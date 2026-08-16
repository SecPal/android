/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.fail;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.Test;

public class AndroidPushRuntimeManagerTest {

    @Test
    public void applyInitializesRuntimeForDeploymentProvidedMetadata() {
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);

        manager.apply(
            new AndroidPushRuntimeMetadata(
                "fcm",
                3,
                "public-client-api-key-demo-1234567890",
                "secpal-demo-push",
                "1:1234567890:android:abcdef1234567890",
                "1234567890"
            )
        );

        assertEquals(1, backend.initializeCallCount);
        assertEquals(1, backend.ensureMessagingCallCount);
        assertSame(backend.lastInitializedApp, backend.lastEnsuredMessagingApp);
        assertEquals("fcm", backend.lastInitializedMetadata.provider());
        assertEquals(3, backend.lastInitializedMetadata.metadataRevision());
        assertEquals(0, backend.deleteCallCount);
    }

    @Test
    public void applyRotatesTokenBeforeRequestWhenProtectedIdentityWasLost() {
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);

        manager.apply(
            new AndroidPushRuntimeMetadata(
                "fcm",
                3,
                "public-client-api-key-demo-1234567890",
                "secpal-demo-push",
                "1:1234567890:android:abcdef1234567890",
                "1234567890"
            ),
            true
        );

        assertEquals(1, backend.initializeCallCount);
        assertEquals(0, backend.ensureMessagingCallCount);
        assertEquals(1, backend.rotateMessagingCallCount);
        assertSame(backend.lastInitializedApp, backend.lastRotatedMessagingApp);
    }

    @Test
    public void applyClearsExistingRuntimeWhenDeploymentDisablesPush() {
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        backend.existingApp = new FakeFirebaseApp(backend, "secpal-runtime-push");
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);

        manager.apply(null);

        assertEquals(0, backend.initializeCallCount);
        assertEquals(0, backend.ensureMessagingCallCount);
        assertEquals(1, backend.deleteCallCount);
        assertNull(backend.lastInitializedMetadata);
    }

    @Test
    public void applyPropagatesDeleteExceptionBeforeInitializeIsAttempted() {
        RuntimeException deleteException = new RuntimeException("delete-failed");
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        backend.existingApp = new FakeFirebaseApp(backend, "secpal-runtime-push") {
            @Override
            public void delete() {
                super.delete();
                throw deleteException;
            }
        };

        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);

        try {
            manager.apply(
                new AndroidPushRuntimeMetadata(
                    "fcm", 1, "api-key", "project-id", "app-id", "sender-id"
                )
            );
            fail("Expected exception from delete");
        } catch (RuntimeException thrown) {
            assertSame(deleteException, thrown);
        }

        assertEquals(0, backend.initializeCallCount);
    }

    @Test
    public void applyWithRollbackRestoresPreviousRuntimeAfterReplacementFails() {
        RuntimeException replacementFailure = new RuntimeException("replacement-failed");
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        backend.existingApp = new FakeFirebaseApp(backend, "secpal-runtime-push");
        backend.nextInitializeFailure = replacementFailure;
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);
        AndroidPushRuntimeMetadata previousMetadata = new AndroidPushRuntimeMetadata(
            "fcm", 2, "old-api-key", "old-project", "old-app", "old-sender"
        );
        AndroidPushRuntimeMetadata nextMetadata = new AndroidPushRuntimeMetadata(
            "fcm", 3, "new-api-key", "new-project", "new-app", "new-sender"
        );

        try {
            manager.applyWithRollback(nextMetadata, previousMetadata);
            fail("Expected replacement failure");
        } catch (RuntimeException thrown) {
            assertSame(replacementFailure, thrown);
        }

        assertEquals(2, backend.initializeCallCount);
        assertEquals(1, backend.deleteCallCount);
        assertEquals(1, backend.ensureMessagingCallCount);
        assertSame(previousMetadata, backend.lastInitializedMetadata);
        assertSame(backend.lastInitializedApp, backend.lastEnsuredMessagingApp);
    }

    @Test
    public void applyWithRollbackDeletesTheOrphanedTokenBeforeReplacingItsRuntime() {
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        FakeFirebaseApp previousApp = new FakeFirebaseApp(
            backend,
            "secpal-runtime-push"
        );
        backend.existingApp = previousApp;
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);
        AndroidPushRuntimeMetadata previousMetadata = new AndroidPushRuntimeMetadata(
            "fcm", 2, "old-api-key", "old-project", "old-app", "old-sender"
        );
        AndroidPushRuntimeMetadata nextMetadata = new AndroidPushRuntimeMetadata(
            "fcm", 3, "new-api-key", "new-project", "new-app", "new-sender"
        );

        manager.applyWithRollback(nextMetadata, previousMetadata, true);

        assertEquals(1, backend.initializeCallCount);
        assertEquals(1, backend.ensureMessagingCallCount);
        assertEquals(0, backend.rotateMessagingCallCount);
        assertEquals(1, backend.deleteMessagingTokenCallCount);
        assertSame(previousApp, backend.lastDeletedMessagingTokenApp);
        assertSame(backend.lastInitializedApp, backend.lastEnsuredMessagingApp);
        assertEquals(
            Arrays.asList("delete-token", "delete-app", "initialize", "ensure"),
            backend.events
        );
    }

    @Test
    public void runtimeResetDeletesTheOrphanedTokenBeforeDeletingItsFirebaseApp() {
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        FakeFirebaseApp previousApp = new FakeFirebaseApp(
            backend,
            "secpal-runtime-push"
        );
        backend.existingApp = previousApp;
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);

        manager.applyWithRollback(
            null,
            new AndroidPushRuntimeMetadata(
                "fcm", 2, "old-api-key", "old-project", "old-app", "old-sender"
            ),
            true
        );

        assertEquals(1, backend.deleteMessagingTokenCallCount);
        assertSame(previousApp, backend.lastDeletedMessagingTokenApp);
        assertEquals(1, backend.deleteCallCount);
        assertEquals(0, backend.initializeCallCount);
        assertEquals(
            Arrays.asList("delete-token", "delete-app"),
            backend.events
        );
    }

    @Test
    public void coldStartTokenDeletionRecreatesThePersistedRuntime() {
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);
        AndroidPushRuntimeMetadata metadata = new AndroidPushRuntimeMetadata(
            "fcm", 2, "old-api-key", "old-project", "old-app", "old-sender"
        );

        manager.deleteToken(metadata);

        assertSame(metadata, backend.lastInitializedMetadata);
        assertEquals(1, backend.deleteMessagingTokenCallCount);
        assertEquals(1, backend.deleteCallCount);
    }

    @Test
    public void refreshTokenRequestsTheCurrentRuntimeWithoutReinitializingIt() {
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        backend.existingApp = new FakeFirebaseApp(backend, "secpal-runtime-push");
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);

        manager.refreshToken();

        assertEquals(0, backend.initializeCallCount);
        assertEquals(0, backend.deleteCallCount);
        assertEquals(1, backend.ensureMessagingCallCount);
        assertSame(backend.existingApp, backend.lastEnsuredMessagingApp);
    }

    @Test
    public void refreshTokenIsANoOpWithoutABoundRuntime() {
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);

        manager.refreshToken();

        assertEquals(0, backend.initializeCallCount);
        assertEquals(0, backend.ensureMessagingCallCount);
        assertEquals(0, backend.deleteCallCount);
    }

    @Test
    public void deleteTokenSynchronouslyTargetsTheBoundRuntime() {
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        FakeFirebaseApp runtimeApp = new FakeFirebaseApp(
            backend,
            "secpal-runtime-push"
        );
        backend.existingApp = runtimeApp;
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);

        manager.deleteToken();

        assertEquals(1, backend.deleteMessagingTokenCallCount);
        assertSame(runtimeApp, backend.lastDeletedMessagingTokenApp);
        assertEquals(Arrays.asList("delete-token"), backend.events);
    }

    @Test
    public void defaultFirebaseBackendRequestsTokenForNamedRuntimeApp() {
        FakeFirebaseMessagingClient messagingClient = new FakeFirebaseMessagingClient();
        FakeMessagingListener messagingListener = new FakeMessagingListener();
        AndroidPushRuntimeManager.DefaultFirebaseBackend backend =
            new AndroidPushRuntimeManager.DefaultFirebaseBackend(
                null,
                messagingClient,
                messagingListener
            );

        backend.ensureMessaging(new FakeFirebaseApp(new FakeFirebaseBackend(), "secpal-runtime-push"));

        assertEquals("secpal-runtime-push", messagingClient.lastRequestedAppName);
        assertEquals("fcm-token-demo", messagingListener.lastReceivedToken);
        assertEquals("secpal-runtime-push", messagingListener.lastReceivedAppName);
    }

    @Test
    public void defaultFirebaseBackendRoutesRequiredTokenRotation() {
        FakeFirebaseMessagingClient messagingClient = new FakeFirebaseMessagingClient();
        FakeMessagingListener messagingListener = new FakeMessagingListener();
        AndroidPushRuntimeManager.DefaultFirebaseBackend backend =
            new AndroidPushRuntimeManager.DefaultFirebaseBackend(
                null,
                messagingClient,
                messagingListener
            );

        backend.rotateMessagingToken(
            new FakeFirebaseApp(new FakeFirebaseBackend(), "secpal-runtime-push")
        );

        assertEquals("secpal-runtime-push", messagingClient.lastRotatedAppName);
        assertEquals("fcm-token-demo", messagingListener.lastReceivedToken);
        assertEquals("secpal-runtime-push", messagingListener.lastReceivedAppName);
    }

    @Test
    public void defaultFirebaseBackendDeletesTokenFromTheNamedPreviousRuntime() {
        FakeFirebaseMessagingClient messagingClient = new FakeFirebaseMessagingClient();
        AndroidPushRuntimeManager.DefaultFirebaseBackend backend =
            new AndroidPushRuntimeManager.DefaultFirebaseBackend(
                null,
                messagingClient,
                new FakeMessagingListener()
            );

        backend.deleteMessagingToken(
            new FakeFirebaseApp(new FakeFirebaseBackend(), "previous-runtime")
        );

        assertEquals("previous-runtime", messagingClient.lastDeletedAppName);
        assertNull(messagingClient.lastRotatedAppName);
    }

    @Test
    public void defaultFirebaseBackendSurfacesTokenRequestFailureToListener() {
        RuntimeException tokenFailure = new RuntimeException("token-request-failed");
        FakeFirebaseMessagingClient messagingClient = new FakeFirebaseMessagingClient();
        messagingClient.failure = tokenFailure;
        FakeMessagingListener messagingListener = new FakeMessagingListener();
        AndroidPushRuntimeManager.DefaultFirebaseBackend backend =
            new AndroidPushRuntimeManager.DefaultFirebaseBackend(
                null,
                messagingClient,
                messagingListener
            );

        backend.ensureMessaging(new FakeFirebaseApp(new FakeFirebaseBackend(), "secpal-runtime-push"));

        assertEquals("secpal-runtime-push", messagingClient.lastRequestedAppName);
        assertSame(tokenFailure, messagingListener.lastFailure);
        assertEquals("secpal-runtime-push", messagingListener.lastFailedAppName);
    }

    @Test
    public void defaultFirebaseBackendPropagatesSynchronousTokenRequestFailureToCaller() {
        RuntimeException tokenFailure = new RuntimeException("token-request-failed");
        FakeFirebaseMessagingClient messagingClient = new FakeFirebaseMessagingClient();
        messagingClient.thrownFailure = tokenFailure;
        FakeMessagingListener messagingListener = new FakeMessagingListener();
        AndroidPushRuntimeManager.DefaultFirebaseBackend backend =
            new AndroidPushRuntimeManager.DefaultFirebaseBackend(
                null,
                messagingClient,
                messagingListener
            );

        try {
            backend.ensureMessaging(new FakeFirebaseApp(new FakeFirebaseBackend(), "secpal-runtime-push"));
            fail("Expected synchronous exception to propagate");
        } catch (RuntimeException thrown) {
            assertSame(tokenFailure, thrown);
        }

        assertEquals("secpal-runtime-push", messagingClient.lastRequestedAppName);
        assertNull(messagingListener.lastFailure);
    }

    @Test
    public void cancelPendingTokenRequestSuppressesCallbacksFromPreviousRequest() {
        FakeFirebaseMessagingClient messagingClient = new FakeFirebaseMessagingClient();
        messagingClient.holdCallback = true;
        FakeMessagingListener messagingListener = new FakeMessagingListener();
        AndroidPushRuntimeManager.DefaultFirebaseBackend backend =
            new AndroidPushRuntimeManager.DefaultFirebaseBackend(
                null,
                messagingClient,
                messagingListener
            );

        backend.ensureMessaging(new FakeFirebaseApp(new FakeFirebaseBackend(), "secpal-runtime-push"));
        backend.cancelPendingTokenRequest();
        messagingClient.deliverPendingSuccess("fcm-token-demo");

        assertNull(
            "Token callback must be suppressed after cancelPendingTokenRequest()",
            messagingListener.lastReceivedToken
        );
    }

    private static class FakeFirebaseBackend
        implements AndroidPushRuntimeManager.FirebaseBackend {
        FakeFirebaseApp existingApp;
        FakeFirebaseApp lastInitializedApp;
        AndroidPushRuntimeMetadata lastInitializedMetadata;
        AndroidPushRuntimeManager.FirebaseAppHandle lastEnsuredMessagingApp;
        AndroidPushRuntimeManager.FirebaseAppHandle lastRotatedMessagingApp;
        AndroidPushRuntimeManager.FirebaseAppHandle lastDeletedMessagingTokenApp;
        int initializeCallCount;
        int ensureMessagingCallCount;
        int rotateMessagingCallCount;
        int deleteMessagingTokenCallCount;
        int deleteCallCount;
        RuntimeException nextInitializeFailure;
        final List<String> events = new ArrayList<>();

        @Override
        public AndroidPushRuntimeManager.FirebaseAppHandle findRuntimeApp() {
            return existingApp;
        }

        @Override
        public AndroidPushRuntimeManager.FirebaseAppHandle initialize(
            AndroidPushRuntimeMetadata metadata
        ) {
            initializeCallCount += 1;
            events.add("initialize");
            lastInitializedMetadata = metadata;
            if (nextInitializeFailure != null) {
                RuntimeException failure = nextInitializeFailure;
                nextInitializeFailure = null;
                throw failure;
            }
            existingApp = new FakeFirebaseApp(this, "secpal-runtime-push");
            lastInitializedApp = existingApp;
            return existingApp;
        }

        @Override
        public void cancelPendingTokenRequest() {}

        @Override
        public void ensureMessaging(AndroidPushRuntimeManager.FirebaseAppHandle app) {
            ensureMessagingCallCount += 1;
            events.add("ensure");
            lastEnsuredMessagingApp = app;
        }

        @Override
        public void rotateMessagingToken(AndroidPushRuntimeManager.FirebaseAppHandle app) {
            rotateMessagingCallCount += 1;
            events.add("rotate");
            lastRotatedMessagingApp = app;
        }

        @Override
        public void deleteMessagingToken(AndroidPushRuntimeManager.FirebaseAppHandle app) {
            deleteMessagingTokenCallCount += 1;
            events.add("delete-token");
            lastDeletedMessagingTokenApp = app;
        }
    }

    private static class FakeFirebaseApp implements AndroidPushRuntimeManager.FirebaseAppHandle {
        protected final FakeFirebaseBackend owner;
        private final String name;

        FakeFirebaseApp(FakeFirebaseBackend owner, String name) {
            this.owner = owner;
            this.name = name;
        }

        @Override
        public String getName() {
            return name;
        }

        @Override
        public void delete() {
            owner.deleteCallCount += 1;
            owner.events.add("delete-app");
            owner.existingApp = null;
        }
    }

    private static final class FakeFirebaseMessagingClient
        implements AndroidPushRuntimeManager.FirebaseMessagingClient {
        private String lastRequestedAppName;
        private String lastRotatedAppName;
        private String lastDeletedAppName;
        private RuntimeException failure;
        private RuntimeException thrownFailure;
        private boolean holdCallback;
        private AndroidPushRuntimeManager.MessagingTokenListener pendingListener;

        void deliverPendingSuccess(String token) {
            if (pendingListener != null) {
                pendingListener.onTokenReceived(token);
            }
        }

        @Override
        public void requestToken(
            String appName,
            AndroidPushRuntimeManager.MessagingTokenListener listener
        ) {
            lastRequestedAppName = appName;

            if (thrownFailure != null) {
                throw thrownFailure;
            }

            if (holdCallback) {
                pendingListener = listener;
                return;
            }

            if (failure != null) {
                listener.onTokenError(failure);
                return;
            }

            listener.onTokenReceived("fcm-token-demo");
        }

        @Override
        public void rotateToken(
            String appName,
            AndroidPushRuntimeManager.MessagingTokenListener listener
        ) {
            lastRotatedAppName = appName;
            requestToken(appName, listener);
        }

        @Override
        public void deleteToken(String appName) {
            lastDeletedAppName = appName;
        }
    }

    private static final class FakeMessagingListener
        implements AndroidPushRuntimeManager.MessagingListener {
        private String lastReceivedAppName;
        private String lastReceivedToken;
        private String lastFailedAppName;
        private Exception lastFailure;

        @Override
        public void onTokenReceived(String appName, String token) {
            lastReceivedAppName = appName;
            lastReceivedToken = token;
        }

        @Override
        public void onTokenError(String appName, Exception exception) {
            lastFailedAppName = appName;
            lastFailure = exception;
        }
    }
}
