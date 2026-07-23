/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.List;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;

@RunWith(RobolectricTestRunner.class)
public class LegacyEnrollmentBootstrapCleanupTest {

    @Test
    public void removesOnlyRetiredEnrollmentStateWithoutReadingTheToken() {
        Context context = RuntimeEnvironment.getApplication();
        SharedPreferences authPreferences = context.getSharedPreferences(
            SecPalNativeAuthPlugin.NATIVE_AUTH_PREFERENCES_NAME,
            Context.MODE_PRIVATE
        );
        SharedPreferences enterprisePreferences = context.getSharedPreferences(
            EnterprisePolicyController.ENTERPRISE_PREFS,
            Context.MODE_PRIVATE
        );

        authPreferences.edit()
            .clear()
            .putString("bootstrap_token_ciphertext", "encrypted-token")
            .putString("bootstrap_token_iv", "initialization-vector")
            .putString("token_ciphertext", "current-auth-token")
            .commit();
        enterprisePreferences.edit()
            .clear()
            .putString("bootstrap_status", "pending")
            .putString("bootstrap_enrollment_session_id", "session-123")
            .putString("bootstrap_update_channel", "beta")
            .putBoolean("kiosk_mode_enabled", true)
            .commit();

        assertTrue(LegacyEnrollmentBootstrapCleanup.clear(context));

        assertFalse(authPreferences.contains("bootstrap_token_ciphertext"));
        assertFalse(authPreferences.contains("bootstrap_token_iv"));
        assertEquals("current-auth-token", authPreferences.getString("token_ciphertext", null));
        assertFalse(enterprisePreferences.contains("bootstrap_status"));
        assertFalse(enterprisePreferences.contains("bootstrap_enrollment_session_id"));
        assertFalse(enterprisePreferences.contains("bootstrap_update_channel"));
        assertTrue(enterprisePreferences.getBoolean("kiosk_mode_enabled", false));

        authPreferences.edit().clear().commit();
        enterprisePreferences.edit().clear().commit();
    }

    @Test
    public void clearsSensitiveTokenStateBeforeDerivedEnterpriseState() {
        RecordingStore store = new RecordingStore(true, true);

        assertTrue(LegacyEnrollmentBootstrapCleanup.clear(store));
        assertEquals(List.of("authentication", "enterprise"), store.operations);
    }

    @Test
    public void stopsBeforeEnterpriseCleanupWhenSensitiveTokenCleanupFails() {
        RecordingStore store = new RecordingStore(false, true);

        assertFalse(LegacyEnrollmentBootstrapCleanup.clear(store));
        assertEquals(List.of("authentication"), store.operations);
    }

    private static final class RecordingStore implements LegacyEnrollmentBootstrapCleanup.Store {
        private final boolean authenticationResult;
        private final boolean enterpriseResult;
        private final List<String> operations = new ArrayList<>();

        private RecordingStore(boolean authenticationResult, boolean enterpriseResult) {
            this.authenticationResult = authenticationResult;
            this.enterpriseResult = enterpriseResult;
        }

        @Override
        public boolean clearAuthenticationState() {
            operations.add("authentication");
            return authenticationResult;
        }

        @Override
        public boolean clearEnterpriseState() {
            operations.add("enterprise");
            return enterpriseResult;
        }
    }
}
