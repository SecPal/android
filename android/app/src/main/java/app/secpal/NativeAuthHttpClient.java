/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

class NativeAuthHttpClient {
    private static final int CONNECT_TIMEOUT_MILLIS = 15000;
    private static final int READ_TIMEOUT_MILLIS = 15000;
    private static final int CURRENT_USER_CONNECT_TIMEOUT_MILLIS = 3000;
    private static final int CURRENT_USER_READ_TIMEOUT_MILLIS = 3000;
    private static final Pattern MESSAGE_PATTERN = Pattern.compile("\"message\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"");
    private static final Pattern REQUEST_BODY_BASE64_PATTERN = Pattern.compile(
        "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
    );

    LoginResponse login(String baseUrl, String email, String password) throws IOException, JSONException, NativeAuthHttpException {
        JSONObject requestBody = new JSONObject()
            .put("email", email)
            .put("password", password)
            .put("device_name", buildDeviceName(Build.MANUFACTURER, Build.MODEL));

        JSONObject response = sendJsonRequest(baseUrl, "/v1/auth/token", "POST", requestBody, null);

        return new LoginResponse(response.getString("token"), JSObject.fromJSONObject(response.getJSONObject("user")));
    }

    ProvisioningBootstrapExchangeResult exchangeBootstrapToken(
        String baseUrl,
        String bootstrapToken,
        ProvisioningBootstrapRuntimeInfo runtimeInfo
    ) throws IOException, JSONException, NativeAuthHttpException {
        JSONObject requestBody = new JSONObject()
            .put("bootstrap_token", bootstrapToken)
            .put("package_name", runtimeInfo.getPackageName());

        if (runtimeInfo.getPackageVersionName() != null) {
            requestBody.put("package_version_name", runtimeInfo.getPackageVersionName());
        }

        if (runtimeInfo.getPackageVersionCode() > 0) {
            requestBody.put("package_version_code", runtimeInfo.getPackageVersionCode());
        }

        if (runtimeInfo.getDeviceName() != null) {
            requestBody.put("device_name", runtimeInfo.getDeviceName());
        }

        JSONObject device = new JSONObject();

        if (runtimeInfo.getDeviceManufacturer() != null) {
            device.put("manufacturer", runtimeInfo.getDeviceManufacturer());
        }

        if (runtimeInfo.getDeviceModel() != null) {
            device.put("model", runtimeInfo.getDeviceModel());
        }

        if (runtimeInfo.getAndroidVersion() != null) {
            device.put("android_version", runtimeInfo.getAndroidVersion());
        }

        if (device.length() > 0) {
            requestBody.put("device", device);
        }

        JSONObject response = sendJsonRequest(baseUrl, "/v1/android/bootstrap/exchange", "POST", requestBody, null);

        return parseBootstrapExchangeResponse(response);
    }

    JSObject getCurrentUser(String baseUrl, String token) throws IOException, JSONException, NativeAuthHttpException {
        JSONObject response = sendJsonRequest(baseUrl, "/v1/me", "GET", null, token);

        return JSObject.fromJSONObject(response);
    }

    void logout(String baseUrl, String token) throws IOException, JSONException, NativeAuthHttpException {
        sendJsonRequest(baseUrl, "/v1/auth/logout", "POST", null, token);
    }

    JSObject request(
        String baseUrl,
        String token,
        String method,
        String path,
        String requestBodyBase64,
        String contentType,
        String accept
    )
        throws IOException, NativeAuthHttpException {
        RequestResponse response = sendRequest(
            baseUrl,
            normalizeRequestPath(path),
            normalizeHttpMethod(method),
            decodeRequestBody(requestBodyBase64),
            token,
            contentType,
            accept,
            false
        );

        JSObject payload = new JSObject();
        payload.put("status", response.getStatusCode());
        payload.put("bodyBase64", response.getResponseBodyBase64());

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
            requestBody == null ? null : requestBody.toString().getBytes(StandardCharsets.UTF_8),
            bearerToken,
            "application/json",
            "application/json",
            true
        );

        String responseBody = response.getResponseBodyAsString();

        return responseBody.isEmpty() ? new JSONObject() : new JSONObject(responseBody);
    }

    private RequestResponse sendRequest(
        String baseUrl,
        String path,
        String method,
        byte[] requestBody,
        String bearerToken,
        String contentType,
        String accept,
        boolean throwOnError
    )
        throws IOException, NativeAuthHttpException {
        HttpURLConnection connection = (HttpURLConnection) new URL(normalizeBaseUrl(baseUrl) + path).openConnection();
        try {
            connection.setRequestMethod(method);
            connection.setConnectTimeout(resolveConnectTimeoutMillis(method, path));
            connection.setReadTimeout(resolveReadTimeoutMillis(method, path));

            if (accept != null && !accept.trim().isEmpty()) {
                connection.setRequestProperty("Accept", accept);
            }

            if (contentType != null && !contentType.trim().isEmpty()) {
                connection.setRequestProperty("Content-Type", contentType);
            }

            if (bearerToken != null) {
                connection.setRequestProperty("Authorization", "Bearer " + bearerToken);
            }

            if (requestBody != null && requestBody.length > 0) {
                connection.setDoOutput(true);
                try (OutputStream outputStream = connection.getOutputStream()) {
                    outputStream.write(requestBody);
                }
            }

            int statusCode = connection.getResponseCode();
            InputStream responseStream = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
            byte[] responseBody;
            if (responseStream != null) {
                try (InputStream in = responseStream) {
                    responseBody = readResponseBodyBytes(in);
                }
            } else {
                responseBody = new byte[0];
            }

            if (statusCode >= 400 && throwOnError) {
                throw new NativeAuthHttpException(
                    buildErrorMessage(new String(responseBody, StandardCharsets.UTF_8), statusCode),
                    statusCode
                );
            }

            return new RequestResponse(statusCode, responseBody, connection.getContentType());
        } finally {
            connection.disconnect();
        }
    }

