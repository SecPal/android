/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

final class SecureWebViewBridgeSupport {
    static final int MINIMUM_WEBVIEW_MAJOR_VERSION = 83;
    static final String UNAVAILABLE_MESSAGE = "Origin-aware WebView bridge is unavailable";
    static final String INSTALLATION_FAILURE_MESSAGE = "Origin-aware WebView bridge installation failed";

    private SecureWebViewBridgeSupport() {}

    static boolean isAvailable(FeatureChecker featureChecker, ProviderVersionResolver providerVersionResolver) {
        try {
            if (!featureChecker.isWebMessageListenerSupported()) {
                return false;
            }

            Integer majorVersion = parseMajorVersion(providerVersionResolver.resolveVersionName());
            return majorVersion != null && majorVersion >= MINIMUM_WEBVIEW_MAJOR_VERSION;
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private static Integer parseMajorVersion(String versionName) {
        if (versionName == null || versionName.isEmpty()) {
            return null;
        }

        int separatorIndex = versionName.indexOf('.');
        String majorVersion = separatorIndex < 0 ? versionName : versionName.substring(0, separatorIndex);

        try {
            return Integer.parseInt(majorVersion);
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    static boolean isBridgeSecurityFailure(IllegalStateException exception) {
        String message = exception.getMessage();

        return UNAVAILABLE_MESSAGE.equals(message) || INSTALLATION_FAILURE_MESSAGE.equals(message);
    }

    interface FeatureChecker {
        boolean isWebMessageListenerSupported();
    }

    interface ProviderVersionResolver {
        String resolveVersionName();
    }
}
