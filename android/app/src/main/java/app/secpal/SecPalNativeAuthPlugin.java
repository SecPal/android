/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URL;

@CapacitorPlugin(name = "SecPalNativeAuth")
public class SecPalNativeAuthPlugin extends Plugin {
    private static final String NATIVE_AUTH_PREFERENCES_NAME = "secpal_native_auth";
    private static final String API_BASE_URL_PREFERENCE_KEY = "api_base_url";
    private static final String RUNTIME_BOOTSTRAP_PREFERENCE_KEY = "runtime_bootstrap";

    private TokenStorage tokenStorage;
    private KeystoreVaultRootKeyWrapper vaultRootKeyWrapper;
    private NativeAuthHttpClient httpClient;
    private NetworkState networkState;
    private NativePasskeyAuthenticator passkeyAuthenticator;
    private AndroidPushRuntimeManager androidPushRuntimeManager;
    private final NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
    private String apiBaseUrl;

    @Override
    public void load() {
        super.load();
        tokenStorage = new KeystoreTokenStorage(getContext());
        androidPushRuntimeManager = new AndroidPushRuntimeManager(getContext());
        JSObject persistedRuntimeBootstrap = getPersistedRuntimeBootstrap();
        if (persistedRuntimeBootstrap == null) {
            clearRejectedLegacyRuntimeState(getNativeAuthPreferences(), tokenStorage);
        }
        persistedRuntimeBootstrap = applyPersistedRuntimeBootstrap(
            getNativeAuthPreferences(),
            androidPushRuntimeManager,
            persistedRuntimeBootstrap
        );
        apiBaseUrl = persistedRuntimeBootstrap != null
            ? persistedRuntimeBootstrap.optString("apiOrigin", null)
            : null;
        vaultRootKeyWrapper = new KeystoreVaultRootKeyWrapper();
        httpClient = new NativeAuthHttpClient();
        networkState = new NetworkState();
        passkeyAuthenticator = new NativePasskeyAuthenticator();
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        taskExecutor.shutdownNow();
    }

    @PluginMethod
    public void login(PluginCall call) {
        String email = requireValue(call, "email");
        String password = requireValue(call, "password");

        if (email == null || password == null) {
            return;
        }

        runAsync(call, () -> {
            try {
                requireNetworkConnection();
                NativeAuthHttpClient.LoginResponse response = httpClient.login(apiBaseUrl, email, password);
                tokenStorage.saveToken(response.getToken());

                JSObject payload = new JSObject();
                payload.put("user", response.getUser());
                call.resolve(payload);
            } catch (IOException | JSONException | NativeAuthHttpException | NetworkUnavailableException exception) {
                rejectCall(call, exception);
            } catch (TokenStorageException exception) {
                call.reject("Failed to persist Android auth token", "TOKEN_STORAGE_ERROR", exception);
            }
        });
    }

    @PluginMethod
    public void loginWithPasskey(PluginCall call) {
        runAsync(call, () -> {
            try {
                Activity activity = getActivity();

                if (activity == null) {
                    call.reject(
                        "Android passkey sign-in is unavailable because no activity is attached.",
                        "PASSKEY_UNAVAILABLE"
                    );
                    return;
                }

                requireNetworkConnection();

                NativeAuthHttpClient.PasskeyChallenge challenge = httpClient.startTokenPasskeyAuthenticationChallenge(
                    apiBaseUrl,
                    NativeAuthHttpClient.buildDeviceName(Build.MANUFACTURER, Build.MODEL)
                );
                String requestJson = PasskeyAuthenticationJson.buildAuthenticationRequestJson(challenge.getPublicKey());
                String authenticationResponseJson = passkeyAuthenticator.authenticate(activity, requestJson);
                JSObject credential = PasskeyAuthenticationJson.buildAuthenticationVerificationCredential(
                    authenticationResponseJson
                );
                NativeAuthHttpClient.LoginResponse response = httpClient.verifyTokenPasskeyAuthenticationChallenge(
                    apiBaseUrl,
                    challenge.getChallengeId(),
                    credential
                );

                tokenStorage.saveToken(response.getToken());

                JSObject payload = new JSObject();
                payload.put("user", response.getUser());
                call.resolve(payload);
            } catch (
                IOException
                | JSONException
                | NativeAuthHttpException
                | NetworkUnavailableException
                | PasskeyAuthenticationException exception
            ) {
                rejectCall(call, exception);
            } catch (TokenStorageException exception) {
                call.reject("Failed to persist Android auth token", "TOKEN_STORAGE_ERROR", exception);
            }
        });
    }

