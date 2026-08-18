/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.DialogInterface;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginMethod;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.Test;
import org.json.JSONObject;

public class SecPalNativeAuthPluginTest {

    @Test
    public void bridgeCallShapeRejectsUnexpectedRetainedPayloads() {
        JSObject data = new JSObject();
        data.put("method", "GET");
        data.put("path", "/v1/me");
        data.put("unexpected", "x");

        assertFalse(SecPalNativeAuthPlugin.hasOnlyKeys(data, "method", "path"));
        data.remove("unexpected");
        assertTrue(SecPalNativeAuthPlugin.hasOnlyKeys(data, "method", "path"));
    }

    @Test
    public void boundedBridgeValuesRejectQueueRetainedCredentialPayloads() {
        assertTrue(SecPalNativeAuthPlugin.isBoundedValue("worker@secpal.dev", 320));
        assertFalse(SecPalNativeAuthPlugin.isBoundedValue("x".repeat(321), 320));
    }

    @Test
    public void boundedBridgeObjectsRejectQueueRetainedRuntimeAndPasskeyPayloads() {
        JSObject bounded = new JSObject();
        bounded.put("challenge", "x".repeat(128));
        JSObject oversized = new JSObject();
        oversized.put(
            "challenge",
            "x".repeat(SecPalNativeAuthPlugin.MAX_PASSKEY_OPTIONS_CHARACTERS)
        );

        assertTrue(SecPalNativeAuthPlugin.isBoundedJsonObject(
            bounded,
            SecPalNativeAuthPlugin.MAX_PASSKEY_OPTIONS_CHARACTERS
        ));
        assertFalse(SecPalNativeAuthPlugin.isBoundedJsonObject(
            oversized,
            SecPalNativeAuthPlugin.MAX_PASSKEY_OPTIONS_CHARACTERS
        ));
    }

    @Test
    public void runtimeBootstrapRejectsOversizedIdentityAndOriginValues() throws Exception {
        assertRuntimeBootstrapInvalid(
            "x".repeat(SecPalNativeAuthPlugin.MAX_RUNTIME_DISPLAY_NAME_CHARACTERS + 1),
            "https://tenant.example/v1"
        );
        assertRuntimeBootstrapInvalid(
            "Tenant",
            "https://" + "x".repeat(SecPalNativeAuthPlugin.MAX_RUNTIME_URL_CHARACTERS)
        );
    }

    @Test
    public void terminalSettlementRunsOnlyOnceAcrossCompletionAndCancellation() throws Exception {
        AtomicBoolean settled = new AtomicBoolean(false);
        AtomicInteger callbacks = new AtomicInteger();
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        Runnable contender = () -> {
            ready.countDown();
            try {
                start.await();
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                return;
            }
            SecPalNativeAuthPlugin.settleOnce(settled, callbacks::incrementAndGet);
        };
        Thread completion = new Thread(contender);
        Thread cancellation = new Thread(contender);
        completion.start();
        cancellation.start();
        assertTrue(ready.await(2, TimeUnit.SECONDS));

        start.countDown();
        completion.join(2_000L);
        cancellation.join(2_000L);

        assertEquals(1, callbacks.get());
    }

