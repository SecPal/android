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

    @Test
    public void applyPropagatesDeleteExceptionBeforeInitializeIsAttempted() {
        RuntimeException deleteException = new RuntimeException("delete-failed");
        FakeFirebaseBackend backend = new FakeFirebaseBackend();
        backend.existingApp = new FakeFirebaseApp(backend) {
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

    private static class FakeFirebaseBackend
        implements AndroidPushRuntimeManager.FirebaseBackend {
        FakeFirebaseApp existingApp;
        AndroidPushRuntimeMetadata lastInitializedMetadata;
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
            existingApp = new FakeFirebaseApp(this);
            return existingApp;
        }

        @Override
        public void ensureMessaging() {
            ensureMessagingCallCount += 1;
        }
    }

    private static class FakeFirebaseApp implements AndroidPushRuntimeManager.FirebaseAppHandle {
        protected final FakeFirebaseBackend owner;

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
