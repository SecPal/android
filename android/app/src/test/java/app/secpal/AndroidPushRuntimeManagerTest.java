/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.TaskCompletionSource;
import com.google.android.gms.tasks.Tasks;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
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
    public void applyReusesAnExistingRuntimeWhenFirebaseOptionsStillMatch() {
        AndroidPushRuntimeMetadata metadata = new AndroidPushRuntimeMetadata(
            "fcm",
            3,
            "public-client-api-key-demo-1234567890",
            "secpal-demo-push",
            "1:1234567890:android:abcdef1234567890",
            "1234567890"
        );
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        backend.existingAppMatchesMetadata = true;
        backend.existingApp = new FakeFirebaseApp(backend, "secpal-runtime-push");
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);

        manager.apply(metadata);

        assertEquals(0, backend.initializeCallCount);
        assertEquals(1, backend.ensureMessagingCallCount);
        assertEquals(0, backend.deleteMessagingTokenCallCount);
        assertEquals(0, backend.deleteCallCount);
        assertEquals(Arrays.asList("cancel", "refresh"), backend.events);
        assertSame(backend.existingApp, backend.lastEnsuredMessagingApp);
    }

    @Test
    public void applyClearsExistingRuntimeWhenDeploymentDisablesPush() {
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        backend.existingApp = new FakeFirebaseApp(backend, "secpal-runtime-push");
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);

        manager.apply(null);

        assertEquals(0, backend.initializeCallCount);
        assertEquals(0, backend.ensureMessagingCallCount);
        assertEquals(1, backend.deleteMessagingTokenCallCount);
        assertEquals(1, backend.deleteCallCount);
        assertEquals(
            Arrays.asList("cancel", "delete-token", "delete-app"),
            backend.events
        );
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
    public void refreshTokenCancelsThePreviousRequestBeforeRefreshingTheNamedRuntime() {
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        backend.existingApp = new FakeFirebaseApp(backend, "secpal-runtime-push");
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);

        manager.refreshToken();

        assertEquals(Arrays.asList("cancel", "refresh"), backend.events);
        assertSame(backend.existingApp, backend.lastEnsuredMessagingApp);
        assertEquals(0, backend.initializeCallCount);
        assertEquals(0, backend.deleteCallCount);
    }

    @Test
    public void rotateTokenCancelsThePreviousRequestBeforeRotatingTheNamedRuntime() {
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        backend.existingApp = new FakeFirebaseApp(backend, "secpal-runtime-push");
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);

        manager.rotateToken();

        assertEquals(Arrays.asList("cancel", "rotate"), backend.events);
        assertSame(backend.existingApp, backend.lastRotatedMessagingApp);
        assertEquals(0, backend.initializeCallCount);
        assertEquals(0, backend.deleteCallCount);
    }

    @Test
    public void deleteTokenSynchronouslyTargetsTheNamedRuntimeWithoutTearingItDown() {
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        backend.existingApp = new FakeFirebaseApp(backend, "secpal-runtime-push");
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);

        manager.deleteToken();

        assertEquals(Arrays.asList("cancel", "delete-token"), backend.events);
        assertSame(backend.existingApp, backend.lastDeletedMessagingTokenApp);
        assertEquals(0, backend.deleteCallCount);
    }

    @Test
    public void deleteTokenRecreatesAColdRuntimeThenDeletesTokenBeforeApplication() {
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);
        AndroidPushRuntimeMetadata metadata = new AndroidPushRuntimeMetadata(
            "fcm", 2, "old-api-key", "old-project", "old-app", "old-sender"
        );

        manager.deleteToken(metadata);

        assertSame(metadata, backend.lastInitializedMetadata);
        assertEquals(
            Arrays.asList("cancel", "initialize", "delete-token", "delete-app"),
            backend.events
        );
        assertEquals(1, backend.deleteCallCount);
    }

    @Test
    public void deleteTokenPreservesTheApplicationWhenSynchronousDeletionFails() {
        RuntimeException deletionFailure = new RuntimeException("token-delete-failed");
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        backend.existingApp = new FakeFirebaseApp(backend, "secpal-runtime-push");
        backend.nextDeleteMessagingFailure = deletionFailure;
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);

        try {
            manager.deleteToken(
                new AndroidPushRuntimeMetadata(
                    "fcm", 2, "old-api-key", "old-project", "old-app", "old-sender"
                )
            );
            fail("Expected synchronous token deletion failure");
        } catch (RuntimeException thrown) {
            assertSame(deletionFailure, thrown);
        }

        assertEquals(
            Arrays.asList("cancel", "delete-token"),
            backend.events
        );
        assertEquals(0, backend.deleteCallCount);
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
    public void defaultFirebaseBackendRotatesTokenForNamedRuntimeApp() {
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
    public void defaultFirebaseBackendDeletesTokenForNamedRuntimeApp() {
        FakeFirebaseMessagingClient messagingClient = new FakeFirebaseMessagingClient();
        AndroidPushRuntimeManager.DefaultFirebaseBackend backend =
            new AndroidPushRuntimeManager.DefaultFirebaseBackend(
                null,
                messagingClient,
                new FakeMessagingListener()
            );

        backend.deleteMessagingToken(
            new FakeFirebaseApp(new FakeFirebaseBackend(), "secpal-runtime-push")
        );

        assertEquals("secpal-runtime-push", messagingClient.lastDeletedAppName);
    }

    @Test
    public void defaultFirebaseMessagingClientDeletesBeforeRequestingRotatedToken() {
        List<String> events = new ArrayList<>();
        FakeMessagingListener listener = new FakeMessagingListener();
        AndroidPushRuntimeManager.DefaultFirebaseMessagingClient client =
            new AndroidPushRuntimeManager.DefaultFirebaseMessagingClient(
                appName -> new AndroidPushRuntimeManager.FirebaseMessagingHandle() {
                    @Override
                    public Task<String> getToken() {
                        events.add("get-token:" + appName);
                        return Tasks.forResult("rotated-token");
                    }

                    @Override
                    public Task<Void> deleteToken() {
                        events.add("delete-token:" + appName);
                        return Tasks.forResult(null);
                    }
                }
            );

        client.rotateToken(
            "secpal-runtime-push",
            new AndroidPushRuntimeManager.MessagingTokenListener() {
                @Override
                public void onTokenReceived(String token) {
                    events.add("received:" + token);
                }

                @Override
                public void onTokenError(Exception exception) {
                    listener.onTokenError("secpal-runtime-push", exception);
                }
            }
        );

        assertEquals(
            Arrays.asList(
                "delete-token:secpal-runtime-push",
                "get-token:secpal-runtime-push",
                "received:rotated-token"
            ),
            events
        );
        assertNull(listener.lastFailure);
    }

    @Test
    public void defaultFirebaseMessagingClientDoesNotRequestTokenAfterDeletionFails() {
        RuntimeException deletionFailure = new RuntimeException("delete-failed");
        List<String> events = new ArrayList<>();
        FakeMessagingListener listener = new FakeMessagingListener();
        AndroidPushRuntimeManager.DefaultFirebaseMessagingClient client =
            new AndroidPushRuntimeManager.DefaultFirebaseMessagingClient(
                appName -> new AndroidPushRuntimeManager.FirebaseMessagingHandle() {
                    @Override
                    public Task<String> getToken() {
                        events.add("get-token");
                        return Tasks.forResult("unexpected-token");
                    }

                    @Override
                    public Task<Void> deleteToken() {
                        events.add("delete-token");
                        return Tasks.forException(deletionFailure);
                    }
                }
            );

        client.rotateToken(
            "secpal-runtime-push",
            new AndroidPushRuntimeManager.MessagingTokenListener() {
                @Override
                public void onTokenReceived(String token) {
                    fail("Rotation must not return a token after deletion fails");
                }

                @Override
                public void onTokenError(Exception exception) {
                    listener.onTokenError("secpal-runtime-push", exception);
                }
            }
        );

        assertEquals(Arrays.asList("delete-token"), events);
        assertSame(deletionFailure, listener.lastFailure);
    }

    @Test
    public void defaultFirebaseMessagingClientWaitsForNamedTokenDeletion() throws Exception {
        List<String> events = new ArrayList<>();
        CountDownLatch deletionRequested = new CountDownLatch(1);
        TaskCompletionSource<Void> deletion = new TaskCompletionSource<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        AndroidPushRuntimeManager.DefaultFirebaseMessagingClient client =
            new AndroidPushRuntimeManager.DefaultFirebaseMessagingClient(
                appName -> new AndroidPushRuntimeManager.FirebaseMessagingHandle() {
                    @Override
                    public Task<String> getToken() {
                        fail("Synchronous deletion must not request a token");
                        return Tasks.forResult("unexpected-token");
                    }

                    @Override
                    public Task<Void> deleteToken() {
                        events.add("delete-token:" + appName);
                        deletionRequested.countDown();
                        return deletion.getTask();
                    }
                }
            );

        Thread deletionThread = new Thread(() -> {
            try {
                client.deleteToken("secpal-runtime-push");
            } catch (Throwable thrown) {
                failure.set(thrown);
            }
        });
        deletionThread.start();
        assertTrue(deletionRequested.await(2, TimeUnit.SECONDS));
        assertTrue("Deletion must block until Firebase settles", deletionThread.isAlive());
        deletion.setResult(null);
        deletionThread.join(2_000L);
        events.add("returned");

        assertFalse("Deletion thread must finish after Firebase settles", deletionThread.isAlive());
        assertNull(failure.get());
        assertEquals(
            Arrays.asList("delete-token:secpal-runtime-push", "returned"),
            events
        );
    }

    @Test
    public void defaultFirebaseMessagingClientSurfacesSynchronousDeletionFailure()
        throws Exception {
        RuntimeException deletionFailure = new RuntimeException("delete-failed");
        AtomicReference<Throwable> thrownFailure = new AtomicReference<>();
        AndroidPushRuntimeManager.DefaultFirebaseMessagingClient client =
            new AndroidPushRuntimeManager.DefaultFirebaseMessagingClient(
                appName -> new AndroidPushRuntimeManager.FirebaseMessagingHandle() {
                    @Override
                    public Task<String> getToken() {
                        fail("Synchronous deletion must not request a token");
                        return Tasks.forResult("unexpected-token");
                    }

                    @Override
                    public Task<Void> deleteToken() {
                        return Tasks.forException(deletionFailure);
                    }
                }
            );

        Thread deletionThread = new Thread(() -> {
            try {
                client.deleteToken("secpal-runtime-push");
            } catch (Throwable thrown) {
                thrownFailure.set(thrown);
            }
        });
        deletionThread.start();
        deletionThread.join(2_000L);

        assertFalse(deletionThread.isAlive());
        assertTrue(thrownFailure.get() instanceof IllegalStateException);
        assertSame(deletionFailure, thrownFailure.get().getCause().getCause());
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
        int deleteMessagingTokenCallCount;
        int deleteCallCount;
        RuntimeException nextInitializeFailure;
        RuntimeException nextDeleteMessagingFailure;
        boolean existingAppMatchesMetadata;
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
        public void cancelPendingTokenRequest() {
            events.add("cancel");
        }

        @Override
        public void ensureMessaging(AndroidPushRuntimeManager.FirebaseAppHandle app) {
            ensureMessagingCallCount += 1;
            events.add("refresh");
            lastEnsuredMessagingApp = app;
        }

        @Override
        public void rotateMessagingToken(AndroidPushRuntimeManager.FirebaseAppHandle app) {
            events.add("rotate");
            lastRotatedMessagingApp = app;
        }

        @Override
        public void deleteMessagingToken(AndroidPushRuntimeManager.FirebaseAppHandle app) {
            deleteMessagingTokenCallCount += 1;
            events.add("delete-token");
            lastDeletedMessagingTokenApp = app;
            if (nextDeleteMessagingFailure != null) {
                throw nextDeleteMessagingFailure;
            }
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
        public boolean matches(AndroidPushRuntimeMetadata metadata) {
            return owner.existingAppMatchesMetadata;
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
