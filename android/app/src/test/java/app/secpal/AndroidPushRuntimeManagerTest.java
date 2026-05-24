/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.fail;

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

    private static class FakeFirebaseBackend
        implements AndroidPushRuntimeManager.FirebaseBackend {
        FakeFirebaseApp existingApp;
        FakeFirebaseApp lastInitializedApp;
        AndroidPushRuntimeMetadata lastInitializedMetadata;
        AndroidPushRuntimeManager.FirebaseAppHandle lastEnsuredMessagingApp;
        int initializeCallCount;
        int ensureMessagingCallCount;
        int deleteCallCount;

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
            existingApp = new FakeFirebaseApp(this, "secpal-runtime-push");
            lastInitializedApp = existingApp;
            return existingApp;
        }

        @Override
        public void ensureMessaging(AndroidPushRuntimeManager.FirebaseAppHandle app) {
            ensureMessagingCallCount += 1;
            lastEnsuredMessagingApp = app;
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
            owner.existingApp = null;
        }
    }

    private static final class FakeFirebaseMessagingClient
        implements AndroidPushRuntimeManager.FirebaseMessagingClient {
        private String lastRequestedAppName;
        private RuntimeException failure;

        @Override
        public void requestToken(
            String appName,
            AndroidPushRuntimeManager.MessagingTokenListener listener
        ) {
            lastRequestedAppName = appName;

            if (failure != null) {
                listener.onTokenError(failure);
                return;
            }

            listener.onTokenReceived("fcm-token-demo");
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
