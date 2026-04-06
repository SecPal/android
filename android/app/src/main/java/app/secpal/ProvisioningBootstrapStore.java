/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.PersistableBundle;

final class ProvisioningBootstrapStore {
    static final String PREFS_NAME = "secpal_enterprise_policy";

    private static final String PREF_STATUS = "bootstrap_status";
    private static final String PREF_SESSION_ID = "bootstrap_enrollment_session_id";
    private static final String PREF_UPDATE_CHANNEL = "bootstrap_update_channel";
    private static final String PREF_RELEASE_METADATA_URL = "bootstrap_release_metadata_url";
    private static final String PREF_API_BASE_URL = "bootstrap_api_base_url";
    private static final String PREF_TENANT_ID = "bootstrap_tenant_id";
    private static final String PREF_TENANT_NAME = "bootstrap_tenant_name";
    private static final String PREF_LAST_ERROR_CODE = "bootstrap_last_error_code";

    private final SharedPreferences preferences;
    private final TokenStorage tokenStorage;

    ProvisioningBootstrapStore(SharedPreferences preferences, TokenStorage tokenStorage) {
        this.preferences = preferences;
        this.tokenStorage = tokenStorage;
    }

    static ProvisioningBootstrapStore fromContext(Context context) {
        return new ProvisioningBootstrapStore(
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE),
            new KeystoreTokenStorage(context, "bootstrap_token")
        );
    }

    void persistProvisioningExtras(PersistableBundle extras) throws TokenStorageException {
        if (extras == null || extras.isEmpty()) {
            return;
        }

        persistProvisioningData(
            extras.getString("bootstrap_token"),
            extras.getString("enrollment_session_id")
        );
    }

    void persistProvisioningData(String bootstrapToken, String enrollmentSessionId) throws TokenStorageException {
        String normalizedToken = normalize(bootstrapToken);

        if (normalizedToken == null) {
            return;
        }

        tokenStorage.saveToken(normalizedToken);
        preferences.edit()
            .putString(PREF_STATUS, ProvisioningBootstrapState.STATUS_PENDING)
            .putString(PREF_SESSION_ID, normalize(enrollmentSessionId))
            .remove(PREF_UPDATE_CHANNEL)
            .remove(PREF_RELEASE_METADATA_URL)
            .remove(PREF_API_BASE_URL)
            .remove(PREF_TENANT_NAME)
            .remove(PREF_LAST_ERROR_CODE)
            .remove(PREF_TENANT_ID)
            .apply();
    }

    ProvisioningBootstrapState getState() throws TokenStorageException {
        String sessionId = preferences.getString(PREF_SESSION_ID, null);
        String storedStatus = preferences.getString(PREF_STATUS, ProvisioningBootstrapState.STATUS_NONE);
        String bootstrapToken = tokenStorage.getToken();
        String status = storedStatus;

        if ((sessionId == null || sessionId.isEmpty()) && bootstrapToken == null) {
            status = ProvisioningBootstrapState.STATUS_NONE;
        } else if (ProvisioningBootstrapState.STATUS_PENDING.equals(storedStatus)
            && (bootstrapToken == null || bootstrapToken.isEmpty())) {
            status = ProvisioningBootstrapState.STATUS_FAILED;
        }

        return new ProvisioningBootstrapState(
            status,
            sessionId,
            preferences.getString(PREF_UPDATE_CHANNEL, null),
            preferences.getString(PREF_RELEASE_METADATA_URL, null),
            preferences.getString(PREF_API_BASE_URL, null),
            preferences.getString(PREF_TENANT_NAME, null),
            preferences.getInt(PREF_TENANT_ID, 0),
            preferences.getString(PREF_LAST_ERROR_CODE, null)
        );
    }

    String getBootstrapToken() throws TokenStorageException {
        return tokenStorage.getToken();
    }

    void applyExchangeResult(ProvisioningBootstrapExchangeResult result) {
        SharedPreferences.Editor editor = preferences.edit()
            .putString(PREF_STATUS, ProvisioningBootstrapState.STATUS_COMPLETED)
            .putString(PREF_SESSION_ID, normalize(result.getEnrollmentSessionId()))
            .putString(PREF_UPDATE_CHANNEL, normalize(result.getUpdateChannel()))
            .putString(PREF_RELEASE_METADATA_URL, normalize(result.getReleaseMetadataUrl()))
            .putString(PREF_API_BASE_URL, normalize(result.getApiBaseUrl()))
            .putString(PREF_TENANT_NAME, normalize(result.getTenantName()))
            .putInt(PREF_TENANT_ID, result.getTenantId())
            .remove(PREF_LAST_ERROR_CODE);

        EnterprisePolicyConfig.fromMap(result.getProvisioningProfile()).writeToPreferences(editor);
        editor.apply();
        tokenStorage.clearToken();
    }

    void markExchangeFailure(String errorCode, boolean terminal) {
        SharedPreferences.Editor editor = preferences.edit().putString(PREF_LAST_ERROR_CODE, normalize(errorCode));

        if (terminal) {
            editor.putString(PREF_STATUS, ProvisioningBootstrapState.STATUS_FAILED).apply();
            tokenStorage.clearToken();
            return;
        }

        editor.putString(PREF_STATUS, ProvisioningBootstrapState.STATUS_PENDING).apply();
    }

    void clear() {
        preferences.edit()
            .remove(PREF_STATUS)
            .remove(PREF_SESSION_ID)
            .remove(PREF_UPDATE_CHANNEL)
            .remove(PREF_RELEASE_METADATA_URL)
            .remove(PREF_API_BASE_URL)
            .remove(PREF_TENANT_ID)
            .remove(PREF_TENANT_NAME)
            .remove(PREF_LAST_ERROR_CODE)
            .apply();
        tokenStorage.clearToken();
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }

        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }
}
