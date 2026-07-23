/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.pm.PackageInfoCompat;

final class AndroidRuntimeInfo {
    private final String packageVersionName;
    private final long packageVersionCode;

    AndroidRuntimeInfo(
        String packageVersionName,
        long packageVersionCode
    ) {
        this.packageVersionName = normalize(packageVersionName);
        this.packageVersionCode = packageVersionCode;
    }

    static AndroidRuntimeInfo fromContext(Context context) {
        String packageName = context.getPackageName();
        String versionName = null;
        long versionCode = 0;

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
            versionCode = PackageInfoCompat.getLongVersionCode(packageInfo);
        } catch (PackageManager.NameNotFoundException ignored) {
            // Fall back to package name only when package metadata is unavailable.
        }

        return new AndroidRuntimeInfo(
            versionName,
            versionCode
        );
    }

    String getPackageVersionName() {
        return packageVersionName;
    }

    long getPackageVersionCode() {
        return packageVersionCode;
    }

    private static String normalize(String value) {
        if (value == null) {
            return null;
        }

        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }
}
