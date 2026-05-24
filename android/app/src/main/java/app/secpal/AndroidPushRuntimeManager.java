/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.Context;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

import java.util.List;

final class AndroidPushRuntimeManager {
    private static final String RUNTIME_APP_NAME = "secpal-runtime-push";
    private static final MessagingListener NO_OP_MESSAGING_LISTENER = new MessagingListener() {
        @Override
        public void onTokenReceived(String appName, String token) {}

        @Override
        public void onTokenError(String appName, Exception exception) {}
    };

    interface FirebaseAppHandle {
        String getName();

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
    }

    interface FirebaseBackend {
        FirebaseAppHandle findRuntimeApp();

        FirebaseAppHandle initialize(AndroidPushRuntimeMetadata metadata);

        void ensureMessaging(FirebaseAppHandle app);
    }

    private final FirebaseBackend firebaseBackend;

    AndroidPushRuntimeManager(Context context) {
        this(context, NO_OP_MESSAGING_LISTENER);
    }

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
        FirebaseAppHandle existingRuntimeApp = firebaseBackend.findRuntimeApp();

        if (existingRuntimeApp != null) {
            existingRuntimeApp.delete();
        }

        if (metadata == null) {
            return;
        }

        FirebaseAppHandle initializedApp = firebaseBackend.initialize(metadata);
        firebaseBackend.ensureMessaging(initializedApp);
    }

    static final class DefaultFirebaseBackend implements FirebaseBackend {
        private final Context applicationContext;
        private final FirebaseMessagingClient messagingClient;
        private final MessagingListener messagingListener;

        DefaultFirebaseBackend(Context applicationContext) {
            this(
                applicationContext,
                new DefaultFirebaseMessagingClient(),
                NO_OP_MESSAGING_LISTENER
            );
        }

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
            String appName = app.getName();

            try {
                messagingClient.requestToken(
                    appName,
                    new MessagingTokenListener() {
                        @Override
                        public void onTokenReceived(String token) {
                            messagingListener.onTokenReceived(appName, token);
                        }

                        @Override
                        public void onTokenError(Exception exception) {
                            messagingListener.onTokenError(appName, exception);
                        }
                    }
                );
            } catch (RuntimeException exception) {
                messagingListener.onTokenError(appName, exception);
                throw exception;
            }
        }
    }

    static final class DefaultFirebaseMessagingClient implements FirebaseMessagingClient {
        @Override
        public void requestToken(String appName, MessagingTokenListener listener) {
            FirebaseApp namedApp = FirebaseApp.getInstance(appName);
            FirebaseMessaging messaging = namedApp.get(FirebaseMessaging.class);

            if (messaging == null) {
                throw new IllegalStateException(
                    "Failed to resolve Firebase Messaging for Android push runtime app " + appName
                );
            }

            messaging
                .getToken()
                .addOnSuccessListener(listener::onTokenReceived)
                .addOnFailureListener(listener::onTokenError);
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
        public void delete() {
            firebaseApp.delete();
        }
    }
}
