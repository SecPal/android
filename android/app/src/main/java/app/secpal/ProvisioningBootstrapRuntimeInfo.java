/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;

final class ProvisioningBootstrapRuntimeInfo {
    private final String packageName;
    private final String packageVersionName;
    private final int packageVersionCode;
    private final String deviceName;
    private final String deviceManufacturer;
    private final String deviceModel;
    private final String androidVersion;

    ProvisioningBootstrapRuntimeInfo(
        String packageName,
        String packageVersionName,
        int packageVersionCode,
        String deviceName,
        String deviceManufacturer,
        String deviceModel,
        String androidVersion
    ) {
        this.packageName = normalize(packageName);
        this.packageVersionName = normalize(packageVersionName);
        this.packageVersionCode = packageVersionCode;
        this.deviceName = normalize(deviceName);
        this.deviceManufacturer = normalize(deviceManufacturer);
        this.deviceModel = normalize(deviceModel);
        this.androidVersion = normalize(androidVersion);
    }

    static ProvisioningBootstrapRuntimeInfo fromContext(Context context) {
        String packageName = context.getPackageName();
        String versionName = null;
        int versionCode = 0;

        try {
            PackageManager packageManager = context.getPackageManager();
            PackageInfo packageInfo;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageInfo = packageManager.getPackageInfo(
                    packageName,
                    PackageManager.PackageInfoFlags.of(0)
                );
            } else {
                packageInfo = packageManager.getPackageInfo(packageName, 0);
            }

            versionName = packageInfo.versionName;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                versionCode = (int) packageInfo.getLongVersionCode();
            } else {
                versionCode = packageInfo.versionCode;
            }
        } catch (PackageManager.NameNotFoundException ignored) {
            // Fall back to package name only when package metadata is unavailable.
        }

        return new ProvisioningBootstrapRuntimeInfo(
            packageName,
            versionName,
            versionCode,
            NativeAuthHttpClient.buildDeviceName(Build.MANUFACTURER, Build.MODEL),
            Build.MANUFACTURER,
            Build.MODEL,
            Build.VERSION.RELEASE
        );
    }

    String getPackageName() {
        return packageName;
    }

    String getPackageVersionName() {
        return packageVersionName;
    }

    int getPackageVersionCode() {
        return packageVersionCode;
    }

    String getDeviceName() {
        return deviceName;
    }

    String getDeviceManufacturer() {
        return deviceManufacturer;
    }

    String getDeviceModel() {
        return deviceModel;
    }

    String getAndroidVersion() {
        return androidVersion;
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }

        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }
}
