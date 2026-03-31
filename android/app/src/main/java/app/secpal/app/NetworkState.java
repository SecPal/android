/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.os.Build;

class NetworkState {
    @SuppressWarnings("deprecation")
    boolean isNetworkAvailable(Context context) {
        ConnectivityManager connectivityManager = context.getSystemService(ConnectivityManager.class);

        if (connectivityManager == null) {
            return false;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
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

        NetworkInfo networkInfo = connectivityManager.getActiveNetworkInfo();

        return isConnectionUsable(
            networkInfo != null && networkInfo.isConnected(),
            true,
            false,
            false
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
