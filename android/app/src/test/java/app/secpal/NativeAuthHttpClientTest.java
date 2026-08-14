/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
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
    public void normalizeBaseUrlRejectsInsecureHttpOrigin() {
        assertErrorMessage(
            "Android auth bridge requires an HTTPS API base URL",
            "http://customer.example"
        );
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
    public void redirectServerRejectsInvalidContentLengthAsIoFailure() {
        for (String value : Arrays.asList("not-a-number", "-1")) {
            try {
                RedirectTestServer.parseContentLength(value);
                throw new AssertionError("Expected invalid Content-Length to fail");
            } catch (IOException exception) {
                assertTrue(exception.getMessage().contains("Content-Length"));
            }
        }
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

    @Test
    public void oversizedBase64IsRejectedBeforeDecoding() {
        assertDecodeErrorMessage(
            "Android auth bridge request exceeds the allowed size",
            "A".repeat(NativeAuthHttpClient.MAX_REQUEST_BODY_BASE64_CHARACTERS + 4)
        );
    }

    @Test
    public void transportTimeoutReasonCannotBeOverwrittenByLaterCancellation()
        throws Exception {
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();

        cancellation.cancelForTimeout();
        cancellation.cancel();

        try {
            cancellation.throwIfCancelled();
            throw new AssertionError("Expected cancellation to throw");
        } catch (NativeAuthHttpClient.NativeAuthCancelledException exception) {
            assertEquals("REQUEST_TIMEOUT", exception.getReasonCode());
        }
    }

    @Test
    public void callerCancellationAfterUnauthorizedStatusPreservesCancellationReason()
        throws Exception {
        assertCancellationAfterUnauthorizedStatus(false, "REQUEST_CANCELLED");
    }

    @Test
    public void lifetimeTimeoutAfterUnauthorizedStatusPreservesTimeoutReason()
        throws Exception {
        assertCancellationAfterUnauthorizedStatus(true, "REQUEST_TIMEOUT");
    }

    @Test
    public void authenticatedRedirectStatusesAlwaysFailClosed() {
        int[] redirectStatuses = { 301, 302, 303, 307, 308 };

        for (int status : redirectStatuses) {
            try {
                NativeAuthHttpClient.rejectAuthenticatedRedirect(status);
            } catch (NativeAuthHttpException exception) {
                assertEquals(status, exception.getStatusCode());
                continue;
            }

            throw new AssertionError("Expected authenticated redirect " + status + " to fail closed");
        }
    }

    @Test
    public void nonRedirectStatusDoesNotTriggerRedirectRejection() throws Exception {
        NativeAuthHttpClient.rejectAuthenticatedRedirect(200);
        NativeAuthHttpClient.rejectAuthenticatedRedirect(422);
    }

    @Test
    public void responseReaderRejectsOversizedBodies() throws Exception {
        byte[] oversized = new byte[NativeAuthRequestPolicy.MAX_RESPONSE_BODY_BYTES + 1];

        try {
            NativeAuthHttpClient.readResponseBodyBytes(
                new ByteArrayInputStream(oversized),
                NativeAuthRequestPolicy.MAX_RESPONSE_BODY_BYTES,
                0
            );
        } catch (NativeAuthHttpException exception) {
            assertEquals("Android auth bridge response exceeds the allowed size", exception.getMessage());
            return;
        }

        throw new AssertionError("Expected oversized response to fail closed");
    }

    @Test
    public void rejectedRouteNeverCreatesCredentialedConnection() throws Exception {
        AtomicInteger openedConnections = new AtomicInteger();
        NativeAuthHttpClient client = new NativeAuthHttpClient(url -> {
            openedConnections.incrementAndGet();
            return new StubHttpURLConnection(url, 200, null);
        });

        try {
            client.request(
                "https://api.secpal.dev",
                "native-secret",
                "POST",
                "/v1/auth/token",
                "e30=",
                "application/json",
                "application/json"
            );
        } catch (NativeAuthHttpException expected) {
            assertEquals(0, openedConnections.get());
            return;
        }

        throw new AssertionError("Expected forbidden route to fail before connection creation");
    }

    @Test
    public void cancellationDisconnectsAnInFlightCredentialedConnection() throws Exception {
        BlockingHttpURLConnection connection = new BlockingHttpURLConnection(
            new URL("https://api.secpal.dev/v1/customers")
        );
        NativeAuthHttpClient client = new NativeAuthHttpClient(url -> connection);
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();
        Thread requestThread = new Thread(() -> {
            try {
                client.request(
                    "https://api.secpal.dev",
                    "native-secret",
                    "GET",
                    "/v1/customers",
                    null,
                    null,
                    "application/json",
                    cancellation
                );
            } catch (IOException | NativeAuthHttpException expected) {
                // Cancellation terminates the blocked transport.
            }
        });

        requestThread.start();
        assertTrue(connection.responseStarted.await(2, TimeUnit.SECONDS));

        cancellation.cancel();

        assertTrue(connection.disconnected.await(2, TimeUnit.SECONDS));
        requestThread.join(2_000L);
        assertFalse(requestThread.isAlive());
    }

    @Test
    public void cancellationDisconnectsAnInFlightLogoutConnection() throws Exception {
        BlockingHttpURLConnection connection = new BlockingHttpURLConnection(
            new URL("https://api.secpal.dev/v1/auth/logout")
        );
        NativeAuthHttpClient client = new NativeAuthHttpClient(url -> connection);
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();
        Thread requestThread = new Thread(() -> {
            try {
                client.logout(
                    "https://api.secpal.dev",
                    "native-secret",
                    cancellation
                );
            } catch (IOException | org.json.JSONException | NativeAuthHttpException expected) {
                // Cancellation terminates the blocked logout transport.
            }
        });

        requestThread.start();
        assertTrue(connection.responseStarted.await(2, TimeUnit.SECONDS));

        cancellation.cancel();

        assertTrue(connection.disconnected.await(2, TimeUnit.SECONDS));
        requestThread.join(2_000L);
        assertFalse(requestThread.isAlive());
    }

    @Test
    public void totalLifetimeDisconnectsASlowCredentialedResponse() throws Exception {
        BlockingHttpURLConnection connection = new BlockingHttpURLConnection(
            new URL("https://api.secpal.dev/v1/customers")
        );
        NativeAuthHttpClient client = new NativeAuthHttpClient(url -> connection);
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor(
            Executors.newSingleThreadExecutor(),
            scheduler,
            250L
        );
        CountDownLatch terminal = new CountDownLatch(1);
        AtomicInteger terminalCallbacks = new AtomicInteger();

        try {
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitAuthenticated(
                    "slow-http-response",
                    0,
                    () -> {
                        try {
                            client.request(
                                "https://api.secpal.dev",
                                "native-secret",
                                "GET",
                                "/v1/customers",
                                null,
                                null,
                                "application/json",
                                cancellation
                            );
                        } catch (IOException | NativeAuthHttpException expected) {
                            // The total-lifetime cancellation owns terminal settlement.
                        }
                    },
                    reason -> {
                        assertEquals("REQUEST_TIMEOUT", reason);
                        cancellation.cancel();
                        terminalCallbacks.incrementAndGet();
                        terminal.countDown();
                    }
                )
            );
            assertTrue(connection.responseStarted.await(2, TimeUnit.SECONDS));
            assertTrue(terminal.await(2, TimeUnit.SECONDS));
            assertTrue(connection.disconnected.await(2, TimeUnit.SECONDS));
            assertEquals(1, terminalCallbacks.get());
        } finally {
            taskExecutor.shutdownNow();
            scheduler.shutdownNow();
        }
    }

    @Test
    public void transportUsesOnlyCanonicalHeadersFromTheAuthorizedRequest() throws Exception {
        StubHttpURLConnection[] captured = new StubHttpURLConnection[1];
        NativeAuthHttpClient client = new NativeAuthHttpClient(url -> {
            captured[0] = new StubHttpURLConnection(
                url,
                200,
                null,
                "{}".getBytes(StandardCharsets.UTF_8),
                "application/json"
            );
            return captured[0];
        });

        client.request(
            "https://api.secpal.dev",
            "native-secret",
            "POST",
            "/v1/customers",
            "e30=",
            " application/json; charset=UTF-8 ",
            " */* "
        );

        assertEquals("application/json", captured[0].getRequestProperty("Content-Type"));
        assertEquals("application/json", captured[0].getRequestProperty("Accept"));
        assertEquals(2, captured[0].getFixedLengthRequestBodyBytes());
    }

    @Test
    public void uploadDeadlinesScaleToTheMaximumSupportedRequestBody() {
        int maximumRequestBytes = NativeAuthRequestPolicy.MAX_REQUEST_BODY_BYTES;

        assertTrue(
            NativeAuthHttpClient.resolveWriteTimeoutMillis(maximumRequestBytes)
                > NativeAuthHttpClient.WRITE_TIMEOUT_MILLIS
        );
        assertTrue(
            NativeAuthHttpClient.resolveTotalRequestLifetimeMillis(maximumRequestBytes)
                > NativeAuthHttpClient.resolveWriteTimeoutMillis(maximumRequestBytes)
        );
        assertEquals(
            NativeAuthHttpClient.TOTAL_REQUEST_LIFETIME_MILLIS,
            NativeAuthHttpClient.resolveTotalRequestLifetimeMillis(0)
        );
    }

    @Test
    public void completedUploadsDoNotAccumulateCancelledWriteDeadlines()
        throws Exception {
        NativeAuthHttpClient client = new NativeAuthHttpClient(
            url -> new StubHttpURLConnection(
                url,
                200,
                null,
                "{}".getBytes(StandardCharsets.UTF_8),
                "application/json"
            )
        );

        for (int index = 0; index < 32; index++) {
            client.request(
                "https://api.secpal.dev",
                "native-secret",
                "POST",
                "/v1/customers",
                "e30=",
                "application/json",
                "application/json"
            );
        }

        assertEquals(0, NativeAuthHttpClient.getPendingWriteDeadlineCountForTest());
    }

    @Test
    public void oversizedDedicatedJsonRequestFailsBeforeOpeningAConnection()
        throws Exception {
        AtomicInteger openedConnections = new AtomicInteger();
        NativeAuthHttpClient client = new NativeAuthHttpClient(url -> {
            openedConnections.incrementAndGet();
            return new StubHttpURLConnection(url, 200, null);
        });
        String oversizedPassword = "x".repeat(
            NativeAuthRequestPolicy.MAX_REQUEST_BODY_BYTES
        );

        try {
            client.login(
                "https://api.secpal.dev",
                "worker@secpal.dev",
                oversizedPassword
            );
            throw new AssertionError("Expected oversized login body to fail closed");
        } catch (NativeAuthHttpException expected) {
            assertEquals(0, expected.getStatusCode());
        }

        assertEquals(0, openedConnections.get());
    }

    @Test
    public void dedicatedAuthJsonResponseUsesItsSmallerBufferLimit() throws Exception {
        byte[] oversizedResponse = new byte[
            NativeAuthHttpClient.MAX_DEDICATED_JSON_RESPONSE_BODY_BYTES + 1
        ];
        NativeAuthHttpClient client = new NativeAuthHttpClient(
            url -> new StubHttpURLConnection(
                url,
                200,
                null,
                oversizedResponse,
                "application/json"
            )
        );

        try {
            client.login(
                "https://api.secpal.dev",
                "worker@secpal.dev",
                "correct horse battery staple"
            );
            throw new AssertionError("Expected oversized auth JSON response to fail closed");
        } catch (NativeAuthHttpException exception) {
            assertEquals(
                "Android auth bridge response exceeds the allowed size",
                exception.getMessage()
            );
            assertEquals(0, exception.getStatusCode());
        }
    }

    @Test
    public void oversizedUnauthorizedResponsesPreserveAuthenticationStatus()
        throws Exception {
        byte[] oversizedDedicatedResponse = new byte[
            NativeAuthHttpClient.MAX_DEDICATED_JSON_RESPONSE_BODY_BYTES + 1
        ];
        NativeAuthHttpClient dedicatedClient = new NativeAuthHttpClient(
            url -> new StubHttpURLConnection(
                url,
                401,
                null,
                oversizedDedicatedResponse,
                "application/json"
            )
        );

        try {
            dedicatedClient.getCurrentUser(
                "https://api.secpal.dev",
                "rejected-token"
            );
            throw new AssertionError("Expected oversized dedicated response to fail closed");
        } catch (NativeAuthHttpException exception) {
            assertEquals(401, exception.getStatusCode());
        }

        byte[] oversizedStreamingResponse = new byte[
            NativeAuthRequestPolicy.MAX_RESPONSE_BODY_BYTES + 1
        ];
        NativeAuthHttpClient streamingClient = new NativeAuthHttpClient(
            url -> new StubHttpURLConnection(
                url,
                401,
                null,
                oversizedStreamingResponse,
                "application/json"
            ) {
                @Override
                public long getContentLengthLong() {
                    return -1L;
                }
            }
        );

        try {
            streamingClient.request(
                "https://api.secpal.dev",
                "rejected-token",
                "GET",
                "/v1/customers",
                null,
                null,
                "application/json"
            );
            throw new AssertionError("Expected oversized streaming response to fail closed");
        } catch (NativeAuthHttpException exception) {
            assertEquals(401, exception.getStatusCode());
        }
    }

    @Test
    public void unreadableUnauthorizedResponsePreservesAuthenticationStatus()
        throws Exception {
        NativeAuthHttpClient client = new NativeAuthHttpClient(
            url -> new StubHttpURLConnection(
                url,
                401,
                null,
                new byte[0],
                "application/json"
            ) {
                @Override
                public long getContentLengthLong() {
                    return -1L;
                }

                @Override
                public InputStream getErrorStream() {
                    return new InputStream() {
                        @Override
                        public int read() throws IOException {
                            throw new IOException("truncated error response");
                        }
                    };
                }
            }
        );

        try {
            client.getCurrentUser(
                "https://api.secpal.dev",
                "rejected-token"
            );
            throw new AssertionError("Expected unreadable unauthorized response to fail closed");
        } catch (NativeAuthHttpException exception) {
            assertEquals(401, exception.getStatusCode());
        }
    }

    @Test
    public void redirectResponsesNeverCreateASecondConnectionOrFollowLocation() throws Exception {
        int[] redirectStatuses = { 301, 302, 303, 307, 308 };
        String[] redirectLocations = {
            "https://api.secpal.dev/v1/me",
            "https://evil.example/steal",
        };

        for (int status : redirectStatuses) {
            for (String redirectLocation : redirectLocations) {
                AtomicInteger openedConnections = new AtomicInteger();
                StubHttpURLConnection[] captured = new StubHttpURLConnection[1];
                NativeAuthHttpClient client = new NativeAuthHttpClient(url -> {
                    openedConnections.incrementAndGet();
                    captured[0] = new StubHttpURLConnection(url, status, redirectLocation);
                    return captured[0];
                });

                try {
                    client.request(
                        "https://api.secpal.dev",
                        "native-secret",
                        "PUT",
                        "/v1/me/notification-installations/device-1",
                        "e30=",
                        "application/json",
                        "application/json"
                    );
                } catch (NativeAuthHttpException expected) {
                    assertEquals(status, expected.getStatusCode());
                    assertEquals(1, openedConnections.get());
                    assertFalse(captured[0].getInstanceFollowRedirects());
                    assertEquals("PUT", captured[0].getRequestMethod());
                    assertEquals("Bearer native-secret", captured[0].getRequestProperty("Authorization"));
                    assertTrue(Arrays.equals(
                        "{}".getBytes(StandardCharsets.UTF_8),
                        captured[0].getWrittenRequestBody()
                    ));
                    continue;
                }

                throw new AssertionError("Expected redirect " + status + " to fail closed");
            }
        }
    }

    @Test
    public void realHttpTransportNeverFollowsAnyAuthenticatedRedirect() throws Exception {
        try (
            RedirectTestServer sourceServer = new RedirectTestServer();
            RedirectTestServer crossOriginServer = new RedirectTestServer()
        ) {
            int sourcePort = sourceServer.getPort();
            int crossOriginPort = crossOriginServer.getPort();
            NativeAuthHttpClient client = new NativeAuthHttpClient(url ->
                (HttpURLConnection) new URL(
                    "http",
                    "127.0.0.1",
                    url.getPort(),
                    url.getFile()
                ).openConnection()
            );

            for (int status : new int[] { 301, 302, 303, 307, 308 }) {
                for (String location : new String[] {
                    "http://127.0.0.1:" + sourcePort + "/same-origin-target",
                    "http://127.0.0.1:" + crossOriginPort + "/cross-origin-target",
                }) {
                    sourceServer.setRedirect(status, location);
                    try {
                        client.request(
                            "https://127.0.0.1:" + sourcePort,
                            "native-secret",
                            "PUT",
                            "/v1/me/notification-installations/device-1",
                            "e30=",
                            "application/json",
                            "application/json"
                        );
                    } catch (NativeAuthHttpException expected) {
                        assertEquals(status, expected.getStatusCode());
                        assertEquals("PUT", sourceServer.getLastMethod());
                        assertEquals("Bearer native-secret", sourceServer.getLastAuthorization());
                        assertTrue(Arrays.equals(
                            "{}".getBytes(StandardCharsets.UTF_8),
                            sourceServer.getLastBody()
                        ));
                        continue;
                    }
                    throw new AssertionError("Expected redirect " + status + " to fail closed");
                }
            }

            assertEquals(10, sourceServer.getSourceRequests());
            assertEquals(0, sourceServer.getTargetRequests());
            assertEquals(0, crossOriginServer.getTargetRequests());
        }
    }

    @Test
    public void jsonRouteRejectsNonJsonResponseContentType() throws Exception {
        NativeAuthHttpClient client = new NativeAuthHttpClient(url ->
            new StubHttpURLConnection(
                url,
                200,
                null,
                "<html>unexpected</html>".getBytes(StandardCharsets.UTF_8),
                "text/html"
            )
        );

        try {
            client.request(
                "https://api.secpal.dev",
                "native-secret",
                "GET",
                "/v1/customers",
                null,
                null,
                "application/json"
            );
        } catch (NativeAuthHttpException expected) {
            assertEquals(
                "Android auth bridge received an unsupported JSON response content type",
                expected.getMessage()
            );
            return;
        }

        throw new AssertionError("Expected non-JSON response to fail closed");
    }

    @Test
    public void nonJsonUnauthorizedResponsePreservesAuthenticationStatus() throws Exception {
        NativeAuthHttpClient client = new NativeAuthHttpClient(url ->
            new StubHttpURLConnection(
                url,
                401,
                null,
                "Unauthorized".getBytes(StandardCharsets.UTF_8),
                "text/plain"
            )
        );

        try {
            client.request(
                "https://api.secpal.dev",
                "native-secret",
                "GET",
                "/v1/customers",
                null,
                null,
                "application/json"
            );
        } catch (NativeAuthHttpException expected) {
            assertEquals(
                "Android auth bridge received an unsupported error response content type",
                expected.getMessage()
            );
            assertEquals(401, expected.getStatusCode());
            return;
        }

        throw new AssertionError("Expected non-JSON unauthorized response to fail closed");
    }

    @Test
    public void buildTokenPasskeyAuthenticationChallengeRequestBodyOnlyCarriesDeviceName() throws Exception {
        JSONObject body = NativeAuthHttpClient
            .buildTokenPasskeyAuthenticationChallengeRequestBody("Pixel 9");

        assertEquals("Pixel 9", body.getString("device_name"));
        assertEquals(1, body.length());
    }

    @Test
    public void buildTokenPasskeyAuthenticationChallengeRequestBodyNeverIncludesEmail() throws Exception {
        JSONObject body = NativeAuthHttpClient
            .buildTokenPasskeyAuthenticationChallengeRequestBody("Pixel 9");

        assertFalse(
            "Public passkey challenges must remain discoverable-only without an email field",
            body.has("email")
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

    private void assertDecodeErrorMessage(String expected, String requestBodyBase64) {
        try {
            NativeAuthHttpClient.validateRequestBodyBase64(requestBodyBase64);
        } catch (NativeAuthHttpException exception) {
            assertEquals(expected, exception.getMessage());
            return;
        }

        throw new AssertionError("Expected NativeAuthHttpException");
    }

    private static void assertCancellationAfterUnauthorizedStatus(
        boolean timeout,
        String expectedReasonCode
    ) throws Exception {
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();
        NativeAuthHttpClient client = new NativeAuthHttpClient(
            url -> new StubHttpURLConnection(url, 401, null) {
                @Override
                public int getResponseCode() {
                    if (timeout) {
                        cancellation.cancelForTimeout();
                    } else {
                        cancellation.cancel();
                    }
                    return 401;
                }
            }
        );

        try {
            client.getCurrentUser(
                "https://api.secpal.dev",
                "rejected-token",
                cancellation
            );
            throw new AssertionError("Expected cancellation to terminate the response");
        } catch (NativeAuthHttpClient.NativeAuthCancelledException exception) {
            assertEquals(expectedReasonCode, exception.getReasonCode());
        }
    }

    private static class StubHttpURLConnection extends HttpURLConnection {
        private final int stubStatus;
        private final String redirectLocation;
        private final byte[] responseBody;
        private final String responseContentType;
        private final ByteArrayOutputStream requestBody = new ByteArrayOutputStream();
        private int fixedLengthRequestBodyBytes = -1;

        StubHttpURLConnection(URL url, int stubStatus, String redirectLocation) {
            this(url, stubStatus, redirectLocation, new byte[0], null);
        }

        StubHttpURLConnection(
            URL url,
            int stubStatus,
            String redirectLocation,
            byte[] responseBody,
            String responseContentType
        ) {
            super(url);
            this.stubStatus = stubStatus;
            this.redirectLocation = redirectLocation;
            this.responseBody = responseBody;
            this.responseContentType = responseContentType;
        }

        @Override
        public int getResponseCode() {
            return stubStatus;
        }

        @Override
        public String getHeaderField(String name) {
            return "Location".equalsIgnoreCase(name) ? redirectLocation : null;
        }

        @Override
        public InputStream getInputStream() {
            return new ByteArrayInputStream(responseBody);
        }

        @Override
        public InputStream getErrorStream() {
            return new ByteArrayInputStream(responseBody);
        }

        @Override
        public long getContentLengthLong() {
            return responseBody.length;
        }

        @Override
        public String getContentType() {
            return responseContentType;
        }

        @Override
        public OutputStream getOutputStream() {
            return requestBody;
        }

        @Override
        public void setFixedLengthStreamingMode(int contentLength) {
            fixedLengthRequestBodyBytes = contentLength;
        }

        byte[] getWrittenRequestBody() { return requestBody.toByteArray(); }

        int getFixedLengthRequestBodyBytes() { return fixedLengthRequestBodyBytes; }

        @Override
        public void disconnect() {}

        @Override
        public boolean usingProxy() { return false; }

        @Override
        public void connect() {}
    }

    private static final class BlockingHttpURLConnection extends HttpURLConnection {
        private final CountDownLatch responseStarted = new CountDownLatch(1);
        private final CountDownLatch disconnected = new CountDownLatch(1);

        BlockingHttpURLConnection(URL url) {
            super(url);
        }

        @Override
        public int getResponseCode() throws IOException {
            responseStarted.countDown();
            try {
                if (!disconnected.await(2, TimeUnit.SECONDS)) {
                    throw new IOException("connection was not cancelled");
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IOException("request interrupted", exception);
            }
            throw new IOException("connection cancelled");
        }

        @Override
        public void disconnect() {
            disconnected.countDown();
        }

        @Override
        public boolean usingProxy() {
            return false;
        }

        @Override
        public void connect() {}
    }

    private static final class RedirectTestServer implements AutoCloseable {
        private static final String SOURCE_PATH = "/v1/me/notification-installations/device-1";

        private final ServerSocket serverSocket;
        private final Thread serverThread;
        private final AtomicInteger sourceRequests = new AtomicInteger();
        private final AtomicInteger targetRequests = new AtomicInteger();
        private volatile boolean closed;
        private volatile int redirectStatus = 301;
        private volatile String redirectLocation = "/same-origin-target";
        private volatile String lastMethod;
        private volatile String lastAuthorization;
        private volatile byte[] lastBody = new byte[0];

        RedirectTestServer() throws IOException {
            serverSocket = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
            serverThread = new Thread(this::serve, "native-auth-redirect-test-server");
            serverThread.setDaemon(true);
            serverThread.start();
        }

        int getPort() { return serverSocket.getLocalPort(); }
        int getSourceRequests() { return sourceRequests.get(); }
        int getTargetRequests() { return targetRequests.get(); }
        String getLastMethod() { return lastMethod; }
        String getLastAuthorization() { return lastAuthorization; }
        byte[] getLastBody() { return lastBody; }

        void setRedirect(int status, String location) {
            redirectStatus = status;
            redirectLocation = location;
        }

        private void serve() {
            while (!closed) {
                try (Socket socket = serverSocket.accept()) {
                    handle(socket);
                } catch (IOException exception) {
                    if (!closed) {
                        throw new AssertionError("Redirect test server failed", exception);
                    }
                }
            }
        }

        private void handle(Socket socket) throws IOException {
            InputStream input = socket.getInputStream();
            String headers = readHeaders(input);
            String[] lines = headers.split("\\r\\n");
            String[] requestLine = lines[0].split(" ", 3);
            String path = requestLine[1];
            int contentLength = 0;
            String authorization = null;
            for (int index = 1; index < lines.length; index++) {
                int separator = lines[index].indexOf(':');
                if (separator < 1) {
                    continue;
                }
                String name = lines[index].substring(0, separator).trim();
                String value = lines[index].substring(separator + 1).trim();
                if ("Content-Length".equalsIgnoreCase(name)) {
                    contentLength = parseContentLength(value);
                } else if ("Authorization".equalsIgnoreCase(name)) {
                    authorization = value;
                }
            }

            OutputStream output = socket.getOutputStream();
            if (SOURCE_PATH.equals(path)) {
                sourceRequests.incrementAndGet();
                lastMethod = requestLine[0];
                lastAuthorization = authorization;
                lastBody = input.readNBytes(contentLength);
                output.write((
                    "HTTP/1.1 " + redirectStatus + " Redirect\r\n"
                        + "Location: " + redirectLocation + "\r\n"
                        + "Content-Length: 0\r\n"
                        + "Connection: close\r\n\r\n"
                ).getBytes(StandardCharsets.ISO_8859_1));
            } else {
                targetRequests.incrementAndGet();
                output.write((
                    "HTTP/1.1 200 OK\r\n"
                        + "Content-Length: 0\r\n"
                        + "Connection: close\r\n\r\n"
                ).getBytes(StandardCharsets.ISO_8859_1));
            }
            output.flush();
        }

        private static int parseContentLength(String value) throws IOException {
            try {
                int contentLength = Integer.parseInt(value);
                if (contentLength < 0) {
                    throw new IOException("Invalid Content-Length");
                }
                return contentLength;
            } catch (NumberFormatException exception) {
                throw new IOException("Invalid Content-Length", exception);
            }
        }

        private static String readHeaders(InputStream input) throws IOException {
            ByteArrayOutputStream headers = new ByteArrayOutputStream();
            int state = 0;
            while (state < 4) {
                int next = input.read();
                if (next == -1) {
                    throw new IOException("Unexpected end of HTTP request headers");
                }
                headers.write(next);
                if ((state == 0 || state == 2) && next == '\r') {
                    state += 1;
                } else if ((state == 1 || state == 3) && next == '\n') {
                    state += 1;
                } else {
                    state = next == '\r' ? 1 : 0;
                }
            }
            return headers.toString(StandardCharsets.ISO_8859_1.name());
        }

        @Override
        public void close() throws Exception {
            closed = true;
            serverSocket.close();
            serverThread.join(1000);
        }
    }
}
