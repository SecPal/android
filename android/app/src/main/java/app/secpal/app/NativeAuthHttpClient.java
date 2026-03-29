/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal.app;

import android.os.Build;

import com.getcapacitor.JSObject;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

class NativeAuthHttpClient {
    private static final int CONNECT_TIMEOUT_MILLIS = 15000;
    private static final int READ_TIMEOUT_MILLIS = 15000;

    LoginResponse login(String baseUrl, String email, String password) throws IOException, JSONException, NativeAuthHttpException {
        JSONObject requestBody = new JSONObject()
            .put("email", email)
            .put("password", password)
            .put("device_name", buildDeviceName());

        JSONObject response = sendJsonRequest(baseUrl, "/v1/auth/token", "POST", requestBody, null);

        return new LoginResponse(response.getString("token"), JSObject.fromJSONObject(response.getJSONObject("user")));
    }

    JSObject getCurrentUser(String baseUrl, String token) throws IOException, JSONException, NativeAuthHttpException {
        JSONObject response = sendJsonRequest(baseUrl, "/v1/me", "GET", null, token);

        return JSObject.fromJSONObject(response);
    }

    void logout(String baseUrl, String token) throws IOException, JSONException, NativeAuthHttpException {
        sendJsonRequest(baseUrl, "/v1/auth/logout", "POST", null, token);
    }

    private JSONObject sendJsonRequest(String baseUrl, String path, String method, JSONObject requestBody, String bearerToken)
        throws IOException, JSONException, NativeAuthHttpException {
        HttpURLConnection connection = (HttpURLConnection) new URL(normalizeBaseUrl(baseUrl) + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MILLIS);
        connection.setReadTimeout(READ_TIMEOUT_MILLIS);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/json");

        if (bearerToken != null) {
            connection.setRequestProperty("Authorization", "Bearer " + bearerToken);
        }

        if (requestBody != null) {
            connection.setDoOutput(true);
            try (OutputStream outputStream = connection.getOutputStream()) {
                outputStream.write(requestBody.toString().getBytes(StandardCharsets.UTF_8));
            }
        }

        int statusCode = connection.getResponseCode();
        InputStream responseStream = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String responseBody = readResponseBody(responseStream);

        if (statusCode >= 400) {
            throw new NativeAuthHttpException(extractErrorMessage(responseBody, statusCode), statusCode);
        }

        return responseBody.isEmpty() ? new JSONObject() : new JSONObject(responseBody);
    }

    private String normalizeBaseUrl(String baseUrl) throws NativeAuthHttpException {
        if (baseUrl == null) {
            throw new NativeAuthHttpException("Android auth bridge requires an API base URL", 0);
        }

        String normalizedBaseUrl = baseUrl.trim();

        if (!normalizedBaseUrl.startsWith("https://") && !normalizedBaseUrl.startsWith("http://")) {
            throw new NativeAuthHttpException("Android auth bridge requires an absolute API base URL", 0);
        }

        return normalizedBaseUrl.endsWith("/")
            ? normalizedBaseUrl.substring(0, normalizedBaseUrl.length() - 1)
            : normalizedBaseUrl;
    }

    private String extractErrorMessage(String responseBody, int statusCode) {
        if (!responseBody.isEmpty()) {
            try {
                JSONObject response = new JSONObject(responseBody);
                if (response.has("message")) {
                    return response.getString("message");
                }
            } catch (JSONException ignored) {
                // Ignore parsing failure and fall back to a generic message.
            }
        }

        return "Android auth request failed with status " + statusCode;
    }

    private String readResponseBody(InputStream inputStream) throws IOException {
        if (inputStream == null) {
            return "";
        }

        try (BufferedReader bufferedReader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            StringBuilder stringBuilder = new StringBuilder();
            String line;

            while ((line = bufferedReader.readLine()) != null) {
                stringBuilder.append(line);
            }

            return stringBuilder.toString();
        }
    }

    private String buildDeviceName() {
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "" : Build.MODEL.trim();
        String combined = (manufacturer + " " + model).trim();

        return combined.isEmpty() ? "android-device" : combined;
    }

    static final class LoginResponse {
        private final String token;
        private final JSObject user;

        LoginResponse(String token, JSObject user) {
            this.token = token;
            this.user = user;
        }

        String getToken() {
            return token;
        }

        JSObject getUser() {
            return user;
        }
    }
}