    @Test
    public void lifecycleNotificationInvalidatesWebViewBeforeNativeBackgroundCancellation()
        throws Exception {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        CountDownLatch requestStarted = new CountDownLatch(1);
        List<String> events = new ArrayList<>();

        try {
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitAuthenticated(
                    "background-ordering",
                    0,
                    () -> {
                        requestStarted.countDown();
                        try {
                            Thread.sleep(10_000L);
                        } catch (InterruptedException exception) {
                            Thread.currentThread().interrupt();
                        }
                    },
                    reason -> events.add("cancel:" + reason)
                )
            );
            assertTrue(requestStarted.await(2, TimeUnit.SECONDS));

            SecPalNativeAuthPlugin.pauseAuthenticatedForLifecycle(
                taskExecutor,
                (event, payload) -> events.add(
                    event + ":" + payload.getBool("foreground")
                )
            );

            assertEquals("nativeAuthLifecycleChanged:false", events.get(0));
            assertEquals("cancel:APP_BACKGROUNDED", events.get(1));

            SecPalNativeAuthPlugin.resumeAuthenticatedForLifecycle(
                taskExecutor,
                (event, payload) -> events.add(
                    event + ":" + payload.getBool("foreground")
                )
            );
            assertEquals("nativeAuthLifecycleChanged:true", events.get(2));
        } finally {
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void obsoleteApiBaseUrlMutationIsNotExportedToJavascript() {
        Set<String> exportedMethods = new java.util.HashSet<>();
        for (Method method : SecPalNativeAuthPlugin.class.getDeclaredMethods()) {
            if (method.getAnnotation(PluginMethod.class) != null) {
                exportedMethods.add(method.getName());
            }
        }

        assertFalse(exportedMethods.contains("setApiBaseUrl"));
        assertFalse(exportedMethods.contains("setRuntimeBootstrap"));
        assertFalse(exportedMethods.contains("clearRuntimeBootstrap"));
        assertTrue(exportedMethods.contains("confirmRuntimeBootstrap"));
        assertTrue(exportedMethods.contains("confirmRuntimeReset"));
        assertTrue(exportedMethods.contains("cancelRequest"));
    }

    @Test
    public void authenticatedRequestsRequireACallerVisibleCancellationIdentifier() {
        assertNull(SecPalNativeAuthPlugin.normalizeRequiredRequestId(null));
        assertNull(SecPalNativeAuthPlugin.normalizeRequiredRequestId("   "));
        assertEquals(
            "webview-request_42",
            SecPalNativeAuthPlugin.normalizeRequiredRequestId(" webview-request_42 ")
        );
    }

    @Test
    public void sessionTransitionsDoNotUseTheBackgroundErrorContract() {
        assertEquals(
            "NATIVE_AUTH_BACKGROUND",
            SecPalNativeAuthPlugin.submissionErrorCode(
                NativeAuthTaskExecutor.SubmitResult.BACKGROUNDED
            )
        );
        assertEquals(
            "NATIVE_AUTH_BUSY",
            SecPalNativeAuthPlugin.submissionErrorCode(
                NativeAuthTaskExecutor.SubmitResult.TRANSITION_IN_PROGRESS
            )
        );
    }

    @Test
    public void runtimeConfirmationMessageBindsTheCanonicalNativeOrigin() throws Exception {
        JSObject bootstrap = SecPalNativeAuthPlugin.buildRuntimeBootstrap(
            "Displayed tenant name",
            "https://customer.example:443/",
            "https://customer.example:443/v1",
            null,
            null
        );

        assertEquals(
            "Credentials for the current instance will be cleared before switching to "
                + "https://customer.example.",
            SecPalNativeAuthPlugin.formatRuntimeConfirmationMessage(
                "Credentials for the current instance will be cleared before switching to %1$s.",
                bootstrap.getString("apiOrigin")
            )
        );
    }

    @Test
    public void runtimeConfirmationAllowsOnlyOnePendingDecisionAndOneOutcome() {
        AtomicBoolean confirmationPending = new AtomicBoolean(false);
        AtomicBoolean decisionPending = new AtomicBoolean(true);

        assertTrue(SecPalNativeAuthPlugin.beginRuntimeConfirmation(confirmationPending));
        assertFalse(SecPalNativeAuthPlugin.beginRuntimeConfirmation(confirmationPending));
        assertTrue(SecPalNativeAuthPlugin.finishRuntimeConfirmation(
            decisionPending,
            confirmationPending
        ));
        assertFalse(SecPalNativeAuthPlugin.finishRuntimeConfirmation(
            decisionPending,
            confirmationPending
        ));
        assertFalse(confirmationPending.get());
    }

    @Test
    public void runtimeConfirmationAcceptsOnlyThePositiveButton() {
        assertTrue(SecPalNativeAuthPlugin.isConfirmedRuntimeButton(
            DialogInterface.BUTTON_POSITIVE
        ));
        assertFalse(SecPalNativeAuthPlugin.isConfirmedRuntimeButton(
            DialogInterface.BUTTON_NEGATIVE
        ));
        assertFalse(SecPalNativeAuthPlugin.isConfirmedRuntimeButton(
            DialogInterface.BUTTON_NEUTRAL
        ));
    }

    @Test
    public void runtimeRebindClearsTenantCredentialBeforePersistence() throws Exception {
        List<String> events = new ArrayList<>();
        RecordingTokenStorage tokenStorage = new RecordingTokenStorage(
            "tenant-a-token",
            events
        );

        assertTrue(SecPalNativeAuthPlugin.replaceRuntimeBootstrapStateWithRollback(
            "https://tenant-a.example",
            "https://tenant-b.example",
            tokenStorage,
            () -> {
                events.add("persist-runtime");
                return true;
            },
            () -> {
                events.add("restore-runtime");
                return true;
            },
            () -> events.add("apply-push")
        ));
        assertEquals(
            java.util.Arrays.asList(
                "read-token",
                "clear-token",
                "persist-runtime",
                "apply-push"
            ),
            events
        );
        assertNull(tokenStorage.token);
    }

    @Test
    public void runtimeRebindRestoresCredentialWhenPersistenceFails() throws Exception {
        List<String> events = new ArrayList<>();
        RecordingTokenStorage tokenStorage = new RecordingTokenStorage(
            "tenant-a-token",
            events
        );

        assertFalse(SecPalNativeAuthPlugin.replaceRuntimeBootstrapStateWithRollback(
            "https://tenant-a.example",
            "https://tenant-b.example",
            tokenStorage,
            () -> {
                events.add("persist-runtime");
                return false;
            },
            () -> {
                events.add("restore-runtime");
                return true;
            },
            () -> events.add("apply-push")
        ));

        assertEquals(
            java.util.Arrays.asList(
                "read-token",
                "clear-token",
                "persist-runtime",
                "restore-runtime",
                "save-token"
            ),
            events
        );
        assertEquals("tenant-a-token", tokenStorage.token);
    }

    @Test
    public void runtimeRebindKeepsCredentialClearedWhenFailedPersistenceCannotRollBack()
        throws Exception {
        List<String> events = new ArrayList<>();
        RecordingTokenStorage tokenStorage = new RecordingTokenStorage(
            "tenant-a-token",
            events
        );

        try {
            SecPalNativeAuthPlugin.replaceRuntimeBootstrapStateWithRollback(
                "https://tenant-a.example",
                "https://tenant-b.example",
                tokenStorage,
                () -> {
                    events.add("persist-runtime");
                    return false;
                },
                () -> {
                    events.add("restore-runtime");
                    return false;
                },
                () -> events.add("apply-push")
            );
            fail("Expected failed runtime rollback to fail closed");
        } catch (RuntimeException expected) {
            assertEquals("Failed to persist Android runtime bootstrap", expected.getMessage());
        }

        assertEquals(
            java.util.Arrays.asList(
                "read-token",
                "clear-token",
                "persist-runtime",
                "restore-runtime"
            ),
            events
        );
        assertNull(tokenStorage.token);
    }

    @Test
    public void runtimeRebindRestoresRuntimeAndCredentialWhenPushReplacementFails()
        throws Exception {
        List<String> events = new ArrayList<>();
        RecordingTokenStorage tokenStorage = new RecordingTokenStorage(
            "tenant-a-token",
            events
        );
        RuntimeException pushFailure = new RuntimeException("push-replacement-failed");

        try {
            SecPalNativeAuthPlugin.replaceRuntimeBootstrapStateWithRollback(
                "https://tenant-a.example",
                "https://tenant-b.example",
                tokenStorage,
                () -> {
                    events.add("persist-runtime");
                    return true;
                },
                () -> {
                    events.add("restore-runtime");
                    return true;
                },
                () -> {
                    events.add("apply-push");
                    throw pushFailure;
                }
            );
            fail("Expected push replacement failure");
        } catch (RuntimeException thrown) {
            assertEquals(pushFailure, thrown);
        }

        assertEquals(
            java.util.Arrays.asList(
                "read-token",
                "clear-token",
                "persist-runtime",
                "apply-push",
                "restore-runtime",
                "save-token"
            ),
            events
        );
        assertEquals("tenant-a-token", tokenStorage.token);
    }

    @Test
    public void runtimeRebindKeepsCredentialClearedWhenRuntimeRollbackFails()
        throws Exception {
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        tokenStorage.token = "tenant-a-token";
        RuntimeException pushFailure = new RuntimeException("push-replacement-failed");

        try {
            SecPalNativeAuthPlugin.replaceRuntimeBootstrapStateWithRollback(
                "https://tenant-a.example",
                "https://tenant-b.example",
                tokenStorage,
                () -> true,
                () -> false,
                () -> { throw pushFailure; }
            );
            fail("Expected push replacement failure");
        } catch (RuntimeException thrown) {
            assertEquals(pushFailure, thrown);
            assertEquals(1, thrown.getSuppressed().length);
        }

        assertNull(tokenStorage.token);
    }

    @Test
    public void runtimeRebindReportsCredentialRestoreFailureAfterRuntimeRollback() {
        RuntimeException pushFailure = new RuntimeException("push-replacement-failed");
        TokenStorage unrestorableTokenStorage = new TokenStorage() {
            @Override
            public void saveToken(String token) throws TokenStorageException {
                throw new TokenStorageException(
                    "Failed to restore Android auth token",
                    new IllegalStateException("keystore-unavailable")
                );
            }

            @Override
            public String getToken() {
                return "tenant-a-token";
            }

            @Override
            public void clearToken() {}
        };

        try {
            SecPalNativeAuthPlugin.replaceRuntimeBootstrapStateWithRollback(
                "https://tenant-a.example",
                "https://tenant-b.example",
                unrestorableTokenStorage,
                () -> true,
                () -> true,
                () -> { throw pushFailure; }
            );
            fail("Expected token restoration failure");
        } catch (TokenStorageException thrown) {
            assertEquals(1, thrown.getSuppressed().length);
            assertEquals(pushFailure, thrown.getSuppressed()[0]);
        }
    }

    @Test
    public void runtimeRebindRollsBackAfterPersistenceThrows() throws Exception {
        List<String> events = new ArrayList<>();
        RecordingTokenStorage tokenStorage = new RecordingTokenStorage(
            "tenant-a-token",
            events
        );
        RuntimeException persistenceFailure = new RuntimeException("persistence-failed");

        try {
            SecPalNativeAuthPlugin.replaceRuntimeBootstrapStateWithRollback(
                "https://tenant-a.example",
                "https://tenant-b.example",
                tokenStorage,
                () -> {
                    events.add("persist-runtime");
                    throw persistenceFailure;
                },
                () -> {
                    events.add("restore-runtime");
                    return true;
                },
                () -> events.add("apply-push")
            );
            fail("Expected persistence failure");
        } catch (RuntimeException thrown) {
            assertEquals(persistenceFailure, thrown);
        }

        assertEquals(
            java.util.Arrays.asList(
                "read-token",
                "clear-token",
                "persist-runtime",
                "restore-runtime",
                "save-token"
            ),
            events
        );
        assertEquals("tenant-a-token", tokenStorage.token);
    }

    @Test
    public void sameOriginRuntimeReplacementDoesNotTouchCredential() throws Exception {
        List<String> events = new ArrayList<>();
        RecordingTokenStorage tokenStorage = new RecordingTokenStorage(
            "tenant-a-token",
            events
        );

        assertTrue(SecPalNativeAuthPlugin.replaceRuntimeBootstrapStateWithRollback(
            "https://tenant-a.example",
            "https://tenant-a.example",
            tokenStorage,
            () -> {
                events.add("persist-runtime");
                return true;
            },
            () -> {
                events.add("restore-runtime");
                return true;
            },
            () -> events.add("apply-push")
        ));

        assertEquals(
            java.util.Arrays.asList("persist-runtime", "apply-push"),
            events
        );
        assertEquals("tenant-a-token", tokenStorage.token);
    }

    @Test
    public void runtimeRebindContinuesWhenPreviousCredentialCannotBeRead() throws Exception {
        List<String> events = new ArrayList<>();
        TokenStorage unreadableTokenStorage = new TokenStorage() {
            @Override
            public void saveToken(String token) {}

            @Override
            public String getToken() throws TokenStorageException {
                events.add("read-token");
                throw new TokenStorageException(
                    "Stored Android auth token cannot be decrypted",
                    new IllegalStateException("invalidated")
                );
            }

            @Override
            public void clearToken() {
                events.add("clear-token");
            }
        };

        assertTrue(
            SecPalNativeAuthPlugin.replaceRuntimeBootstrapStateWithRollback(
                "https://tenant-a.example",
                "https://tenant-b.example",
                unreadableTokenStorage,
                () -> {
                    events.add("persist-runtime");
                    return true;
                },
                () -> {
                    events.add("restore-runtime");
                    return true;
                },
                () -> events.add("apply-push")
            )
        );
        assertEquals(
            java.util.Arrays.asList(
                "read-token",
                "clear-token",
                "persist-runtime",
                "apply-push"
            ),
            events
        );
    }

    @Test
    public void resolveErrorCodeUsesHttpStatusWhenPresent() {
        assertEquals(
            "HTTP_401",
            SecPalNativeAuthPlugin.resolveErrorCode(new NativeAuthHttpException("Unauthenticated", 401))
        );
    }

    @Test
    public void resolveErrorCodeUsesValidationFallbackWhenStatusIsZero() {
        assertEquals(
            "VALIDATION_ERROR",
            SecPalNativeAuthPlugin.resolveErrorCode(new NativeAuthHttpException("Invalid", 0))
        );
    }

    @Test
    public void resolveErrorCodePreservesStableTransportTimeout() {
        assertEquals(
            "REQUEST_TIMEOUT",
            SecPalNativeAuthPlugin.resolveErrorCode(
                new NativeAuthHttpClient.NativeAuthCancelledException(
                    "REQUEST_TIMEOUT",
                    null
                )
            )
        );
    }

    @Test
    public void resolveErrorCodeIgnoresNonHttpExceptions() {
        assertNull(SecPalNativeAuthPlugin.resolveErrorCode(new IllegalStateException("boom")));
    }

    @Test
    public void resolveErrorCodeUsesNetworkOfflineForMissingConnectivity() {
        assertEquals(
            "NETWORK_OFFLINE",
            SecPalNativeAuthPlugin.resolveErrorCode(
                new NetworkUnavailableException("Android auth requires an active internet connection")
            )
        );
    }

    @Test
    public void resolveErrorCodePreservesPasskeyErrorCodes() {
        assertEquals(
            "PASSKEY_CANCELLED",
            SecPalNativeAuthPlugin.resolveErrorCode(
                new PasskeyAuthenticationException("Passkey sign-in was cancelled.", "PASSKEY_CANCELLED")
            )
        );
    }

    @Test
    public void resolveRuntimeBootstrapErrorCodeHandlesKnownAndFallbackFailures() {
        assertEquals(
            "INSECURE_API_BASE_URL",
            SecPalNativeAuthPlugin.resolveRuntimeBootstrapErrorCode(
                new SecPalNativeAuthPlugin.ConfiguredApiBaseUrlException(
                    "Android auth API origin must use HTTPS",
                    "INSECURE_API_BASE_URL"
                )
            )
        );
        assertEquals(
            "RUNTIME_BOOTSTRAP_INVALID",
            SecPalNativeAuthPlugin.resolveRuntimeBootstrapErrorCode(
                new SecPalNativeAuthPlugin.InvalidRuntimeBootstrapException(
                    "Android runtime bootstrap is invalid",
                    "RUNTIME_BOOTSTRAP_INVALID"
                )
            )
        );
        assertEquals(
            "RUNTIME_BOOTSTRAP_INVALID",
            SecPalNativeAuthPlugin.resolveRuntimeBootstrapErrorCode(new IllegalStateException("boom"))
        );
        assertEquals(
            "RUNTIME_BOOTSTRAP_INVALID",
            SecPalNativeAuthPlugin.resolveRuntimeBootstrapErrorCode(new NullPointerException("firebase-internal"))
        );
    }

    @Test
    public void vaultRootKeyBridgeStaysDisabledForWebViewJavascript() {
        assertFalse(SecPalNativeAuthPlugin.isVaultRootKeyBridgeEnabledForWebView());
    }

    @Test
    public void vaultRootKeyWrapperAvailabilityStaysDisabledForWebViewJavascript() {
        assertTrue(
            SecPalNativeAuthPlugin.isVaultDeviceBoundWrapperAvailableForWebView(true, true)
        );
        assertFalse(
            SecPalNativeAuthPlugin.isVaultDeviceBoundWrapperAvailableForWebView(false, true)
        );
        assertFalse(
            SecPalNativeAuthPlugin.isVaultDeviceBoundWrapperAvailableForWebView(true, false)
        );
    }

    @Test
    public void resolveConfiguredApiBaseUrlNormalizesConfiguredOrigin() {
        assertEquals(
            "https://api.secpal.dev",
            SecPalNativeAuthPlugin.resolveConfiguredApiBaseUrl(" https://api.secpal.dev/ ")
        );
    }

    @Test
    public void resolveConfiguredApiBaseUrlFailsFastForInvalidOrigin() {
        try {
            SecPalNativeAuthPlugin.resolveConfiguredApiBaseUrl("https://api.secpal.dev@evil.example");
            fail("Expected IllegalStateException");
        } catch (IllegalStateException exception) {
            assertEquals("Invalid Android auth API origin configuration", exception.getMessage());
            assertTrue(exception.getCause() instanceof NativeAuthHttpException);
        }
    }

    @Test
    public void resolveRuntimeApiBaseUrlRejectsInsecureHttpOrigin() {
        try {
            SecPalNativeAuthPlugin.resolveRuntimeApiBaseUrl("http://api.secpal.dev");
            fail("Expected ConfiguredApiBaseUrlException");
        } catch (SecPalNativeAuthPlugin.ConfiguredApiBaseUrlException exception) {
            assertEquals("Android auth API origin must use HTTPS", exception.getMessage());
            assertEquals("INSECURE_API_BASE_URL", exception.getErrorCode());
        }
    }

    @Test
    public void normalizeRuntimeBootstrapDerivesCanonicalApiOriginFromRawApiBaseUrl() throws Exception {
        JSObject normalized = SecPalNativeAuthPlugin.normalizeRuntimeBootstrap(
            new JSONObject()
                .put("instanceDisplayName", "Tenant A")
                .put("rawApiBaseUrl", "https://tenant-a.example/v1")
                .put("features", new JSONObject().put("passwordLoginEnabled", true))
        );

        assertEquals("https://tenant-a.example", normalized.getString("apiOrigin"));
        assertEquals("https://tenant-a.example/v1", normalized.getString("rawApiBaseUrl"));
        assertFalse(normalized.has("minimumSupportedAppVersion"));
        assertFalse(normalized.has("minimumSupportedAppBuild"));
        assertTrue(normalized.getJSONObject("features").getBoolean("passwordLoginEnabled"));
        assertFalse(normalized.getJSONObject("features").getBoolean("passkeyLoginEnabled"));
        assertFalse(normalized.getJSONObject("features").has("managedAndroidEnrollment"));
    }

    @Test
    public void normalizeRuntimeBootstrapPreservesValidatedAndroidPushMetadata() throws Exception {
        JSObject normalized = SecPalNativeAuthPlugin.normalizeRuntimeBootstrap(
            new JSONObject()
                .put("instanceDisplayName", "Tenant A")
                .put("rawApiBaseUrl", "https://tenant-a.example/v1")
                .put(
                    "androidPush",
                    new JSONObject()
                        .put("provider", "fcm")
                        .put("metadataRevision", 3)
                        .put(
                            "publicClientMetadata",
                            new JSONObject()
                                .put("apiKey", "public-client-api-key-demo-1234567890")
                                .put("projectId", "secpal-demo-push")
                                .put("applicationId", "1:1234567890:android:abcdef1234567890")
                                .put("senderId", "1234567890")
                        )
                )
        );

        JSONObject androidPush = normalized.getJSONObject("androidPush");

        assertNotNull(androidPush);
        assertEquals("fcm", androidPush.getString("provider"));
        assertEquals(3, androidPush.getInt("metadataRevision"));
        assertEquals(
            "public-client-api-key-demo-1234567890",
            androidPush.getJSONObject("publicClientMetadata").getString("apiKey")
        );
        assertEquals(
            "1234567890",
            androidPush.getJSONObject("publicClientMetadata").getString("senderId")
        );
    }

    @Test
    public void normalizeRuntimeBootstrapRejectsIncompleteAndroidPushMetadata() throws Exception {
        try {
            SecPalNativeAuthPlugin.normalizeRuntimeBootstrap(
                new JSONObject()
                    .put("instanceDisplayName", "Tenant A")
                    .put("rawApiBaseUrl", "https://tenant-a.example/v1")
                    .put(
                        "androidPush",
                        new JSONObject()
                            .put("provider", "fcm")
                            .put("metadataRevision", 3)
                            .put(
                                "publicClientMetadata",
                                new JSONObject()
                                    .put("apiKey", "public-client-api-key-demo-1234567890")
                                    .put("projectId", "secpal-demo-push")
                                    .put("applicationId", "1:1234567890:android:abcdef1234567890")
                            )
                    )
            );
            fail("Expected InvalidRuntimeBootstrapException");
        } catch (SecPalNativeAuthPlugin.InvalidRuntimeBootstrapException exception) {
            assertEquals(
                "Android runtime bootstrap requires complete Android push client metadata",
                exception.getMessage()
            );
            assertEquals("RUNTIME_BOOTSTRAP_INVALID", exception.getErrorCode());
        }
    }

    @Test
    public void normalizeRuntimeBootstrapRejectsAndroidPushMetadataRevisionStringOverflow()
        throws Exception {
        try {
            SecPalNativeAuthPlugin.normalizeRuntimeBootstrap(
                new JSONObject()
                    .put("instanceDisplayName", "Tenant A")
                    .put("rawApiBaseUrl", "https://tenant-a.example/v1")
                    .put(
                        "androidPush",
                        new JSONObject()
                            .put("provider", "fcm")
                            .put("metadataRevision", "9999999999")
                            .put(
                                "publicClientMetadata",
                                new JSONObject()
                                    .put("apiKey", "public-client-api-key-demo-1234567890")
                                    .put("projectId", "secpal-demo-push")
                                    .put("applicationId", "1:1234567890:android:abcdef1234567890")
                                    .put("senderId", "1234567890")
                            )
                    )
            );
            fail("Expected InvalidRuntimeBootstrapException");
        } catch (SecPalNativeAuthPlugin.InvalidRuntimeBootstrapException exception) {
            assertEquals(
                "Android runtime bootstrap requires a positive Android push metadata revision",
                exception.getMessage()
            );
            assertEquals("RUNTIME_BOOTSTRAP_INVALID", exception.getErrorCode());
        }
    }

    @Test
    public void buildRuntimeBootstrapPayloadUsesPersistedBootstrapWhenAvailable() throws Exception {
        JSObject bootstrap = SecPalNativeAuthPlugin.normalizeRuntimeBootstrap(
            new JSONObject()
                .put("instanceDisplayName", "Tenant A")
                .put("rawApiBaseUrl", "https://tenant-a.example/v1")
        );

        JSObject payload = SecPalNativeAuthPlugin.buildRuntimeBootstrapPayload(bootstrap);

        assertTrue(payload.getBoolean("configured"));
        assertEquals(
            "https://tenant-a.example",
            payload.getJSONObject("bootstrap").getString("apiOrigin")
        );
        assertNull(payload.opt("apiOrigin"));
    }

    @Test
    public void buildRuntimeBootstrapPayloadLeavesRuntimeUnconfiguredWithoutPersistedBootstrap()
        throws Exception {
        JSObject payload = SecPalNativeAuthPlugin.buildRuntimeBootstrapPayload(null);

        assertFalse(payload.getBoolean("configured"));
        assertNull(payload.opt("apiOrigin"));
        assertNull(payload.opt("bootstrap"));
    }

    @Test
    public void loadPersistedRuntimeBootstrapReturnsNullWhenOnlyLegacyApiBaseUrlKeyExists() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        preferences.edit()
            .putString("api_base_url", "https://tenant-a.example")
            .commit();

        JSObject result = SecPalNativeAuthPlugin.loadPersistedRuntimeBootstrap(preferences);

        assertNull(result);
    }

