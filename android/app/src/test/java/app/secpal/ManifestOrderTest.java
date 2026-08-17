/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.xmlpull.v1.XmlPullParser;
import org.xmlpull.v1.XmlPullParserFactory;

@RunWith(RobolectricTestRunner.class)
public final class ManifestOrderTest {
    private static final String ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android";
    private static final String NETWORK_STATE_PERMISSION = "android.permission.ACCESS_NETWORK_STATE";
    private static final String INTERNET_PERMISSION = "android.permission.INTERNET";

    @Test
    public void permissionsPrecedeApplicationInSourceManifest() throws Exception {
        assertNetworkPermissionsPrecedeApplication(readSourceManifest());
    }

    @Test(expected = AssertionError.class)
    public void sourceManifestRequiresNetworkStatePermission() throws Exception {
        assertNetworkPermissionsPrecedeApplication(
            manifestWithChildren(
                "    <uses-permission android:name=\"android.permission.INTERNET\" />\r\n"
                    + "    <application />\r\n"
            )
        );
    }

    @Test(expected = AssertionError.class)
    public void sourceManifestRequiresInternetPermission() throws Exception {
        assertNetworkPermissionsPrecedeApplication(
            manifestWithChildren(
                "    <uses-permission\r\n"
                    + "        android:name=\"android.permission.ACCESS_NETWORK_STATE\">\r\n"
                    + "    </uses-permission>\r\n"
                    + "    <application />\r\n"
            )
        );
    }

    @Test(expected = AssertionError.class)
    public void sourceManifestRequiresApplicationElement() throws Exception {
        assertNetworkPermissionsPrecedeApplication(
            manifestWithChildren(
                "    <uses-permission android:name=\"android.permission.ACCESS_NETWORK_STATE\" />\r\n"
                    + "    <uses-permission android:name=\"android.permission.INTERNET\" />\r\n"
            )
        );
    }

    @Test(expected = AssertionError.class)
    public void permissionNamesInCommentsDoNotSatisfySourceManifestContract() throws Exception {
        assertNetworkPermissionsPrecedeApplication(
            manifestWithChildren(
                "    <!-- android.permission.ACCESS_NETWORK_STATE -->\r\n"
                    + "    <!-- android.permission.INTERNET -->\r\n"
                    + "    <application />\r\n"
            )
        );
    }

    @Test(expected = AssertionError.class)
    public void permissionNamesOnOtherElementsDoNotSatisfySourceManifestContract() throws Exception {
        assertNetworkPermissionsPrecedeApplication(
            manifestWithChildren(
                "    <uses-feature android:name=\"android.permission.ACCESS_NETWORK_STATE\" />\r\n"
                    + "    <uses-feature android:name=\"android.permission.INTERNET\" />\r\n"
                    + "    <application />\r\n"
            )
        );
    }

    @Test
    public void formattedPermissionDeclarationsSatisfySourceManifestContract() throws Exception {
        assertNetworkPermissionsPrecedeApplication(
            manifestWithChildren(
                "    <uses-permission\r\n"
                    + "        android:name=\"android.permission.ACCESS_NETWORK_STATE\">\r\n"
                    + "    </uses-permission>\r\n"
                    + "    <uses-permission\r\n"
                    + "        android:name=\"android.permission.INTERNET\" />\r\n"
                    + "    <application />\r\n"
            )
        );
    }

    @Test(expected = AssertionError.class)
    public void networkPermissionsMustPrecedeApplication() throws Exception {
        assertNetworkPermissionsPrecedeApplication(
            manifestWithChildren(
                "    <application />\r\n"
                    + "    <uses-permission android:name=\"android.permission.ACCESS_NETWORK_STATE\" />\r\n"
                    + "    <uses-permission android:name=\"android.permission.INTERNET\" />\r\n"
            )
        );
    }

    private static void assertNetworkPermissionsPrecedeApplication(String manifest) throws Exception {
        XmlPullParserFactory parserFactory = XmlPullParserFactory.newInstance();
        parserFactory.setNamespaceAware(true);
        XmlPullParser parser = parserFactory.newPullParser();
        parser.setInput(new StringReader(manifest));

        boolean applicationFound = false;
        boolean networkStatePermissionFound = false;
        boolean internetPermissionFound = false;

        while (parser.next() != XmlPullParser.END_DOCUMENT) {
            if (parser.getEventType() != XmlPullParser.START_TAG || parser.getDepth() != 2) {
                continue;
            }

            if ("application".equals(parser.getName())) {
                applicationFound = true;
                continue;
            }

            if (!"uses-permission".equals(parser.getName())) {
                continue;
            }

            String permission = parser.getAttributeValue(ANDROID_NAMESPACE, "name");
            if (NETWORK_STATE_PERMISSION.equals(permission)) {
                assertFalse(
                    "ACCESS_NETWORK_STATE must precede the application element",
                    applicationFound
                );
                networkStatePermissionFound = true;
            } else if (INTERNET_PERMISSION.equals(permission)) {
                assertFalse("INTERNET must precede the application element", applicationFound);
                internetPermissionFound = true;
            }
        }

        assertTrue("Source manifest must contain an application element", applicationFound);
        assertTrue(
            "Source manifest must retain ACCESS_NETWORK_STATE permission",
            networkStatePermissionFound
        );
        assertTrue("Source manifest must retain INTERNET permission", internetPermissionFound);
    }

    private static String manifestWithChildren(String children) {
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n"
            + "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">\r\n"
            + children
            + "</manifest>\r\n";
    }

    private static String readSourceManifest() throws Exception {
        return new String(
            Files.readAllBytes(new File("src/main/AndroidManifest.xml").toPath()),
            StandardCharsets.UTF_8
        );
    }
}
