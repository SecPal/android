/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class NativeAuthHttpClientTest {

    @Test
    public void normalizeBaseUrlTrimsWhitespaceAndTrailingSlash() throws Exception {
        assertEquals("https://api.secpal.dev", NativeAuthHttpClient.normalizeBaseUrl(" https://api.secpal.dev/ "));
    }

    @Test
    public void normalizeBaseUrlRejectsMissingValue() {
        assertErrorMessage("Android auth bridge requires an API base URL", null);
    }

    @Test
    public void normalizeBaseUrlRejectsRelativeValue() {
        assertErrorMessage("Android auth bridge requires an absolute API base URL", "/v1");
    }

    @Test
    public void normalizeBaseUrlRejectsUserInfo() {
        assertErrorMessage(
            "Android auth bridge requires a bare API origin without userinfo, path, query, or fragment",
            "https://api.secpal.dev@evil.example"
        );
    }

    @Test
    public void normalizeBaseUrlRejectsPathQueryAndFragment() {
        assertErrorMessage(
            "Android auth bridge requires a bare API origin without userinfo, path, query, or fragment",
            "https://api.secpal.dev/v1?token=1#frag"
        );
    }

    @Test
    public void normalizeHttpMethodUppercasesSupportedMethods() throws Exception {
        assertEquals("PATCH", NativeAuthHttpClient.normalizeHttpMethod("patch"));
    }

    @Test
    public void normalizeHttpMethodRejectsUnsupportedMethods() {
        assertMethodErrorMessage("Android auth bridge does not support method TRACE", "trace");
    }

    @Test
    public void normalizeRequestPathTrimsWhitespace() throws Exception {
        assertEquals("/v1/me", NativeAuthHttpClient.normalizeRequestPath(" /v1/me "));
    }

    @Test
    public void normalizeRequestPathRejectsAbsoluteUrls() {
        assertPathErrorMessage(
            "Android auth bridge requires a relative request path starting with /",
            "https://api.secpal.dev/v1/me"
        );
    }

    @Test
    public void buildErrorMessageUsesJsonMessageWhenPresent() {
        assertEquals(
            "Bad credentials",
            NativeAuthHttpClient.buildErrorMessage("{\"message\":\"Bad credentials\"}", 422)
        );
    }

    @Test
    public void buildErrorMessageHandlesEscapedQuotesInJsonMessage() {
        assertEquals(
            "Bad \"credentials\"",
            NativeAuthHttpClient.buildErrorMessage("{\"message\":\"Bad \\\"credentials\\\"\"}", 422)
        );
    }

    @Test
    public void buildErrorMessageFallsBackToStatusWhenJsonIsInvalid() {
        assertEquals(
            "Android auth request failed with status 503",
            NativeAuthHttpClient.buildErrorMessage("<html>", 503)
        );
    }

    @Test
    public void buildErrorMessageDecodesUnicodeEscapesInJsonMessage() {
        assertEquals(
            "Not found \u2014 resource missing",
            NativeAuthHttpClient.buildErrorMessage("{\"message\":\"Not found \\u2014 resource missing\"}", 404)
        );
    }

    @Test
    public void resolveConnectTimeoutMillisUsesShorterBudgetForCurrentUserBootstrap() {
        assertEquals(3000, NativeAuthHttpClient.resolveConnectTimeoutMillis("GET", "/v1/me"));
    }

    @Test
    public void resolveReadTimeoutMillisUsesShorterBudgetForCurrentUserBootstrap() {
        assertEquals(3000, NativeAuthHttpClient.resolveReadTimeoutMillis("GET", "/v1/me"));
    }

    @Test
    public void timeoutResolutionKeepsDefaultBudgetForNonBootstrapRequests() {
        assertEquals(15000, NativeAuthHttpClient.resolveConnectTimeoutMillis("POST", "/v1/auth/token"));
        assertEquals(15000, NativeAuthHttpClient.resolveReadTimeoutMillis("POST", "/v1/auth/token"));
    }

    @Test
    public void validateRequestBodyBase64AcceptsCanonicalBase64() throws Exception {
        NativeAuthHttpClient.validateRequestBodyBase64("eyJvayI6dHJ1ZX0=");
    }

    @Test
    public void validateRequestBodyBase64RejectsMalformedBase64() {
        assertDecodeErrorMessage(
            "Android auth bridge received an invalid Base64 request body",
            "!!!"
        );
    }

    private void assertErrorMessage(String expected, String baseUrl) {
        try {
            NativeAuthHttpClient.normalizeBaseUrl(baseUrl);
        } catch (NativeAuthHttpException exception) {
            assertEquals(expected, exception.getMessage());
            return;
        }

        throw new AssertionError("Expected NativeAuthHttpException");
    }

    private void assertMethodErrorMessage(String expected, String method) {
        try {
            NativeAuthHttpClient.normalizeHttpMethod(method);
        } catch (NativeAuthHttpException exception) {
            assertEquals(expected, exception.getMessage());
            return;
        }

        throw new AssertionError("Expected NativeAuthHttpException");
    }

    private void assertPathErrorMessage(String expected, String path) {
        try {
            NativeAuthHttpClient.normalizeRequestPath(path);
        } catch (NativeAuthHttpException exception) {
            assertEquals(expected, exception.getMessage());
            return;
        }

        throw new AssertionError("Expected NativeAuthHttpException");
    }

    private void assertDecodeErrorMessage(String expected, String requestBodyBase64) {
        try {
            NativeAuthHttpClient.validateRequestBodyBase64(requestBodyBase64);
        } catch (NativeAuthHttpException exception) {
            assertEquals(expected, exception.getMessage());
            return;
        }

        throw new AssertionError("Expected NativeAuthHttpException");
    }
}
