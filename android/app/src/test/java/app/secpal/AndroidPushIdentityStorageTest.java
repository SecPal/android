/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
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

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
public class AndroidPushIdentityStorageTest {
    private static final String API_ORIGIN = "https://tenant-a.example";
    private static final String NEXT_API_ORIGIN = "https://tenant-b.example";
    private static final String AUTH_TOKEN = "native-auth-token";
    private static final String TOKEN =
        "fcm-token-one-1234567890abcdefghijklmnopqrstuvwxyz";

    @Test
    public void runtimeOriginRequiresCanonicalBareHttpsOrigin() throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );

        AndroidPushIdentityStorage.State bound = storage.bindRuntime(
            " HTTPS://Tenant-A.Example:443 ",
            3
        );

        assertEquals(API_ORIGIN, bound.apiOrigin());
        assertEquals(
            "https://tenant-a.example:8443",
            createStorage(new InMemorySharedPreferences())
                .bindRuntime("https://Tenant-A.Example:8443", 3)
                .apiOrigin()
        );

        String[] invalidOrigins = {
            null,
            "http://tenant-a.example",
            "https://tenant-a.example/",
            "https://tenant-a.example/v1",
            "https://tenant-a.example?tenant=a",
            "https://tenant-a.example#tenant-a",
            "https://user@tenant-a.example",
            "tenant-a.example"
        };
        for (String invalidOrigin : invalidOrigins) {
            try {
                createStorage(new InMemorySharedPreferences())
                    .bindRuntime(invalidOrigin, 3);
                fail("Expected invalid Android push runtime origin failure");
            } catch (TokenStorageException expected) {
                assertTrue(expected.getCause() instanceof IllegalArgumentException);
            }
            assertNull(
                AndroidPushIdentityStorage.normalizeApiOrigin(invalidOrigin)
            );
        }
        assertEquals(
            API_ORIGIN,
            AndroidPushIdentityStorage.normalizeApiOrigin(
                " HTTPS://Tenant-A.Example:443 "
            )
        );
    }

    @Test
    public void protectedStateNeverPersistsRawIdentityValues() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        AndroidPushIdentityStorage storage = createStorage(preferences);

        AndroidPushIdentityStorage.State state = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(API_ORIGIN, 3, state.installationId(), TOKEN);

        String persisted = preferences.getString(
            AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY,
            null
        );
        assertFalse(persisted.contains(TOKEN));
        assertFalse(persisted.contains(state.installationId()));
        assertFalse(preferences.getAll().containsValue(TOKEN));
        assertFalse(preferences.getAll().containsValue(state.installationId()));
    }

    @Test
    public void restartReusesIdentityForTheSameRuntime() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        AndroidPushIdentityStorage storage = createStorage(preferences, cipher, ids);

        AndroidPushIdentityStorage.State first = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(API_ORIGIN, 3, first.installationId(), TOKEN);
        AndroidPushIdentityStorage.State restored = createStorage(
            preferences,
            cipher,
            ids
        ).bindRuntime(API_ORIGIN, 3);

        assertEquals(first.installationId(), restored.installationId());
        assertEquals(TOKEN, restored.token());
    }

    @Test
    public void runtimeChangeCreatesAnUnregisteredIdentity() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        AndroidPushIdentityStorage storage = createStorage(preferences, cipher, ids);

        AndroidPushIdentityStorage.State first = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(API_ORIGIN, 3, first.installationId(), TOKEN);
        AndroidPushIdentityStorage.State rebound = storage.bindRuntime(
            NEXT_API_ORIGIN,
            4
        );

        assertNotEquals(first.installationId(), rebound.installationId());
        assertNull(rebound.token());
        assertFalse(rebound.hasServerRegistration());
    }

    @Test
    public void mismatchedTokenCallbackCannotCrossRuntimeBindings() throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State bound = storage.bindRuntime(API_ORIGIN, 3);

        AndroidPushIdentityStorage.State unchanged = storage.recordToken(
            NEXT_API_ORIGIN,
            4,
            bound.installationId(),
            TOKEN
        );

        assertEquals(bound.installationId(), unchanged.installationId());
        assertNull(unchanged.token());
    }

    @Test
    public void unreadableStateIsInvalidatedAndRequiresTokenRotation()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        preferences.edit()
            .putString(AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY, "missing")
            .putString(AndroidPushIdentityStorage.STATE_IV_KEY, "iv")
            .commit();
        AndroidPushIdentityStorage storage = createStorage(preferences);

        try {
            storage.load();
            fail("Expected protected storage failure");
        } catch (TokenStorageException expected) {
            assertTrue(storage.requiresTokenRotation());
            assertFalse(preferences.contains(
                AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY
            ));
            assertFalse(preferences.contains(AndroidPushIdentityStorage.STATE_IV_KEY));
        }
    }

    @Test
    public void aFreshTokenCompletesRequiredRotation() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        AndroidPushIdentityStorage storage = createStorage(preferences);
        storage.invalidateIdentityForTokenRotation();
        AndroidPushIdentityStorage.State bound = storage.bindRuntime(API_ORIGIN, 3);

        storage.recordToken(API_ORIGIN, 3, bound.installationId(), TOKEN);

        assertFalse(storage.requiresTokenRotation());
    }

    @Test
    public void registeredIdentityMustBeRetainedBeforeTokenRotation()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State registered = registerCurrentIdentity(storage);

        try {
            storage.invalidateCurrentIdentityForTokenRotation();
            fail("Expected live registration retention requirement");
        } catch (TokenStorageException expected) {
            AndroidPushIdentityStorage.State unchanged = storage.load();
            assertEquals(registered.installationId(), unchanged.installationId());
            assertTrue(unchanged.hasServerRegistration());
            assertFalse(storage.requiresTokenRotation());
        }
    }

    @Test
    public void genericTokenRotationCannotDiscardARegisteredIdentity()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State registered = registerCurrentIdentity(storage);

        try {
            storage.invalidateIdentityForTokenRotation();
            fail("Expected live registration retention requirement");
        } catch (TokenStorageException expected) {
            AndroidPushIdentityStorage.State unchanged = storage.load();
            assertEquals(registered.installationId(), unchanged.installationId());
            assertTrue(unchanged.hasServerRegistration());
            assertFalse(storage.requiresTokenRotation());
        }
    }

    @Test
    public void retainedRegistrationSurvivesTokenRotation() throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State registered = registerCurrentIdentity(storage);
        AndroidPushIdentityStorage.State retained =
            storage.retainCurrentRegistrationForRevocation(AUTH_TOKEN, true);

        assertTrue(storage.requiresTokenRotation());

        AndroidPushIdentityStorage.State rotated =
            storage.invalidateCurrentIdentityForTokenRotation();

        assertNotNull(rotated);
        assertNotEquals(registered.installationId(), rotated.installationId());
        assertNotEquals(retained.installationId(), rotated.installationId());
        assertEquals(
            registered.installationId(),
            rotated.pendingRevocationInstallationId()
        );
        assertEquals(AUTH_TOKEN, rotated.pendingRevocationAuthToken());
        assertTrue(rotated.pendingRevocationRequiresAuthenticationLogout());
        assertTrue(storage.requiresTokenRotation());
    }

    @Test
    public void tokenRefreshBeforeRetentionCompletesRequiredRotation()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State registered = registerCurrentIdentity(storage);
        AndroidPushIdentityStorage.State refreshed = storage.recordToken(
            API_ORIGIN,
            3,
            registered.installationId(),
            TOKEN + "-refreshed-before-retention"
        );

        AndroidPushIdentityStorage.State retained =
            storage.retainCurrentRegistrationForRevocation(AUTH_TOKEN, false);

        assertTrue(retained.hasPendingRevocation());
        assertEquals(TOKEN + "-refreshed-before-retention", retained.token());
        assertTrue(refreshed.tokenReceivedAt() > registered.tokenReceivedAt());
        assertFalse(storage.requiresTokenRotation());
    }

    @Test
    public void directRegisteredRuntimeRebindWithoutAuthorityFailsClosed()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State registered = registerCurrentIdentity(storage);

        try {
            storage.bindRuntime(NEXT_API_ORIGIN, 4);
            fail("Expected missing revocation authority failure");
        } catch (TokenStorageException expected) {
            AndroidPushIdentityStorage.State unchanged = storage.load();
            assertEquals(registered.installationId(), unchanged.installationId());
            assertEquals(API_ORIGIN, unchanged.apiOrigin());
            assertTrue(unchanged.hasServerRegistration());
            assertFalse(unchanged.hasPendingRevocation());
            assertFalse(storage.requiresTokenRotation());
        }
    }

    @Test
    public void preparedRuntimeRebindSurvivesSameRuntimeRestart() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        AndroidPushIdentityStorage storage = createStorage(preferences, cipher, ids);
        registerCurrentIdentity(storage);
        storage.prepareRuntimeRebind(NEXT_API_ORIGIN, AUTH_TOKEN);

        AndroidPushIdentityStorage.State restored = createStorage(
            preferences,
            cipher,
            ids
        ).bindRuntime(API_ORIGIN, 3);

        assertTrue(restored.hasPendingRebind());
        assertEquals(NEXT_API_ORIGIN, restored.pendingRebindApiOrigin());
        assertEquals(AUTH_TOKEN, restored.pendingRebindAuthToken());
    }

    @Test
    public void runtimeRebindPreparationRejectsAChangedBinding()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State registered = registerCurrentIdentity(
            storage
        );

        try {
            storage.prepareRuntimeRebind(
                NEXT_API_ORIGIN,
                AUTH_TOKEN,
                API_ORIGIN,
                "00000000-0000-4000-8000-999999999999"
            );
            fail("Expected changed runtime binding failure");
        } catch (TokenStorageException expected) {
            assertTrue(expected.getCause() instanceof IllegalStateException);
        }
        try {
            storage.prepareRuntimeRebind(
                NEXT_API_ORIGIN,
                AUTH_TOKEN,
                NEXT_API_ORIGIN,
                registered.installationId()
            );
            fail("Expected changed runtime binding failure");
        } catch (TokenStorageException expected) {
            assertTrue(expected.getCause() instanceof IllegalStateException);
        }
        assertFalse(storage.load().hasPendingRebind());

        storage.prepareRuntimeRebind(
            NEXT_API_ORIGIN,
            AUTH_TOKEN,
            API_ORIGIN,
            registered.installationId()
        );

        assertEquals(
            NEXT_API_ORIGIN,
            storage.load().pendingRebindApiOrigin()
        );
    }

    @Test
    public void runtimeRebindPreparationWithoutAuthorityFailsClosed()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State registered = registerCurrentIdentity(storage);

        try {
            storage.prepareRuntimeRebind(NEXT_API_ORIGIN, null);
            fail("Expected missing prepared rebind authority failure");
        } catch (TokenStorageException expected) {
            AndroidPushIdentityStorage.State unchanged = storage.load();
            assertEquals(registered.installationId(), unchanged.installationId());
            assertTrue(unchanged.hasServerRegistration());
            assertFalse(unchanged.hasPendingRebind());
        }
    }

    @Test
    public void onlyExplicitMatchingCancellationClearsPreparedRebind()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        registerCurrentIdentity(storage);
        storage.prepareRuntimeRebind(NEXT_API_ORIGIN, AUTH_TOKEN);

        storage.cancelPreparedRuntimeRebind("https://tenant-c.example");
        assertTrue(storage.load().hasPendingRebind());

        storage.cancelPreparedRuntimeRebind(NEXT_API_ORIGIN);
        assertFalse(storage.load().hasPendingRebind());
    }

    @Test
    public void staleSameRuntimeTokenCallbackCannotCompleteRotation()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State previous = storage.bindRuntime(API_ORIGIN, 3);
        storage.invalidateIdentityForTokenRotation();
        AndroidPushIdentityStorage.State replacement = storage.bindRuntime(API_ORIGIN, 3);

        AndroidPushIdentityStorage.State unchanged = storage.recordToken(
            API_ORIGIN,
            3,
            previous.installationId(),
            TOKEN
        );

        assertEquals(replacement.installationId(), unchanged.installationId());
        assertNull(unchanged.token());
        assertTrue(storage.requiresTokenRotation());
    }

    @Test
    public void wrongTypedProtectedStateRequiresTokenRotation() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        preferences.edit()
            .putBoolean(AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY, true)
            .putString(AndroidPushIdentityStorage.STATE_IV_KEY, "iv")
            .commit();
        AndroidPushIdentityStorage storage = createStorage(preferences);

        try {
            storage.load();
            fail("Expected protected storage type failure");
        } catch (TokenStorageException expected) {
            assertFalse(preferences.contains(
                AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY
            ));
            assertFalse(preferences.contains(AndroidPushIdentityStorage.STATE_IV_KEY));
            assertTrue(storage.requiresTokenRotation());
        }
    }

    @Test
    public void wrongTypedRotationMarkerFailsClosed() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        AndroidPushIdentityStorage storage = createStorage(preferences);
        storage.bindRuntime(API_ORIGIN, 3);
        preferences.edit()
            .putString(AndroidPushIdentityStorage.TOKEN_ROTATION_REQUIRED_KEY, "yes")
            .commit();

        try {
            storage.snapshot();
            fail("Expected rotation marker type failure");
        } catch (TokenStorageException expected) {
            assertFalse(preferences.contains(
                AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY
            ));
            assertTrue(storage.requiresTokenRotation());
        }
    }

    @Test
    public void wrongTypedJsonStateFieldsFailClosed() throws Exception {
        String installationId = "00000000-0000-4000-8000-000000000001";
        String[] malformedStates = {
            "{\"schemaVersion\":\"1\",\"apiOrigin\":\"" + API_ORIGIN
                + "\",\"metadataRevision\":3,\"installationId\":\""
                + installationId + "\",\"tokenReceivedAt\":0,\"registeredAt\":0}",
            "{\"schemaVersion\":1,\"apiOrigin\":\"" + API_ORIGIN
                + "\",\"metadataRevision\":\"3\",\"installationId\":\""
                + installationId + "\",\"tokenReceivedAt\":0,\"registeredAt\":0}",
            "{\"schemaVersion\":1,\"apiOrigin\":\"" + API_ORIGIN
                + "\",\"metadataRevision\":3,\"installationId\":\""
                + installationId
                + "\",\"tokenReceivedAt\":\"invalid\",\"registeredAt\":0}",
            "{\"schemaVersion\":1,\"apiOrigin\":\"" + API_ORIGIN
                + "\",\"metadataRevision\":3,\"installationId\":\""
                + installationId
                + "\",\"tokenReceivedAt\":0,\"registeredAt\":\"invalid\"}",
            "{\"schemaVersion\":1,\"apiOrigin\":\"" + API_ORIGIN
                + "\",\"metadataRevision\":3,\"installationId\":\""
                + installationId
                + "\",\"tokenReceivedAt\":0,\"registeredAt\":0,"
                + "\"pendingRevocationRequiresAuthenticationLogout\":\"yes\"}",
            "{\"schemaVersion\":1,\"apiOrigin\":\"" + API_ORIGIN
                + "\",\"metadataRevision\":3,\"installationId\":\""
                + installationId
                + "\",\"tokenReceivedAt\":0,\"registeredAt\":0,"
                + "\"reconfigurationRequired\":\"yes\"}",
        };

        for (String malformedState : malformedStates) {
            InMemorySharedPreferences preferences = new InMemorySharedPreferences();
            MemoryCipher cipher = new MemoryCipher();
            AndroidPushIdentityStorage storage = createStorage(
                preferences,
                cipher,
                new AtomicInteger()
            );
            storage.bindRuntime(API_ORIGIN, 3);
            cipher.replacePlaintext(
                preferences.getString(
                    AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY,
                    null
                ),
                malformedState
            );

            try {
                storage.load();
                fail("Expected malformed protected JSON state failure");
            } catch (TokenStorageException expected) {
                assertNull(storage.load());
                assertTrue(storage.requiresTokenRotation());
            }
        }
    }

    @Test
    public void inconsistentRegistrationMetadataFailsClosed() throws Exception {
        String installationId = "00000000-0000-4000-8000-000000000001";
        String baseState = "{\"schemaVersion\":1,\"apiOrigin\":\""
            + API_ORIGIN
            + "\",\"metadataRevision\":3,\"installationId\":\""
            + installationId
            + "\",\"tokenReceivedAt\":0,";
        String[] inconsistentStates = {
            baseState
                + "\"registeredAt\":0,\"registeredCredentialFingerprint\":\""
                + fingerprint('c')
                + "\"}",
            baseState + "\"registeredAt\":1}",
            baseState
                + "\"registeredAt\":0,\"token\":\""
                + TOKEN
                + "\",\"registeredFingerprint\":\""
                + fingerprint('a')
                + "\"}",
            baseState
                + "\"registeredAt\":1,\"registeredFingerprint\":\""
                + fingerprint('a')
                + "\"}"
        };

        for (String inconsistentState : inconsistentStates) {
            InMemorySharedPreferences preferences = new InMemorySharedPreferences();
            MemoryCipher cipher = new MemoryCipher();
            AndroidPushIdentityStorage storage = createStorage(
                preferences,
                cipher,
                new AtomicInteger()
            );
            storage.bindRuntime(API_ORIGIN, 3);
            cipher.replacePlaintext(
                preferences.getString(
                    AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY,
                    null
                ),
                inconsistentState
            );

            try {
                storage.load();
                fail("Expected inconsistent registration metadata failure");
            } catch (TokenStorageException expected) {
                assertNull(storage.load());
                assertTrue(storage.requiresTokenRotation());
            }
        }
    }

    @Test
    public void registrationFingerprintTracksPayloadInsteadOfAuthority() throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State bound = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(
            API_ORIGIN,
            3,
            bound.installationId(),
            TOKEN
        );
        String fingerprint = fingerprint('a');
        AndroidPushIdentityStorage.State registered = storage.markRegistered(
            storage.snapshot(),
            fingerprint,
            fingerprint('c')
        );

        assertFalse(registered.needsRegistration(fingerprint));
        assertTrue(registered.needsRegistration(fingerprint('b')));
    }

    @Test
    public void tokenRotationRemainsDistinguishableAfterRestart()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AtomicInteger ids = new AtomicInteger();
        AndroidPushIdentityStorage storage = createStorage(preferences, cipher, ids);
        AndroidPushIdentityStorage.State bound = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(
            API_ORIGIN,
            3,
            bound.installationId(),
            TOKEN
        );
        AndroidPushIdentityStorage.State registered = storage.markRegistered(
            storage.snapshot(),
            fingerprint('a'),
            fingerprint('c')
        );

        AndroidPushIdentityStorage.State rotated = storage.recordToken(
            API_ORIGIN,
            3,
            registered.installationId(),
            TOKEN + "-rotated"
        );
        assertTrue(rotated.tokenChangedSinceRegistration(fingerprint('d')));

        AndroidPushIdentityStorage.State restored = createStorage(
            preferences,
            cipher,
            ids
        ).load();
        assertTrue(restored.tokenChangedSinceRegistration(fingerprint('d')));
    }

    @Test
    public void registrationReconfigurationAndAuthorityTransitionsPersist()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State bound = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(
            API_ORIGIN,
            3,
            bound.installationId(),
            TOKEN
        );

        AndroidPushIdentityStorage.State reconfiguration =
            storage.markReconfigurationRequired(storage.snapshot());
        assertTrue(reconfiguration.isReconfigurationRequired());

        AndroidPushIdentityStorage.State registered = storage.markRegistered(
            storage.snapshot(),
            fingerprint('a'),
            fingerprint('c')
        );
        assertTrue(registered.hasServerRegistration());
        assertTrue(registered.isReconfigurationRequired());

        AndroidPushIdentityStorage.State cleared = storage.clearRegistrationAuthority();
        assertFalse(cleared.hasServerRegistration());
        assertFalse(cleared.hasPendingRevocation());
        assertFalse(cleared.hasPendingRebind());
        assertTrue(cleared.isReconfigurationRequired());
    }

    @Test
    public void pendingRevocationClearsOnlyForMatchingIdentityAndAuthority()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State registered = registerCurrentIdentity(storage);
        AndroidPushIdentityStorage.State retained =
            storage.retainCurrentRegistrationForRevocation(AUTH_TOKEN, false);

        AndroidPushIdentityStorage.State unchanged = storage.clearPendingRevocation(
            API_ORIGIN,
            "00000000-0000-4000-8000-999999999999",
            AUTH_TOKEN
        );
        assertTrue(unchanged.hasPendingRevocation());

        AndroidPushIdentityStorage.State staleAuthority =
            storage.clearPendingRevocation(
                API_ORIGIN,
                registered.installationId(),
                "stale-auth-token"
            );
        assertTrue(staleAuthority.hasPendingRevocation());

        AndroidPushIdentityStorage.State cleared = storage.clearPendingRevocation(
            API_ORIGIN,
            registered.installationId(),
            AUTH_TOKEN
        );
        assertFalse(cleared.hasPendingRevocation());
        assertEquals(retained.installationId(), cleared.installationId());
    }

    @Test
    public void rejectedRevocationClearsOnlyMatchingAuthorityAndRequiresRotation()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State registered = registerCurrentIdentity(storage);
        String legacyInstallationId = "00000000-0000-4000-8000-999999999999";
        storage.retainLegacyInstallationForRevocation(
            legacyInstallationId,
            AUTH_TOKEN
        );

        boolean stale = storage.markPendingRevocationAuthorityRejected(
            API_ORIGIN,
            legacyInstallationId,
            "stale-auth-token"
        );

        assertFalse(stale);
        assertTrue(storage.load().hasPendingRevocation());
        assertTrue(storage.load().hasServerRegistration());
        assertTrue(storage.requiresTokenRotation());

        boolean rejected = storage.markPendingRevocationAuthorityRejected(
            API_ORIGIN,
            legacyInstallationId,
            AUTH_TOKEN
        );

        assertTrue(rejected);
        assertFalse(storage.load().hasPendingRevocation());
        assertTrue(storage.load().hasServerRegistration());
        assertEquals(registered.installationId(), storage.load().installationId());
        assertTrue(storage.requiresTokenRotation());
    }

    @Test
    public void rejectedRevocationClearsMatchingPreparedRebindAuthority()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        registerCurrentIdentity(storage);
        storage.prepareRuntimeRebind(NEXT_API_ORIGIN, AUTH_TOKEN);
        String legacyInstallationId = "00000000-0000-4000-8000-999999999999";
        storage.retainLegacyInstallationForRevocation(
            legacyInstallationId,
            AUTH_TOKEN
        );

        boolean rejected = storage.markPendingRevocationAuthorityRejected(
            API_ORIGIN,
            legacyInstallationId,
            AUTH_TOKEN
        );

        assertTrue(rejected);
        AndroidPushIdentityStorage.State current = storage.load();
        assertFalse(current.hasPendingRevocation());
        assertFalse(current.hasPendingRebind());
        assertTrue(current.hasServerRegistration());
    }

    @Test
    public void rejectedRevocationPreservesDifferentPreparedRebindAuthority()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        registerCurrentIdentity(storage);
        storage.prepareRuntimeRebind(NEXT_API_ORIGIN, AUTH_TOKEN);
        String legacyInstallationId = "00000000-0000-4000-8000-999999999999";
        String legacyAuthority = "legacy-auth-token";
        storage.retainLegacyInstallationForRevocation(
            legacyInstallationId,
            legacyAuthority
        );

        boolean rejected = storage.markPendingRevocationAuthorityRejected(
            API_ORIGIN,
            legacyInstallationId,
            legacyAuthority
        );

        assertTrue(rejected);
        AndroidPushIdentityStorage.State current = storage.load();
        assertFalse(current.hasPendingRevocation());
        assertTrue(current.hasPendingRebind());
        assertEquals(AUTH_TOKEN, current.pendingRebindAuthToken());
    }

    @Test
    public void rejectedRevocationPreservesCompletedTokenRotation()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State registered = registerCurrentIdentity(storage);
        AndroidPushIdentityStorage.State retained =
            storage.retainCurrentRegistrationForRevocation(AUTH_TOKEN, false);
        storage.recordToken(
            API_ORIGIN,
            3,
            retained.installationId(),
            TOKEN + "-rotated"
        );
        assertFalse(storage.requiresTokenRotation());

        boolean rejected = storage.markPendingRevocationAuthorityRejected(
            API_ORIGIN,
            registered.installationId(),
            AUTH_TOKEN
        );

        assertTrue(rejected);
        assertFalse(storage.load().hasPendingRevocation());
        assertFalse(storage.requiresTokenRotation());
    }

    @Test
    public void pendingRuntimeClearRotatesOnlyTheCurrentIdentity() throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State registered = registerCurrentIdentity(storage);
        AndroidPushIdentityStorage.State retained =
            storage.retainCurrentRegistrationForRevocation(AUTH_TOKEN, true);

        AndroidPushIdentityStorage.State rotated =
            storage.rotateIdentityForPendingRuntimeClear();

        assertNotEquals(retained.installationId(), rotated.installationId());
        assertEquals(
            registered.installationId(),
            rotated.pendingRevocationInstallationId()
        );
        assertEquals(AUTH_TOKEN, rotated.pendingRevocationAuthToken());
        assertTrue(rotated.pendingRevocationRequiresAuthenticationLogout());
    }

    @Test
    public void runtimeResetPreparationPersistsCurrentAuthority() throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        registerCurrentIdentity(storage);

        storage.prepareRuntimeReset(AUTH_TOKEN);

        AndroidPushIdentityStorage.State prepared = storage.load();
        assertTrue(prepared.hasPendingRebind());
        assertEquals(API_ORIGIN, prepared.pendingRebindApiOrigin());
        assertEquals(AUTH_TOKEN, prepared.pendingRebindAuthToken());
    }

    @Test
    public void legacyRevocationRequiresAuthorityAndPersistsIt() throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        storage.bindRuntime(API_ORIGIN, 3);
        String legacyInstallationId = "00000000-0000-4000-8000-999999999999";

        try {
            storage.retainLegacyInstallationForRevocation(
                legacyInstallationId,
                null
            );
            fail("Expected legacy revocation authority requirement");
        } catch (TokenStorageException expected) {
            assertFalse(storage.load().hasPendingRevocation());
        }

        storage.retainLegacyInstallationForRevocation(
            legacyInstallationId,
            AUTH_TOKEN
        );

        AndroidPushIdentityStorage.State retained = storage.load();
        assertEquals(legacyInstallationId, retained.pendingRevocationInstallationId());
        assertEquals(AUTH_TOKEN, retained.pendingRevocationAuthToken());
        assertTrue(storage.requiresTokenRotation());
    }

    @Test
    public void legacyRevocationRetriesRemainIdempotentWithoutNewAuthority()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State bound = storage.bindRuntime(API_ORIGIN, 3);

        storage.retainLegacyInstallationForRevocation(
            bound.installationId(),
            null
        );
        assertFalse(storage.load().hasPendingRevocation());

        String legacyInstallationId = "00000000-0000-4000-8000-999999999999";
        storage.retainLegacyInstallationForRevocation(
            legacyInstallationId,
            AUTH_TOKEN
        );
        storage.retainLegacyInstallationForRevocation(
            legacyInstallationId,
            null
        );

        AndroidPushIdentityStorage.State retained = storage.load();
        assertEquals(legacyInstallationId, retained.pendingRevocationInstallationId());
        assertEquals(AUTH_TOKEN, retained.pendingRevocationAuthToken());
    }

    @Test
    public void legacyRevocationRetryPreservesCompletedTokenRotation()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        registerCurrentIdentity(storage);
        String legacyInstallationId = "00000000-0000-4000-8000-999999999999";
        storage.retainLegacyInstallationForRevocation(
            legacyInstallationId,
            AUTH_TOKEN
        );
        AndroidPushIdentityStorage.State retained = storage.load();
        storage.recordToken(
            API_ORIGIN,
            3,
            retained.installationId(),
            TOKEN + "-rotated-before-retry"
        );
        assertFalse(storage.requiresTokenRotation());

        storage.retainLegacyInstallationForRevocation(
            legacyInstallationId,
            null
        );

        assertFalse(storage.requiresTokenRotation());
        assertEquals(
            AUTH_TOKEN,
            storage.load().pendingRevocationAuthToken()
        );
    }

    @Test
    public void runtimeResetPreparationPreservesCompletedTokenRotation()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        registerCurrentIdentity(storage);
        AndroidPushIdentityStorage.State retained =
            storage.retainCurrentRegistrationForRevocation(AUTH_TOKEN, false);
        storage.recordToken(
            API_ORIGIN,
            3,
            retained.installationId(),
            TOKEN + "-rotated-before-reset"
        );
        assertFalse(storage.requiresTokenRotation());

        storage.prepareRuntimeReset(AUTH_TOKEN);

        assertTrue(
            storage.load().pendingRevocationRequiresAuthenticationLogout()
        );
        assertFalse(storage.requiresTokenRotation());
    }

    @Test
    public void pendingRevocationBlocksAnotherRuntimeBinding() throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        registerCurrentIdentity(storage);
        storage.retainCurrentRegistrationForRevocation(AUTH_TOKEN, false);

        try {
            storage.bindRuntime(NEXT_API_ORIGIN, 4, AUTH_TOKEN);
            fail("Expected pending revocation to block runtime binding");
        } catch (TokenStorageException expected) {
            assertTrue(storage.load().hasPendingRevocation());
        }
    }

    @Test
    public void currentRegistrationCannotReplaceExistingRevocationTombstone()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State registered = registerCurrentIdentity(storage);
        String legacyInstallationId = "00000000-0000-4000-8000-999999999999";
        storage.retainLegacyInstallationForRevocation(
            legacyInstallationId,
            AUTH_TOKEN
        );

        try {
            storage.retainCurrentRegistrationForRevocation(AUTH_TOKEN, false);
            fail("Expected existing revocation tombstone to be preserved");
        } catch (TokenStorageException expected) {
            AndroidPushIdentityStorage.State unchanged = storage.load();
            assertEquals(registered.installationId(), unchanged.installationId());
            assertTrue(unchanged.hasServerRegistration());
            assertEquals(
                legacyInstallationId,
                unchanged.pendingRevocationInstallationId()
            );
        }
    }

    @Test
    public void snapshotRestoresStateAndRotationRequirement() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        AndroidPushIdentityStorage storage = createStorage(preferences);
        AndroidPushIdentityStorage.State registered = registerCurrentIdentity(storage);
        AndroidPushIdentityStorage.Snapshot registeredSnapshot = storage.snapshot();
        storage.retainCurrentRegistrationForRevocation(AUTH_TOKEN, true);

        storage.restore(registeredSnapshot);

        AndroidPushIdentityStorage.State restored = storage.load();
        assertEquals(registered.installationId(), restored.installationId());
        assertTrue(restored.hasServerRegistration());
        assertFalse(storage.requiresTokenRotation());

        storage.clearRegistrationAuthority();
        storage.invalidateIdentityForTokenRotation();
        AndroidPushIdentityStorage.Snapshot invalidatedSnapshot = storage.snapshot();
        AndroidPushIdentityStorage.State rebound = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(API_ORIGIN, 3, rebound.installationId(), TOKEN);

        storage.restore(invalidatedSnapshot);

        assertNull(storage.load());
        assertTrue(storage.requiresTokenRotation());
    }

    @Test
    public void duplicateTokenDoesNotRewriteProtectedState() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        MemoryCipher cipher = new MemoryCipher();
        AndroidPushIdentityStorage storage = createStorage(
            preferences,
            cipher,
            new AtomicInteger()
        );
        AndroidPushIdentityStorage.State bound = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(API_ORIGIN, 3, bound.installationId(), TOKEN);
        int encryptionCount = cipher.encryptionCount();

        storage.recordToken(API_ORIGIN, 3, bound.installationId(), TOKEN);

        assertEquals(encryptionCount, cipher.encryptionCount());
    }

    @Test
    public void clearAndStateRestoreUseDurablePersistence() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        AndroidPushIdentityStorage storage = createStorage(preferences);
        AndroidPushIdentityStorage.State registered = registerCurrentIdentity(storage);
        int commitsBeforeClear = preferences.commitCount();
        int appliesBeforeClear = preferences.applyCount();

        storage.clear();

        assertEquals(commitsBeforeClear + 1, preferences.commitCount());
        assertEquals(appliesBeforeClear, preferences.applyCount());
        assertNull(storage.load());
        assertFalse(storage.requiresTokenRotation());

        storage.restore(registered);
        assertEquals(registered.installationId(), storage.load().installationId());
        assertTrue(storage.load().hasServerRegistration());

        storage.restore((AndroidPushIdentityStorage.State) null);
        assertNull(storage.load());
    }

    @Test
    public void removingServerRegistrationMakesTheIdentityRegisterableAgain()
        throws Exception {
        AndroidPushIdentityStorage storage = createStorage(
            new InMemorySharedPreferences()
        );
        AndroidPushIdentityStorage.State registered = registerCurrentIdentity(storage);

        AndroidPushIdentityStorage.State unregistered =
            registered.withoutServerRegistration();

        assertFalse(unregistered.hasServerRegistration());
        assertTrue(unregistered.needsRegistration(fingerprint('a')));
    }

    private static AndroidPushIdentityStorage.State registerCurrentIdentity(
        AndroidPushIdentityStorage storage
    ) throws Exception {
        AndroidPushIdentityStorage.State bound = storage.bindRuntime(API_ORIGIN, 3);
        storage.recordToken(
            API_ORIGIN,
            3,
            bound.installationId(),
            TOKEN
        );
        return storage.markRegistered(
            storage.snapshot(),
            fingerprint('a'),
            fingerprint('c')
        );
    }

    private static String fingerprint(char value) {
        return String.valueOf(value).repeat(64);
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

        int encryptionCount() {
            return sequence;
        }

        void replacePlaintext(String ciphertext, String plaintext) {
            plaintextByCiphertext.put(ciphertext, plaintext);
        }
    }

    private static final class InMemorySharedPreferences implements SharedPreferences {
        private final Map<String, Object> values = new HashMap<>();
        private int commitCount;
        private int applyCount;

        @Override
        public Map<String, ?> getAll() { return values; }

        @Override
        public String getString(String key, String defaultValue) {
            Object value = values.get(key);
            if (value == null) {
                return defaultValue;
            }
            if (!(value instanceof String)) {
                throw new ClassCastException(key + " is not a String");
            }
            return (String) value;
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
                public boolean commit() {
                    commitCount++;
                    return true;
                }

                @Override
                public void apply() { applyCount++; }

                @Override
                public Editor putStringSet(String key, Set<String> value) {
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
        public Set<String> getStringSet(String key, Set<String> defaults) {
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
            if (value == null) {
                return defaultValue;
            }
            if (!(value instanceof Boolean)) {
                throw new ClassCastException(key + " is not a Boolean");
            }
            return (Boolean) value;
        }

        @Override
        public void registerOnSharedPreferenceChangeListener(
            OnSharedPreferenceChangeListener listener
        ) {}

        @Override
        public void unregisterOnSharedPreferenceChangeListener(
            OnSharedPreferenceChangeListener listener
        ) {}

        int commitCount() {
            return commitCount;
        }

        int applyCount() {
            return applyCount;
        }
    }
}
