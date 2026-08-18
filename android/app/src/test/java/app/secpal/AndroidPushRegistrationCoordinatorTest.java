/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import com.getcapacitor.JSObject;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

@RunWith(RobolectricTestRunner.class)
public class AndroidPushRegistrationCoordinatorTest {
    private static final String API_ORIGIN = "https://tenant-a.example";
    private static final String AUTHORITY = "native-auth-token";
    private static final String TOKEN =
        "fcm-token-one-1234567890abcdefghijklmnopqrstuvwxyz";

    private SharedPreferences preferences;
    private MemoryCipher cipher;
    private AtomicInteger ids;
    private AndroidPushIdentityStorage storage;
    private FakeTransport transport;
    private RecordingPublisher publisher;

    @Before
    public void setUp() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        preferences = context.getSharedPreferences(
            "push-registration-" + System.nanoTime(),
            Context.MODE_PRIVATE
        );
        cipher = new MemoryCipher();
        ids = new AtomicInteger();
        storage = createStorage();
        AndroidPushIdentityStorage.State bound = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(API_ORIGIN, 3, bound.installationId(), TOKEN);
        transport = new FakeTransport();
        publisher = new RecordingPublisher();
    }

    @Test
    public void firstRegistrationIsPutOnceAndDuplicateCallbacksAndRestartAreNoOps()
        throws Exception {
        AndroidPushRegistrationCoordinator coordinator = coordinator(client("1.2.3", 7));

        AndroidPushRegistrationCoordinator.Outcome first = coordinator.synchronize(
            AUTHORITY,
            new NativeAuthHttpClient.CancellationSignal()
        );
        AndroidPushRegistrationCoordinator.Outcome duplicate = coordinator.synchronize(
            AUTHORITY,
            new NativeAuthHttpClient.CancellationSignal()
        );
        AndroidPushRegistrationCoordinator restarted = new AndroidPushRegistrationCoordinator(
            createStorage(),
            transport,
            client("1.2.3", 7),
            publisher
        );
        AndroidPushRegistrationCoordinator.Outcome afterRestart = restarted.synchronize(
            AUTHORITY,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(AndroidPushRegistrationCoordinator.Outcome.Kind.SUCCESS, first.kind());
        assertEquals(
            AndroidPushRegistrationCoordinator.LifecycleEvent.REGISTERED,
            first.lifecycleEvent()
        );
        assertEquals(
            AndroidPushRegistrationCoordinator.LifecycleEvent.UNCHANGED,
            duplicate.lifecycleEvent()
        );
        assertEquals(
            AndroidPushRegistrationCoordinator.LifecycleEvent.UNCHANGED,
            afterRestart.lifecycleEvent()
        );
        assertEquals(1, transport.callCount);
        assertEquals("PUT", transport.method);
        assertEquals("registered", transport.payload.getString("lifecycle_event"));
        assertEquals("android_fcm", transport.payload.getString("channel"));
        assertEquals(TOKEN, transport.payload
            .getJSONObject("registration")
            .getString("push_token"));
        assertEquals(
            AndroidPushRegistrationCoordinator.Status.SYNCHRONIZED,
            publisher.lastStatus
        );
    }

    @Test
    public void tokenAndClientChangesUseDistinctLifecycleEvents() throws Exception {
        coordinator(client("1.2.3", 7)).synchronize(
            AUTHORITY,
            new NativeAuthHttpClient.CancellationSignal()
        );
        AndroidPushIdentityStorage.State registered = storage.load();
        storage.recordToken(
            API_ORIGIN,
            3,
            registered.installationId(),
            TOKEN + "-rotated"
        );

        AndroidPushRegistrationCoordinator.Outcome rotated = coordinator(
            client("1.2.3", 7)
        ).synchronize(AUTHORITY, new NativeAuthHttpClient.CancellationSignal());

        assertEquals(
            AndroidPushRegistrationCoordinator.LifecycleEvent.CREDENTIAL_ROTATED,
            rotated.lifecycleEvent()
        );
        assertEquals(
            "credential_rotated",
            transport.payload.getString("lifecycle_event")
        );

        AndroidPushRegistrationCoordinator.Outcome clientUpdated = coordinator(
            client("1.2.4", 8)
        ).synchronize(AUTHORITY, new NativeAuthHttpClient.CancellationSignal());

        assertEquals(
            AndroidPushRegistrationCoordinator.LifecycleEvent.CLIENT_UPDATED,
            clientUpdated.lifecycleEvent()
        );
        assertEquals(3, transport.callCount);
        assertEquals("client_updated", transport.payload.getString("lifecycle_event"));
    }

    @Test
    public void missingAndOversizedAuthorityNeverReachTransport() throws Exception {
        AndroidPushRegistrationCoordinator coordinator = coordinator(client("1.2.3", 7));

        AndroidPushRegistrationCoordinator.Outcome missing = coordinator.synchronize(
            "   ",
            new NativeAuthHttpClient.CancellationSignal()
        );
        AndroidPushRegistrationCoordinator.Outcome oversized = coordinator.synchronize(
            "a".repeat(AndroidPushIdentityStorage.MAX_AUTH_TOKEN_CHARACTERS + 1),
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.AUTHENTICATION_REJECTED,
            missing.kind()
        );
        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.AUTHENTICATION_REJECTED,
            oversized.kind()
        );
        assertEquals(0, transport.callCount);
        assertEquals(
            AndroidPushRegistrationCoordinator.Status.AUTHENTICATION_REJECTED,
            publisher.lastStatus
        );
    }

    @Test
    public void serverAuthenticationAndRuntimeRejectionsRemainTyped() throws Exception {
        AndroidPushRegistrationCoordinator coordinator = coordinator(client("1.2.3", 7));
        transport.response = new AndroidPushRegistrationCoordinator.Transport.Response(
            401,
            null
        );

        AndroidPushRegistrationCoordinator.Outcome authentication = coordinator.synchronize(
            AUTHORITY,
            new NativeAuthHttpClient.CancellationSignal()
        );
        transport.response = new AndroidPushRegistrationCoordinator.Transport.Response(
            409,
            "NOTIFICATION_RUNTIME_STATE_INVALID"
        );
        AndroidPushRegistrationCoordinator.Outcome reconfiguration = coordinator.synchronize(
            AUTHORITY,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.AUTHENTICATION_REJECTED,
            authentication.kind()
        );
        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.RECONFIGURATION_REQUIRED,
            reconfiguration.kind()
        );
        assertTrue(storage.load().isReconfigurationRequired());
        assertEquals(
            AndroidPushRegistrationCoordinator.Status.RECONFIGURATION_REQUIRED,
            publisher.lastStatus
        );
    }

    @Test
    public void staleRuntimeReconfigurationIsRetriedWithoutPublishingIt()
        throws Exception {
        String originalInstallationId = storage.load().installationId();
        transport.response = new AndroidPushRegistrationCoordinator.Transport.Response(
            409,
            "NOTIFICATION_RUNTIME_STATE_INVALID"
        );
        transport.beforeResponse = () -> {
            try {
                storage.bindRuntime("https://tenant-b.example", 4);
            } catch (TokenStorageException exception) {
                throw new AssertionError(exception);
            }
        };

        AndroidPushRegistrationCoordinator.Outcome outcome = coordinator(
            client("1.2.3", 7)
        ).synchronize(AUTHORITY, new NativeAuthHttpClient.CancellationSignal());

        AndroidPushIdentityStorage.State rebound = storage.load();
        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.RETRYABLE_FAILURE,
            outcome.kind()
        );
        assertEquals(
            AndroidPushRegistrationCoordinator.Status.RETRY_PENDING,
            publisher.lastStatus
        );
        assertNotEquals(originalInstallationId, rebound.installationId());
        assertFalse(rebound.isReconfigurationRequired());
        assertEquals(1, transport.callCount);
    }

    @Test
    public void staleAuthenticationRejectionIsRetriedWithoutPublishingIt()
        throws Exception {
        String originalInstallationId = storage.load().installationId();
        transport.response = new AndroidPushRegistrationCoordinator.Transport.Response(
            401,
            null
        );
        transport.beforeResponse = () -> {
            try {
                storage.bindRuntime("https://tenant-b.example", 4);
            } catch (TokenStorageException exception) {
                throw new AssertionError(exception);
            }
        };

        AndroidPushRegistrationCoordinator.Outcome outcome = coordinator(
            client("1.2.3", 7)
        ).synchronize(AUTHORITY, new NativeAuthHttpClient.CancellationSignal());

        AndroidPushIdentityStorage.State rebound = storage.load();
        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.RETRYABLE_FAILURE,
            outcome.kind()
        );
        assertEquals(
            AndroidPushRegistrationCoordinator.Status.RETRY_PENDING,
            publisher.lastStatus
        );
        assertNotEquals(originalInstallationId, rebound.installationId());
        assertEquals(1, transport.callCount);
    }

    @Test
    public void callerCancellationTakesPrecedenceOverInvalidAuthority()
        throws Exception {
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();
        cancellation.cancel();

        AndroidPushRegistrationCoordinator.Outcome outcome = coordinator(
            client("1.2.3", 7)
        ).synchronize(" ", cancellation);

        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.CANCELLED,
            outcome.kind()
        );
        assertEquals(
            AndroidPushRegistrationCoordinator.Status.CANCELLED,
            publisher.lastStatus
        );
        assertEquals(0, transport.callCount);
    }

    @Test
    public void transportRequestTimeoutRemainsRetryable() throws Exception {
        transport.failure = new NativeAuthHttpClient.NativeAuthCancelledException(
            "REQUEST_TIMEOUT",
            null
        );

        AndroidPushRegistrationCoordinator.Outcome outcome = coordinator(
            client("1.2.3", 7)
        ).synchronize(AUTHORITY, new NativeAuthHttpClient.CancellationSignal());

        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.RETRYABLE_FAILURE,
            outcome.kind()
        );
        assertEquals(
            AndroidPushRegistrationCoordinator.Status.RETRY_PENDING,
            publisher.lastStatus
        );
    }

    @Test
    public void authenticationStatusSurvivesTransportResponseValidationFailure()
        throws Exception {
        transport.httpFailure = new NativeAuthHttpException(
            "Android auth bridge response exceeds the allowed size",
            401
        );

        AndroidPushRegistrationCoordinator.Outcome outcome = coordinator(
            client("1.2.3", 7)
        ).synchronize(AUTHORITY, new NativeAuthHttpClient.CancellationSignal());

        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.AUTHENTICATION_REJECTED,
            outcome.kind()
        );
        assertEquals(
            AndroidPushRegistrationCoordinator.Status.AUTHENTICATION_REJECTED,
            publisher.lastStatus
        );
    }

    @Test
    public void tokenRotatedDuringFirstPutIsRetriedAsCredentialRotation()
        throws Exception {
        transport.beforeResponse = () -> {
            try {
                AndroidPushIdentityStorage.State current = storage.load();
                storage.recordToken(
                    API_ORIGIN,
                    3,
                    current.installationId(),
                    TOKEN + "-rotated-during-put"
                );
            } catch (TokenStorageException exception) {
                throw new AssertionError(exception);
            }
        };

        AndroidPushRegistrationCoordinator.Outcome staleSuccess = coordinator(
            client("1.2.3", 7)
        ).synchronize(AUTHORITY, new NativeAuthHttpClient.CancellationSignal());
        transport.beforeResponse = null;
        AndroidPushRegistrationCoordinator.Outcome rotated = coordinator(
            client("1.2.3", 7)
        ).synchronize(AUTHORITY, new NativeAuthHttpClient.CancellationSignal());

        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.RETRYABLE_FAILURE,
            staleSuccess.kind()
        );
        assertEquals(
            AndroidPushRegistrationCoordinator.LifecycleEvent.CREDENTIAL_ROTATED,
            rotated.lifecycleEvent()
        );
        assertEquals(
            "credential_rotated",
            transport.payload.getString("lifecycle_event")
        );
        assertEquals(2, transport.callCount);
    }

    @Test
    public void runtimeBindingChangedDuringPutDoesNotConfirmTheStaleCandidate()
        throws Exception {
        String originalInstallationId = storage.load().installationId();
        transport.beforeResponse = () -> {
            try {
                storage.bindRuntime("https://tenant-b.example", 4);
            } catch (TokenStorageException exception) {
                throw new AssertionError(exception);
            }
        };

        AndroidPushRegistrationCoordinator.Outcome outcome = coordinator(
            client("1.2.3", 7)
        ).synchronize(AUTHORITY, new NativeAuthHttpClient.CancellationSignal());

        AndroidPushIdentityStorage.State rebound = storage.load();
        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.RETRYABLE_FAILURE,
            outcome.kind()
        );
        assertNotEquals(originalInstallationId, rebound.installationId());
        assertFalse(rebound.hasServerRegistration());
        assertEquals(1, transport.callCount);
    }

    @Test
    public void transportFailureAndCancellationRemainTyped() throws Exception {
        AndroidPushRegistrationCoordinator coordinator = coordinator(client("1.2.3", 7));
        transport.failure = new IOException("offline");
        AndroidPushRegistrationCoordinator.Outcome retryable = coordinator.synchronize(
            AUTHORITY,
            new NativeAuthHttpClient.CancellationSignal()
        );

        transport.failure = null;
        transport.cancelBeforeResponse = true;
        AndroidPushRegistrationCoordinator.Outcome cancelled = coordinator.synchronize(
            AUTHORITY,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.RETRYABLE_FAILURE,
            retryable.kind()
        );
        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.CANCELLED,
            cancelled.kind()
        );
        assertEquals(AndroidPushRegistrationCoordinator.Status.CANCELLED, publisher.lastStatus);
        assertFalse(storage.load().hasServerRegistration());
    }

    @Test
    public void nativeTransportUsesTheBoundedPutSurfaceAndParsesErrorCode()
        throws Exception {
        RecordingHttpClient httpClient = new RecordingHttpClient();
        AndroidPushRegistrationCoordinator.NativeTransport nativeTransport =
            new AndroidPushRegistrationCoordinator.NativeTransport(httpClient);
        JSONObject payload = new JSONObject().put("channel", "android_fcm");

        AndroidPushRegistrationCoordinator.Transport.Response response =
            nativeTransport.put(
                API_ORIGIN,
                AUTHORITY,
                "00000000-0000-4000-8000-000000000001",
                payload,
                new NativeAuthHttpClient.CancellationSignal()
            );

        assertEquals(API_ORIGIN, httpClient.apiOrigin);
        assertEquals(AUTHORITY, httpClient.authority);
        assertEquals("PUT", httpClient.method);
        assertEquals(
            "/v1/me/notification-installations/00000000-0000-4000-8000-000000000001",
            httpClient.path
        );
        assertEquals(
            payload.toString(),
            new String(
                Base64.decode(httpClient.requestBodyBase64, Base64.DEFAULT),
                StandardCharsets.UTF_8
            )
        );
        assertEquals(409, response.statusCode());
        assertEquals("NOTIFICATION_CHANNEL_UNSUPPORTED", response.errorCode());
    }

    private AndroidPushRegistrationCoordinator coordinator(
        AndroidPushRegistrationCoordinator.ClientMetadata metadata
    ) {
        return new AndroidPushRegistrationCoordinator(
            storage,
            transport,
            metadata,
            publisher
        );
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

    private static AndroidPushRegistrationCoordinator.ClientMetadata client(
        String versionName,
        long versionCode
    ) {
        return new AndroidPushRegistrationCoordinator.ClientMetadata(
            "Samsung reception tablet",
            "app.secpal",
            versionName,
            versionCode,
            "Samsung",
            "SM-G556B",
            "16",
            36,
            "v1",
            4
        );
    }

    private static final class FakeTransport
        implements AndroidPushRegistrationCoordinator.Transport {
        private int callCount;
        private String method;
        private JSONObject payload;
        private Response response = new Response(200, null);
        private IOException failure;
        private NativeAuthHttpException httpFailure;
        private boolean cancelBeforeResponse;
        private Runnable beforeResponse;

        @Override
        public Response put(
            String apiOrigin,
            String authority,
            String installationId,
            JSONObject requestPayload,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException, NativeAuthHttpException {
            callCount++;
            method = "PUT";
            payload = requestPayload;
            if (failure != null) {
                throw failure;
            }
            if (httpFailure != null) {
                throw httpFailure;
            }
            if (beforeResponse != null) {
                beforeResponse.run();
            }
            if (cancelBeforeResponse) {
                cancellation.cancel();
            }
            return response;
        }
    }

    private static final class RecordingPublisher
        implements AndroidPushRegistrationCoordinator.StatusPublisher {
        private AndroidPushRegistrationCoordinator.Status lastStatus;

        @Override
        public void publish(AndroidPushRegistrationCoordinator.Status status) {
            lastStatus = status;
        }
    }

    private static final class RecordingHttpClient extends NativeAuthHttpClient {
        private String apiOrigin;
        private String authority;
        private String method;
        private String path;
        private String requestBodyBase64;

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
            requestBodyBase64 = bodyBase64;
            JSObject response = new JSObject();
            response.put("status", 409);
            response.put(
                "bodyBase64",
                Base64.encodeToString(
                    ("{\"code\":\"NOTIFICATION_CHANNEL_UNSUPPORTED\"}")
                        .getBytes(StandardCharsets.UTF_8),
                    Base64.NO_WRAP
                )
            );
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
