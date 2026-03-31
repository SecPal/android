/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal.app;

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
    private NativeAuthHttpClient httpClient;
    private NetworkState networkState;
    private final NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
    private String apiBaseUrl;

    @Override
    public void load() {
        super.load();
        apiBaseUrl = resolveConfiguredApiBaseUrl(getContext().getString(R.string.api_base_url));
        tokenStorage = new KeystoreTokenStorage(getContext());
        httpClient = new NativeAuthHttpClient();
        networkState = new NetworkState();
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
            throw new IllegalStateException("Invalid Android auth API origin configuration", exception);
        }
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
}