    @PluginMethod
    public void createPasskeyAttestation(PluginCall call) {
        JSObject publicKey = call.getObject("publicKey");

        if (publicKey == null) {
            call.reject("Missing required value: publicKey", "INVALID_INPUT");
            return;
        }

        runAsync(call, () -> {
            try {
                Activity activity = getActivity();

                if (activity == null) {
                    call.reject(
                        "Android passkey registration is unavailable because no activity is attached.",
                        "PASSKEY_UNAVAILABLE"
                    );
                    return;
                }

                String requestJson = PasskeyAuthenticationJson.buildRegistrationRequestJson(publicKey);
                String registrationResponseJson = passkeyAuthenticator.register(activity, requestJson);
                JSObject credential = PasskeyAuthenticationJson.buildRegistrationVerificationCredential(
                    registrationResponseJson
                );

                JSObject payload = new JSObject();
                payload.put("credential", credential);
                call.resolve(payload);
            } catch (JSONException | NativeAuthHttpException | PasskeyAuthenticationException exception) {
                rejectCall(call, exception);
            }
        });
    }

    @PluginMethod
    public void getCurrentUser(PluginCall call) {
        runAsync(call, () -> {
            try {
                String token = requireStoredToken(call);
                if (token == null) {
                    return;
                }

                requireNetworkConnection();
                call.resolve(httpClient.getCurrentUser(apiBaseUrl, token));
            } catch (IOException | JSONException | NativeAuthHttpException | NetworkUnavailableException exception) {
                maybeClearToken(exception);
                rejectCall(call, exception);
            } catch (TokenStorageException exception) {
                call.reject("Failed to load Android auth token", "TOKEN_STORAGE_ERROR", exception);
            }
        });
    }

    @PluginMethod
    public void isNetworkAvailable(PluginCall call) {
        JSObject payload = new JSObject();
        payload.put("available", networkState.isNetworkAvailable(getContext()));
        call.resolve(payload);
    }

    @PluginMethod
    public void getRuntimeInfo(PluginCall call) {
        ProvisioningBootstrapRuntimeInfo runtimeInfo =
            ProvisioningBootstrapRuntimeInfo.fromContext(getContext());
        String appVersion = runtimeInfo.getPackageVersionName();
        int appBuild = runtimeInfo.getPackageVersionCode();

        if (appVersion == null || appVersion.trim().isEmpty() || appBuild <= 0) {
            call.reject(
                "Android runtime version metadata is unavailable",
                "RUNTIME_INFO_UNAVAILABLE"
            );
            return;
        }

        JSObject payload = new JSObject();
        payload.put("clientPlatform", "android");
        payload.put("appVersion", appVersion);
        payload.put("appBuild", appBuild);
        call.resolve(payload);
    }

    @PluginMethod
    public void setApiBaseUrl(PluginCall call) {
        String value = requireValue(call, "apiBaseUrl");

        if (value == null) {
            return;
        }

        runAsync(call, () -> {
            try {
                String nextApiBaseUrl = resolveRuntimeApiBaseUrl(value);

                if (!getNativeAuthPreferences()
                    .edit()
                    .putString(API_BASE_URL_PREFERENCE_KEY, nextApiBaseUrl)
                    .remove(RUNTIME_BOOTSTRAP_PREFERENCE_KEY)
                    .commit()) {
                    call.reject(
                        "Failed to persist Android runtime API origin",
                        "RUNTIME_BOOTSTRAP_PERSISTENCE_FAILED"
                    );
                    return;
                }

                if (shouldClearStoredToken(apiBaseUrl, nextApiBaseUrl)) {
                    tokenStorage.clearToken();
                }

                apiBaseUrl = nextApiBaseUrl;

                JSObject payload = new JSObject();
                payload.put("apiBaseUrl", apiBaseUrl);
                call.resolve(payload);
            } catch (ConfiguredApiBaseUrlException exception) {
                call.reject(
                    exception.getMessage(),
                    exception.getErrorCode(),
                    exception
                );
            }
        });
    }

