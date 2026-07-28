/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;

import java.util.Locale;

import org.json.JSONObject;
import org.junit.Test;

public class AndroidPushRuntimeMetadataTest {

    @Test
    public void fromBootstrapNormalizesProviderIndependentlyOfDefaultLocale() throws Exception {
        Locale originalLocale = Locale.getDefault();
        Locale.setDefault(Locale.forLanguageTag("tr-TR"));

        try {
            assertEquals("i", AndroidPushRuntimeMetadata.normalizeProvider("I"));

            JSONObject androidPush = new JSONObject()
                .put("provider", "FCM")
                .put("metadataRevision", 1)
                .put(
                    "publicClientMetadata",
                    new JSONObject()
                        .put("apiKey", "api-key")
                        .put("projectId", "project-id")
                        .put("applicationId", "application-id")
                        .put("senderId", "sender-id")
                );

            AndroidPushRuntimeMetadata metadata = AndroidPushRuntimeMetadata.fromBootstrap(androidPush);

            assertEquals("fcm", metadata.provider());
        } finally {
            Locale.setDefault(originalLocale);
        }
    }
}
