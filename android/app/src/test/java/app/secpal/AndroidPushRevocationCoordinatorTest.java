/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

@RunWith(RobolectricTestRunner.class)
public class AndroidPushRevocationCoordinatorTest {
    private static final String API_ORIGIN = "https://tenant-a.example";
    private static final String AUTHORITY = "durable-old-auth-token";
    private static final String TOKEN =
        "fcm-token-one-1234567890abcdefghijklmnopqrstuvwxyz";

    private SharedPreferences preferences;
    private MemoryCipher cipher;
    private AtomicInteger ids;
    private AndroidPushIdentityStorage storage;
    private FakeTransport transport;
    private RecordingPublisher publisher;
    private String revokedInstallationId;

    @Before
    public void setUp() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        preferences = context.getSharedPreferences(
            "push-revocation-" + System.nanoTime(),
            Context.MODE_PRIVATE
        );
        cipher = new MemoryCipher();
        ids = new AtomicInteger();
        storage = createStorage();
        AndroidPushIdentityStorage.State bound = storage.bindRuntime(API_ORIGIN, 3);
        AndroidPushIdentityStorage.State candidate = storage.recordToken(
            API_ORIGIN,
            3,
            bound.installationId(),
            TOKEN
        );
        AndroidPushIdentityStorage.State registered = storage.markRegistered(
            candidate,
            "a".repeat(64),
            "b".repeat(64)
        );
        revokedInstallationId = registered.installationId();
        storage.retainCurrentRegistrationForRevocation(AUTHORITY, false);
        transport = new FakeTransport();
        publisher = new RecordingPublisher();
    }

    @Test
    public void definitiveDeleteStatusesClearTheTombstoneIdempotently()
        throws Exception {
        for (int status : new int[] { 200, 204, 404 }) {
            setUp();
            transport.statusCode = status;

            AndroidPushRevocationCoordinator.Outcome first = coordinator().retry(
                new NativeAuthHttpClient.CancellationSignal()
            );
            AndroidPushRevocationCoordinator.Outcome duplicate = coordinator().retry(
                new NativeAuthHttpClient.CancellationSignal()
            );

            assertEquals(
                AndroidPushRevocationCoordinator.Outcome.Kind.SUCCESS,
                first.kind()
            );
            assertEquals(
                AndroidPushRevocationCoordinator.Outcome.Kind.SUCCESS,
                duplicate.kind()
            );
            assertFalse(storage.load().hasPendingRevocation());
            assertEquals(1, transport.callCount);
            assertEquals(API_ORIGIN, transport.apiOrigin);
            assertEquals(AUTHORITY, transport.authority);
            assertEquals(revokedInstallationId, transport.installationId);
        }
    }

    @Test
    public void offlineCleanupSurvivesRestartAndUsesOnlyDurableAuthority()
        throws Exception {
        transport.failure = new IOException("offline");

        AndroidPushRevocationCoordinator.Outcome offline = coordinator().retry(
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRevocationCoordinator.Outcome.Kind.RETRYABLE_FAILURE,
            offline.kind()
        );
        assertTrue(storage.load().hasPendingRevocation());
        assertFalse(storage.load().hasServerRegistration());
        assertTrue(storage.requiresTokenRotation());
        assertEquals(
            AndroidPushRevocationCoordinator.Status.RETRY_PENDING,
            publisher.lastStatus
        );

        transport.failure = null;
        AndroidPushRevocationCoordinator restarted =
            new AndroidPushRevocationCoordinator(
                createStorage(),
                transport,
                publisher
            );
        AndroidPushRevocationCoordinator.Outcome recovered = restarted.retry(
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRevocationCoordinator.Outcome.Kind.SUCCESS,
            recovered.kind()
        );
        assertEquals(2, transport.callCount);
        assertEquals(API_ORIGIN, transport.apiOrigin);
        assertEquals(AUTHORITY, transport.authority);
        assertFalse(storage.load().hasPendingRevocation());
    }

    @Test
    public void responseValidationFailuresPreserveKnownDefinitiveStatus()
        throws Exception {
        for (int status : new int[] { 401, 403, 404 }) {
            setUp();
            transport.httpFailure = new NativeAuthHttpException(
                "unsupported response",
                status
            );

            AndroidPushRevocationCoordinator.Outcome outcome = coordinator().retry(
                new NativeAuthHttpClient.CancellationSignal()
            );

            assertFalse(storage.load().hasPendingRevocation());
            if (status == 404) {
                assertEquals(
                    AndroidPushRevocationCoordinator.Outcome.Kind.SUCCESS,
                    outcome.kind()
                );
                assertTrue(storage.requiresTokenRotation());
            } else {
                assertEquals(
                    AndroidPushRevocationCoordinator.Outcome.Kind.AUTHORITY_REJECTED,
                    outcome.kind()
                );
                assertTrue(storage.requiresTokenRotation());
            }
        }
    }

    @Test
    public void permanentAuthorityRejectionStopsRetryAndRequiresTokenRotation()
        throws Exception {
        for (int status : new int[] { 401, 403 }) {
            setUp();
            transport.statusCode = status;

            AndroidPushRevocationCoordinator.Outcome rejected = coordinator().retry(
                new NativeAuthHttpClient.CancellationSignal()
            );
            AndroidPushRevocationCoordinator.Outcome duplicate = coordinator().retry(
                new NativeAuthHttpClient.CancellationSignal()
            );

            assertEquals(
                AndroidPushRevocationCoordinator.Outcome.Kind.AUTHORITY_REJECTED,
                rejected.kind()
            );
            assertEquals(
                AndroidPushRevocationCoordinator.Outcome.Kind.SUCCESS,
                duplicate.kind()
            );
            assertFalse(storage.load().hasPendingRevocation());
            assertTrue(storage.requiresTokenRotation());
            assertEquals(1, transport.callCount);
        }
    }

    @Test
    public void ambiguousResponsesAndTimeoutsKeepTheExactTombstone()
        throws Exception {
        transport.statusCode = 503;
        AndroidPushRevocationCoordinator.Outcome rejected = coordinator().retry(
            new NativeAuthHttpClient.CancellationSignal()
        );
        transport.failure = new NativeAuthHttpClient.NativeAuthCancelledException(
            "REQUEST_TIMEOUT",
            null
        );
        AndroidPushRevocationCoordinator.Outcome timeout = coordinator().retry(
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRevocationCoordinator.Outcome.Kind.RETRYABLE_FAILURE,
            rejected.kind()
        );
        assertEquals(
            AndroidPushRevocationCoordinator.Outcome.Kind.RETRYABLE_FAILURE,
            timeout.kind()
        );
        AndroidPushIdentityStorage.State retained = storage.load();
        assertTrue(retained.hasPendingRevocation());
        assertEquals(API_ORIGIN, retained.pendingRevocationApiOrigin());
        assertEquals(
            revokedInstallationId,
            retained.pendingRevocationInstallationId()
        );
        assertEquals(AUTHORITY, retained.pendingRevocationAuthToken());
    }

    @Test
    public void cancellationBeforeAndDuringDeleteLeaveRetryWorkUntouched()
        throws Exception {
        NativeAuthHttpClient.CancellationSignal before =
            new NativeAuthHttpClient.CancellationSignal();
        before.cancel();

        AndroidPushRevocationCoordinator.Outcome cancelledBefore =
            coordinator().retry(before);
        assertEquals(
            AndroidPushRevocationCoordinator.Outcome.Kind.CANCELLED,
            cancelledBefore.kind()
        );
        assertEquals(0, transport.callCount);
        assertTrue(storage.load().hasPendingRevocation());

        transport.cancelDuringRequest = true;
        AndroidPushRevocationCoordinator.Outcome cancelledDuring =
            coordinator().retry(new NativeAuthHttpClient.CancellationSignal());

        assertEquals(
            AndroidPushRevocationCoordinator.Outcome.Kind.CANCELLED,
            cancelledDuring.kind()
        );
        assertEquals(1, transport.callCount);
        assertTrue(storage.load().hasPendingRevocation());
    }

    @Test
    public void definitiveResponseIsPersistedBeforeLateCancellation()
        throws Exception {
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();
        transport.beforeResponse = cancellation::cancel;
        transport.statusCode = 204;

        AndroidPushRevocationCoordinator.Outcome outcome = coordinator().retry(
            cancellation
        );

        assertEquals(
            AndroidPushRevocationCoordinator.Outcome.Kind.CANCELLED,
            outcome.kind()
        );
        assertFalse(storage.load().hasPendingRevocation());
    }

    @Test
    public void rejectedAuthorityIsPersistedBeforeLateCancellation()
        throws Exception {
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();
        transport.beforeResponse = cancellation::cancel;
        transport.statusCode = 401;

        AndroidPushRevocationCoordinator.Outcome outcome = coordinator().retry(
            cancellation
        );

        assertEquals(
            AndroidPushRevocationCoordinator.Outcome.Kind.CANCELLED,
            outcome.kind()
        );
        assertFalse(storage.load().hasPendingRevocation());
        assertTrue(storage.requiresTokenRotation());
    }

    @Test
    public void cancellationExceptionWithKnownResponseIsPersistedFirst()
        throws Exception {
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();
        transport.failure = new NativeAuthHttpClient.NativeAuthCancelledException(
            "REQUEST_CANCELLED",
            null,
            404
        );

        AndroidPushRevocationCoordinator.Outcome outcome = coordinator().retry(
            cancellation
        );

        assertEquals(
            AndroidPushRevocationCoordinator.Outcome.Kind.CANCELLED,
            outcome.kind()
        );
        assertFalse(storage.load().hasPendingRevocation());
    }

    @Test
    public void staleDeleteResponseCannotClearANewerTombstoneOrRegistration()
        throws Exception {
        AndroidPushIdentityStorage.State retained = storage.load();
        AndroidPushIdentityStorage.State candidate = storage.recordToken(
            API_ORIGIN,
            3,
            retained.installationId(),
            TOKEN + "-new"
        );
        storage.markRegistered(candidate, "c".repeat(64), "d".repeat(64));
        String newerInstallationId =
            "00000000-0000-4000-8000-999999999999";
        transport.beforeResponse = () -> {
            try {
                storage.clearPendingRevocation(
                    API_ORIGIN,
                    revokedInstallationId,
                    AUTHORITY
                );
                storage.retainLegacyInstallationForRevocation(
                    newerInstallationId,
                    "newer-durable-authority"
                );
            } catch (TokenStorageException exception) {
                throw new AssertionError(exception);
            }
        };

        AndroidPushRevocationCoordinator.Outcome outcome = coordinator().retry(
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRevocationCoordinator.Outcome.Kind.RETRYABLE_FAILURE,
            outcome.kind()
        );
        AndroidPushIdentityStorage.State current = storage.load();
        assertTrue(current.hasServerRegistration());
        assertEquals(newerInstallationId, current.pendingRevocationInstallationId());
        assertEquals(
            "newer-durable-authority",
            current.pendingRevocationAuthToken()
        );
    }

    @Test
    public void staleDeleteResponseCannotClearTombstoneWithNewerAuthority()
        throws Exception {
        transport.beforeResponse = () -> {
            try {
                storage.prepareRuntimeReset("newer-durable-authority");
            } catch (TokenStorageException exception) {
                throw new AssertionError(exception);
            }
        };

        AndroidPushRevocationCoordinator.Outcome outcome = coordinator().retry(
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRevocationCoordinator.Outcome.Kind.RETRYABLE_FAILURE,
            outcome.kind()
        );
        AndroidPushIdentityStorage.State current = storage.load();
        assertTrue(current.hasPendingRevocation());
        assertEquals(
            revokedInstallationId,
            current.pendingRevocationInstallationId()
        );
        assertEquals(
            "newer-durable-authority",
            current.pendingRevocationAuthToken()
        );
    }

    @Test
    public void nativeTransportUsesTheBoundedDeleteSurface() throws Exception {
        RecordingHttpClient httpClient = new RecordingHttpClient();
        AndroidPushRevocationCoordinator.NativeTransport nativeTransport =
            new AndroidPushRevocationCoordinator.NativeTransport(httpClient);

        int status = nativeTransport.delete(
            API_ORIGIN,
            AUTHORITY,
            revokedInstallationId,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(204, status);
        assertEquals(API_ORIGIN, httpClient.apiOrigin);
        assertEquals(AUTHORITY, httpClient.authority);
        assertEquals("DELETE", httpClient.method);
        assertEquals(
            "/v1/me/notification-installations/" + revokedInstallationId,
            httpClient.path
        );
    }

    private AndroidPushRevocationCoordinator coordinator() {
        return new AndroidPushRevocationCoordinator(storage, transport, publisher);
    }

    private AndroidPushIdentityStorage createStorage() {
        return new AndroidPushIdentityStorage(
            preferences,
            cipher,
            () -> String.format(
                "00000000-0000-4000-8000-%012d",
                ids.incrementAndGet()
            ),
            () -> 1_700_000_000_000L
        );
    }

    private static final class FakeTransport
        implements AndroidPushRevocationCoordinator.Transport {
        private int callCount;
        private int statusCode = 204;
        private IOException failure;
        private NativeAuthHttpException httpFailure;
        private boolean cancelDuringRequest;
        private Runnable beforeResponse;
        private String apiOrigin;
        private String authority;
        private String installationId;

        @Override
        public int delete(
            String requestedApiOrigin,
            String requestedAuthority,
            String requestedInstallationId,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException, NativeAuthHttpException {
            callCount++;
            apiOrigin = requestedApiOrigin;
            authority = requestedAuthority;
            installationId = requestedInstallationId;
            if (cancelDuringRequest) {
                cancellation.cancel();
                cancellation.throwIfCancelled();
            }
            if (failure != null) {
                throw failure;
            }
            if (httpFailure != null) {
                throw httpFailure;
            }
            if (beforeResponse != null) {
                beforeResponse.run();
            }
            return statusCode;
        }
    }

    private static final class RecordingPublisher
        implements AndroidPushRevocationCoordinator.StatusPublisher {
        private AndroidPushRevocationCoordinator.Status lastStatus;

        @Override
        public void publish(AndroidPushRevocationCoordinator.Status status) {
            lastStatus = status;
        }
    }

    private static final class RecordingHttpClient extends NativeAuthHttpClient {
        private String apiOrigin;
        private String authority;
        private String method;
        private String path;

        @Override
        JSObject requestAuxiliaryJson(
            String baseUrl,
            String token,
            String requestMethod,
            String requestPath,
            String bodyBase64,
            String contentType,
            String accept,
            CancellationSignal cancellation
        ) {
            apiOrigin = baseUrl;
            authority = token;
            method = requestMethod;
            path = requestPath;
            JSObject response = new JSObject();
            response.put("status", 204);
            response.put("bodyBase64", "");
            return response;
        }
    }

    private static final class MemoryCipher implements TokenCipher {
        private final Map<String, String> plaintextByCiphertext = new HashMap<>();
        private int sequence;

        @Override
        public EncryptedTokenPayload encrypt(String plaintext) {
            String ciphertext = "encrypted-" + ++sequence;
            plaintextByCiphertext.put(ciphertext, plaintext);
            return new EncryptedTokenPayload(ciphertext, "iv-" + sequence);
        }

        @Override
        public String decrypt(EncryptedTokenPayload payload)
            throws TokenStorageException {
            String plaintext = plaintextByCiphertext.get(payload.getCiphertext());
            assertNotNull(plaintext);
            return plaintext;
        }
    }
}
