/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;

import android.content.Context;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;

@RunWith(RobolectricTestRunner.class)
public final class CordovaConfigResourceTest {

    @Test
    public void capacitorCordovaConfigRemainsResolvableByItsNameBasedContract() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        int configResourceId = context.getResources().getIdentifier(
            "config",
            "xml",
            context.getPackageName()
        );

        assertNotEquals(0, configResourceId);

        Class<?> parserClass = Class.forName("org.apache.cordova.ConfigXmlParser");
        Object parser = parserClass.getDeclaredConstructor().newInstance();
        parserClass.getMethod("parse", Context.class).invoke(parser, context);
        List<?> pluginEntries = (List<?>) parserClass
            .getMethod("getPluginEntries")
            .invoke(parser);

        assertFalse(pluginEntries.isEmpty());
    }
}
