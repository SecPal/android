/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.Activity;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.IOException;

@CapacitorPlugin(name = "SecPalNativeAuth")
public class SecPalNativeAuthPlugin extends Plugin {
    private TokenStorage tokenStorage;
    private KeystoreVaultRootKeyWrapper vaultRootKeyWrapper;
    private NativeAuthHttpClient httpClient;
    private NetworkState networkState;
    private NativePasskeyAuthenticator passkeyAuthenticator;
    private final NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
    private String apiBaseUrl;

    @Override
    public void load() {
        super.load();
        apiBaseUrl = resolveConfiguredApiBaseUrl(getContext().getString(R.string.api_base_url));
        tokenStorage = new KeystoreTokenStorage(getContext());
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

    static boolean shouldClearStoredToken(String currentApiBaseUrl, String nextApiBaseUrl) {
        return currentApiBaseUrl != null && !currentApiBaseUrl.equals(nextApiBaseUrl);
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
}
