/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NetworkStateTest {

    @Test
    public void connectivityPolicyRejectsMissingActiveNetwork() {
        assertFalse(NetworkState.isConnectionUsable(false, true, true, true));
    }

    @Test
    public void connectivityPolicyRejectsMissingInternetCapability() {
        assertFalse(NetworkState.isConnectionUsable(true, false, true, true));
    }

    @Test
    public void connectivityPolicyRejectsUnvalidatedModernNetwork() {
        assertFalse(NetworkState.isConnectionUsable(true, true, false, true));
    }

    @Test
    public void connectivityPolicyAcceptsValidatedModernNetwork() {
        assertTrue(NetworkState.isConnectionUsable(true, true, true, true));
    }

    @Test
    public void connectivityPolicyAcceptsLegacyConnectedNetworkWithoutValidationSignal() {
        assertTrue(NetworkState.isConnectionUsable(true, true, false, false));
    }
}
