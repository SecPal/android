/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.res.Resources;
import android.content.res.XmlResourceParser;
import java.net.URL;
import java.nio.file.Path;
import java.util.List;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.XmlResourceParserImpl;

@RunWith(RobolectricTestRunner.class)
public final class CordovaConfigResourceTest {

    private static final int CONFIG_RESOURCE_ID = 0x7f140001;

    @Test
    public void capacitorCordovaConfigRemainsResolvableByItsNameBasedContract() throws Exception {
        Context applicationContext = RuntimeEnvironment.getApplication();
        XmlResourceParser configFixture = createConfigFixtureParser();
        ConfigContractResources resources = new ConfigContractResources(
            applicationContext.getResources(),
            configFixture
        );
        Context context = new ContextWrapper(applicationContext) {
            @Override
            public Resources getResources() {
                return resources;
            }

            @Override
            public String getPackageName() {
                return "app.secpal";
            }
        };

        // Cordova is a runtime-only implementation dependency of the generated
        // plugin library, so keep the app test compile classpath isolated from it.
        Class<?> parserClass = Class.forName("org.apache.cordova.ConfigXmlParser");
        Object parser = parserClass.getDeclaredConstructor().newInstance();
        try {
            parserClass.getMethod("parse", Context.class).invoke(parser, context);
        } finally {
            configFixture.close();
        }
        List<?> pluginEntries = (List<?>) parserClass
            .getMethod("getPluginEntries")
            .invoke(parser);

        assertEquals("config", resources.requestedName);
        assertEquals("xml", resources.requestedType);
        assertEquals("app.secpal", resources.requestedPackage);
        assertEquals(CONFIG_RESOURCE_ID, resources.requestedXmlResourceId);
        assertTrue(
            containsPluginEntry(
                pluginEntries,
                "SecPalTestFixture",
                "app.secpal.TestFixturePlugin"
            )
        );
    }

    private boolean containsPluginEntry(
        List<?> pluginEntries,
        String expectedService,
        String expectedPluginClass
    ) throws Exception {
        for (Object pluginEntry : pluginEntries) {
            Class<?> pluginEntryClass = pluginEntry.getClass();
            String service = (String) pluginEntryClass.getField("service").get(pluginEntry);
            String pluginClass = (String) pluginEntryClass.getField("pluginClass").get(pluginEntry);
            if (expectedService.equals(service) && expectedPluginClass.equals(pluginClass)) {
                return true;
            }
        }

        return false;
    }

    private XmlResourceParser createConfigFixtureParser() throws Exception {
        URL configResource = getClass().getResource("/res/xml/config.xml");
        assertNotNull(configResource);
        Path configPath = Path.of(configResource.toURI());
        DocumentBuilderFactory documentBuilderFactory = DocumentBuilderFactory.newInstance();
        documentBuilderFactory.setNamespaceAware(true);

        return new XmlResourceParserImpl(
            documentBuilderFactory.newDocumentBuilder().parse(configPath.toFile()),
            configPath,
            "app.secpal",
            "app.secpal",
            null
        );
    }

    private static final class ConfigContractResources extends Resources {

        private final XmlResourceParser configFixture;
        private String requestedName;
        private String requestedType;
        private String requestedPackage;
        private int requestedXmlResourceId;

        @SuppressWarnings("deprecation") // Resources exposes no current public test-double constructor.
        ConfigContractResources(Resources delegate, XmlResourceParser configFixture) {
            super(delegate.getAssets(), delegate.getDisplayMetrics(), delegate.getConfiguration());
            this.configFixture = configFixture;
        }

        @Override
        public int getIdentifier(String name, String type, String packageName) {
            requestedName = name;
            requestedType = type;
            requestedPackage = packageName;
            return CONFIG_RESOURCE_ID;
        }

        @Override
        public XmlResourceParser getXml(int resourceId) {
            requestedXmlResourceId = resourceId;
            return configFixture;
        }
    }
}