    @PluginMethod
    public void setRuntimeBootstrap(PluginCall call) {
        String instanceDisplayName = requireValue(call, "instanceDisplayName");
        String apiOrigin = requireValue(call, "apiOrigin");
        String rawApiBaseUrl = requireValue(call, "rawApiBaseUrl");
        String minimumSupportedAppVersion = requireValue(call, "minimumSupportedAppVersion");
        Integer minimumSupportedAppBuild = call.getInt("minimumSupportedAppBuild");
        JSObject androidPush = call.getObject("androidPush");
        JSObject features = call.getObject("features");

        if (instanceDisplayName == null
            || apiOrigin == null
            || rawApiBaseUrl == null
            || minimumSupportedAppVersion == null) {
            return;
        }

        if (minimumSupportedAppBuild == null || minimumSupportedAppBuild <= 0) {
            call.reject(
                "Missing required value: minimumSupportedAppBuild",
                "INVALID_INPUT"
            );
            return;
        }

        runAsync(call, () -> {
            try {
                JSObject bootstrap = buildRuntimeBootstrap(
                    instanceDisplayName,
                    apiOrigin,
                    rawApiBaseUrl,
                    minimumSupportedAppVersion,
                    minimumSupportedAppBuild,
                    androidPush,
                    features
                );
                String nextApiBaseUrl = bootstrap.getString("apiOrigin");

                if (!persistRuntimeBootstrap(bootstrap)) {
                    call.reject(
                        "Failed to persist Android runtime bootstrap",
                        "RUNTIME_BOOTSTRAP_PERSISTENCE_FAILED"
                    );
                    return;
                }

                try {
                    androidPushRuntimeManager.apply(
                        AndroidPushRuntimeMetadata.fromBootstrap(bootstrap.optJSONObject("androidPush"))
                    );
                } catch (RuntimeException exception) {
                    getNativeAuthPreferences().edit().remove(RUNTIME_BOOTSTRAP_PREFERENCE_KEY).apply();
                    androidPushRuntimeManager.apply(null);
                    throw exception;
                }

                if (shouldClearStoredToken(apiBaseUrl, nextApiBaseUrl)) {
                    tokenStorage.clearToken();
                }

                apiBaseUrl = nextApiBaseUrl;

                JSObject payload = new JSObject();
                payload.put("bootstrap", bootstrap);
                call.resolve(payload);
            } catch (IllegalStateException exception) {
                call.reject(
                    exception.getMessage(),
                    resolveRuntimeBootstrapErrorCode(exception),
                    exception
                );
            } catch (JSONException exception) {
                call.reject(
                    "Failed to serialize Android runtime bootstrap",
                    "RUNTIME_BOOTSTRAP_INVALID",
                    exception
                );
            }
        });
    }

    @PluginMethod
    public void getRuntimeBootstrap(PluginCall call) {
        runAsync(call, () -> {
            JSObject payload = buildRuntimeBootstrapPayload(getPersistedRuntimeBootstrap());
            call.resolve(payload);
        });
    }

    @PluginMethod
    public void clearRuntimeBootstrap(PluginCall call) {
        runAsync(call, () -> {
            boolean persisted = clearRuntimeBootstrapState(
                getNativeAuthPreferences(),
                tokenStorage,
                () -> ProvisioningBootstrapStore.fromContext(getContext()).clear()
            );

            if (!persisted) {
                call.reject(
                    "Failed to clear Android runtime bootstrap state",
                    "RUNTIME_BOOTSTRAP_PERSISTENCE_FAILED"
                );
                return;
            }

            apiBaseUrl = null;
            androidPushRuntimeManager.apply(null);
            call.resolve();
        });
    }

    @PluginMethod
    public void isVaultDeviceBoundWrapperAvailable(PluginCall call) {
        JSObject payload = new JSObject();
        payload.put("available", vaultRootKeyWrapper != null && vaultRootKeyWrapper.isAvailable());
        call.resolve(payload);
    }

