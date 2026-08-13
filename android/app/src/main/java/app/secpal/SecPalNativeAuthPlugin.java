/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
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
import java.util.Locale;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;

@CapacitorPlugin(name = "SecPalNativeAuth")
public class SecPalNativeAuthPlugin extends Plugin {
    static final String NATIVE_AUTH_PREFERENCES_NAME = "secpal_native_auth";
    private static final String API_BASE_URL_PREFERENCE_KEY = "api_base_url";
    private static final String RUNTIME_BOOTSTRAP_PREFERENCE_KEY = "runtime_bootstrap";
    private static final String ANDROID_PUSH_TOKEN_RECEIVED_EVENT = "androidPushTokenReceived";
    private static final String ANDROID_PUSH_TOKEN_ERROR_EVENT = "androidPushTokenError";
    private static final String VAULT_ROOT_KEY_BRIDGE_UNSUPPORTED_MESSAGE =
        "Android offline vault root keys cannot be bridged into WebView JavaScript";
    private static final String VAULT_ROOT_KEY_BRIDGE_UNSUPPORTED_CODE =
        "VAULT_ROOT_KEY_BRIDGE_UNSUPPORTED";

    @FunctionalInterface
    interface AndroidPushRegistrationRevoker {
        void revoke(String apiOrigin, String token, String installationId)
            throws IOException, NativeAuthHttpException;
    }

    @FunctionalInterface
    interface NativeAuthenticationRevoker {
        void revoke(String apiOrigin, String token)
            throws IOException, JSONException, NativeAuthHttpException;
    }

    private TokenStorage tokenStorage;
    private KeystoreVaultRootKeyWrapper vaultRootKeyWrapper;
    private NativeAuthHttpClient httpClient;
    private NetworkState networkState;
    private NativePasskeyAuthenticator passkeyAuthenticator;
    private AndroidPushRuntimeManager androidPushRuntimeManager;
    private final NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
    private final AtomicBoolean runtimeMutationConfirmationPending = new AtomicBoolean(false);
    private volatile boolean destroyed = false;
    private String apiBaseUrl;

