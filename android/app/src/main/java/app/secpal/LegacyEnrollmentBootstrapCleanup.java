/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import android.content.Context;
import android.content.SharedPreferences;

final class LegacyEnrollmentBootstrapCleanup {
    private static final String[] AUTHENTICATION_KEYS = {
        "bootstrap_token_ciphertext",
        "bootstrap_token_iv"
    };
    private static final String[] ENTERPRISE_KEYS = {
        "bootstrap_status",
        "bootstrap_enrollment_session_id",
        "bootstrap_update_channel",
        "bootstrap_release_metadata_url",
        "bootstrap_api_base_url",
        "bootstrap_tenant_id",
        "bootstrap_tenant_name",
        "bootstrap_last_error_code"
    };

    interface Store {
        boolean clearAuthenticationState();
        boolean clearEnterpriseState();
    }

    private LegacyEnrollmentBootstrapCleanup() {}

    static boolean clear(Context context) {
        return clear(
            new SharedPreferencesStore(
                context.getSharedPreferences(
                    SecPalNativeAuthPlugin.NATIVE_AUTH_PREFERENCES_NAME,
                    Context.MODE_PRIVATE
                ),
                context.getSharedPreferences(EnterprisePolicyController.ENTERPRISE_PREFS, Context.MODE_PRIVATE)
            )
        );
    }

    static boolean clear(Store store) {
        if (!store.clearAuthenticationState()) {
            return false;
        }

        return store.clearEnterpriseState();
    }

    private static final class SharedPreferencesStore implements Store {
        private final SharedPreferences authenticationPreferences;
        private final SharedPreferences enterprisePreferences;

        private SharedPreferencesStore(
            SharedPreferences authenticationPreferences,
            SharedPreferences enterprisePreferences
        ) {
            this.authenticationPreferences = authenticationPreferences;
            this.enterprisePreferences = enterprisePreferences;
        }

        @Override
        public boolean clearAuthenticationState() {
            return removeKnownKeys(authenticationPreferences, AUTHENTICATION_KEYS);
        }

        @Override
        public boolean clearEnterpriseState() {
            return removeKnownKeys(enterprisePreferences, ENTERPRISE_KEYS);
        }
    }

    private static boolean removeKnownKeys(SharedPreferences preferences, String[] keys) {
        SharedPreferences.Editor editor = null;

        for (String key : keys) {
            if (!preferences.contains(key)) {
                continue;
            }
            if (editor == null) {
                editor = preferences.edit();
            }
            editor.remove(key);
        }

        return editor == null || editor.commit();
    }
}