    @Test
    public void loadPersistedRuntimeBootstrapRestoresStructuredBootstrapFromPreferences()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        JSObject stored = SecPalNativeAuthPlugin.normalizeRuntimeBootstrap(
            new JSONObject()
                .put("instanceDisplayName", "Tenant A")
                .put("rawApiBaseUrl", "https://tenant-a.example/v1")
        );
        preferences.edit()
            .putString("runtime_bootstrap", stored.toString())
            .commit();

        JSObject result = SecPalNativeAuthPlugin.loadPersistedRuntimeBootstrap(preferences);

        assertNotNull(result);
        assertEquals("https://tenant-a.example", result.getString("apiOrigin"));
        assertEquals("Tenant A", result.getString("instanceDisplayName"));
    }

    @Test
    public void loadPersistedRuntimeBootstrapDiscardsObsoleteSchemaMarkers() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        JSONObject stored = new JSONObject()
            .put("instanceDisplayName", "Tenant A")
            .put("rawApiBaseUrl", "https://tenant-a.example/v1")
            .put("minimumSupportedAppVersion", "0.0.1")
            .put("minimumSupportedAppBuild", 1)
            .put("schemaVersion", 3)
            .put("schema_version", 3);
        preferences.edit()
            .putString("runtime_bootstrap", stored.toString())
            .commit();

        JSObject result = SecPalNativeAuthPlugin.loadPersistedRuntimeBootstrap(preferences);

        assertNotNull(result);
        assertEquals("https://tenant-a.example", result.getString("apiOrigin"));
        assertEquals("Tenant A", result.getString("instanceDisplayName"));
        assertFalse(result.has("schemaVersion"));
        assertFalse(result.has("schema_version"));
        assertFalse(result.has("minimumSupportedAppVersion"));
        assertFalse(result.has("minimumSupportedAppBuild"));
    }

    @Test
    public void loadPersistedRuntimeBootstrapSelfHealsCorruptBootstrapJson() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        preferences.edit()
            .putString("runtime_bootstrap", "{not valid json}")
            .commit();

        JSObject result = SecPalNativeAuthPlugin.loadPersistedRuntimeBootstrap(preferences);

        assertNull(result);
        assertNull(preferences.getString("runtime_bootstrap", null));
    }

    @Test
    public void restoreRuntimeBootstrapPersistenceRollsBackPreviousDeploymentStateSynchronously() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();

        preferences.edit()
            .putString("runtime_bootstrap", "{\"apiOrigin\":\"https://tenant-a.example\"}")
            .putString("api_base_url", "https://tenant-a.example")
            .commit();

        preferences.edit()
            .putString("runtime_bootstrap", "{\"apiOrigin\":\"https://tenant-b.example\"}")
            .remove("api_base_url")
            .commit();

        assertTrue(
            SecPalNativeAuthPlugin.restoreRuntimeBootstrapPersistenceSynchronously(
                preferences,
                "{\"apiOrigin\":\"https://tenant-a.example\"}",
                "https://tenant-a.example"
            )
        );

        assertEquals(
            "{\"apiOrigin\":\"https://tenant-a.example\"}",
            preferences.getString("runtime_bootstrap", null)
        );
        assertEquals("https://tenant-a.example", preferences.getString("api_base_url", null));
        assertEquals(0, preferences.applyCallCount);
    }

    @Test
    public void applyPersistedRuntimeBootstrapSelfHealsFirebaseInitializationFailures()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        JSObject stored = SecPalNativeAuthPlugin.normalizeRuntimeBootstrap(
            new JSONObject()
                .put("instanceDisplayName", "Tenant A")
                .put("rawApiBaseUrl", "https://tenant-a.example/v1")
                .put(
                    "androidPush",
                    new JSONObject()
                        .put("provider", "fcm")
                        .put("metadataRevision", 3)
                        .put(
                            "publicClientMetadata",
                            new JSONObject()
                                .put("apiKey", "public-client-api-key-demo-1234567890")
                                .put("projectId", "secpal-demo-push")
                                .put("applicationId", "1:1234567890:android:abcdef1234567890")
                                .put("senderId", "1234567890")
                        )
                )
        );
        preferences.edit()
            .putString("runtime_bootstrap", stored.toString())
            .putString("api_base_url", "https://tenant-a.example")
            .commit();
        tokenStorage.token = "tenant-a-token";
        ThrowingFirebaseBackend firebaseBackend = new ThrowingFirebaseBackend();

        JSObject result = SecPalNativeAuthPlugin.applyPersistedRuntimeBootstrap(
            preferences,
            tokenStorage,
            new AndroidPushRuntimeManager(firebaseBackend),
            stored
        );

        assertNull(result);
        assertNull(preferences.getString("runtime_bootstrap", null));
        assertNull(preferences.getString("api_base_url", null));
        assertNull(tokenStorage.token);
        assertEquals(
            "Load-time Firebase failures should clear the persisted bootstrap asynchronously.",
            1,
            preferences.applyCallCount
        );
        assertEquals(1, firebaseBackend.initializeCallCount);
        assertEquals(2, firebaseBackend.findRuntimeAppCallCount);
    }

    @Test
    public void persistedPushRuntimeApplicationIsScheduledOffTheCallingThread() {
        AtomicBoolean applyCalled = new AtomicBoolean(false);
        AtomicBoolean completionCalled = new AtomicBoolean(false);
        AtomicReference<Runnable> scheduled = new AtomicReference<>();
        AndroidPushRuntimeManager.FirebaseBackend firebaseBackend =
            new AndroidPushRuntimeManager.FirebaseBackend() {
                @Override
                public AndroidPushRuntimeManager.FirebaseAppHandle findRuntimeApp() {
                    applyCalled.set(true);
                    return null;
                }

                @Override
                public AndroidPushRuntimeManager.FirebaseAppHandle initialize(
                    AndroidPushRuntimeMetadata metadata
                ) {
                    fail("Disabled push must not initialize Firebase");
                    return null;
                }

                @Override
                public void cancelPendingTokenRequest() {}

                @Override
                public void ensureMessaging(AndroidPushRuntimeManager.FirebaseAppHandle app) {
                    fail("Disabled push must not request a token");
                }

                @Override
                public void rotateMessagingToken(
                    AndroidPushRuntimeManager.FirebaseAppHandle app
                ) {
                    fail("Disabled push must not rotate a token");
                }

                @Override
                public void deleteMessagingToken(
                    AndroidPushRuntimeManager.FirebaseAppHandle app
                ) {
                    fail("No Firebase runtime exists to delete");
                }
            };

        SecPalNativeAuthPlugin.schedulePersistedRuntimeBootstrapApplication(
            scheduled::set,
            new InMemorySharedPreferences(),
            new FakeTokenStorage(),
            new AndroidPushRuntimeManager(firebaseBackend),
            null,
            bootstrap -> completionCalled.set(true)
        );

        assertFalse("Firebase work must not run inline during plugin load", applyCalled.get());
        assertFalse(completionCalled.get());
        assertNotNull(scheduled.get());

        scheduled.get().run();

        assertTrue(applyCalled.get());
        assertTrue(completionCalled.get());
    }

    @Test
    public void messagingListenerNeverForwardsRawTokenToTheWebView() {
        final boolean[] notified = { false };
        AndroidPushRuntimeManager.MessagingListener listener =
            SecPalNativeAuthPlugin.buildAndroidPushMessagingListener(
                () -> false,
                (event, payload) -> notified[0] = true
            );

        listener.onTokenReceived("secpal-runtime-push", "fcm-token-demo");

        assertFalse("Raw push tokens must remain native-only", notified[0]);
    }

    @Test
    public void messagingListenerSuppressesTokenEventAfterDestroyed() {
        final boolean[] notified = { false };
        AndroidPushRuntimeManager.MessagingListener listener =
            SecPalNativeAuthPlugin.buildAndroidPushMessagingListener(
                () -> true,
                (event, payload) -> notified[0] = true
            );

        listener.onTokenReceived("secpal-runtime-push", "fcm-token-demo");

        assertFalse(
            "Token callback must be suppressed after plugin is destroyed",
            notified[0]
        );
    }

    @Test
    public void messagingListenerSuppressesTokenErrorAfterDestroyed() {
        final boolean[] notified = { false };
        AndroidPushRuntimeManager.MessagingListener listener =
            SecPalNativeAuthPlugin.buildAndroidPushMessagingListener(
                () -> true,
                (event, payload) -> notified[0] = true
            );

        listener.onTokenError("secpal-runtime-push", new RuntimeException("token-failure"));

        assertFalse(
            "Error callback must be suppressed after plugin is destroyed",
            notified[0]
        );
    }

    @Test
    public void shouldClearStoredTokenUnlessRuntimeOriginIsAlreadyBoundToSameTenant() {
        assertTrue(
            SecPalNativeAuthPlugin.shouldClearStoredToken(
                "https://tenant-a.example",
                "https://tenant-b.example"
            )
        );
        assertFalse(
            SecPalNativeAuthPlugin.shouldClearStoredToken(
                "https://tenant-a.example",
                "https://tenant-a.example"
            )
        );
        assertTrue(SecPalNativeAuthPlugin.shouldClearStoredToken(null, "https://tenant-a.example"));
    }

    @Test
    public void clearRejectedLegacyRuntimeStateClearsLegacyOriginAndToken() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();

        preferences.edit()
            .putString("api_base_url", "https://tenant-a.example")
            .commit();
        tokenStorage.token = "tenant-a-token";

        SecPalNativeAuthPlugin.clearRejectedLegacyRuntimeState(preferences, tokenStorage);

        assertNull(preferences.getString("api_base_url", null));
        assertNull(tokenStorage.token);
        assertEquals(
            "Legacy cleanup should use apply() because load() cannot surface persistence failures.",
            1,
            preferences.applyCallCount
        );
    }

    @Test
    public void clearRejectedLegacyRuntimeStateIsNoOpWithoutLegacyOrigin() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        tokenStorage.token = "tenant-a-token";

        SecPalNativeAuthPlugin.clearRejectedLegacyRuntimeState(preferences, tokenStorage);

        assertNull(preferences.getString("api_base_url", null));
        assertEquals("tenant-a-token", tokenStorage.token);
        assertEquals(0, preferences.applyCallCount);
    }

    @Test
    public void clearRuntimeBootstrapStateRemovesTenantScopedRuntimeData() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();

        preferences.edit()
            .putString("runtime_bootstrap", "{\"apiOrigin\":\"https://tenant-a.example\"}")
            .putString("api_base_url", "https://tenant-a.example")
            .putString("keep_me", "value")
            .commit();
        tokenStorage.token = "tenant-a-token";

        assertTrue(
            SecPalNativeAuthPlugin.clearRuntimeBootstrapState(
                preferences,
                tokenStorage
            )
        );

        assertNull(preferences.getString("runtime_bootstrap", null));
        assertNull(preferences.getString("api_base_url", null));
        assertEquals("value", preferences.getString("keep_me", null));
        assertNull(tokenStorage.token);
    }

    @Test
    public void clearRuntimeBootstrapStatePreservesRuntimeDataWhenCommitFails() {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();

        preferences.edit()
            .putString("runtime_bootstrap", "{\"apiOrigin\":\"https://tenant-a.example\"}")
            .putString("api_base_url", "https://tenant-a.example")
            .commit();
        tokenStorage.token = "tenant-a-token";
        preferences.failNextCommit = true;

        assertFalse(
            SecPalNativeAuthPlugin.clearRuntimeBootstrapState(
                preferences,
                tokenStorage
            )
        );

        assertEquals(
            "{\"apiOrigin\":\"https://tenant-a.example\"}",
            preferences.getString("runtime_bootstrap", null)
        );
        assertEquals("https://tenant-a.example", preferences.getString("api_base_url", null));
        assertEquals(
            "Token must be preserved when preferences commit() fails so native state stays consistent.",
            "tenant-a-token",
            tokenStorage.token
        );
        assertEquals(
            "Async apply() must not silently retry after a failed commit() that already rejected the caller.",
            0,
            preferences.applyCallCount
        );
    }

    @Test
    public void clearRuntimeBootstrapStateRollsBackWhenPushCleanupFails() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        RuntimeException pushCleanupFailure = new RuntimeException("push-cleanup-failed");

        preferences.edit()
            .putString("runtime_bootstrap", "{\"apiOrigin\":\"https://tenant-a.example\"}")
            .putString("api_base_url", "https://tenant-a.example")
            .commit();
        tokenStorage.token = "tenant-a-token";

        try {
            SecPalNativeAuthPlugin.clearRuntimeBootstrapStateWithPushRollback(
                preferences,
                tokenStorage,
                tokenStorage.token,
                () -> { throw pushCleanupFailure; }
            );
            fail("Expected push cleanup failure");
        } catch (RuntimeException thrown) {
            assertEquals(pushCleanupFailure, thrown);
        }

        assertEquals(
            "{\"apiOrigin\":\"https://tenant-a.example\"}",
            preferences.getString("runtime_bootstrap", null)
        );
        assertEquals("https://tenant-a.example", preferences.getString("api_base_url", null));
        assertEquals("tenant-a-token", tokenStorage.token);
    }

    @Test
    public void clearRuntimeBootstrapStateRestoresPushRuntimeWhenResetFails() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        ResetFailingFirebaseBackend firebaseBackend = new ResetFailingFirebaseBackend();
        AndroidPushRuntimeManager pushRuntimeManager = new AndroidPushRuntimeManager(firebaseBackend);
        AndroidPushRuntimeMetadata previousPushRuntime = new AndroidPushRuntimeMetadata(
            "fcm", 3, "old-api-key", "old-project", "old-app", "old-sender"
        );

        preferences.edit()
            .putString("runtime_bootstrap", "{\"apiOrigin\":\"https://tenant-a.example\"}")
            .putString("api_base_url", "https://tenant-a.example")
            .commit();
        tokenStorage.token = "tenant-a-token";

        try {
            SecPalNativeAuthPlugin.clearRuntimeBootstrapStateWithPushRollback(
                preferences,
                tokenStorage,
                tokenStorage.token,
                pushRuntimeManager,
                previousPushRuntime
            );
            fail("Expected push reset failure");
        } catch (RuntimeException thrown) {
            assertEquals("push-reset-failed", thrown.getMessage());
        }

        assertEquals(
            "{\"apiOrigin\":\"https://tenant-a.example\"}",
            preferences.getString("runtime_bootstrap", null)
        );
        assertEquals("tenant-a-token", tokenStorage.token);
        assertEquals(1, firebaseBackend.initializeCallCount);
        assertEquals(previousPushRuntime, firebaseBackend.lastInitializedMetadata);
        assertEquals(1, firebaseBackend.ensureMessagingCallCount);
        assertEquals(1, firebaseBackend.deleteMessagingTokenCallCount);
    }

    @Test
    public void clearRuntimeBootstrapStateKeepsCredentialClearedWhenRollbackFails()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        RuntimeException pushCleanupFailure = new RuntimeException("push-cleanup-failed");

        preferences.edit()
            .putString("runtime_bootstrap", "{\"apiOrigin\":\"https://tenant-a.example\"}")
            .putString("api_base_url", "https://tenant-a.example")
            .commit();
        tokenStorage.token = "tenant-a-token";

        try {
            SecPalNativeAuthPlugin.clearRuntimeBootstrapStateWithPushRollback(
                preferences,
                tokenStorage,
                tokenStorage.token,
                () -> {
                    preferences.failNextCommit = true;
                    throw pushCleanupFailure;
                }
            );
            fail("Expected push cleanup failure");
        } catch (RuntimeException thrown) {
            assertEquals(pushCleanupFailure, thrown);
            assertEquals(1, thrown.getSuppressed().length);
        }

        assertEquals(
            "{\"apiOrigin\":\"https://tenant-a.example\"}",
            preferences.getString("runtime_bootstrap", null)
        );
        assertEquals("https://tenant-a.example", preferences.getString("api_base_url", null));
        assertNull(tokenStorage.token);
    }

    @Test
    public void clearRuntimeBootstrapStatePreservesPushFailureWhenRollbackThrows()
        throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        FakeTokenStorage tokenStorage = new FakeTokenStorage();
        RuntimeException pushCleanupFailure = new RuntimeException("push-cleanup-failed");
        RuntimeException rollbackFailure = new RuntimeException("rollback-failed");

        preferences.edit()
            .putString("runtime_bootstrap", "{\"apiOrigin\":\"https://tenant-a.example\"}")
            .putString("api_base_url", "https://tenant-a.example")
            .commit();
        tokenStorage.token = "tenant-a-token";

        try {
            SecPalNativeAuthPlugin.clearRuntimeBootstrapStateWithPushRollback(
                preferences,
                tokenStorage,
                tokenStorage.token,
                () -> {
                    preferences.nextCommitFailure = rollbackFailure;
                    throw pushCleanupFailure;
                }
            );
            fail("Expected push cleanup failure");
        } catch (RuntimeException thrown) {
            assertEquals(pushCleanupFailure, thrown);
            assertEquals(1, thrown.getSuppressed().length);
            assertEquals(rollbackFailure, thrown.getSuppressed()[0]);
        }

        assertNull(tokenStorage.token);
    }

    @Test
    public void runtimeResetContinuesWhenStoredCredentialCannotBeRead() throws Exception {
        InMemorySharedPreferences preferences = new InMemorySharedPreferences();
        AtomicBoolean pushCleanupCalled = new AtomicBoolean(false);
        TokenStorage unreadableTokenStorage = new TokenStorage() {
            @Override
            public void saveToken(String token) {}

            @Override
            public String getToken() throws TokenStorageException {
                clearToken();
                throw new TokenStorageException(
                    "Stored Android auth token cannot be decrypted",
                    new IllegalStateException("invalidated")
                );
            }

            @Override
            public void clearToken() {}
        };

        preferences.edit()
            .putString("runtime_bootstrap", "{\"apiOrigin\":\"https://tenant-a.example\"}")
            .putString("api_base_url", "https://tenant-a.example")
            .commit();

        String token = SecPalNativeAuthPlugin.readStoredTokenForRuntimeMutation(
            unreadableTokenStorage
        );
        assertNull(token);
        assertTrue(
            SecPalNativeAuthPlugin.clearRuntimeBootstrapStateWithPushRollback(
                preferences,
                unreadableTokenStorage,
                token,
                () -> pushCleanupCalled.set(true)
            )
        );

        assertTrue(pushCleanupCalled.get());
        assertNull(preferences.getString("runtime_bootstrap", null));
        assertNull(preferences.getString("api_base_url", null));
    }


    @Test
    public void completedNativeRuntimeClearIgnoresBestEffortAuthenticationRevocationFailure() {
        AtomicBoolean logoutCalled = new AtomicBoolean(false);

        SecPalNativeAuthPlugin.revokeNativeAuthenticationAfterRuntimeClear(
            "rejected-token",
            "https://tenant-a.example",
            (apiOrigin, token) -> {
                logoutCalled.set(true);
                throw new NativeAuthHttpException("Unauthenticated", 401);
            }
        );

        assertTrue(logoutCalled.get());
    }

    @Test
    public void nativeLogoutClearsTheCredentialWithoutWaitingForPushCleanup() {
        List<String> events = new ArrayList<>();
        RecordingTokenStorage tokenStorage = new RecordingTokenStorage(
            "stored-token",
            events
        );

        SecPalNativeAuthPlugin.clearNativeCredentialForLogout(tokenStorage);

        assertEquals(Arrays.asList("clear-token"), events);
        assertNull(tokenStorage.token);
    }

    private static void assertRuntimeBootstrapInvalid(
        String instanceDisplayName,
        String rawApiBaseUrl
    ) throws Exception {
        try {
            SecPalNativeAuthPlugin.normalizeRuntimeBootstrap(
                new JSONObject()
                    .put("instanceDisplayName", instanceDisplayName)
                    .put("rawApiBaseUrl", rawApiBaseUrl)
            );
            fail("Expected InvalidRuntimeBootstrapException");
        } catch (SecPalNativeAuthPlugin.InvalidRuntimeBootstrapException expected) {
            assertEquals("RUNTIME_BOOTSTRAP_INVALID", expected.getErrorCode());
        }
    }

    private static final class FakeTokenStorage implements TokenStorage {
        private String token;

        @Override
        public void saveToken(String token) {
            this.token = token;
        }

        @Override
        public String getToken() {
            return token;
        }

        @Override
        public void clearToken() {
            token = null;
        }
    }

    private static final class RecordingTokenStorage implements TokenStorage {
        private String token;
        private final List<String> events;

        private RecordingTokenStorage(String token, List<String> events) {
            this.token = token;
            this.events = events;
        }

        @Override
        public void saveToken(String token) {
            events.add("save-token");
            this.token = token;
        }

        @Override
        public String getToken() {
            events.add("read-token");
            return token;
        }

        @Override
        public void clearToken() {
            events.add("clear-token");
            token = null;
        }
    }

    private static final class ThrowingFirebaseBackend implements AndroidPushRuntimeManager.FirebaseBackend {
        private int findRuntimeAppCallCount;
        private int initializeCallCount;

        @Override
        public AndroidPushRuntimeManager.FirebaseAppHandle findRuntimeApp() {
            findRuntimeAppCallCount += 1;
            return null;
        }

        @Override
        public AndroidPushRuntimeManager.FirebaseAppHandle initialize(AndroidPushRuntimeMetadata metadata) {
            initializeCallCount += 1;
            throw new IllegalStateException("Failed to initialize Android push runtime from deployment metadata");
        }

        @Override
        public void cancelPendingTokenRequest() {}

        @Override
        public void ensureMessaging(AndroidPushRuntimeManager.FirebaseAppHandle app) {
            fail("ensureMessaging should not run after initialization fails");
        }

        @Override
        public void rotateMessagingToken(AndroidPushRuntimeManager.FirebaseAppHandle app) {
            fail("rotateMessagingToken should not run after initialization fails");
        }

        @Override
        public void deleteMessagingToken(AndroidPushRuntimeManager.FirebaseAppHandle app) {
            fail("deleteMessagingToken is not part of this initialization test");
        }
    }

    private static final class ResetFailingFirebaseBackend
        implements AndroidPushRuntimeManager.FirebaseBackend {
        private AndroidPushRuntimeManager.FirebaseAppHandle existingApp = new AndroidPushRuntimeManager.FirebaseAppHandle() {
            @Override
            public String getName() {
                return "secpal-runtime-push";
            }

            @Override
            public void delete() {
                existingApp = null;
                throw new IllegalStateException("push-reset-failed");
            }
        };
        private int initializeCallCount;
        private int ensureMessagingCallCount;
        private int deleteMessagingTokenCallCount;
        private AndroidPushRuntimeMetadata lastInitializedMetadata;

        @Override
        public AndroidPushRuntimeManager.FirebaseAppHandle findRuntimeApp() {
            return existingApp;
        }

        @Override
        public AndroidPushRuntimeManager.FirebaseAppHandle initialize(
            AndroidPushRuntimeMetadata metadata
        ) {
            initializeCallCount += 1;
            lastInitializedMetadata = metadata;
            existingApp = new AndroidPushRuntimeManager.FirebaseAppHandle() {
                @Override
                public String getName() {
                    return "secpal-runtime-push";
                }

                @Override
                public void delete() {
                    existingApp = null;
                }
            };
            return existingApp;
        }

        @Override
        public void cancelPendingTokenRequest() {}

        @Override
        public void ensureMessaging(AndroidPushRuntimeManager.FirebaseAppHandle app) {
            ensureMessagingCallCount += 1;
        }

        @Override
        public void rotateMessagingToken(AndroidPushRuntimeManager.FirebaseAppHandle app) {
            fail("rotateMessagingToken is not part of this reset test");
        }

        @Override
        public void deleteMessagingToken(AndroidPushRuntimeManager.FirebaseAppHandle app) {
            deleteMessagingTokenCallCount += 1;
        }
    }

    private static final class InMemorySharedPreferences implements SharedPreferences {
        private final Map<String, String> values = new HashMap<>();
        private boolean failNextCommit;
        private RuntimeException nextCommitFailure;
        private int applyCallCount;

        @Override
        public Map<String, ?> getAll() { return values; }

        @Override
        public String getString(String key, String defValue) { return values.getOrDefault(key, defValue); }

        @Override
        public Set<String> getStringSet(String key, Set<String> defValues) { throw new UnsupportedOperationException(); }

        @Override
        public int getInt(String key, int defValue) { throw new UnsupportedOperationException(); }

        @Override
        public long getLong(String key, long defValue) { throw new UnsupportedOperationException(); }

        @Override
        public float getFloat(String key, float defValue) { throw new UnsupportedOperationException(); }

        @Override
        public boolean getBoolean(String key, boolean defValue) { throw new UnsupportedOperationException(); }

        @Override
        public boolean contains(String key) { return values.containsKey(key); }

        @Override
        public Editor edit() {
            final Map<String, String> pending = new HashMap<>(values);
            final boolean[] cleared = { false };
            return new Editor() {
                @Override
                public Editor putString(String key, String value) { pending.put(key, value); return this; }

                @Override
                public Editor remove(String key) { pending.remove(key); return this; }

                @Override
                public Editor clear() { pending.clear(); cleared[0] = true; return this; }

                @Override
                public void apply() {
                    applyCallCount += 1;
                    flush();
                }

                @Override
                public boolean commit() {
                    if (nextCommitFailure != null) {
                        RuntimeException failure = nextCommitFailure;
                        nextCommitFailure = null;
                        throw failure;
                    }
                    if (failNextCommit) {
                        failNextCommit = false;
                        flush();
                        return false;
                    }
                    flush();
                    return true;
                }

                private void flush() {
                    if (cleared[0]) {
                        values.clear();
                    }
                    values.keySet().retainAll(pending.keySet());
                    values.putAll(pending);
                }

                @Override
                public Editor putStringSet(String key, Set<String> values) { throw new UnsupportedOperationException(); }

                @Override
                public Editor putInt(String key, int value) { throw new UnsupportedOperationException(); }

                @Override
                public Editor putLong(String key, long value) { throw new UnsupportedOperationException(); }

                @Override
                public Editor putFloat(String key, float value) { throw new UnsupportedOperationException(); }

                @Override
                public Editor putBoolean(String key, boolean value) { throw new UnsupportedOperationException(); }
            };
        }

        @Override
        public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}

        @Override
        public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}
    }
}
