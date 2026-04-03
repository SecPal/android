/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.PersistableBundle;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

public final class EnterprisePolicyConfig {
    static final String KEY_KIOSK_MODE_ENABLED = "secpal_kiosk_mode_enabled";
    static final String KEY_LOCK_TASK_ENABLED = "secpal_lock_task_enabled";
    static final String KEY_ALLOW_PHONE = "secpal_allow_phone";
    static final String KEY_ALLOW_SMS = "secpal_allow_sms";
    static final String KEY_ALLOWED_PACKAGES = "secpal_allowed_packages";
    static final String KEY_PREFER_GESTURE_NAVIGATION = "secpal_prefer_gesture_navigation";

    private static final String PREF_KIOSK_MODE_ENABLED = "kiosk_mode_enabled";
    private static final String PREF_LOCK_TASK_ENABLED = "lock_task_enabled";
    private static final String PREF_ALLOW_PHONE = "allow_phone";
    private static final String PREF_ALLOW_SMS = "allow_sms";
    private static final String PREF_ALLOWED_PACKAGES = "allowed_packages";
    private static final String PREF_PREFER_GESTURE_NAVIGATION = "prefer_gesture_navigation";

    private final boolean kioskModeEnabled;
    private final boolean lockTaskEnabled;
    private final boolean allowPhone;
    private final boolean allowSms;
    private final boolean preferGestureNavigation;
    private final Set<String> additionalAllowedPackages;

    EnterprisePolicyConfig(
        boolean kioskModeEnabled,
        boolean lockTaskEnabled,
        boolean allowPhone,
        boolean allowSms,
        boolean preferGestureNavigation,
        Set<String> additionalAllowedPackages
    ) {
        this.kioskModeEnabled = kioskModeEnabled;
        this.lockTaskEnabled = lockTaskEnabled;
        this.allowPhone = allowPhone;
        this.allowSms = allowSms;
        this.preferGestureNavigation = preferGestureNavigation;
        this.additionalAllowedPackages = Collections.unmodifiableSet(
            new LinkedHashSet<>(additionalAllowedPackages)
        );
    }

    public static EnterprisePolicyConfig disabled() {
        return new EnterprisePolicyConfig(false, false, false, false, false, Collections.emptySet());
    }

    public static EnterprisePolicyConfig fromBundle(Bundle bundle) {
        if (bundle == null || bundle.isEmpty()) {
            return disabled();
        }

        Map<String, Object> values = new LinkedHashMap<>();

        for (String key : bundle.keySet()) {
            values.put(key, bundle.get(key));
        }

        return fromMap(values);
    }

    public static EnterprisePolicyConfig fromPersistableBundle(PersistableBundle bundle) {
        if (bundle == null || bundle.isEmpty()) {
            return disabled();
        }

        Map<String, Object> values = new LinkedHashMap<>();

        for (String key : bundle.keySet()) {
            values.put(key, bundle.get(key));
        }

        return fromMap(values);
    }

    public static EnterprisePolicyConfig fromMap(Map<String, ?> values) {
        if (values == null || values.isEmpty()) {
            return disabled();
        }

        boolean kioskModeEnabled = readBoolean(
            values,
            KEY_KIOSK_MODE_ENABLED,
            "kiosk_mode_enabled",
            "kioskModeEnabled"
        );
        Boolean explicitLockTaskEnabled = readOptionalBoolean(
            values,
            KEY_LOCK_TASK_ENABLED,
            "lock_task_enabled",
            "lockTaskEnabled"
        );
        boolean allowPhone = readBoolean(values, KEY_ALLOW_PHONE, "allow_phone", "allowPhone");
        boolean allowSms = readBoolean(values, KEY_ALLOW_SMS, "allow_sms", "allowSms");
        Boolean explicitPreferGestureNavigation = readOptionalBoolean(
            values,
            KEY_PREFER_GESTURE_NAVIGATION,
            "prefer_gesture_navigation",
            "preferGestureNavigation"
        );
        Set<String> additionalAllowedPackages = readPackageSet(
            values,
            KEY_ALLOWED_PACKAGES,
            "allowed_packages",
            "allowedPackages"
        );
        boolean lockTaskEnabled = explicitLockTaskEnabled == null
            ? kioskModeEnabled
            : explicitLockTaskEnabled;
        boolean preferGestureNavigation = explicitPreferGestureNavigation == null
            ? kioskModeEnabled
            : explicitPreferGestureNavigation;

        return new EnterprisePolicyConfig(
            kioskModeEnabled,
            lockTaskEnabled,
            allowPhone,
            allowSms,
            preferGestureNavigation,
            additionalAllowedPackages
        );
    }

