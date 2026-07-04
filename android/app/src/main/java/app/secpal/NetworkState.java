/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

class NetworkState {
    boolean isNetworkAvailable(Context context) {
        ConnectivityManager connectivityManager = context.getSystemService(ConnectivityManager.class);

        if (connectivityManager == null) {
            return false;
        }

        Network activeNetwork = connectivityManager.getActiveNetwork();
        NetworkCapabilities networkCapabilities = activeNetwork == null
            ? null
            : connectivityManager.getNetworkCapabilities(activeNetwork);

        return isConnectionUsable(
            activeNetwork != null,
            networkCapabilities != null
                && networkCapabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),
            networkCapabilities != null
                && networkCapabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
            true
        );
    }

    static boolean isConnectionUsable(
        boolean hasActiveNetwork,
        boolean hasInternetCapability,
        boolean hasValidatedCapability,
        boolean requiresValidatedCapability
    ) {
        if (!hasActiveNetwork || !hasInternetCapability) {
            return false;
        }

        return !requiresValidatedCapability || hasValidatedCapability;
    }
}