    @Override
    public void load() {
        super.load();
        tokenStorage = new KeystoreTokenStorage(getContext());
        androidPushRuntimeManager = new AndroidPushRuntimeManager(
            getContext(),
            createAndroidPushMessagingListener()
        );
        JSObject persistedRuntimeBootstrap = getPersistedRuntimeBootstrap();
        if (persistedRuntimeBootstrap == null) {
            clearRejectedLegacyRuntimeState(getNativeAuthPreferences(), tokenStorage);
        }
        persistedRuntimeBootstrap = applyPersistedRuntimeBootstrap(
            getNativeAuthPreferences(),
            tokenStorage,
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
        destroyed = true;
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
        NativePasskeyCapability capability = NativePasskeyCapability.forCurrentDevice();

        if (!requirePasskeyCapability(call, capability)) {
            return;
        }

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
                String authenticationResponseJson = passkeyAuthenticator.authenticate(
                    activity,
                    requestJson,
                    capability
                );
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
        NativePasskeyCapability capability = NativePasskeyCapability.forCurrentDevice();

        if (!requirePasskeyCapability(call, capability)) {
            return;
        }

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
                String registrationResponseJson = passkeyAuthenticator.register(
                    activity,
                    requestJson,
                    capability
                );
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
    public void getPasskeyCapabilities(PluginCall call) {
        call.resolve(buildPasskeyCapabilities(NativePasskeyCapability.forCurrentDevice()));
    }

    @PluginMethod
    public void getRuntimeInfo(PluginCall call) {
        AndroidRuntimeInfo runtimeInfo = AndroidRuntimeInfo.fromContext(getContext());
        String appVersion = runtimeInfo.getPackageVersionName();
        long appBuild = runtimeInfo.getPackageVersionCode();

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
    public void confirmRuntimeBootstrap(PluginCall call) {
        String instanceDisplayName = requireValue(call, "instanceDisplayName");
        String apiOrigin = requireValue(call, "apiOrigin");
        String rawApiBaseUrl = requireValue(call, "rawApiBaseUrl");
        JSObject androidPush = call.getObject("androidPush");
        JSObject features = call.getObject("features");

        if (instanceDisplayName == null
            || apiOrigin == null
            || rawApiBaseUrl == null) {
            return;
        }

        runAsync(call, () -> {
            try {
                JSObject bootstrap = buildRuntimeBootstrap(
                    instanceDisplayName,
                    apiOrigin,
                    rawApiBaseUrl,
                    androidPush,
                    features
                );
                String canonicalApiOrigin = bootstrap.getString("apiOrigin");
                String confirmationMessage = formatRuntimeConfirmationMessage(
                    getContext().getString(R.string.runtime_confirmation_switch_message),
                    canonicalApiOrigin
                );

                confirmNativeRuntimeMutation(
                    call,
                    R.string.runtime_confirmation_switch_title,
                    confirmationMessage,
                    () -> runAsync(call, () -> applyConfirmedRuntimeBootstrap(call, bootstrap))
                );
            } catch (RuntimeException exception) {
                rejectRuntimeBootstrap(call, exception);
            } catch (JSONException exception) {
                rejectInvalidRuntimeBootstrap(call, exception);
            }
        });
    }

    private void applyConfirmedRuntimeBootstrap(
        PluginCall call,
        JSObject bootstrap
    ) {
        try {
            String nextApiBaseUrl = bootstrap.getString("apiOrigin");
            SharedPreferences preferences = getNativeAuthPreferences();
            JSObject previousBootstrap = loadPersistedRuntimeBootstrap(preferences);
            String previousRuntimeBootstrap = preferences.getString(
                RUNTIME_BOOTSTRAP_PREFERENCE_KEY,
                null
            );
            String previousApiBaseUrl = preferences.getString(API_BASE_URL_PREFERENCE_KEY, null);
            AndroidPushRuntimeMetadata previousPushRuntime = previousBootstrap == null
                ? null
                : AndroidPushRuntimeMetadata.fromBootstrap(
                    previousBootstrap.optJSONObject("androidPush")
                );

            if (!replaceRuntimeBootstrapStateWithRollback(
                apiBaseUrl,
                nextApiBaseUrl,
                tokenStorage,
                () -> persistRuntimeBootstrap(bootstrap),
                () -> restoreRuntimeBootstrapPersistenceSynchronously(
                    preferences,
                    previousRuntimeBootstrap,
                    previousApiBaseUrl
                ),
                () -> androidPushRuntimeManager.applyWithRollback(
                    AndroidPushRuntimeMetadata.fromBootstrap(
                        bootstrap.optJSONObject("androidPush")
                    ),
                    previousPushRuntime
                )
            )) {
                call.reject(
                    "Failed to persist Android runtime bootstrap",
                    "RUNTIME_BOOTSTRAP_PERSISTENCE_FAILED"
                );
                return;
            }

            apiBaseUrl = nextApiBaseUrl;

            JSObject payload = new JSObject();
            payload.put("bootstrap", bootstrap);
            call.resolve(payload);
        } catch (TokenStorageException exception) {
            call.reject(
                "Failed to access Android auth token during runtime rebind",
                "TOKEN_STORAGE_ERROR",
                exception
            );
        } catch (RuntimeException exception) {
            rejectRuntimeBootstrap(call, exception);
        }
    }

    @PluginMethod
    public void getRuntimeBootstrap(PluginCall call) {
        runAsync(call, () -> {
            JSObject payload = buildRuntimeBootstrapPayload(getPersistedRuntimeBootstrap());
            call.resolve(payload);
        });
    }

    @PluginMethod
    public void confirmRuntimeReset(PluginCall call) {
        runAsync(call, () -> {
            JSObject persistedBootstrap = getPersistedRuntimeBootstrap();
            String currentApiOrigin = apiBaseUrl;
            if (persistedBootstrap != null) {
                currentApiOrigin = persistedBootstrap.optString("apiOrigin", currentApiOrigin);
            }
            if (currentApiOrigin == null || currentApiOrigin.trim().isEmpty()) {
                call.reject(
                    "Android runtime reset requires a configured instance",
                    "RUNTIME_NOT_CONFIGURED"
                );
                return;
            }

            String confirmedApiOrigin = currentApiOrigin.trim();

            String confirmationMessage = formatRuntimeConfirmationMessage(
                getContext().getString(R.string.runtime_confirmation_reset_message),
                confirmedApiOrigin
            );
            String androidPushInstallationId = call.getString("androidPushInstallationId");
            confirmNativeRuntimeMutation(
                call,
                R.string.runtime_confirmation_reset_title,
                confirmationMessage,
                () -> runAsync(
                    call,
                    () -> clearConfirmedRuntime(
                        call,
                        confirmedApiOrigin,
                        androidPushInstallationId
                    )
                )
            );
        });
    }

    private void clearConfirmedRuntime(
        PluginCall call,
        String confirmedApiOrigin,
        String androidPushInstallationId
    ) {
        try {
            String tokenForServerRevocation = readStoredTokenForRuntimeMutation(tokenStorage);
            if (!clearRuntimeBootstrapStateWithPushRollback(
                getNativeAuthPreferences(),
                tokenStorage,
                tokenForServerRevocation,
                () -> androidPushRuntimeManager.apply(null)
            )) {
                call.reject(
                    "Failed to clear Android runtime bootstrap state",
                    "RUNTIME_BOOTSTRAP_PERSISTENCE_FAILED"
                );
                return;
            }
            revokeServerStateAfterRuntimeClear(
                tokenForServerRevocation,
                confirmedApiOrigin,
                androidPushInstallationId,
                (apiOrigin, token, installationId) -> httpClient.request(
                    apiOrigin,
                    token,
                    "DELETE",
                    "/v1/me/notification-installations/" + installationId,
                    null,
                    null,
                    "application/json"
                ),
                (apiOrigin, token) -> httpClient.logout(apiOrigin, token)
            );
        } catch (TokenStorageException exception) {
            call.reject(
                "Failed to access Android auth token during runtime reset",
                "TOKEN_STORAGE_ERROR",
                exception
            );
            return;
        } catch (RuntimeException exception) {
            call.reject(
                exception.getMessage(),
                resolveRuntimeBootstrapErrorCode(exception),
                exception
            );
            return;
        }

        apiBaseUrl = null;
        call.resolve();
    }

    @PluginMethod
    public void isVaultDeviceBoundWrapperAvailable(PluginCall call) {
        JSObject payload = new JSObject();
        payload.put(
            "available",
            isVaultDeviceBoundWrapperAvailableForWebView(
                isVaultRootKeyBridgeEnabledForWebView(),
                vaultRootKeyWrapper != null && vaultRootKeyWrapper.isAvailable()
            )
        );
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
        rejectVaultRootKeyBridgeCall(call);
    }

    @PluginMethod
    public void unwrapVaultRootKey(PluginCall call) {
        rejectVaultRootKeyBridgeCall(call);
    }

    private void runAsync(PluginCall call, Runnable job) {
        if (!taskExecutor.submit(
            job,
            exception -> call.reject(
                "Android native auth operation failed unexpectedly",
                "NATIVE_AUTH_INTERNAL_ERROR",
                exception
            )
        )) {
            call.reject("Failed to execute auth request - plugin was shutdown", "PLUGIN_SHUTDOWN");
        }
    }

    private void confirmNativeRuntimeMutation(
        PluginCall call,
        int titleResource,
        String message,
        Runnable confirmedMutation
    ) {
        if (!beginRuntimeConfirmation(runtimeMutationConfirmationPending)) {
            call.reject(
                "Another Android runtime confirmation is already pending",
                "RUNTIME_CONFIRMATION_PENDING"
            );
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            runtimeMutationConfirmationPending.set(false);
            call.reject(
                "Android runtime changes require an attached native activity",
                "RUNTIME_CONFIRMATION_UNAVAILABLE"
            );
            return;
        }

        AtomicBoolean decisionPending = new AtomicBoolean(true);
        activity.runOnUiThread(() -> {
            try {
                DialogInterface.OnClickListener decisionListener = (dialog, which) -> {
                    dialog.dismiss();
                    if (isConfirmedRuntimeButton(which)) {
                        completeRuntimeConfirmation(decisionPending, confirmedMutation);
                        return;
                    }
                    cancelRuntimeConfirmation(call, decisionPending);
                };
                new AlertDialog.Builder(activity)
                    .setTitle(titleResource)
                    .setMessage(message)
                    .setPositiveButton(
                        R.string.runtime_confirmation_continue,
                        decisionListener
                    )
                    .setNegativeButton(
                        R.string.runtime_confirmation_cancel,
                        decisionListener
                    )
                    .setCancelable(true)
                    .setOnCancelListener(dialog -> {
                        dialog.dismiss();
                        cancelRuntimeConfirmation(call, decisionPending);
                    })
                    .show();
            } catch (RuntimeException exception) {
                if (finishRuntimeConfirmation(decisionPending, runtimeMutationConfirmationPending)) {
                    call.reject(
                        "Android runtime confirmation could not be displayed",
                        "RUNTIME_CONFIRMATION_UNAVAILABLE",
                        exception
                    );
                }
            }
        });
    }

    private void completeRuntimeConfirmation(
        AtomicBoolean decisionPending,
        Runnable confirmedMutation
    ) {
        if (!finishRuntimeConfirmation(decisionPending, runtimeMutationConfirmationPending)) {
            return;
        }
        confirmedMutation.run();
    }

    private void cancelRuntimeConfirmation(PluginCall call, AtomicBoolean decisionPending) {
        if (!finishRuntimeConfirmation(decisionPending, runtimeMutationConfirmationPending)) {
            return;
        }
        call.reject(
            "Android runtime change was not confirmed",
            "RUNTIME_CONFIRMATION_CANCELLED"
        );
    }

    static String formatRuntimeConfirmationMessage(String template, String canonicalApiOrigin) {
        return String.format(Locale.US, template, canonicalApiOrigin);
    }

    static boolean beginRuntimeConfirmation(AtomicBoolean confirmationPending) {
        return confirmationPending.compareAndSet(false, true);
    }

    static boolean isConfirmedRuntimeButton(int button) {
        return button == DialogInterface.BUTTON_POSITIVE;
    }

    static boolean finishRuntimeConfirmation(
        AtomicBoolean decisionPending,
        AtomicBoolean confirmationPending
    ) {
        if (!decisionPending.compareAndSet(true, false)) {
            return false;
        }
        confirmationPending.set(false);
        return true;
    }

    private static void rejectRuntimeBootstrap(PluginCall call, RuntimeException exception) {
        call.reject(
            exception.getMessage(),
            resolveRuntimeBootstrapErrorCode(exception),
            exception
        );
    }

    private static void rejectInvalidRuntimeBootstrap(PluginCall call, JSONException exception) {
        call.reject(
            "Failed to serialize Android runtime bootstrap",
            "RUNTIME_BOOTSTRAP_INVALID",
            exception
        );
    }

    private boolean requirePasskeyCapability(
        PluginCall call,
        NativePasskeyCapability capability
    ) {
        try {
            capability.requirePasskeysAvailable();
            return true;
        } catch (PasskeyAuthenticationException exception) {
            rejectCall(call, exception);
            return false;
        }
    }

    interface DestroyedCheck {
        boolean isDestroyed();
    }

    interface PushEventNotifier {
        void notifyRetained(String event, JSObject payload);
    }

    static boolean isVaultRootKeyBridgeEnabledForWebView() {
        return false;
    }

    static JSObject buildPasskeyCapabilities(NativePasskeyCapability capability) {
        JSObject payload = new JSObject();
        payload.put("passkeysAvailable", capability.isPasskeysAvailable());

        if (!capability.isPasskeysAvailable()) {
            payload.put("reason", capability.getUnavailableReason());
        }

        return payload;
    }

    static boolean isVaultDeviceBoundWrapperAvailableForWebView(
        boolean vaultRootKeyBridgeEnabledForWebView,
        boolean wrapperAvailable
    ) {
        return vaultRootKeyBridgeEnabledForWebView && wrapperAvailable;
    }

    private void rejectVaultRootKeyBridgeCall(PluginCall call) {
        call.reject(
            VAULT_ROOT_KEY_BRIDGE_UNSUPPORTED_MESSAGE,
            VAULT_ROOT_KEY_BRIDGE_UNSUPPORTED_CODE
        );
    }

    private AndroidPushRuntimeManager.MessagingListener createAndroidPushMessagingListener() {
        return buildAndroidPushMessagingListener(
            () -> destroyed,
            (event, payload) -> notifyListeners(event, payload, true)
        );
    }

    static AndroidPushRuntimeManager.MessagingListener buildAndroidPushMessagingListener(
        DestroyedCheck destroyedCheck,
        PushEventNotifier notifier
    ) {
        return new AndroidPushRuntimeManager.MessagingListener() {
            @Override
            public void onTokenReceived(String appName, String token) {
                if (destroyedCheck.isDestroyed()) {
                    return;
                }
                notifier.notifyRetained(
                    ANDROID_PUSH_TOKEN_RECEIVED_EVENT,
                    buildAndroidPushTokenPayload(appName, token)
                );
            }

            @Override
            public void onTokenError(String appName, Exception exception) {
                if (destroyedCheck.isDestroyed()) {
                    return;
                }
                notifier.notifyRetained(
                    ANDROID_PUSH_TOKEN_ERROR_EVENT,
                    buildAndroidPushTokenErrorPayload(appName, exception)
                );
            }
        };
    }

    private static JSObject buildAndroidPushTokenPayload(String appName, String token) {
        JSObject payload = new JSObject();
        payload.put("appName", appName);
        payload.put("provider", "fcm");
        payload.put("token", token);
        return payload;
    }

    private static JSObject buildAndroidPushTokenErrorPayload(String appName, Exception exception) {
        JSObject payload = new JSObject();
        String message = exception.getMessage();

        payload.put("appName", appName);
        payload.put("provider", "fcm");
        payload.put("errorCode", exception.getClass().getSimpleName());
        payload.put(
            "message",
            message == null || message.trim().isEmpty()
                ? "Failed to retrieve Android push registration token"
                : message
        );

        return payload;
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

    static String resolveRuntimeBootstrapErrorCode(RuntimeException exception) {
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
        } catch (InsecureApiBaseUrlException exception) {
            throw new ConfiguredApiBaseUrlException(
                "Android auth API origin must use HTTPS",
                "INSECURE_API_BASE_URL",
                exception
            );
        } catch (NativeAuthHttpException exception) {
            throw new ConfiguredApiBaseUrlException(
                "Invalid Android auth API origin configuration",
                "INVALID_API_BASE_URL",
                exception
            );
        }
    }

    static String resolveRuntimeApiBaseUrl(String configuredValue) {
        return resolveConfiguredApiBaseUrl(configuredValue);
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
        return !Objects.equals(currentApiBaseUrl, nextApiBaseUrl);
    }

    static boolean replaceRuntimeBootstrapStateWithRollback(
        String currentApiBaseUrl,
        String nextApiBaseUrl,
        TokenStorage tokenStorage,
        BooleanSupplier persistence,
        BooleanSupplier runtimeRollback,
        Runnable pushReplacement
    ) throws TokenStorageException {
        boolean credentialMustBeRebound = shouldClearStoredToken(
            currentApiBaseUrl,
            nextApiBaseUrl
        );
        String previousToken = credentialMustBeRebound
            ? readStoredTokenForRuntimeMutation(tokenStorage)
            : null;
        if (credentialMustBeRebound) {
            tokenStorage.clearToken();
        }

        final boolean persisted;
        try {
            persisted = persistence.getAsBoolean();
        } catch (RuntimeException exception) {
            rollbackRuntimeBootstrapReplacement(
                exception,
                runtimeRollback,
                tokenStorage,
                previousToken,
                credentialMustBeRebound
            );
            throw exception;
        }

        if (!persisted) {
            RuntimeException failure = new RuntimeException(
                "Failed to persist Android runtime bootstrap"
            );
            if (!rollbackRuntimeBootstrapReplacement(
                failure,
                runtimeRollback,
                tokenStorage,
                previousToken,
                credentialMustBeRebound
            )) {
                throw failure;
            }
            return false;
        }

        try {
            pushReplacement.run();
            return true;
        } catch (RuntimeException exception) {
            rollbackRuntimeBootstrapReplacement(
                exception,
                runtimeRollback,
                tokenStorage,
                previousToken,
                credentialMustBeRebound
            );
            throw exception;
        }
    }

    private static boolean rollbackRuntimeBootstrapReplacement(
        RuntimeException failure,
        BooleanSupplier runtimeRollback,
        TokenStorage tokenStorage,
        String previousToken,
        boolean restoreCredential
    ) throws TokenStorageException {
        final boolean runtimeRestored;
        try {
            runtimeRestored = runtimeRollback.getAsBoolean();
        } catch (RuntimeException rollbackFailure) {
            failure.addSuppressed(rollbackFailure);
            return false;
        }

        if (!runtimeRestored) {
            failure.addSuppressed(new IllegalStateException(
                "Failed to restore Android runtime bootstrap after replacement failure"
            ));
            return false;
        }

        try {
            restoreRuntimeCredential(tokenStorage, previousToken, restoreCredential);
        } catch (TokenStorageException tokenException) {
            tokenException.addSuppressed(failure);
            throw tokenException;
        }
        return true;
    }

    private static void restoreRuntimeCredential(
        TokenStorage tokenStorage,
        String previousToken,
        boolean restoreCredential
    ) throws TokenStorageException {
        if (restoreCredential && previousToken != null) {
            tokenStorage.saveToken(previousToken);
        }
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
        TokenStorage tokenStorage,
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
            preferences.edit()
                .remove(RUNTIME_BOOTSTRAP_PREFERENCE_KEY)
                .remove(API_BASE_URL_PREFERENCE_KEY)
                .apply();
            tokenStorage.clearToken();
            androidPushRuntimeManager.apply(null);
            return null;
        }
    }

    static boolean clearRuntimeBootstrapState(
        SharedPreferences preferences,
        TokenStorage tokenStorage
    ) {
        String previousRuntimeBootstrap = preferences.getString(
            RUNTIME_BOOTSTRAP_PREFERENCE_KEY,
            null
        );
        String previousApiBaseUrl = preferences.getString(API_BASE_URL_PREFERENCE_KEY, null);
        boolean persisted = preferences.edit()
            .remove(RUNTIME_BOOTSTRAP_PREFERENCE_KEY)
            .remove(API_BASE_URL_PREFERENCE_KEY)
            .commit();

        if (!persisted) {
            final boolean persistenceRestored;
            try {
                persistenceRestored = restoreRuntimeBootstrapPersistenceSynchronously(
                    preferences,
                    previousRuntimeBootstrap,
                    previousApiBaseUrl
                );
            } catch (RuntimeException rollbackFailure) {
                tokenStorage.clearToken();
                throw rollbackFailure;
            }
            if (!persistenceRestored) {
                tokenStorage.clearToken();
            }
            return false;
        }

        tokenStorage.clearToken();

        return true;
    }

    static boolean clearRuntimeBootstrapStateWithPushRollback(
        SharedPreferences preferences,
        TokenStorage tokenStorage,
        String previousToken,
        Runnable pushCleanup
    ) throws TokenStorageException {
        String previousRuntimeBootstrap = preferences.getString(
            RUNTIME_BOOTSTRAP_PREFERENCE_KEY,
            null
        );
        String previousApiBaseUrl = preferences.getString(API_BASE_URL_PREFERENCE_KEY, null);
        if (!clearRuntimeBootstrapState(preferences, tokenStorage)) {
            return false;
        }

        try {
            pushCleanup.run();
            return true;
        } catch (RuntimeException exception) {
            final boolean persistenceRestored;
            try {
                persistenceRestored = restoreRuntimeBootstrapPersistenceSynchronously(
                    preferences,
                    previousRuntimeBootstrap,
                    previousApiBaseUrl
                );
            } catch (RuntimeException rollbackException) {
                exception.addSuppressed(rollbackException);
                throw exception;
            }
            if (persistenceRestored && previousToken != null) {
                try {
                    tokenStorage.saveToken(previousToken);
                } catch (TokenStorageException tokenException) {
                    tokenException.addSuppressed(exception);
                    throw tokenException;
                }
            }
            if (!persistenceRestored) {
                exception.addSuppressed(new IllegalStateException(
                    "Failed to restore Android runtime bootstrap after push cleanup failure"
                ));
            }
            throw exception;
        }
    }

    static String readStoredTokenForRuntimeMutation(TokenStorage tokenStorage) {
        try {
            return tokenStorage.getToken();
        } catch (TokenStorageException ignored) {
            return null;
        }
    }

    static void revokeServerStateAfterRuntimeClear(
        String token,
        String apiOrigin,
        String installationId,
        AndroidPushRegistrationRevoker pushRevoker,
        NativeAuthenticationRevoker authenticationRevoker
    ) {
        revokeAndroidPushRegistrationAfterRuntimeClear(
            token,
            apiOrigin,
            installationId,
            pushRevoker
        );
        revokeNativeAuthenticationAfterRuntimeClear(
            token,
            apiOrigin,
            authenticationRevoker
        );
    }

    static void revokeAndroidPushRegistrationAfterRuntimeClear(
        String token,
        String apiOrigin,
        String installationId,
        AndroidPushRegistrationRevoker revoker
    ) {
        String normalizedApiOrigin = apiOrigin == null ? "" : apiOrigin.trim();
        String normalizedInstallationId = installationId == null ? "" : installationId.trim();
        if (normalizedApiOrigin.isEmpty() || normalizedInstallationId.isEmpty()) {
            return;
        }

        if (token == null || token.trim().isEmpty()) {
            return;
        }

        try {
            revoker.revoke(normalizedApiOrigin, token, normalizedInstallationId);
        } catch (IOException | NativeAuthHttpException | RuntimeException ignored) {
            // Runtime reset remains available offline; server revocation is best-effort.
        }
    }

    static void revokeNativeAuthenticationAfterRuntimeClear(
        String token,
        String apiOrigin,
        NativeAuthenticationRevoker revoker
    ) {
        String normalizedApiOrigin = apiOrigin == null ? "" : apiOrigin.trim();
        if (normalizedApiOrigin.isEmpty() || token == null || token.trim().isEmpty()) {
            return;
        }

        try {
            revoker.revoke(normalizedApiOrigin, token);
        } catch (IOException | JSONException | NativeAuthHttpException | RuntimeException ignored) {
            // Runtime reset remains available offline; server logout is best-effort.
        }
    }

    static boolean restoreRuntimeBootstrapPersistenceSynchronously(
        SharedPreferences preferences,
        String previousRuntimeBootstrap,
        String previousApiBaseUrl
    ) {
        SharedPreferences.Editor editor = preferences.edit();

        if (previousRuntimeBootstrap == null || previousRuntimeBootstrap.trim().isEmpty()) {
            editor.remove(RUNTIME_BOOTSTRAP_PREFERENCE_KEY);
        } else {
            editor.putString(RUNTIME_BOOTSTRAP_PREFERENCE_KEY, previousRuntimeBootstrap);
        }
        if (previousApiBaseUrl == null || previousApiBaseUrl.trim().isEmpty()) {
            editor.remove(API_BASE_URL_PREFERENCE_KEY);
        } else {
            editor.putString(API_BASE_URL_PREFERENCE_KEY, previousApiBaseUrl);
        }

        return editor.commit();
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
        JSONObject androidPush,
        JSONObject features
    ) throws JSONException {
        JSObject bootstrap = new JSObject();
        bootstrap.put("instanceDisplayName", instanceDisplayName);
        bootstrap.put("apiOrigin", apiOrigin);
        bootstrap.put("rawApiBaseUrl", rawApiBaseUrl);

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
        String canonicalApiOrigin = resolveCanonicalBootstrapApiOrigin(
            firstNonBlank(bootstrap.optString("apiOrigin", null), rawApiBaseUrl)
        );

        JSONObject features = bootstrap.optJSONObject("features");
        JSObject normalized = new JSObject();
        normalized.put("instanceDisplayName", instanceDisplayName);
        normalized.put("apiOrigin", canonicalApiOrigin);
        normalized.put("rawApiBaseUrl", rawApiBaseUrl.trim());

        JSObject normalizedFeatures = new JSObject();
        normalizedFeatures.put(
            "passwordLoginEnabled",
            features != null && features.optBoolean("passwordLoginEnabled", false)
        );
        normalizedFeatures.put(
            "passkeyLoginEnabled",
            features != null && features.optBoolean("passkeyLoginEnabled", false)
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

    static String normalizeRequiredString(String value, String message)
        throws InvalidRuntimeBootstrapException {
        if (value == null || value.trim().isEmpty()) {
            throw new InvalidRuntimeBootstrapException(message, "RUNTIME_BOOTSTRAP_INVALID");
        }

        return value.trim();
    }

    static String firstNonBlank(String preferred, String fallback) {
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
