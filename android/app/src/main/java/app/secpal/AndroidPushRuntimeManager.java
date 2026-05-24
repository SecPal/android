/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.Context;

import com.google.firebase.FirebaseApp;

import java.util.List;

final class AndroidPushRuntimeManager {
    private static final String RUNTIME_APP_NAME = "secpal-runtime-push";

    interface FirebaseAppHandle {
        void delete();
    }

    interface FirebaseBackend {
        FirebaseAppHandle findRuntimeApp();

        FirebaseAppHandle initialize(AndroidPushRuntimeMetadata metadata);

        void ensureMessaging();
    }

    private final FirebaseBackend firebaseBackend;

    AndroidPushRuntimeManager(Context context) {
        this(new DefaultFirebaseBackend(context.getApplicationContext()));
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

        firebaseBackend.initialize(metadata);
        firebaseBackend.ensureMessaging();
    }

    private static final class DefaultFirebaseBackend implements FirebaseBackend {
        private final Context applicationContext;

        DefaultFirebaseBackend(Context applicationContext) {
            this.applicationContext = applicationContext;
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
        public void ensureMessaging() {
            // FCM token retrieval for the named app is tracked in issue #241.
        }
    }

    private static final class DefaultFirebaseAppHandle implements FirebaseAppHandle {
        private final FirebaseApp firebaseApp;

        DefaultFirebaseAppHandle(FirebaseApp firebaseApp) {
            this.firebaseApp = firebaseApp;
        }

        @Override
        public void delete() {
            firebaseApp.delete();
        }
    }
}
