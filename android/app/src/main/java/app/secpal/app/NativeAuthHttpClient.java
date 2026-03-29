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
import java.net.MalformedURLException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

class NativeAuthHttpClient {
    private static final int CONNECT_TIMEOUT_MILLIS = 15000;
    private static final int READ_TIMEOUT_MILLIS = 15000;
    private static final Pattern MESSAGE_PATTERN = Pattern.compile("\"message\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"");

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

    JSObject request(String baseUrl, String token, String method, String path, String requestBody)
        throws IOException, NativeAuthHttpException {
        RequestResponse response = sendRequest(
            baseUrl,
            normalizeRequestPath(path),
            normalizeHttpMethod(method),
            requestBody,
            token
        );

        JSObject payload = new JSObject();
        payload.put("status", response.getStatusCode());
        payload.put("body", response.getResponseBody());

        if (response.getContentType() != null && !response.getContentType().isEmpty()) {
            payload.put("contentType", response.getContentType());
        }

        return payload;
    }

    private JSONObject sendJsonRequest(String baseUrl, String path, String method, JSONObject requestBody, String bearerToken)
        throws IOException, JSONException, NativeAuthHttpException {
        RequestResponse response = sendRequest(
            baseUrl,
            path,
            method,
            requestBody == null ? null : requestBody.toString(),
            bearerToken
        );

        return response.getResponseBody().isEmpty() ? new JSONObject() : new JSONObject(response.getResponseBody());
    }

    private RequestResponse sendRequest(String baseUrl, String path, String method, String requestBody, String bearerToken)
        throws IOException, NativeAuthHttpException {
        HttpURLConnection connection = (HttpURLConnection) new URL(normalizeBaseUrl(baseUrl) + path).openConnection();
        try {
            connection.setRequestMethod(method);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MILLIS);
            connection.setReadTimeout(READ_TIMEOUT_MILLIS);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Content-Type", "application/json");

            if (bearerToken != null) {
                connection.setRequestProperty("Authorization", "Bearer " + bearerToken);
            }

            if (requestBody != null && !requestBody.isEmpty()) {
                connection.setDoOutput(true);
                try (OutputStream outputStream = connection.getOutputStream()) {
                    outputStream.write(requestBody.getBytes(StandardCharsets.UTF_8));
                }
            }

            int statusCode = connection.getResponseCode();
            InputStream responseStream = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String responseBody;
            if (responseStream != null) {
                try (InputStream in = responseStream) {
                    responseBody = readResponseBody(in);
                }
            } else {
                responseBody = "";
            }

            if (statusCode >= 400) {
                throw new NativeAuthHttpException(buildErrorMessage(responseBody, statusCode), statusCode);
            }

            return new RequestResponse(statusCode, responseBody, connection.getContentType());
        } finally {
            connection.disconnect();
        }
    }

    static String normalizeBaseUrl(String baseUrl) throws NativeAuthHttpException {
        if (baseUrl == null) {
            throw new NativeAuthHttpException("Android auth bridge requires an API base URL", 0);
        }

        String normalizedBaseUrl = baseUrl.trim();
        URL parsedUrl;

        try {
            parsedUrl = new URL(normalizedBaseUrl);
        } catch (MalformedURLException exception) {
            throw new NativeAuthHttpException("Android auth bridge requires an absolute API base URL", 0);
        }

        if (!"https".equals(parsedUrl.getProtocol()) && !"http".equals(parsedUrl.getProtocol())) {
            throw new NativeAuthHttpException("Android auth bridge requires an absolute API base URL", 0);
        }

        if (parsedUrl.getHost() == null || parsedUrl.getHost().trim().isEmpty()) {
            throw new NativeAuthHttpException("Android auth bridge requires an absolute API base URL", 0);
        }

        if ((parsedUrl.getUserInfo() != null && !parsedUrl.getUserInfo().isEmpty())
            || (parsedUrl.getPath() != null && !parsedUrl.getPath().isEmpty() && !"/".equals(parsedUrl.getPath()))
            || parsedUrl.getQuery() != null
            || parsedUrl.getRef() != null) {
            throw new NativeAuthHttpException(
                "Android auth bridge requires a bare API origin without userinfo, path, query, or fragment",
                0
            );
        }

        StringBuilder origin = new StringBuilder(parsedUrl.getProtocol())
            .append("://")
            .append(parsedUrl.getHost());

        if (parsedUrl.getPort() != -1 && parsedUrl.getPort() != parsedUrl.getDefaultPort()) {
            origin.append(":").append(parsedUrl.getPort());
        }

        return origin.toString();
    }