    static int resolveConnectTimeoutMillis(String method, String path) {
        return isCurrentUserBootstrapRequest(method, path)
            ? CURRENT_USER_CONNECT_TIMEOUT_MILLIS
            : CONNECT_TIMEOUT_MILLIS;
    }

    static int resolveReadTimeoutMillis(String method, String path) {
        return isCurrentUserBootstrapRequest(method, path)
            ? CURRENT_USER_READ_TIMEOUT_MILLIS
            : READ_TIMEOUT_MILLIS;
    }

    private static boolean isCurrentUserBootstrapRequest(String method, String path) {
        return "GET".equals(method) && "/v1/me".equals(path);
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

    static ProvisioningBootstrapExchangeResult parseBootstrapExchangeResponse(JSONObject response)
        throws JSONException {
        return parseBootstrapExchangePayload(toJavaMap(response.getJSONObject("data")));
    }

    static ProvisioningBootstrapExchangeResult parseBootstrapExchangePayload(Map<String, Object> data) {
        return new ProvisioningBootstrapExchangeResult(
            stringValue(data.get("enrollment_session_id")),
            intValue(data.get("tenant_id")),
            stringValue(data.get("tenant_name")),
            stringValue(data.get("api_base_url")),
            stringValue(data.get("update_channel")),
            stringValue(data.get("release_metadata_url")),
            mapValue(data.get("provisioning_profile"))
        );
    }

    private static Map<String, Object> toJavaMap(JSONObject object) throws JSONException {
        LinkedHashMap<String, Object> values = new LinkedHashMap<>();
        Iterator<String> keys = object.keys();

        while (keys.hasNext()) {
            String key = keys.next();

            values.put(key, toJavaValue(object.get(key)));
        }

        return values;
    }

    private static Object toJavaValue(Object value) throws JSONException {
        if (value == JSONObject.NULL) {
            return null;
        }

        if (value instanceof JSONObject) {
            return toJavaMap((JSONObject) value);
        }

        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            Object[] values = new Object[array.length()];

            for (int index = 0; index < array.length(); index++) {
                values[index] = toJavaValue(array.get(index));
            }

            return values;
        }

        return value;
    }

    private static String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static int intValue(Object value) {
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }

        if (value == null) {
            return 0;
        }

        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mapValue(Object value) {
        if (value instanceof Map) {
            return (Map<String, Object>) value;
        }

        return new LinkedHashMap<>();
    }

    private byte[] readResponseBodyBytes(InputStream inputStream) throws IOException {
        if (inputStream == null) {
            return new byte[0];
        }

        try (ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int bytesRead;

            while ((bytesRead = inputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, bytesRead);
            }

            return outputStream.toByteArray();
        }
    }

    static void validateRequestBodyBase64(String requestBodyBase64) throws NativeAuthHttpException {
        if (requestBodyBase64 == null || requestBodyBase64.isEmpty()) {
            return;
        }

        if (!REQUEST_BODY_BASE64_PATTERN.matcher(requestBodyBase64).matches()) {
            throw new NativeAuthHttpException("Android auth bridge received an invalid Base64 request body", 0);
        }
    }

    static byte[] decodeRequestBody(String requestBodyBase64) throws NativeAuthHttpException {
        if (requestBodyBase64 == null || requestBodyBase64.isEmpty()) {
            return null;
        }

        validateRequestBodyBase64(requestBodyBase64);

        try {
            return Base64.decode(requestBodyBase64, Base64.NO_WRAP);
        } catch (IllegalArgumentException exception) {
            throw new NativeAuthHttpException("Android auth bridge received an invalid Base64 request body", 0);
        }
    }

    static String buildDeviceName(String manufacturerValue, String modelValue) {
        String manufacturer = manufacturerValue == null ? "" : manufacturerValue.trim();
        String model = modelValue == null ? "" : modelValue.trim();
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
        private final byte[] responseBody;
        private final String contentType;

        RequestResponse(int statusCode, byte[] responseBody, String contentType) {
            this.statusCode = statusCode;
            this.responseBody = responseBody;
            this.contentType = contentType;
        }

        int getStatusCode() { return statusCode; }

        String getResponseBodyAsString() { return new String(responseBody, StandardCharsets.UTF_8); }

        String getResponseBodyBase64() {
            return responseBody.length == 0 ? "" : Base64.encodeToString(responseBody, Base64.NO_WRAP);
        }

        String getContentType() { return contentType; }
    }
}
