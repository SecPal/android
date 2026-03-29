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
    public void buildErrorMessageUsesJsonMessageWhenPresent() {
        assertEquals(
            "Bad credentials",
            NativeAuthHttpClient.buildErrorMessage("{\"message\":\"Bad credentials\"}", 422)
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
}