    @PluginMethod
    public void logout(PluginCall call) {
        runAsync(call, () -> {
            try {
                String token = requireStoredToken(call);
                if (token == null) {
                    return;
                }

                httpClient.logout(apiBaseUrl, token);
                tokenStorage.clearToken();
                call.resolve();
            } catch (IOException | JSONException | NativeAuthHttpException exception) {
                maybeClearToken(exception);
                rejectCall(call, exception);
            } catch (TokenStorageException exception) {
                call.reject("Failed to load Android auth token", "TOKEN_STORAGE_ERROR", exception);
            }
        });
    }

    @PluginMethod
    public void request(PluginCall call) {
        String method = requireValue(call, "method");
        String path = requireValue(call, "path");

        if (method == null || path == null) {
            return;
        }

        String bodyBase64 = call.getString("bodyBase64");
        String contentType = call.getString("contentType");
        String accept = call.getString("accept");

        runAsync(call, () -> {
            try {
                String token = requireStoredToken(call);
                if (token == null) {
                    return;
                }

                requireNetworkConnection();
                JSObject response = httpClient.request(apiBaseUrl, token, method, path, bodyBase64, contentType, accept);

                Integer statusCode = response.getInteger("status");
                if (statusCode != null && statusCode == 401) {
                    tokenStorage.clearToken();
                }

                call.resolve(response);
            } catch (IOException | NativeAuthHttpException | NetworkUnavailableException exception) {
                maybeClearToken(exception);
                rejectCall(call, exception);
            } catch (TokenStorageException exception) {
                call.reject("Failed to load Android auth token", "TOKEN_STORAGE_ERROR", exception);
            }
        });
    }

    @PluginMethod
    public void wrapVaultRootKey(PluginCall call) {
        String rootKeyBase64 = requireValue(call, "rootKeyBase64");
        String subjectHash = requireValue(call, "subjectHash");

        if (rootKeyBase64 == null || subjectHash == null) {
            return;
        }

        runAsync(call, () -> {
            try {
                JSObject payload = new JSObject();
                payload.put("wrappedRootKey", vaultRootKeyWrapper.wrap(rootKeyBase64, subjectHash));
                call.resolve(payload);
            } catch (TokenStorageException exception) {
                call.reject("Failed to wrap Android offline vault root key", "TOKEN_STORAGE_ERROR", exception);
            }
        });
    }

    @PluginMethod
    public void unwrapVaultRootKey(PluginCall call) {
        String wrappedRootKey = requireValue(call, "wrappedRootKey");
        String subjectHash = requireValue(call, "subjectHash");

        if (wrappedRootKey == null || subjectHash == null) {
            return;
        }

        runAsync(call, () -> {
            try {
                JSObject payload = new JSObject();
                payload.put("rootKeyBase64", vaultRootKeyWrapper.unwrap(wrappedRootKey, subjectHash));
                call.resolve(payload);
            } catch (TokenStorageException exception) {
                call.reject("Failed to unwrap Android offline vault root key", "TOKEN_STORAGE_ERROR", exception);
            }
        });
    }

    private void runAsync(PluginCall call, Runnable job) {
        if (!taskExecutor.submit(job)) {
            call.reject("Failed to execute auth request - plugin was shutdown", "PLUGIN_SHUTDOWN");
        }
    }

    private String requireStoredToken(PluginCall call) throws TokenStorageException {
        String token = tokenStorage.getToken();

        if (token == null || token.trim().isEmpty()) {
            call.reject("Android auth token is not available", "NO_STORED_TOKEN");
            return null;
        }

        return token;
    }

    private String requireValue(PluginCall call, String key) {
        String value = call.getString(key);

        if (value == null || value.trim().isEmpty()) {
            call.reject("Missing required value: " + key, "INVALID_INPUT");
            return null;
        }

        return value.trim();
    }

    private void rejectCall(PluginCall call, Exception exception) {
        String errorCode = resolveErrorCode(exception);

        if (errorCode != null) {
            call.reject(exception.getMessage(), errorCode, exception);
            return;
        }

        call.reject(exception.getMessage(), exception.getClass().getSimpleName(), exception);
    }

