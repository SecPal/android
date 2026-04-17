/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.webkit.WebView;

public final class WebViewBackNavigationController {

    private WebViewBackNavigationController() {
    }

    public static boolean goBackIfPossible(BackNavigationTarget target) {
        if (target == null || !target.canGoBack()) {
            return false;
        }

        target.goBack();
        return true;
    }

    public static BackNavigationTarget forWebView(WebView webView) {
        if (webView == null) {
            return null;
        }

        return new BackNavigationTarget() {
            @Override
            public boolean canGoBack() {
                return webView.canGoBack();
            }

            @Override
            public void goBack() {
                webView.goBack();
            }
        };
    }

    public interface BackNavigationTarget {
        boolean canGoBack();

        void goBack();
    }
}
