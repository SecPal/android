/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.Test;

public class EnterprisePolicyConfigTest {

    @Test
    public void fromMapReadsDedicatedDeviceFlagsAndPackages() {
        Map<String, Object> values = new LinkedHashMap<>();

        values.put(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);
        values.put(EnterprisePolicyConfig.KEY_LOCK_TASK_ENABLED, false);
        values.put(EnterprisePolicyConfig.KEY_ALLOW_PHONE, "true");
        values.put(EnterprisePolicyConfig.KEY_ALLOW_SMS, "1");
        values.put(EnterprisePolicyConfig.KEY_PREFER_GESTURE_NAVIGATION, "0");
        values.put(EnterprisePolicyConfig.KEY_ALLOWED_PACKAGES, "com.example.alpha, com.example.beta");

        EnterprisePolicyConfig config = EnterprisePolicyConfig.fromMap(values);

        assertTrue(config.isKioskModeEnabled());
        assertFalse(config.isLockTaskEnabled());
        assertTrue(config.isAllowPhone());
        assertTrue(config.isAllowSms());
        assertFalse(config.isPreferGestureNavigation());
        assertEquals(2, config.getAdditionalAllowedPackages().size());
        assertTrue(config.getAdditionalAllowedPackages().contains("com.example.alpha"));
        assertTrue(config.getAdditionalAllowedPackages().contains("com.example.beta"));
    }

    @Test
    public void lockTaskDefaultsToEnabledWhenDedicatedModeIsEnabledWithoutExplicitOverride() {
        Map<String, Object> values = new LinkedHashMap<>();

        values.put(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);

        EnterprisePolicyConfig config = EnterprisePolicyConfig.fromMap(values);

        assertTrue(config.isKioskModeEnabled());
        assertTrue(config.isLockTaskEnabled());
        assertTrue(config.isPreferGestureNavigation());
    }

    @Test
    public void lockTaskStaysEnabledWhenPhoneIsAllowedWithoutExplicitOverride() {
        Map<String, Object> values = new LinkedHashMap<>();

        values.put(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);
        values.put(EnterprisePolicyConfig.KEY_ALLOW_PHONE, true);

        EnterprisePolicyConfig config = EnterprisePolicyConfig.fromMap(values);

        assertTrue(config.isKioskModeEnabled());
        assertTrue(config.isLockTaskEnabled());
        assertTrue(config.isPreferGestureNavigation());
    }

    @Test
    public void lockTaskStaysEnabledWhenAdditionalAppsAreAllowedWithoutExplicitOverride() {
        Map<String, Object> values = new LinkedHashMap<>();

        values.put(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);
        values.put(EnterprisePolicyConfig.KEY_ALLOWED_PACKAGES, "com.example.alpha");

        EnterprisePolicyConfig config = EnterprisePolicyConfig.fromMap(values);

        assertTrue(config.isKioskModeEnabled());
        assertTrue(config.isLockTaskEnabled());
        assertTrue(config.isPreferGestureNavigation());
    }

    @Test
    public void gestureNavigationCanBeExplicitlyDisabledForProvisioning() {
        Map<String, Object> values = new LinkedHashMap<>();

        values.put(EnterprisePolicyConfig.KEY_KIOSK_MODE_ENABLED, true);
        values.put(EnterprisePolicyConfig.KEY_PREFER_GESTURE_NAVIGATION, false);

        EnterprisePolicyConfig config = EnterprisePolicyConfig.fromMap(values);

        assertTrue(config.isKioskModeEnabled());
        assertFalse(config.isPreferGestureNavigation());
    }

    @Test
    public void parsePackageListNormalizesArraysAndSeparators() {
        assertEquals(
            3,
            EnterprisePolicyConfig.parsePackageList(
                new String[] { "com.example.alpha", "com.example.beta", "com.example.gamma" }
            ).size()
        );
        assertEquals(
            2,
            EnterprisePolicyConfig.parsePackageList("com.example.alpha;\ncom.example.beta").size()
        );
    }

    @Test
    public void disabledConfigurationTurnsAllFlagsOff() {
        EnterprisePolicyConfig config = EnterprisePolicyConfig.disabled();

        assertFalse(config.isKioskModeEnabled());
        assertFalse(config.isLockTaskEnabled());
        assertFalse(config.isAllowPhone());
        assertFalse(config.isAllowSms());
        assertFalse(config.isPreferGestureNavigation());
        assertTrue(config.getAdditionalAllowedPackages().isEmpty());
    }
}
