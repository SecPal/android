/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import java.util.Map;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AndroidPushIdentityInstrumentedTest {
    private static final String PREFERENCES_NAME = "secpal_native_auth";
    private static final String API_ORIGIN = "https://device-test.secpal.dev";
    private static final String FCM_TOKEN =
        "device-fcm-token-1234567890-abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMN";

    @Test
    public void realKeystoreProtectsIdentityAcrossRestartAndReset() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        SharedPreferences preferences = context.getSharedPreferences(
            PREFERENCES_NAME,
            Context.MODE_PRIVATE
        );
        assertTrue(preferences.edit().clear().commit());

        try {
            AndroidPushIdentityStorage storage = new AndroidPushIdentityStorage(context);
            AndroidPushIdentityStorage.State initial = storage.bindRuntime(API_ORIGIN, 7);
            AndroidPushIdentityStorage.State tokenState = storage.recordToken(
                API_ORIGIN,
                7,
                FCM_TOKEN
            );

            Map<String, ?> persisted = preferences.getAll();
            String persistedText = persisted.toString();
            assertNotNull(tokenState);
            assertTrue(persisted.containsKey(
                AndroidPushIdentityStorage.STATE_CIPHERTEXT_KEY
            ));
            assertTrue(persisted.containsKey(AndroidPushIdentityStorage.STATE_IV_KEY));
            assertFalse(persistedText.contains(FCM_TOKEN));
            assertFalse(persistedText.contains(initial.installationId()));

            AndroidPushIdentityStorage restarted = new AndroidPushIdentityStorage(context);
            AndroidPushIdentityStorage.State restored = restarted.load();
            assertNotNull(restored);
            assertEquals(initial.installationId(), restored.installationId());
            assertEquals(FCM_TOKEN, restored.token());

            restarted.clear();
            assertNull(restarted.load());
            AndroidPushIdentityStorage.State replacement = restarted.bindRuntime(
                API_ORIGIN,
                7
            );
            assertNotEquals(initial.installationId(), replacement.installationId());
            assertNull(replacement.token());
        } finally {
            assertTrue(preferences.edit().clear().commit());
        }
    }
}
