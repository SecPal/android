/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.Context;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;

import java.util.List;
import java.util.Objects;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

final class AndroidPushRuntimeManager {
    private static final String RUNTIME_APP_NAME = "secpal-runtime-push";
    private static final long TOKEN_DELETION_TIMEOUT_SECONDS = 15;
    private static final MessagingListener NO_OP_MESSAGING_LISTENER = new MessagingListener() {
        @Override
        public void onTokenReceived(String appName, String token) {}

        @Override
        public void onTokenError(String appName, Exception exception) {}
    };

    interface FirebaseAppHandle {
        String getName();

        default boolean matches(AndroidPushRuntimeMetadata metadata) {
            return false;
        }

        void delete();
    }

    interface MessagingTokenListener {
        void onTokenReceived(String token);

        void onTokenError(Exception exception);
    }

    interface MessagingListener {
        void onTokenReceived(String appName, String token);

        void onTokenError(String appName, Exception exception);
    }

    interface FirebaseMessagingClient {
        void requestToken(String appName, MessagingTokenListener listener);

        void rotateToken(String appName, MessagingTokenListener listener);

        void deleteToken(String appName);
    }

    interface FirebaseMessagingHandle {
        Task<String> getToken();

        Task<Void> deleteToken();
    }

    @FunctionalInterface
    interface FirebaseMessagingResolver {
        FirebaseMessagingHandle resolve(String appName);
    }

    interface FirebaseBackend {
        FirebaseAppHandle findRuntimeApp();

        FirebaseAppHandle initialize(AndroidPushRuntimeMetadata metadata);

        void cancelPendingTokenRequest();

        void ensureMessaging(FirebaseAppHandle app);

        void rotateMessagingToken(FirebaseAppHandle app);

        void deleteMessagingToken(FirebaseAppHandle app);
    }

    private final FirebaseBackend firebaseBackend;

    AndroidPushRuntimeManager(Context context, MessagingListener messagingListener) {
        this(
            new DefaultFirebaseBackend(
                context.getApplicationContext(),
                new DefaultFirebaseMessagingClient(),
                messagingListener
            )
        );
    }

    AndroidPushRuntimeManager(FirebaseBackend firebaseBackend) {
        this.firebaseBackend = firebaseBackend;
    }

    void apply(AndroidPushRuntimeMetadata metadata) {
        firebaseBackend.cancelPendingTokenRequest();

        FirebaseAppHandle existingRuntimeApp = firebaseBackend.findRuntimeApp();

        if (existingRuntimeApp != null
            && metadata != null
            && existingRuntimeApp.matches(metadata)) {
            firebaseBackend.ensureMessaging(existingRuntimeApp);
            return;
        }

        if (existingRuntimeApp != null) {
            firebaseBackend.deleteMessagingToken(existingRuntimeApp);
            existingRuntimeApp.delete();
        }

        if (metadata == null) {
            return;
        }

        FirebaseAppHandle initializedApp = firebaseBackend.initialize(metadata);
        firebaseBackend.ensureMessaging(initializedApp);
    }

    void applyWithRollback(
        AndroidPushRuntimeMetadata metadata,
        AndroidPushRuntimeMetadata rollbackMetadata
    ) {
        try {
            apply(metadata);
        } catch (RuntimeException exception) {
            try {
                apply(rollbackMetadata);
            } catch (RuntimeException rollbackException) {
                exception.addSuppressed(rollbackException);
            }
            throw exception;
        }
    }

    void refreshToken() {
        firebaseBackend.cancelPendingTokenRequest();
        FirebaseAppHandle runtimeApp = firebaseBackend.findRuntimeApp();
        if (runtimeApp != null) {
            firebaseBackend.ensureMessaging(runtimeApp);
        }
    }

    void rotateToken() {
        firebaseBackend.cancelPendingTokenRequest();
        FirebaseAppHandle runtimeApp = firebaseBackend.findRuntimeApp();
        if (runtimeApp != null) {
            firebaseBackend.rotateMessagingToken(runtimeApp);
        }
    }

    void deleteToken() {
        firebaseBackend.cancelPendingTokenRequest();
        FirebaseAppHandle runtimeApp = firebaseBackend.findRuntimeApp();
        if (runtimeApp != null) {
            firebaseBackend.deleteMessagingToken(runtimeApp);
        }
    }

    void deleteToken(AndroidPushRuntimeMetadata metadata) {
        firebaseBackend.cancelPendingTokenRequest();
        FirebaseAppHandle runtimeApp = firebaseBackend.findRuntimeApp();
        if (runtimeApp == null && metadata != null) {
            runtimeApp = firebaseBackend.initialize(metadata);
        }
        if (runtimeApp == null) {
            return;
        }
        firebaseBackend.deleteMessagingToken(runtimeApp);
        runtimeApp.delete();
    }

    static final class DefaultFirebaseBackend implements FirebaseBackend {
        private final Context applicationContext;
        private final FirebaseMessagingClient messagingClient;
        private final MessagingListener messagingListener;
        private final AtomicInteger requestGeneration = new AtomicInteger(0);

        DefaultFirebaseBackend(
            Context applicationContext,
            FirebaseMessagingClient messagingClient,
            MessagingListener messagingListener
        ) {
            this.applicationContext = applicationContext;
            this.messagingClient = messagingClient;
            this.messagingListener = messagingListener == null
                ? NO_OP_MESSAGING_LISTENER
                : messagingListener;
        }

        @Override
        public void cancelPendingTokenRequest() {
            requestGeneration.incrementAndGet();
        }