    public static EnterprisePolicyConfig fromPreferences(SharedPreferences preferences) {
        return new EnterprisePolicyConfig(
            preferences.getBoolean(PREF_KIOSK_MODE_ENABLED, false),
            preferences.getBoolean(PREF_LOCK_TASK_ENABLED, false),
            preferences.getBoolean(PREF_ALLOW_PHONE, false),
            preferences.getBoolean(PREF_ALLOW_SMS, false),
            preferences.getBoolean(PREF_PREFER_GESTURE_NAVIGATION, false),
            parsePackageList(preferences.getString(PREF_ALLOWED_PACKAGES, ""))
        );
    }

    public boolean isKioskModeEnabled() {
        return kioskModeEnabled;
    }

    public boolean isLockTaskEnabled() {
        return lockTaskEnabled;
    }

    public boolean isAllowPhone() {
        return allowPhone;
    }

    public boolean isAllowSms() {
        return allowSms;
    }

    public boolean isPreferGestureNavigation() {
        return preferGestureNavigation;
    }

    public Set<String> getAdditionalAllowedPackages() {
        return additionalAllowedPackages;
    }

    public void writeToPreferences(SharedPreferences.Editor editor) {
        editor.putBoolean(PREF_KIOSK_MODE_ENABLED, kioskModeEnabled);
        editor.putBoolean(PREF_LOCK_TASK_ENABLED, lockTaskEnabled);
        editor.putBoolean(PREF_ALLOW_PHONE, allowPhone);
        editor.putBoolean(PREF_ALLOW_SMS, allowSms);
        editor.putBoolean(PREF_PREFER_GESTURE_NAVIGATION, preferGestureNavigation);
        editor.putString(PREF_ALLOWED_PACKAGES, String.join(",", additionalAllowedPackages));
    }

    static Set<String> parsePackageList(Object rawValue) {
        LinkedHashSet<String> packages = new LinkedHashSet<>();

        if (rawValue == null) {
            return packages;
        }

        if (rawValue instanceof String[]) {
            for (String value : (String[]) rawValue) {
                addPackage(packages, value);
            }

            return packages;
        }

        if (rawValue instanceof Object[]) {
            for (Object value : (Object[]) rawValue) {
                addPackage(packages, value == null ? null : String.valueOf(value));
            }

            return packages;
        }

        String normalizedValue = String.valueOf(rawValue)
            .replace('\n', ',')
            .replace(';', ',');

        for (String value : Arrays.asList(normalizedValue.split(","))) {
            addPackage(packages, value);
        }

        return packages;
    }

    private static boolean readBoolean(Map<String, ?> values, String... keys) {
        Boolean value = readOptionalBoolean(values, keys);

        return value != null && value;
    }

    private static Boolean readOptionalBoolean(Map<String, ?> values, String... keys) {
        for (String key : keys) {
            Object value = values.get(key);

            if (value instanceof Boolean) {
                return (Boolean) value;
            }

            if (value instanceof String) {
                String normalized = ((String) value).trim();

                if (!normalized.isEmpty()) {
                    return "true".equalsIgnoreCase(normalized)
                        || "1".equals(normalized)
                        || "yes".equalsIgnoreCase(normalized);
                }
            }
        }

        return null;
    }

    private static Set<String> readPackageSet(Map<String, ?> values, String... keys) {
        for (String key : keys) {
            if (values.containsKey(key)) {
                return parsePackageList(values.get(key));
            }
        }

        return Collections.emptySet();
    }

    private static void addPackage(Set<String> packages, String rawValue) {
        if (rawValue == null) {
            return;
        }

        String normalized = rawValue.trim();

        if (!normalized.isEmpty()) {
            packages.add(normalized);
        }
    }
}
