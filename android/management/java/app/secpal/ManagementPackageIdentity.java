/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Public certificate pins authenticate independent application signing authorities. */
final class ManagementPackageIdentity {
    private ManagementPackageIdentity() {}

    static boolean matches(Context context, String packageName, String expectedDigest) {
        if (expectedDigest == null || !expectedDigest.matches("[a-f0-9]{64}")) return false;
        try {
            Signature[] signatures = currentSignatures(context.getPackageManager(), packageName);
            // Only one current signer is supported; no historical/debug fallback is authority.
            return signatures != null && signatures.length == 1
                && expectedDigest.equals(digest(signatures[0]));
        } catch (PackageManager.NameNotFoundException | RuntimeException exception) {
            return false;
        }
    }

    static boolean isExclusiveCaller(Context context, int uid, String packageName, String digest) {
        String[] packages = context.getPackageManager().getPackagesForUid(uid);
        return packages != null && packages.length == 1 && packageName.equals(packages[0])
            && matches(context, packageName, digest)
            && !matches(context, context.getPackageName(), digest);
    }

    @SuppressWarnings("deprecation")
    private static Signature[] currentSignatures(PackageManager manager, String packageName)
        throws PackageManager.NameNotFoundException {
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            PackageInfo info = manager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES);
            return info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        }
        return manager.getPackageInfo(packageName, PackageManager.GET_SIGNATURES).signatures;
    }

    static String digest(Signature signature) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(signature.toByteArray());
            StringBuilder result = new StringBuilder();
            for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
            return result.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
