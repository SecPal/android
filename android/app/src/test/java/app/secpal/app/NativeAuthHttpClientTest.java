/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal.app;

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
}
