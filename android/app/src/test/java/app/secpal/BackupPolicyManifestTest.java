/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.XmlResourceParser;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.xmlpull.v1.XmlPullParser;

@RunWith(RobolectricTestRunner.class)
public final class BackupPolicyManifestTest {
    private static final Set<String> BACKUP_DOMAINS = new HashSet<>(Arrays.asList(
        "root", "file", "database", "sharedpref", "external",
        "device_root", "device_file", "device_database", "device_sharedpref"
    ));

    @Test
    public void applicationRetainsLegacyBackupDisable() throws Exception {
        ApplicationInfo applicationInfo = getApplicationInfo();
        assertFalse((applicationInfo.flags & ApplicationInfo.FLAG_ALLOW_BACKUP) != 0);
    }

    @Test
    public void applicationReferencesExplicitBackupRules() throws Exception {
        Context context = RuntimeEnvironment.getApplication();

        try (XmlResourceParser parser = context.getAssets().openXmlResourceParser("AndroidManifest.xml")) {
            while (parser.next() != XmlPullParser.END_DOCUMENT) {
                if (parser.getEventType() == XmlPullParser.START_TAG
                    && "application".equals(parser.getName())) {
                    assertEquals(
                        R.xml.backup_rules,
                        parser.getAttributeResourceValue(
                            "http://schemas.android.com/apk/res/android",
                            "fullBackupContent",
                            0
                        )
                    );
                    assertEquals(
                        R.xml.data_extraction_rules,
                        parser.getAttributeResourceValue(
                            "http://schemas.android.com/apk/res/android",
                            "dataExtractionRules",
                            0
                        )
                    );
                    return;
                }
            }
        }

        throw new AssertionError("Merged manifest must contain an application element");
    }

    @Test
    public void permissionsPrecedeApplicationInSourceManifest() throws Exception {
        assertNetworkPermissionsPrecedeApplication(readSourceManifest());
    }

    @Test(expected = AssertionError.class)
    public void sourceManifestRequiresNetworkStatePermission() throws Exception {
        assertNetworkPermissionsPrecedeApplication(
            readSourceManifest().replace(
                "    <uses-permission android:name=\"android.permission.ACCESS_NETWORK_STATE\" />\n",
                ""
            )
        );
    }

    private static void assertNetworkPermissionsPrecedeApplication(String manifest) {
        int applicationIndex = manifest.indexOf("<application");
        int networkStatePermissionIndex = manifest.indexOf("android.permission.ACCESS_NETWORK_STATE");
        int internetPermissionIndex = manifest.indexOf("android.permission.INTERNET");

        assertTrue("Source manifest must contain an application element", applicationIndex >= 0);
        assertTrue(
            "Source manifest must retain ACCESS_NETWORK_STATE permission",
            networkStatePermissionIndex >= 0
        );
        assertTrue(
            "ACCESS_NETWORK_STATE must precede the application element",
            networkStatePermissionIndex < applicationIndex
        );
        assertTrue(
            "Source manifest must retain INTERNET permission",
            internetPermissionIndex >= 0
        );
        assertTrue(
            "INTERNET must precede the application element",
            internetPermissionIndex < applicationIndex
        );
    }

    private static String readSourceManifest() throws Exception {
        return new String(
            Files.readAllBytes(new File("src/main/AndroidManifest.xml").toPath()),
            StandardCharsets.UTF_8
        );
    }

    @Test
    public void legacyBackupRulesExcludeEveryBackupDomain() throws Exception {
        assertExcludedDomains(R.xml.backup_rules, "full-backup-content");
    }

    @Test
    public void androidTwelveRulesExcludeEveryDomainForCloudBackupAndDeviceTransfer() throws Exception {
        assertExcludedDomains(R.xml.data_extraction_rules, "cloud-backup");
        assertExcludedDomains(R.xml.data_extraction_rules, "device-transfer");
    }

    private static void assertExcludedDomains(int resourceId, String policySection) throws Exception {
        Set<String> excludedDomains = new HashSet<>();
        boolean inPolicySection = false;
        int policySectionDepth = -1;

        try (XmlResourceParser parser = RuntimeEnvironment.getApplication().getResources().getXml(resourceId)) {
            while (parser.next() != XmlPullParser.END_DOCUMENT) {
                if (parser.getEventType() == XmlPullParser.START_TAG) {
                    if (policySection.equals(parser.getName())) {
                        inPolicySection = true;
                        policySectionDepth = parser.getDepth();
                    } else if (inPolicySection && "exclude".equals(parser.getName())) {
                        assertEquals(
                            "All backup domains must be fully excluded",
                            ".",
                            parser.getAttributeValue(null, "path")
                        );
                        excludedDomains.add(parser.getAttributeValue(null, "domain"));
                    }
                } else if (parser.getEventType() == XmlPullParser.END_TAG
                    && inPolicySection
                    && policySectionDepth == parser.getDepth()
                    && policySection.equals(parser.getName())) {
                    inPolicySection = false;
                }
            }
        }

        assertEquals(
            "Rules must exclude exactly every backup domain for " + policySection,
            BACKUP_DOMAINS,
            excludedDomains
        );
    }

    private static ApplicationInfo getApplicationInfo() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        return context.getPackageManager().getApplicationInfo(
            context.getPackageName(),
            PackageManager.ApplicationInfoFlags.of(0)
        );
    }
}
