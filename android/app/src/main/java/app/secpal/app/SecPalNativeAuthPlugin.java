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
    private final NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();

    @Override
    public void load() {
        super.load();
        tokenStorage = new KeystoreTokenStorage(getContext());
        httpClient = new NativeAuthHttpClient();
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        taskExecutor.shutdownNow();
    }

    @PluginMethod
    public void login(PluginCall call) {
        String baseUrl = requireValue(call, "baseUrl");
        String email = requireValue(call, "email");
        String password = requireValue(call, "password");

        if (baseUrl == null || email == null || password == null) {
            return;
        }

        runAsync(call, () -> {
            try {
                NativeAuthHttpClient.LoginResponse response = httpClient.login(baseUrl, email, password);
                tokenStorage.saveToken(response.getToken());

                JSObject payload = new JSObject();
                payload.put("user", response.getUser());
                call.resolve(payload);
            } catch (IOException | JSONException | NativeAuthHttpException exception) {
                rejectCall(call, exception);
            } catch (TokenStorageException exception) {
                call.reject("Failed to persist Android auth token", "TOKEN_STORAGE_ERROR", exception);
            }
        });
    }

    @PluginMethod
    public void getCurrentUser(PluginCall call) {
        String baseUrl = requireValue(call, "baseUrl");

        if (baseUrl == null) {
            return;
        }

        runAsync(call, () -> {
            try {
                String token = requireStoredToken(call);
                if (token == null) {
                    return;
                }

                call.resolve(httpClient.getCurrentUser(baseUrl, token));
            } catch (IOException | JSONException | NativeAuthHttpException exception) {
                maybeClearToken(exception);
                rejectCall(call, exception);
            } catch (TokenStorageException exception) {
                call.reject("Failed to load Android auth token", "TOKEN_STORAGE_ERROR", exception);
            }
        });
    }

    @PluginMethod
    public void logout(PluginCall call) {
        String baseUrl = requireValue(call, "baseUrl");

        if (baseUrl == null) {
            return;
        }

        runAsync(call, () -> {
            try {
                String token = requireStoredToken(call);
                if (token == null) {
                    return;
                }

                httpClient.logout(baseUrl, token);
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
        String baseUrl = requireValue(call, "baseUrl");
        String method = requireValue(call, "method");
        String path = requireValue(call, "path");

        if (baseUrl == null || method == null || path == null) {
            return;
        }

        String body = call.getString("body");

        runAsync(call, () -> {
            try {
                String token = requireStoredToken(call);
                if (token == null) {
                    return;
                }

                call.resolve(httpClient.request(baseUrl, token, method, path, body));
            } catch (IOException | NativeAuthHttpException exception) {
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
        if (!(exception instanceof NativeAuthHttpException)) {
            return null;
        }

        int statusCode = ((NativeAuthHttpException) exception).getStatusCode();

        return statusCode > 0 ? "HTTP_" + statusCode : "VALIDATION_ERROR";
    }

    private void maybeClearToken(Exception exception) {
        if (exception instanceof NativeAuthHttpException) {
            NativeAuthHttpException httpException = (NativeAuthHttpException) exception;

            if (httpException.getStatusCode() == 401) {
                tokenStorage.clearToken();
            }
        }
    }
}