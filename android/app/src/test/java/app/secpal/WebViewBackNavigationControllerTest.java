/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WebViewBackNavigationControllerTest {

    @Test
    public void goBackIfPossibleNavigatesBackWhenHistoryExists() {
        FakeBackNavigationTarget target = new FakeBackNavigationTarget(true);

        assertTrue(WebViewBackNavigationController.goBackIfPossible(target));
        assertTrue(target.didGoBack());
    }

    @Test
    public void goBackIfPossibleDoesNothingWhenHistoryIsMissing() {
        FakeBackNavigationTarget target = new FakeBackNavigationTarget(false);

        assertFalse(WebViewBackNavigationController.goBackIfPossible(target));
        assertFalse(target.didGoBack());
    }

    @Test
    public void goBackIfPossibleDoesNothingWhenTargetIsMissing() {
        assertFalse(WebViewBackNavigationController.goBackIfPossible(null));
    }

    private static final class FakeBackNavigationTarget
        implements WebViewBackNavigationController.BackNavigationTarget {
        private final boolean canGoBack;
        private boolean didGoBack;

        private FakeBackNavigationTarget(boolean canGoBack) {
            this.canGoBack = canGoBack;
        }

        @Override
        public boolean canGoBack() {
            return canGoBack;
        }

        @Override
        public void goBack() {
            didGoBack = true;
        }

        private boolean didGoBack() {
            return didGoBack;
        }
    }
}