    static String resolveErrorCode(Exception exception) {
        if (exception instanceof NetworkUnavailableException) {
            return "NETWORK_OFFLINE";
        }

        if (exception instanceof PasskeyAuthenticationException) {
            return ((PasskeyAuthenticationException) exception).getErrorCode();
        }

        if (!(exception instanceof NativeAuthHttpException)) {
            return null;
        }

        int statusCode = ((NativeAuthHttpException) exception).getStatusCode();

        return statusCode > 0 ? "HTTP_" + statusCode : "VALIDATION_ERROR";
    }

    static String resolveRuntimeBootstrapErrorCode(IllegalStateException exception) {
        if (exception instanceof ConfiguredApiBaseUrlException) {
            return ((ConfiguredApiBaseUrlException) exception).getErrorCode();
        }

        if (exception instanceof InvalidRuntimeBootstrapException) {
            return ((InvalidRuntimeBootstrapException) exception).getErrorCode();
        }

        return "RUNTIME_BOOTSTRAP_INVALID";
    }

    static String resolveConfiguredApiBaseUrl(String configuredValue) {
        try {
            return NativeAuthHttpClient.normalizeBaseUrl(configuredValue);
        } catch (NativeAuthHttpException exception) {
            throw new ConfiguredApiBaseUrlException(
                "Invalid Android auth API origin configuration",
                "INVALID_API_BASE_URL",
                exception
            );
        }
    }

    static String resolveRuntimeApiBaseUrl(String configuredValue) {
        String normalizedApiBaseUrl = resolveConfiguredApiBaseUrl(configuredValue);

        if (!normalizedApiBaseUrl.startsWith("https://")) {
            throw new ConfiguredApiBaseUrlException(
                "Android auth API origin must use HTTPS",
                "INSECURE_API_BASE_URL"
            );
        }

        return normalizedApiBaseUrl;
    }

    static String resolveCanonicalBootstrapApiOrigin(String configuredValue) {
        if (configuredValue == null || configuredValue.trim().isEmpty()) {
            throw new InvalidRuntimeBootstrapException(
                "Android runtime bootstrap requires a raw API base URL",
                "RUNTIME_BOOTSTRAP_INVALID"
            );
        }

        URL parsedUrl;

        try {
            parsedUrl = new URL(configuredValue.trim());
        } catch (MalformedURLException exception) {
            throw new InvalidRuntimeBootstrapException(
                "Android runtime bootstrap requires a valid API base URL",
                "RUNTIME_BOOTSTRAP_INVALID"
            );
        }

        if ((parsedUrl.getUserInfo() != null && !parsedUrl.getUserInfo().isEmpty())
            || parsedUrl.getQuery() != null
            || parsedUrl.getRef() != null) {
            throw new InvalidRuntimeBootstrapException(
                "Android runtime bootstrap requires a bare API base URL or its /v1 endpoint",
                "RUNTIME_BOOTSTRAP_INVALID"
            );
        }

        String path = parsedUrl.getPath() == null ? "" : parsedUrl.getPath().replaceAll("/+$", "");

        if (!path.isEmpty() && !"/v1".equals(path)) {
            throw new InvalidRuntimeBootstrapException(
                "Android runtime bootstrap requires a bare API base URL or its /v1 endpoint",
                "RUNTIME_BOOTSTRAP_INVALID"
            );
        }

        StringBuilder origin = new StringBuilder(parsedUrl.getProtocol())
            .append("://")
            .append(parsedUrl.getHost());

        if (parsedUrl.getPort() != -1 && parsedUrl.getPort() != parsedUrl.getDefaultPort()) {
            origin.append(":").append(parsedUrl.getPort());
        }

        return resolveRuntimeApiBaseUrl(origin.toString());
    }

    static boolean shouldClearStoredToken(String currentApiBaseUrl, String nextApiBaseUrl) {
        return currentApiBaseUrl != null && !currentApiBaseUrl.equals(nextApiBaseUrl);
    }

    static void clearRejectedLegacyRuntimeState(SharedPreferences preferences, TokenStorage tokenStorage) {
        String legacyApiBaseUrl = preferences.getString(API_BASE_URL_PREFERENCE_KEY, null);

        if (legacyApiBaseUrl == null || legacyApiBaseUrl.trim().isEmpty()) {
            return;
        }

        preferences.edit().remove(API_BASE_URL_PREFERENCE_KEY).apply();
        tokenStorage.clearToken();
    }

