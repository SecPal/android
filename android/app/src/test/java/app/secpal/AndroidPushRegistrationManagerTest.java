/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.SharedPreferences;
import android.util.Base64;

import com.getcapacitor.JSObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
public class AndroidPushRegistrationManagerTest {
    private static final String API_ORIGIN = "https://tenant-a.example";
    private static final String TOKEN_ONE =
        "fcm-token-one-1234567890abcdefghijklmnopqrstuvwxyz";
    private static final String TOKEN_TWO =
        "fcm-token-two-1234567890abcdefghijklmnopqrstuvwxyz";

    @Test
    public void protectedStateNeverPersistsRawIdentityValues() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        AndroidPushIdentityStorage storage = createStorage(preferences);

        AndroidPushIdentityStorage.State state = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(API_ORIGIN, 3, TOKEN_ONE);

        String persisted = preferences.getString(
            AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY,
            null
        );
        assertFalse(persisted.contains(TOKEN_ONE));
        assertFalse(persisted.contains(state.installationId()));
        assertFalse(preferences.getAll().containsValue(TOKEN_ONE));
        assertFalse(preferences.getAll().containsValue(state.installationId()));
    }

    @Test
    public void appRestartReusesBindingButRuntimeChangeInvalidatesIt() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        AndroidPushIdentityStorage storage = createStorage(preferences, cipher, ids);

        AndroidPushIdentityStorage.State first = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(API_ORIGIN, 3, TOKEN_ONE);
        AndroidPushIdentityStorage restarted = createStorage(preferences, cipher, ids);
        AndroidPushIdentityStorage.State restored = restarted.bindRuntime(API_ORIGIN, 3);

        assertEquals(first.installationId(), restored.installationId());
        assertEquals(TOKEN_ONE, restored.token());

        AndroidPushIdentityStorage.State rebound = restarted.bindRuntime(
            "https://tenant-b.example",
            4
        );
        assertNotEquals(first.installationId(), rebound.installationId());
        assertNull(rebound.token());
    }

    @Test
    public void failedBindLeavesThePreviousRuntimeOperational() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        SwitchableCipher cipher = new SwitchableCipher();
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, new AtomicInteger()),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));

        cipher.failEncryption = true;
        try {
            manager.bindRuntime("https://tenant-b.example", pushMetadata(4));
            fail("Expected protected storage failure");
        } catch (TokenStorageException expected) {
            // The previously published runtime binding must remain authoritative.
        }
        cipher.failEncryption = false;

        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );

        assertEquals(1, backend.lifecycleEvents.size());
        assertEquals(API_ORIGIN, backend.registrationApiOrigins.get(0));
        assertEquals("registered", manager.getStatus().getString("state"));
    }

    @Test
    public void corruptColdStartStateIsInvalidatedAndFreshlyBound() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        preferences.edit()
            .putString(AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY, "corrupt")
            .putString(AndroidPushIdentityStorage.STATE_IV_KEY, "corrupt")
            .commit();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        AndroidPushIdentityStorage storage = createStorage(preferences, cipher, ids);
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            new RecordingBackend()
        );

        manager.restoreRuntime(API_ORIGIN, pushMetadata(3));

        assertEquals("awaiting_token", manager.getStatus().getString("state"));
        assertTrue(manager.getStatus().getBool("configured"));
        assertTrue(manager.requiresTokenRotation());
        assertEquals(API_ORIGIN, storage.load().apiOrigin());

        AndroidPushRegistrationManager restarted = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            new RecordingBackend()
        );
        restarted.restoreRuntime(API_ORIGIN, pushMetadata(3));
        assertTrue(restarted.requiresTokenRotation());

        restarted.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );

        assertFalse(restarted.requiresTokenRotation());
    }

    @Test
    public void coldStartRestoresPendingRuntimeCleanupWithoutNetworkIo()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        manager.prepareRuntimeReset("auth-token");

        AndroidPushRegistrationManager restarted = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );

        assertTrue(restarted.restorePendingRuntimeClear());
        assertEquals(0, backend.unregisterCount);
        assertEquals("retry_pending", restarted.getStatus().getString("state"));
        assertFalse(restarted.getStatus().getBool("configured"));

        assertTrue(restarted.clearRuntime(null));
        assertEquals(1, backend.unregisterCount);
    }

    @Test
    public void activeProtectedStateInvalidationRecreatesBindingBeforeRetry()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        AndroidPushIdentityStorage storage = createStorage(preferences);
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        preferences.edit()
            .putString(AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY, "corrupt")
            .putString(AndroidPushIdentityStorage.STATE_IV_KEY, "corrupt")
            .commit();

        try {
            manager.onAuthenticated("auth-token");
            fail("Expected protected storage failure");
        } catch (TokenStorageException expected) {
            manager.onProtectedStateError();
        }

        assertEquals("retry_pending", manager.getStatus().getString("state"));
        assertTrue(manager.requiresTokenRotation());
        assertEquals(API_ORIGIN, storage.load().apiOrigin());

        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );

        assertEquals("registered", manager.getStatus().getString("state"));
        assertFalse(manager.requiresTokenRotation());
        assertEquals(1, backend.lifecycleEvents.size());
    }

    @Test
    public void duplicateAndRotatedTokensAreRegisteredIdempotently() throws Exception {
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));

        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        manager.onAuthenticated("auth-token");

        assertEquals(1, backend.lifecycleEvents.size());
        assertEquals("registered", backend.lifecycleEvents.get(0));
        assertEquals("registered", manager.getStatus().getString("state"));

        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_TWO,
            "auth-token"
        );
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_TWO,
            "auth-token"
        );

        assertEquals(2, backend.lifecycleEvents.size());
        assertEquals("credential_rotated", backend.lifecycleEvents.get(1));
    }

    @Test
    public void changedAuthenticationCredentialRegistersForTheNewPrincipal()
        throws Exception {
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            backend,
            "1.5.0",
            10500
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "first-user-auth-token"
        );

        manager.onAuthenticated("second-user-auth-token");

        assertEquals(2, backend.lifecycleEvents.size());
        assertEquals("credential_rotated", backend.lifecycleEvents.get(1));
    }

    @Test
    public void appUpgradeRefreshesRegistrationMetadataWithAnUnchangedToken()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager firstVersion =
            new AndroidPushRegistrationManager(
                createStorage(preferences, cipher, ids),
                backend,
                "1.5.0",
                10500
            );
        firstVersion.bindRuntime(API_ORIGIN, pushMetadata(3));
        firstVersion.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );

        AndroidPushRegistrationManager upgraded = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend,
            "1.6.0",
            10600
        );
        upgraded.bindRuntime(API_ORIGIN, pushMetadata(3));
        upgraded.onAuthenticated("auth-token");

        assertEquals(2, backend.lifecycleEvents.size());
        assertEquals("credential_rotated", backend.lifecycleEvents.get(1));
    }

    @Test
    public void coldStartRestoresTheRegisteredAbstractStatus() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );

        AndroidPushRegistrationManager restarted = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        restarted.bindRuntime(API_ORIGIN, pushMetadata(3));

        assertEquals("registered", restarted.getStatus().getString("state"));
        assertFalse(restarted.getStatus().has("token"));
        assertFalse(restarted.getStatus().has("installationId"));
        assertEquals(1, backend.lifecycleEvents.size());
    }

    @Test
    public void logoutRevokesBeforeReauthenticationAndKeepsIdentifiersNative()
        throws Exception {
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );

        manager.onLogout("auth-token");

        assertEquals(1, backend.unregisterCount);
        assertEquals("awaiting_auth", manager.getStatus().getString("state"));
        assertFalse(manager.getStatus().has("installationId"));
        assertFalse(manager.getStatus().has("token"));
        assertFalse(manager.getStatus().has("tokenReceivedAt"));

        manager.onAuthenticated("next-auth-token");
        assertEquals(2, backend.lifecycleEvents.size());
        assertEquals("registered", backend.lifecycleEvents.get(1));
    }

    @Test
    public void staleTokenErrorCannotOverwriteLoggedOutStatus() throws Exception {
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            new RecordingBackend()
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        manager.onLogout("auth-token");

        manager.onTokenError(AndroidPushRegistrationManager.RUNTIME_APP_NAME);

        assertEquals("awaiting_auth", manager.getStatus().getString("state"));
        assertFalse(manager.getStatus().getBool("retryable"));
    }

    @Test
    public void disabledRuntimeRemainsDisabledAcrossAuthenticationAndLogout()
        throws Exception {
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            new RecordingBackend()
        );
        manager.bindRuntime(API_ORIGIN, null);

        manager.onAuthenticated("auth-token");
        assertEquals("disabled", manager.getStatus().getString("state"));
        assertFalse(manager.getStatus().getBool("configured"));

        manager.onTokenError(AndroidPushRegistrationManager.RUNTIME_APP_NAME);
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        assertEquals("disabled", manager.getStatus().getString("state"));

        manager.onLogout("auth-token");
        assertEquals("disabled", manager.getStatus().getString("state"));
        assertFalse(manager.getStatus().getBool("retryable"));
    }

    @Test
    public void runtimeChangeRevokesAndInvalidatesThePreviousBinding()
        throws Exception {
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );

        AndroidPushRegistrationManager.RebindResult rebind = manager.rebindRuntime(
            "https://tenant-b.example",
            pushMetadata(4)
        );
        manager.revokePrevious(
            rebind,
            "auth-token",
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(1, backend.unregisterCount);
        assertEquals("awaiting_token", manager.getStatus().getString("state"));
        assertFalse(manager.getStatus().has("apiOrigin"));
        assertFalse(manager.getStatus().has("metadataRevision"));
    }

    @Test
    public void tokenErrorDuringRebindRemainsRetryableAfterPreviousRevocation()
        throws Exception {
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        AndroidPushRegistrationManager.RebindResult rebind = manager.rebindRuntime(
            "https://tenant-b.example",
            pushMetadata(4)
        );

        manager.onTokenError(AndroidPushRegistrationManager.RUNTIME_APP_NAME);
        manager.revokePrevious(
            rebind,
            "auth-token",
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals("retry_pending", manager.getStatus().getString("state"));
        assertEquals(
            "TOKEN_UNAVAILABLE",
            manager.getStatus().getString("failureCode")
        );
    }

    @Test
    public void rejectedPreviousRevocationFailsTheRebindAndAllowsRollback()
        throws Exception {
        RecordingBackend backend = new RecordingBackend();
        backend.unregisterStatus = 500;
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        String originalInstallationId = storage.load().installationId();
        AndroidPushRegistrationManager.RebindResult rebind = manager.rebindRuntime(
            "https://tenant-b.example",
            pushMetadata(4)
        );

        try {
            manager.revokePrevious(
                rebind,
                "auth-token",
                new NativeAuthHttpClient.CancellationSignal()
            );
            fail("Expected rejected previous registration revocation");
        } catch (IllegalStateException expected) {
            manager.rollbackRebind(rebind);
        }

        assertEquals(originalInstallationId, storage.load().installationId());
        assertEquals("registered", manager.getStatus().getString("state"));
    }

    @Test
    public void interruptedRebindRetainsPreviousRevocationForColdStartRetry()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        backend.unregisterStatus = 500;
        AndroidPushRegistrationManager.RebindResult interrupted = manager.rebindRuntime(
            API_ORIGIN,
            pushMetadata(4)
        );
        try {
            manager.revokePrevious(
                interrupted,
                "auth-token",
                new NativeAuthHttpClient.CancellationSignal()
            );
            fail("Expected rejected previous registration revocation");
        } catch (IllegalStateException expected) {
            // Simulate process termination before the in-memory rollback can run.
        }

        backend.unregisterStatus = 204;
        AndroidPushRegistrationManager restarted = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        restarted.bindRuntime(API_ORIGIN, pushMetadata(4));
        restarted.onAuthenticated("auth-token");

        assertEquals(2, backend.unregisterCount);
        assertEquals("awaiting_token", restarted.getStatus().getString("state"));
    }

    @Test
    public void successfulRevocationWithFailedCleanupRollbackForcesReregistration()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FailNextEncryptionCipher cipher = new FailNextEncryptionCipher();
        AndroidPushIdentityStorage storage = createStorage(
            preferences,
            cipher,
            new AtomicInteger()
        );
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        AndroidPushRegistrationManager.RebindResult rebind = manager.rebindRuntime(
            API_ORIGIN,
            pushMetadata(4)
        );
        backend.beforeUnregister = () -> cipher.failNextEncryption = true;

        try {
            manager.revokePrevious(
                rebind,
                "auth-token",
                new NativeAuthHttpClient.CancellationSignal()
            );
            fail("Expected failed cleanup persistence");
        } catch (IllegalStateException expected) {
            manager.rollbackRebind(rebind);
        }

        manager.onAuthenticated("auth-token");

        assertEquals(2, backend.lifecycleEvents.size());
        assertEquals("registered", manager.getStatus().getString("state"));
    }

    @Test
    public void restartedCrossTenantBindingNeverSendsTheNewBearerToTheOldOrigin()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "old-tenant-auth-token"
        );
        backend.unregisterStatus = 500;
        AndroidPushRegistrationManager.RebindResult interrupted = manager.rebindRuntime(
            "https://tenant-b.example",
            pushMetadata(4),
            "old-tenant-auth-token"
        );
        try {
            manager.revokePrevious(
                interrupted,
                "old-tenant-auth-token",
                new NativeAuthHttpClient.CancellationSignal()
            );
            fail("Expected rejected previous registration revocation");
        } catch (IllegalStateException expected) {
            // Simulate process termination before rollback.
        }

        backend.unregisterStatus = 204;
        AndroidPushRegistrationManager restarted = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        restarted.bindRuntime("https://tenant-b.example", pushMetadata(4));
        restarted.onAuthenticated(null);

        assertEquals(2, backend.unregisterCount);
        assertEquals("awaiting_token", restarted.getStatus().getString("state"));

        restarted.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_TWO,
            "new-tenant-auth-token"
        );

        assertEquals(
            "old-tenant-auth-token",
            backend.unregistrationAuthTokens.get(1)
        );
        assertEquals(API_ORIGIN, backend.unregistrationApiOrigins.get(1));
        assertEquals(2, backend.lifecycleEvents.size());
        assertEquals(
            "https://tenant-b.example",
            backend.registrationApiOrigins.get(1)
        );
        assertEquals("new-tenant-auth-token", backend.registrationAuthTokens.get(1));
        assertEquals("registered", restarted.getStatus().getString("state"));
    }

    @Test
    public void stagedCrossTenantRebindSurvivesBootstrapPersistenceCrash()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "old-tenant-auth-token"
        );
        manager.prepareRuntimeRebind(
            "https://tenant-b.example",
            "old-tenant-auth-token"
        );

        AndroidPushRegistrationManager restarted = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        restarted.restoreRuntime("https://tenant-b.example", pushMetadata(4));
        restarted.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_TWO,
            "new-tenant-auth-token"
        );

        assertEquals(1, backend.unregisterCount);
        assertEquals(API_ORIGIN, backend.unregistrationApiOrigins.get(0));
        assertEquals(
            "old-tenant-auth-token",
            backend.unregistrationAuthTokens.get(0)
        );
        assertEquals("registered", restarted.getStatus().getString("state"));
    }

    @Test
    public void stagedSameOriginRevisionChangeSurvivesBootstrapPersistenceCrash()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "old-auth-token"
        );
        manager.prepareRuntimeRebind(API_ORIGIN, "old-auth-token");

        AndroidPushRegistrationManager restarted = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        restarted.restoreRuntime(API_ORIGIN, pushMetadata(4));
        restarted.onAuthenticated(null);

        assertEquals(1, backend.unregisterCount);
        assertEquals("old-auth-token", backend.unregistrationAuthTokens.get(0));
        assertEquals(API_ORIGIN, backend.unregistrationApiOrigins.get(0));
        assertEquals("awaiting_token", restarted.getStatus().getString("state"));
    }

    @Test
    public void stagedCrossTenantRebindNeverUsesTheNewTenantBearer()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "old-tenant-auth-token"
        );
        manager.prepareRuntimeRebind(
            "https://tenant-b.example",
            "old-tenant-auth-token"
        );

        AndroidPushRegistrationManager restarted = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        AndroidPushRegistrationManager.RebindResult rebind = restarted.restoreRuntime(
            "https://tenant-b.example",
            pushMetadata(4)
        );
        restarted.revokePrevious(
            rebind,
            "new-tenant-auth-token",
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(1, backend.unregisterCount);
        assertEquals(
            "old-tenant-auth-token",
            backend.unregistrationAuthTokens.get(0)
        );
        assertEquals(API_ORIGIN, backend.unregistrationApiOrigins.get(0));
    }

    @Test
    public void crossTenantRebindWithoutRevocationAuthorityFailsBeforeMutation()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            new RecordingBackend()
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "old-tenant-auth-token"
        );
        String installationId = storage.load().installationId();

        try {
            manager.prepareRuntimeRebind("https://tenant-b.example", null);
            fail("Expected missing cross-tenant revocation authority to fail");
        } catch (TokenStorageException expected) {
            assertEquals(
                "Android push revocation authority is unavailable",
                expected.getMessage()
            );
        }

        AndroidPushIdentityStorage.State unchanged = storage.load();
        assertEquals(API_ORIGIN, unchanged.apiOrigin());
        assertEquals(installationId, unchanged.installationId());
        assertFalse(unchanged.hasPendingRebind());
    }

    @Test
    public void stagedCrossTenantRebindIsDiscardedWhenOldBootstrapRemains()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "old-tenant-auth-token"
        );
        manager.prepareRuntimeRebind(
            "https://tenant-b.example",
            "old-tenant-auth-token"
        );

        AndroidPushRegistrationManager restarted = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        restarted.restoreRuntime(API_ORIGIN, pushMetadata(3));
        restarted.onAuthenticated("old-tenant-auth-token");

        assertEquals(0, backend.unregisterCount);
        assertEquals("registered", restarted.getStatus().getString("state"));
    }

    @Test
    public void runtimeResetCrashRetainsRevocationAuthorityUntilCleanupSucceeds()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        RecordingBackend backend = new RecordingBackend();
        AndroidPushIdentityStorage storage = createStorage(preferences, cipher, ids);
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "reset-auth-token"
        );
        String installationId = storage.load().installationId();
        manager.prepareRuntimeReset("reset-auth-token");

        backend.offlineUnregistration = true;
        AndroidPushRegistrationManager firstRestart =
            new AndroidPushRegistrationManager(
                createStorage(preferences, cipher, ids),
                backend
            );

        assertFalse(firstRestart.clearRuntime(null));
        AndroidPushIdentityStorage.State retained = storage.load();
        assertNotNull(retained);
        assertTrue(retained.hasPendingRevocation());
        assertEquals(API_ORIGIN, retained.pendingRevocationApiOrigin());
        assertEquals(installationId, retained.pendingRevocationInstallationId());
        assertNotEquals(installationId, retained.installationId());
        assertEquals("reset-auth-token", retained.pendingRevocationAuthToken());

        backend.offlineUnregistration = false;
        AndroidPushRegistrationManager secondRestart =
            new AndroidPushRegistrationManager(
                createStorage(preferences, cipher, ids),
                backend
            );

        assertTrue(secondRestart.clearRuntime(null));
        assertNull(storage.load());
        assertEquals(2, backend.unregisterCount);
        assertEquals("reset-auth-token", backend.unregistrationAuthTokens.get(0));
        assertEquals("reset-auth-token", backend.unregistrationAuthTokens.get(1));
    }

    @Test
    public void legacyInstallationRevocationIsPersistedBeforeBrowserCleanup()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        RecordingBackend backend = new RecordingBackend();
        AndroidPushIdentityStorage storage = createStorage(preferences, cipher, ids);
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        String legacyInstallationId = "11111111-1111-4111-8111-111111111111";

        manager.retainLegacyInstallationForRevocation(
            legacyInstallationId,
            "legacy-auth-token"
        );

        AndroidPushIdentityStorage.State retained = storage.load();
        assertTrue(retained.hasPendingRevocation());
        assertEquals(API_ORIGIN, retained.pendingRevocationApiOrigin());
        assertEquals(
            legacyInstallationId,
            retained.pendingRevocationInstallationId()
        );
        assertEquals(
            "legacy-auth-token",
            retained.pendingRevocationAuthToken()
        );

        AndroidPushRegistrationManager restarted =
            new AndroidPushRegistrationManager(
                createStorage(preferences, cipher, ids),
                backend
            );
        restarted.restoreRuntime(API_ORIGIN, pushMetadata(3));
        restarted.onAuthenticated("legacy-auth-token");

        assertEquals(1, backend.unregisterCount);
        assertEquals(API_ORIGIN, backend.unregistrationApiOrigins.get(0));
        assertEquals(
            "legacy-auth-token",
            backend.unregistrationAuthTokens.get(0)
        );
        assertFalse(storage.load().hasPendingRevocation());
    }

    @Test
    public void runtimeResetAddsAuthorityToPendingSameRuntimeLegacyCleanup()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        AndroidPushIdentityStorage storage = createStorage(preferences);
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.retainLegacyInstallationForRevocation(
            "11111111-1111-4111-8111-111111111111",
            null
        );
        String preResetInstallationId = storage.load().installationId();

        manager.prepareRuntimeReset("reset-auth-token");
        backend.offlineUnregistration = true;

        assertFalse(manager.clearRuntime("reset-auth-token"));
        assertEquals(
            "reset-auth-token",
            storage.load().pendingRevocationAuthToken()
        );
        assertNotEquals(
            storage.load().pendingRevocationInstallationId(),
            storage.load().installationId()
        );
        assertNotEquals(preResetInstallationId, storage.load().installationId());
    }

    @Test
    public void runtimeResetNeverReportsCleanupAfterTombstonePersistenceFails()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FailNextEncryptionCipher cipher = new FailNextEncryptionCipher();
        AndroidPushIdentityStorage storage = createStorage(
            preferences,
            cipher,
            new AtomicInteger()
        );
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "reset-auth-token"
        );
        manager.prepareRuntimeReset("reset-auth-token");
        backend.offlineUnregistration = true;
        cipher.failNextEncryption = true;

        assertFalse(manager.clearRuntime("reset-auth-token"));
        assertNotNull(storage.load());
        assertTrue(storage.load().hasServerRegistration());
        assertEquals("retry_pending", manager.getStatus().getString("state"));
    }

    @Test
    public void runtimeClearUsesSameOriginLegacyAuthorityForBothRegistrations()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "shared-auth-token"
        );
        manager.retainLegacyInstallationForRevocation(
            "11111111-1111-4111-8111-111111111111",
            "shared-auth-token"
        );

        assertTrue(manager.clearRuntime(null));

        assertNull(storage.load());
        assertEquals(2, backend.unregisterCount);
        assertEquals("shared-auth-token", backend.unregistrationAuthTokens.get(0));
        assertEquals("shared-auth-token", backend.unregistrationAuthTokens.get(1));
    }

    @Test
    public void logoutClearsCrossTenantRevocationAuthorityAfterFailedCleanup()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        RecordingBackend backend = new RecordingBackend();
        AndroidPushIdentityStorage storage = createStorage(
            preferences,
            cipher,
            ids
        );
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "old-tenant-auth-token"
        );
        backend.unregisterStatus = 500;
        AndroidPushRegistrationManager.RebindResult rebind = manager.rebindRuntime(
            "https://tenant-b.example",
            pushMetadata(4),
            "old-tenant-auth-token"
        );
        try {
            manager.revokePrevious(
                rebind,
                "old-tenant-auth-token",
                new NativeAuthHttpClient.CancellationSignal()
            );
            fail("Expected rejected previous registration revocation");
        } catch (IllegalStateException expected) {
            // Keep the persisted tombstone to exercise explicit logout cleanup.
        }
        assertTrue(storage.load().hasPendingRevocation());
        assertEquals(
            "old-tenant-auth-token",
            storage.load().pendingRevocationAuthToken()
        );
        assertEquals(API_ORIGIN, storage.load().pendingRevocationApiOrigin());
        assertEquals("https://tenant-b.example", storage.load().apiOrigin());

        manager.onLogout(null);

        AndroidPushIdentityStorage.State loggedOut = storage.load();
        assertNotNull(loggedOut);
        assertFalse(loggedOut.hasServerRegistration());
        assertFalse(loggedOut.hasPendingRevocation());
        assertFalse(loggedOut.hasPendingRebind());
        assertEquals(2, backend.unregisterCount);
        assertEquals(
            "old-tenant-auth-token",
            backend.unregistrationAuthTokens.get(1)
        );

        manager.onAuthenticated("new-tenant-auth-token");
        assertEquals(2, backend.unregisterCount);
    }

    @Test
    public void stagedRebindToDisabledPushSurvivesUntilColdStartRevocation()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        RecordingBackend backend = new RecordingBackend();
        AndroidPushIdentityStorage storage = createStorage(preferences, cipher, ids);
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "old-tenant-auth-token"
        );
        manager.prepareRuntimeRebind(
            "https://tenant-b.example",
            "old-tenant-auth-token"
        );

        AndroidPushRegistrationManager restarted = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        AndroidPushRegistrationManager.RebindResult rebind = restarted.restoreRuntime(
            "https://tenant-b.example",
            null
        );
        restarted.revokePrevious(
            rebind,
            null,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(1, backend.unregisterCount);
        assertEquals(
            "old-tenant-auth-token",
            backend.unregistrationAuthTokens.get(0)
        );
        assertNull(storage.load());
        assertEquals("disabled", restarted.getStatus().getString("state"));
    }

    @Test
    public void pendingRevocationCleanupHandlesInvalidatedProtectedState()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        AndroidPushIdentityStorage storage = createStorage(preferences);
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        manager.rebindRuntime(API_ORIGIN, pushMetadata(4));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_TWO,
            null
        );
        backend.beforeUnregister = storage::clear;

        manager.onAuthenticated("auth-token");

        assertEquals("awaiting_token", manager.getStatus().getString("state"));
    }

    @Test
    public void corruptPushStateCannotPreventLogoutCleanup() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        AndroidPushIdentityStorage storage = createStorage(preferences);
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            new RecordingBackend()
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        preferences.edit()
            .putString(AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY, "corrupt")
            .putString(AndroidPushIdentityStorage.STATE_IV_KEY, "corrupt")
            .commit();

        manager.onLogout("auth-token");

        assertEquals("unconfigured", manager.getStatus().getString("state"));
        assertFalse(preferences.contains(AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY));
        assertFalse(preferences.contains(AndroidPushIdentityStorage.STATE_IV_KEY));
    }

    @Test
    public void failedRuntimeApplyCanRestoreTheExactPreviousIdentity()
        throws Exception {
        RecordingBackend backend = new RecordingBackend();
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            storage,
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        String originalInstallationId = storage.load().installationId();

        AndroidPushRegistrationManager.RebindResult rebind = manager.rebindRuntime(
            "https://tenant-b.example",
            pushMetadata(4)
        );
        manager.rollbackRebind(rebind);

        assertEquals(originalInstallationId, storage.load().installationId());
        assertEquals(TOKEN_ONE, storage.load().token());
        assertEquals("registered", manager.getStatus().getString("state"));
        assertEquals(0, backend.unregisterCount);
    }

    @Test
    public void failedRuntimeApplyRestoresDisabledPushState() throws Exception {
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            new RecordingBackend()
        );
        manager.bindRuntime(API_ORIGIN, null);

        AndroidPushRegistrationManager.RebindResult rebind = manager.rebindRuntime(
            "https://tenant-b.example",
            pushMetadata(4)
        );
        assertEquals("awaiting_token", manager.getStatus().getString("state"));

        manager.rollbackRebind(rebind);

        assertEquals("disabled", manager.getStatus().getString("state"));
        assertFalse(manager.getStatus().getBool("configured"));
    }

    @Test
    public void offlineRegistrationRemainsPendingForExplicitRetry() throws Exception {
        RecordingBackend backend = new RecordingBackend();
        backend.offline = true;
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));

        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );

        assertEquals("retry_pending", manager.getStatus().getString("state"));
        assertTrue(manager.getStatus().getBool("retryable"));

        backend.offline = false;
        manager.onAuthenticated("auth-token");
        assertEquals("registered", manager.getStatus().getString("state"));
    }

    @Test
    public void unrelatedRegistrationConflictRemainsRetryable() throws Exception {
        RecordingBackend backend = new RecordingBackend();
        backend.registrationResponse =
            new AndroidPushRegistrationManager.RegistrationResponse(
                409,
                "OTHER_CONFLICT"
            );
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));

        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );

        assertEquals("retry_pending", manager.getStatus().getString("state"));
        assertEquals(
            "REGISTRATION_REJECTED",
            manager.getStatus().getString("failureCode")
        );
    }

    @Test
    public void rejectedRegistrationSchedulingRemainsRetryableUnlessTerminal()
        throws Exception {
        RecordingBackend backend = new RecordingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));

        manager.onRegistrationSchedulingError();

        assertEquals("retry_pending", manager.getStatus().getString("state"));
        assertEquals(
            "REGISTRATION_RETRY_REQUIRED",
            manager.getStatus().getString("failureCode")
        );

        backend.registrationResponse =
            new AndroidPushRegistrationManager.RegistrationResponse(
                409,
                "NOTIFICATION_RUNTIME_STATE_INVALID"
            );
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );
        manager.onRegistrationSchedulingError();

        assertEquals("reconfiguration_required", manager.getStatus().getString("state"));
    }

    @Test
    public void documentedRegistrationConflictRemainsTerminalUntilRuntimeRebind()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        RecordingBackend backend = new RecordingBackend();
        backend.registrationResponse =
            new AndroidPushRegistrationManager.RegistrationResponse(
                409,
                "NOTIFICATION_RUNTIME_STATE_INVALID"
            );
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_ONE,
            "auth-token"
        );

        manager.onTokenError(AndroidPushRegistrationManager.RUNTIME_APP_NAME);
        manager.onTokenReceived(
            AndroidPushRegistrationManager.RUNTIME_APP_NAME,
            TOKEN_TWO,
            "auth-token"
        );
        manager.onAuthenticated("auth-token");
        assertFalse(manager.prepareRetry());
        manager.onProtectedStateError();
        assertFalse(manager.prepareRetry());
        manager.onLogout("auth-token");

        assertEquals("reconfiguration_required", manager.getStatus().getString("state"));
        assertEquals(1, backend.lifecycleEvents.size());

        AndroidPushRegistrationManager restarted = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, ids),
            backend
        );
        restarted.bindRuntime(API_ORIGIN, pushMetadata(3));
        restarted.onAuthenticated("auth-token");

        assertEquals(
            "reconfiguration_required",
            restarted.getStatus().getString("state")
        );
        assertEquals(1, backend.lifecycleEvents.size());

        restarted.rebindRuntime(API_ORIGIN, pushMetadata(4));
        assertEquals("awaiting_token", restarted.getStatus().getString("state"));
    }

    @Test
    public void abstractStatusRemainsReadableWhileRegistrationIsInFlight()
        throws Exception {
        BlockingBackend backend = new BlockingBackend();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(new InMemorySharedPreferences()),
            backend
        );
        manager.bindRuntime(API_ORIGIN, pushMetadata(3));
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            Future<?> registration = executor.submit(() -> {
                try {
                    manager.onTokenReceived(
                        AndroidPushRegistrationManager.RUNTIME_APP_NAME,
                        TOKEN_ONE,
                        "auth-token"
                    );
                } catch (TokenStorageException exception) {
                    throw new IllegalStateException(exception);
                }
            });
            assertTrue(backend.registrationStarted.await(2, TimeUnit.SECONDS));

            Future<JSObject> status = executor.submit(manager::getStatus);
            assertTrue(status.get(1, TimeUnit.SECONDS).getBool("configured"));

            backend.allowRegistrationToFinish.countDown();
            registration.get(2, TimeUnit.SECONDS);
        } finally {
            backend.allowRegistrationToFinish.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    public void abstractStatusPublishesBindingAndStateAtomically() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        BlockingCipher cipher = new BlockingCipher();
        AndroidPushRegistrationManager manager = new AndroidPushRegistrationManager(
            createStorage(preferences, cipher, new AtomicInteger()),
            new RecordingBackend()
        );
        manager.bindRuntime(API_ORIGIN, null);
        ExecutorService executor = Executors.newSingleThreadExecutor();

        try {
            cipher.blockNextEncryption = true;
            Future<?> bind = executor.submit(() -> {
                try {
                    manager.bindRuntime(API_ORIGIN, pushMetadata(3));
                } catch (TokenStorageException exception) {
                    throw new IllegalStateException(exception);
                }
            });
            assertTrue(cipher.encryptionStarted.await(2, TimeUnit.SECONDS));

            JSObject status = manager.getStatus();
            assertEquals("disabled", status.getString("state"));
            assertFalse(status.getBool("configured"));

            cipher.allowEncryption.countDown();
            bind.get(2, TimeUnit.SECONDS);
        } finally {
            cipher.allowEncryption.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    public void nativeBackendBuildsTheCanonicalSchemaFourPayload() throws Exception {
        CapturingHttpClient client = new CapturingHttpClient();
        AndroidPushRegistrationManager.HttpBackend backend =
            new AndroidPushRegistrationManager.HttpBackend(client, "1.5.0", 10500);
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State state = storage.bindRuntime(API_ORIGIN, 3);
        state = storage.recordToken(API_ORIGIN, 3, TOKEN_ONE);

        assertEquals(
            201,
            backend.register(
                API_ORIGIN,
                "auth-token",
                state,
                "registered",
                new NativeAuthHttpClient.CancellationSignal()
            ).status()
        );

        assertEquals("PUT", client.method);
        assertEquals(
            "/v1/me/notification-installations/" + state.installationId(),
            client.path
        );
        JSONObject body = new JSONObject(
            new String(
                Base64.decode(client.bodyBase64, Base64.NO_WRAP),
                StandardCharsets.UTF_8
            )
        );
        assertEquals(TOKEN_ONE, body.getJSONObject("registration").getString("push_token"));
        assertEquals(4, body.getJSONObject("runtime").getInt("schema_version"));
        assertEquals(3, body.getJSONObject("runtime").getInt("metadata_revision"));
        assertEquals("registered", body.getString("lifecycle_event"));
    }

    @Test
    public void nativeBackendPreservesRegistrationConflictCode() throws Exception {
        CapturingHttpClient client = new CapturingHttpClient();
        client.responseStatus = 409;
        client.responseBody = new JSONObject()
            .put("code", "NOTIFICATION_CHANNEL_UNSUPPORTED")
            .toString();
        AndroidPushRegistrationManager.HttpBackend backend =
            new AndroidPushRegistrationManager.HttpBackend(client, "1.5.0", 10500);
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State state = storage.bindRuntime(API_ORIGIN, 3);
        state = storage.recordToken(API_ORIGIN, 3, TOKEN_ONE);

        AndroidPushRegistrationManager.RegistrationResponse response = backend.register(
            API_ORIGIN,
            "auth-token",
            state,
            "registered",
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(409, response.status());
        assertEquals("NOTIFICATION_CHANNEL_UNSUPPORTED", response.errorCode());
    }

    private static AndroidPushIdentityStorage createStorage(
        InMemorySharedPreferences preferences
    ) {
        return createStorage(preferences, new MemoryCipher(), new AtomicInteger());
    }

    private static AndroidPushIdentityStorage createStorage(
        InMemorySharedPreferences preferences,
        TokenCipher cipher,
        AtomicInteger ids
    ) {
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

    private static AndroidPushRuntimeMetadata pushMetadata(int revision) {
        return new AndroidPushRuntimeMetadata(
            "fcm",
            revision,
            "api-key",
            "project-id",
            "application-id",
            "sender-id"
        );
    }

    private static final class RecordingBackend
        implements AndroidPushRegistrationManager.Backend {
        final List<String> lifecycleEvents = new ArrayList<>();
        final List<String> registrationApiOrigins = new ArrayList<>();
        final List<String> registrationAuthTokens = new ArrayList<>();
        final List<String> unregistrationApiOrigins = new ArrayList<>();
        final List<String> unregistrationAuthTokens = new ArrayList<>();
        int unregisterCount;
        int unregisterStatus = 204;
        Runnable beforeUnregister = () -> {};
        boolean offline;
        boolean offlineUnregistration;
        AndroidPushRegistrationManager.RegistrationResponse registrationResponse =
            new AndroidPushRegistrationManager.RegistrationResponse(201, null);

        @Override
        public AndroidPushRegistrationManager.RegistrationResponse register(
            String apiOrigin,
            String authToken,
            AndroidPushIdentityStorage.State state,
            String lifecycleEvent,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException {
            if (offline) {
                throw new IOException("offline");
            }
            assertEquals(state.apiOrigin(), apiOrigin);
            assertFalse(state.installationId().isEmpty());
            assertTrue(state.token().startsWith("fcm-token-"));
            registrationApiOrigins.add(apiOrigin);
            registrationAuthTokens.add(authToken);
            lifecycleEvents.add(lifecycleEvent);
            return registrationResponse;
        }

        @Override
        public int unregister(
            String apiOrigin,
            String authToken,
            String installationId,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException {
            unregisterCount += 1;
            unregistrationApiOrigins.add(apiOrigin);
            unregistrationAuthTokens.add(authToken);
            beforeUnregister.run();
            if (offlineUnregistration) {
                throw new IOException("offline");
            }
            return unregisterStatus;
        }
    }

    private static final class BlockingBackend
        implements AndroidPushRegistrationManager.Backend {
        final CountDownLatch registrationStarted = new CountDownLatch(1);
        final CountDownLatch allowRegistrationToFinish = new CountDownLatch(1);

        @Override
        public AndroidPushRegistrationManager.RegistrationResponse register(
            String apiOrigin,
            String authToken,
            AndroidPushIdentityStorage.State state,
            String lifecycleEvent,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException {
            registrationStarted.countDown();
            try {
                if (!allowRegistrationToFinish.await(5, TimeUnit.SECONDS)) {
                    throw new IOException("registration test timed out");
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IOException("registration test interrupted", exception);
            }
            return new AndroidPushRegistrationManager.RegistrationResponse(201, null);
        }

        @Override
        public int unregister(
            String apiOrigin,
            String authToken,
            String installationId,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) {
            return 204;
        }
    }

    private static final class CapturingHttpClient extends NativeAuthHttpClient {
        String method;
        String path;
        String bodyBase64;
        int responseStatus = 201;
        String responseBody;

        @Override
        JSObject requestAuxiliaryJson(
            String baseUrl,
            String token,
            String method,
            String path,
            String requestBodyBase64,
            String contentType,
            String accept,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) {
            this.method = method;
            this.path = path;
            this.bodyBase64 = requestBodyBase64;
            JSObject response = new JSObject();
            response.put("status", responseStatus);
            if (responseBody != null) {
                response.put(
                    "bodyBase64",
                    Base64.encodeToString(
                        responseBody.getBytes(StandardCharsets.UTF_8),
                        Base64.NO_WRAP
                    )
                );
            }
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
            if (plaintext == null) {
                throw new TokenStorageException(
                    "missing ciphertext",
                    new IllegalStateException("missing")
                );
            }
            return plaintext;
        }
    }

    private static final class SwitchableCipher implements TokenCipher {
        private final MemoryCipher delegate = new MemoryCipher();
        boolean failEncryption;

        @Override
        public EncryptedTokenPayload encrypt(String plaintext)
            throws TokenStorageException {
            if (failEncryption) {
                throw new TokenStorageException(
                    "encryption failed",
                    new IllegalStateException("test failure")
                );
            }
            return delegate.encrypt(plaintext);
        }

        @Override
        public String decrypt(EncryptedTokenPayload payload)
            throws TokenStorageException {
            return delegate.decrypt(payload);
        }
    }

    private static final class FailNextEncryptionCipher implements TokenCipher {
        private final MemoryCipher delegate = new MemoryCipher();
        boolean failNextEncryption;

        @Override
        public EncryptedTokenPayload encrypt(String plaintext)
            throws TokenStorageException {
            if (failNextEncryption) {
                failNextEncryption = false;
                throw new TokenStorageException(
                    "encryption failed",
                    new IllegalStateException("test failure")
                );
            }
            return delegate.encrypt(plaintext);
        }

        @Override
        public String decrypt(EncryptedTokenPayload payload)
            throws TokenStorageException {
            return delegate.decrypt(payload);
        }
    }

    private static final class BlockingCipher implements TokenCipher {
        private final MemoryCipher delegate = new MemoryCipher();
        final CountDownLatch encryptionStarted = new CountDownLatch(1);
        final CountDownLatch allowEncryption = new CountDownLatch(1);
        boolean blockNextEncryption;

        @Override
        public EncryptedTokenPayload encrypt(String plaintext)
            throws TokenStorageException {
            if (blockNextEncryption) {
                encryptionStarted.countDown();
                try {
                    if (!allowEncryption.await(5, TimeUnit.SECONDS)) {
                        throw new TokenStorageException(
                            "encryption timed out",
                            new IllegalStateException("test timeout")
                        );
                    }
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new TokenStorageException(
                        "encryption interrupted",
                        exception
                    );
                }
            }
            return delegate.encrypt(plaintext);
        }

        @Override
        public String decrypt(EncryptedTokenPayload payload)
            throws TokenStorageException {
            return delegate.decrypt(payload);
        }
    }

    private static final class InMemorySharedPreferences implements SharedPreferences {
        private final Map<String, Object> values = new HashMap<>();

        @Override
        public Map<String, ?> getAll() { return values; }

        @Override
        public String getString(String key, String defaultValue) {
            Object value = values.get(key);
            return value instanceof String ? (String) value : defaultValue;
        }

        @Override
        public boolean contains(String key) { return values.containsKey(key); }

        @Override
        public Editor edit() {
            return new Editor() {
                @Override
                public Editor putString(String key, String value) {
                    values.put(key, value);
                    return this;
                }

                @Override
                public Editor remove(String key) {
                    values.remove(key);
                    return this;
                }

                @Override
                public Editor clear() {
                    values.clear();
                    return this;
                }

                @Override
                public boolean commit() { return true; }

                @Override
                public void apply() {}

                @Override
                public Editor putStringSet(String key, Set<String> values) {
                    throw new UnsupportedOperationException();
                }

                @Override
                public Editor putInt(String key, int value) {
                    throw new UnsupportedOperationException();
                }

                @Override
                public Editor putLong(String key, long value) {
                    throw new UnsupportedOperationException();
                }

                @Override
                public Editor putFloat(String key, float value) {
                    throw new UnsupportedOperationException();
                }

                @Override
                public Editor putBoolean(String key, boolean value) {
                    values.put(key, value);
                    return this;
                }
            };
        }

        @Override
        public Set<String> getStringSet(String key, Set<String> defaultValues) {
            throw new UnsupportedOperationException();
        }

        @Override
        public int getInt(String key, int defaultValue) {
            throw new UnsupportedOperationException();
        }

        @Override
        public long getLong(String key, long defaultValue) {
            throw new UnsupportedOperationException();
        }

        @Override
        public float getFloat(String key, float defaultValue) {
            throw new UnsupportedOperationException();
        }

        @Override
        public boolean getBoolean(String key, boolean defaultValue) {
            Object value = values.get(key);
            return value instanceof Boolean ? (Boolean) value : defaultValue;
        }

        @Override
        public void registerOnSharedPreferenceChangeListener(
            OnSharedPreferenceChangeListener listener
        ) {}

        @Override
        public void unregisterOnSharedPreferenceChangeListener(
            OnSharedPreferenceChangeListener listener
        ) {}
    }
}