        @Override
        public FirebaseAppHandle findRuntimeApp() {
            List<FirebaseApp> apps = FirebaseApp.getApps(applicationContext);

            for (FirebaseApp app : apps) {
                if (RUNTIME_APP_NAME.equals(app.getName())) {
                    return new DefaultFirebaseAppHandle(app);
                }
            }

            return null;
        }

        @Override
        public FirebaseAppHandle initialize(AndroidPushRuntimeMetadata metadata) {
            FirebaseApp initializedApp = FirebaseApp.initializeApp(
                applicationContext,
                metadata.toFirebaseOptions(),
                RUNTIME_APP_NAME
            );

            if (initializedApp == null) {
                throw new IllegalStateException(
                    "Failed to initialize Android push runtime from deployment metadata"
                );
            }

            return new DefaultFirebaseAppHandle(initializedApp);
        }

        @Override
        public void ensureMessaging(FirebaseAppHandle app) {
            requestMessagingToken(app, false);
        }

        @Override
        public void rotateMessagingToken(FirebaseAppHandle app) {
            requestMessagingToken(app, true);
        }

        @Override
        public void deleteMessagingToken(FirebaseAppHandle app) {
            messagingClient.deleteToken(app.getName());
        }

        private void requestMessagingToken(
            FirebaseAppHandle app,
            boolean rotateToken
        ) {
            String appName = app.getName();
            int generation = requestGeneration.get();
            MessagingTokenListener listener = new MessagingTokenListener() {
                @Override
                public void onTokenReceived(String token) {
                    if (requestGeneration.get() == generation) {
                        messagingListener.onTokenReceived(appName, token);
                    }
                }

                @Override
                public void onTokenError(Exception exception) {
                    if (requestGeneration.get() == generation) {
                        messagingListener.onTokenError(appName, exception);
                    }
                }
            };
            if (rotateToken) {
                messagingClient.rotateToken(appName, listener);
            } else {
                messagingClient.requestToken(appName, listener);
            }
        }
    }

    static final class DefaultFirebaseMessagingClient implements FirebaseMessagingClient {
        private static final Executor DIRECT_EXECUTOR = Runnable::run;
        private final FirebaseMessagingResolver messagingResolver;

        DefaultFirebaseMessagingClient() {
            this(DefaultFirebaseMessagingClient::resolveMessaging);
        }

        DefaultFirebaseMessagingClient(FirebaseMessagingResolver messagingResolver) {
            this.messagingResolver = messagingResolver;
        }

        @Override
        public void requestToken(String appName, MessagingTokenListener listener) {
            messagingResolver
                .resolve(appName)
                .getToken()
                .addOnSuccessListener(DIRECT_EXECUTOR, listener::onTokenReceived)
                .addOnFailureListener(DIRECT_EXECUTOR, listener::onTokenError);
        }

        @Override
        public void rotateToken(String appName, MessagingTokenListener listener) {
            FirebaseMessagingHandle messaging = messagingResolver.resolve(appName);
            messaging
                .deleteToken()
                .continueWithTask(DIRECT_EXECUTOR, deletion -> {
                    if (!deletion.isSuccessful()) {
                        Exception failure = deletion.getException();
                        if (failure != null) {
                            throw failure;
                        }
                        throw new IllegalStateException(
                            "Failed to delete the previous Android push token"
                        );
                    }
                    return messaging.getToken();
                })
                .addOnSuccessListener(DIRECT_EXECUTOR, listener::onTokenReceived)
                .addOnFailureListener(DIRECT_EXECUTOR, listener::onTokenError);
        }

        @Override
        public void deleteToken(String appName) {
            try {
                Tasks.await(
                    messagingResolver.resolve(appName).deleteToken(),
                    TOKEN_DELETION_TIMEOUT_SECONDS,
                    TimeUnit.SECONDS
                );
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(
                    "Interrupted while deleting the previous Android push token",
                    exception
                );
            } catch (ExecutionException | TimeoutException exception) {
                throw new IllegalStateException(
                    "Failed to delete the previous Android push token",
                    exception
                );
            }
        }

        private static FirebaseMessagingHandle resolveMessaging(String appName) {
            FirebaseApp namedApp = FirebaseApp.getInstance(appName);
            FirebaseMessaging messaging = namedApp.get(FirebaseMessaging.class);

            if (messaging == null) {
                throw new IllegalStateException(
                    "Failed to resolve Firebase Messaging for Android push runtime app " + appName
                );
            }

            return new FirebaseMessagingHandle() {
                @Override
                public Task<String> getToken() {
                    return messaging.getToken();
                }

                @Override
                public Task<Void> deleteToken() {
                    return messaging.deleteToken();
                }
            };
        }
    }

    private static final class DefaultFirebaseAppHandle implements FirebaseAppHandle {
        private final FirebaseApp firebaseApp;

        DefaultFirebaseAppHandle(FirebaseApp firebaseApp) {
            this.firebaseApp = firebaseApp;
        }

        @Override
        public String getName() {
            return firebaseApp.getName();
        }

        @Override
        public boolean matches(AndroidPushRuntimeMetadata metadata) {
            if (metadata == null) {
                return false;
            }
            FirebaseOptions options = firebaseApp.getOptions();
            return Objects.equals(options.getApiKey(), metadata.apiKey())
                && Objects.equals(
                    options.getProjectId(),
                    metadata.projectId()
                )
                && Objects.equals(
                    options.getApplicationId(),
                    metadata.applicationId()
                )
                && Objects.equals(
                    options.getGcmSenderId(),
                    metadata.senderId()
                );
        }

        @Override
        public void delete() {
            firebaseApp.delete();
        }
    }
}