    static JSObject applyPersistedRuntimeBootstrap(
        SharedPreferences preferences,
        AndroidPushRuntimeManager androidPushRuntimeManager,
        JSObject persistedRuntimeBootstrap
    ) {
        if (persistedRuntimeBootstrap == null) {
            androidPushRuntimeManager.apply(null);
            return null;
        }

        try {
            androidPushRuntimeManager.apply(
                AndroidPushRuntimeMetadata.fromBootstrap(persistedRuntimeBootstrap.optJSONObject("androidPush"))
            );
            return persistedRuntimeBootstrap;
        } catch (RuntimeException exception) {
            preferences.edit().remove(RUNTIME_BOOTSTRAP_PREFERENCE_KEY).apply();
            androidPushRuntimeManager.apply(null);
            return null;
        }
    }

    static boolean clearRuntimeBootstrapState(
        SharedPreferences preferences,
        TokenStorage tokenStorage,
        Runnable provisioningStateClearer
    ) {
        boolean persisted = preferences.edit()
            .remove(RUNTIME_BOOTSTRAP_PREFERENCE_KEY)
            .remove(API_BASE_URL_PREFERENCE_KEY)
            .commit();

        if (!persisted) {
            return false;
        }

        tokenStorage.clearToken();

        if (provisioningStateClearer != null) {
            provisioningStateClearer.run();
        }

        return true;
    }

    private boolean persistRuntimeBootstrap(JSObject bootstrap) {
        return getNativeAuthPreferences()
            .edit()
            .putString(RUNTIME_BOOTSTRAP_PREFERENCE_KEY, bootstrap.toString())
            .remove(API_BASE_URL_PREFERENCE_KEY)
            .commit();
    }

    static JSObject buildRuntimeBootstrapPayload(JSObject bootstrap) {
        JSObject payload = new JSObject();

        if (bootstrap == null) {
            payload.put("configured", false);
            return payload;
        }

        payload.put("configured", true);
        payload.put("bootstrap", bootstrap);

        return payload;
    }

    private JSObject getPersistedRuntimeBootstrap() {
        return loadPersistedRuntimeBootstrap(getNativeAuthPreferences());
    }

    static JSObject loadPersistedRuntimeBootstrap(SharedPreferences preferences) {
        String rawBootstrap = preferences.getString(RUNTIME_BOOTSTRAP_PREFERENCE_KEY, null);

        if (rawBootstrap == null || rawBootstrap.trim().isEmpty()) {
            return null;
        }

        try {
            return normalizeRuntimeBootstrap(new JSONObject(rawBootstrap));
        } catch (JSONException | ConfiguredApiBaseUrlException | InvalidRuntimeBootstrapException exception) {
            preferences.edit().remove(RUNTIME_BOOTSTRAP_PREFERENCE_KEY).apply();
            return null;
        }
    }

    static JSObject buildRuntimeBootstrap(
        String instanceDisplayName,
        String apiOrigin,
        String rawApiBaseUrl,
        String minimumSupportedAppVersion,
        int minimumSupportedAppBuild,
        JSONObject androidPush,
        JSONObject features
    ) throws JSONException {
        JSObject bootstrap = new JSObject();
        bootstrap.put("instanceDisplayName", instanceDisplayName);
        bootstrap.put("apiOrigin", apiOrigin);
        bootstrap.put("rawApiBaseUrl", rawApiBaseUrl);
        bootstrap.put("minimumSupportedAppVersion", minimumSupportedAppVersion);
        bootstrap.put("minimumSupportedAppBuild", minimumSupportedAppBuild);

        if (androidPush != null) {
            bootstrap.put("androidPush", androidPush);
        }

        if (features != null) {
            bootstrap.put("features", features);
        }

        return normalizeRuntimeBootstrap(bootstrap);
    }

