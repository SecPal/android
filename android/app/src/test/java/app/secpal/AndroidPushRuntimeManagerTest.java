/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

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
        assertEquals("fcm", backend.lastInitializedMetadata.provider());
        assertEquals(3, backend.lastInitializedMetadata.metadataRevision());
        assertEquals(0, backend.deleteCallCount);
    }

    @Test
    public void applyClearsExistingRuntimeWhenDeploymentDisablesPush() {
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        backend.existingApp = new FakeFirebaseApp(backend);
        AndroidPushRuntimeManager manager = new AndroidPushRuntimeManager(backend);

        manager.apply(null);

        assertEquals(0, backend.initializeCallCount);
        assertEquals(0, backend.ensureMessagingCallCount);
        assertEquals(1, backend.deleteCallCount);
        assertNull(backend.lastInitializedMetadata);
    }

    private static final class FakeFirebaseBackend
        implements AndroidPushRuntimeManager.FirebaseBackend {
        private FakeFirebaseApp existingApp;
        private AndroidPushRuntimeMetadata lastInitializedMetadata;
        private int initializeCallCount;
        private int ensureMessagingCallCount;
        private int deleteCallCount;

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
            existingApp = new FakeFirebaseApp(this);
            return existingApp;
        }

        @Override
        public void ensureMessaging() {
            ensureMessagingCallCount += 1;
        }
    }

    private static final class FakeFirebaseApp
        implements AndroidPushRuntimeManager.FirebaseAppHandle {
        private final FakeFirebaseBackend owner;

        FakeFirebaseApp(FakeFirebaseBackend owner) {
            this.owner = owner;
        }

        @Override
        public void delete() {
            owner.deleteCallCount += 1;
            owner.existingApp = null;
        }
    }
}
