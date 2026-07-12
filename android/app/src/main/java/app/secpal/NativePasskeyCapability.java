/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import android.os.Build;

final class NativePasskeyCapability {
    private static final int MINIMUM_SUPPORTED_SDK = Build.VERSION_CODES.UPSIDE_DOWN_CAKE;
    private static final String ANDROID_VERSION_UNSUPPORTED_CODE =
        "PASSKEY_ANDROID_VERSION_UNSUPPORTED";
    private static final String ANDROID_VERSION_UNSUPPORTED_MESSAGE =
        "Passkeys require Android 14 or newer.";

    private final boolean passkeysAvailable;
    private final String unavailableReason;

    private NativePasskeyCapability(boolean passkeysAvailable, String unavailableReason) {
        this.passkeysAvailable = passkeysAvailable;
        this.unavailableReason = unavailableReason;
    }

    static NativePasskeyCapability forCurrentDevice() {
        return forSdkInt(Build.VERSION.SDK_INT);
    }

    static NativePasskeyCapability forSdkInt(int sdkInt) {
        return sdkInt >= MINIMUM_SUPPORTED_SDK
            ? new NativePasskeyCapability(true, null)
            : new NativePasskeyCapability(false, ANDROID_VERSION_UNSUPPORTED_CODE);
    }

    boolean isPasskeysAvailable() {
        return passkeysAvailable;
    }

    String getUnavailableReason() {
        return unavailableReason;
    }

    void requirePasskeysAvailable() throws PasskeyAuthenticationException {
        if (!passkeysAvailable) {
            throw new PasskeyAuthenticationException(
                ANDROID_VERSION_UNSUPPORTED_MESSAGE,
                ANDROID_VERSION_UNSUPPORTED_CODE
            );
        }
    }
}