    static JSObject normalizeRuntimeBootstrap(JSONObject bootstrap)
        throws JSONException, ConfiguredApiBaseUrlException, InvalidRuntimeBootstrapException {
        if (bootstrap == null) {
            throw new InvalidRuntimeBootstrapException(
                "Android runtime bootstrap is missing",
                "RUNTIME_BOOTSTRAP_INVALID"
            );
        }

        String instanceDisplayName = normalizeRequiredString(
            bootstrap.optString("instanceDisplayName", null),
            "Android runtime bootstrap requires an instance display name"
        );
        String rawApiBaseUrl = normalizeRequiredString(
            firstNonBlank(bootstrap.optString("rawApiBaseUrl", null), bootstrap.optString("apiOrigin", null)),
            "Android runtime bootstrap requires a raw API base URL"
        );
        String minimumSupportedAppVersion = normalizeRequiredString(
            bootstrap.optString("minimumSupportedAppVersion", null),
            "Android runtime bootstrap requires a minimum supported app version"
        );
        int minimumSupportedAppBuild = bootstrap.optInt("minimumSupportedAppBuild", 0);

        if (minimumSupportedAppBuild <= 0) {
            throw new InvalidRuntimeBootstrapException(
                "Android runtime bootstrap requires a minimum supported app build",
                "RUNTIME_BOOTSTRAP_INVALID"
            );
        }

        String canonicalApiOrigin = resolveCanonicalBootstrapApiOrigin(
            firstNonBlank(bootstrap.optString("apiOrigin", null), rawApiBaseUrl)
        );

        JSONObject features = bootstrap.optJSONObject("features");
        JSObject normalized = new JSObject();
        normalized.put("instanceDisplayName", instanceDisplayName);
        normalized.put("apiOrigin", canonicalApiOrigin);
        normalized.put("rawApiBaseUrl", rawApiBaseUrl.trim());
        normalized.put("minimumSupportedAppVersion", minimumSupportedAppVersion);
        normalized.put("minimumSupportedAppBuild", minimumSupportedAppBuild);

        JSObject normalizedFeatures = new JSObject();
        normalizedFeatures.put(
            "passwordLoginEnabled",
            features != null && features.optBoolean("passwordLoginEnabled", false)
        );
        normalizedFeatures.put(
            "passkeyLoginEnabled",
            features != null && features.optBoolean("passkeyLoginEnabled", false)
        );
        normalizedFeatures.put(
            "managedAndroidEnrollment",
            features != null && features.optBoolean("managedAndroidEnrollment", false)
        );
        normalized.put("features", normalizedFeatures);

        AndroidPushRuntimeMetadata androidPush = AndroidPushRuntimeMetadata.fromBootstrap(
            bootstrap.optJSONObject("androidPush")
        );

        if (androidPush != null) {
            normalized.put("androidPush", androidPush.toJsObject());
        }

        return normalized;
    }

    private static String normalizeRequiredString(String value, String message)
        throws InvalidRuntimeBootstrapException {
        if (value == null || value.trim().isEmpty()) {
            throw new InvalidRuntimeBootstrapException(message, "RUNTIME_BOOTSTRAP_INVALID");
        }

        return value.trim();
    }

    private static String firstNonBlank(String preferred, String fallback) {
        if (preferred != null && !preferred.trim().isEmpty()) {
            return preferred;
        }

        return fallback;
    }

    private SharedPreferences getNativeAuthPreferences() {
        return getContext().getSharedPreferences(NATIVE_AUTH_PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    private void maybeClearToken(Exception exception) {
        if (exception instanceof NativeAuthHttpException) {
            NativeAuthHttpException httpException = (NativeAuthHttpException) exception;

            if (httpException.getStatusCode() == 401) {
                tokenStorage.clearToken();
            }
        }
    }

    private void requireNetworkConnection() throws NetworkUnavailableException {
        if (!networkState.isNetworkAvailable(getContext())) {
            throw new NetworkUnavailableException(
                "Android auth requires an active internet connection"
            );
        }
    }

    static final class ConfiguredApiBaseUrlException extends IllegalStateException {
        private final String errorCode;

        ConfiguredApiBaseUrlException(String message, String errorCode, Throwable cause) {
            super(message, cause);
            this.errorCode = errorCode;
        }

        ConfiguredApiBaseUrlException(String message, String errorCode) {
            super(message);
            this.errorCode = errorCode;
        }

        String getErrorCode() {
            return errorCode;
        }
    }

    static final class InvalidRuntimeBootstrapException extends IllegalStateException {
        private final String errorCode;

        InvalidRuntimeBootstrapException(String message, String errorCode) {
            super(message);
            this.errorCode = errorCode;
        }

        String getErrorCode() {
            return errorCode;
        }
    }
}