    static String buildErrorMessage(String responseBody, int statusCode) {
        if (!responseBody.isEmpty()) {
            Matcher matcher = MESSAGE_PATTERN.matcher(responseBody);
            if (matcher.find()) {
                return decodeJsonStringFragment(matcher.group(1));
            }
        }

        return "Android auth request failed with status " + statusCode;
    }

    private static String decodeJsonStringFragment(String value) {
        StringBuilder decodedValue = new StringBuilder();
        boolean escaping = false;

        for (int index = 0; index < value.length(); index++) {
            char currentCharacter = value.charAt(index);

            if (!escaping) {
                if (currentCharacter == '\\') {
                    escaping = true;
                } else {
                    decodedValue.append(currentCharacter);
                }
                continue;
            }

            switch (currentCharacter) {
                case '"':
                case '\\':
                case '/':
                    decodedValue.append(currentCharacter);
                    break;
                case 'b':
                    decodedValue.append('\b');
                    break;
                case 'f':
                    decodedValue.append('\f');
                    break;
                case 'n':
                    decodedValue.append('\n');
                    break;
                case 'r':
                    decodedValue.append('\r');
                    break;
                case 't':
                    decodedValue.append('\t');
                    break;
                case 'u':
                    if (index + 4 < value.length()) {
                        String hex = value.substring(index + 1, index + 5);
                        try {
                            int codeUnit = Integer.parseInt(hex, 16);
                            index += 4;
                            char ch = (char) codeUnit;
                            if (Character.isHighSurrogate(ch)
                                    && index + 6 < value.length()
                                    && value.charAt(index + 1) == '\\'
                                    && value.charAt(index + 2) == 'u') {
                                String lowHex = value.substring(index + 3, index + 7);
                                try {
                                    int lowCodeUnit = Integer.parseInt(lowHex, 16);
                                    char lowCh = (char) lowCodeUnit;
                                    if (Character.isLowSurrogate(lowCh)) {
                                        decodedValue.appendCodePoint(Character.toCodePoint(ch, lowCh));
                                        index += 6;
                                    } else {
                                        decodedValue.append(ch);
                                    }
                                } catch (NumberFormatException ignored) {
                                    decodedValue.append(ch);
                                }
                            } else {
                                decodedValue.append(ch);
                            }
                        } catch (NumberFormatException ignored) {
                            decodedValue.append('u');
                        }
                    } else {
                        decodedValue.append('u');
                    }
                    break;
                default:
                    decodedValue.append(currentCharacter);
                    break;
            }

            escaping = false;
        }

        if (escaping) {
            decodedValue.append('\\');
        }

        return decodedValue.toString();
    }

    static String normalizeHttpMethod(String method) throws NativeAuthHttpException {
        if (method == null || method.trim().isEmpty()) {
            throw new NativeAuthHttpException("Android auth bridge requires an HTTP method", 0);
        }

        String normalizedMethod = method.trim().toUpperCase(Locale.US);

        switch (normalizedMethod) {
            case "GET":
            case "POST":
            case "PUT":
            case "PATCH":
            case "DELETE":
                return normalizedMethod;
            default:
                throw new NativeAuthHttpException("Android auth bridge does not support method " + normalizedMethod, 0);
        }
    }

    static String normalizeRequestPath(String path) throws NativeAuthHttpException {
        if (path == null || path.trim().isEmpty()) {
            throw new NativeAuthHttpException("Android auth bridge requires a request path", 0);
        }

        String normalizedPath = path.trim();

        if (!normalizedPath.startsWith("/")) {
            throw new NativeAuthHttpException("Android auth bridge requires a relative request path starting with /", 0);
        }

        return normalizedPath;
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

    static final class RequestResponse {
        private final int statusCode;
        private final String responseBody;
        private final String contentType;

        RequestResponse(int statusCode, String responseBody, String contentType) {
            this.statusCode = statusCode;
            this.responseBody = responseBody;
            this.contentType = contentType;
        }

        int getStatusCode() { return statusCode; }

        String getResponseBody() { return responseBody; }

        String getContentType() { return contentType; }
    }
}