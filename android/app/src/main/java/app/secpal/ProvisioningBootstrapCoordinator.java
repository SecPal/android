/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.content.Context;

import org.json.JSONException;

import java.io.IOException;

final class ProvisioningBootstrapCoordinator {
    static final String RETRY_ERROR_CODE = "BOOTSTRAP_EXCHANGE_RETRY";
    static final String TOKEN_STORAGE_ERROR_CODE = "TOKEN_STORAGE_ERROR";
    static final String MISSING_TOKEN_ERROR_CODE = "NO_BOOTSTRAP_TOKEN";

    interface ExchangeClient {
        ProvisioningBootstrapExchangeResult exchange(
            String bootstrapToken,
            ProvisioningBootstrapRuntimeInfo runtimeInfo
        ) throws IOException, JSONException, NativeAuthHttpException;
    }

    interface Connectivity {
        boolean isNetworkAvailable();
    }

    enum SyncOutcome {
        SKIPPED_NOT_PENDING,
        SKIPPED_OFFLINE,
        COMPLETED,
        FAILED_RETRYABLE,
        FAILED_TERMINAL
    }

    private final ProvisioningBootstrapStore store;
    private final ExchangeClient exchangeClient;
    private final Connectivity connectivity;
    private final ProvisioningBootstrapRuntimeInfo runtimeInfo;

    ProvisioningBootstrapCoordinator(
        ProvisioningBootstrapStore store,
        ExchangeClient exchangeClient,
        Connectivity connectivity,
        ProvisioningBootstrapRuntimeInfo runtimeInfo
    ) {
        this.store = store;
        this.exchangeClient = exchangeClient;
        this.connectivity = connectivity;
        this.runtimeInfo = runtimeInfo;
    }

    static ProvisioningBootstrapCoordinator fromContext(Context context) {
        Context appContext = context.getApplicationContext();
        NativeAuthHttpClient httpClient = new NativeAuthHttpClient();
        String apiOrigin = SecPalNativeAuthPlugin.resolveConfiguredApiBaseUrl(
            appContext.getString(R.string.api_base_url)
        );
        NetworkState networkState = new NetworkState();

        return new ProvisioningBootstrapCoordinator(
            ProvisioningBootstrapStore.fromContext(appContext),
            (bootstrapToken, runtimeInfo) -> httpClient.exchangeBootstrapToken(apiOrigin, bootstrapToken, runtimeInfo),
            () -> networkState.isNetworkAvailable(appContext),
            ProvisioningBootstrapRuntimeInfo.fromContext(appContext)
        );
    }

    SyncOutcome syncPendingBootstrap() {
        ProvisioningBootstrapState state;

        try {
            state = store.getState();
        } catch (TokenStorageException exception) {
            store.markExchangeFailure(TOKEN_STORAGE_ERROR_CODE, true);
            return SyncOutcome.FAILED_TERMINAL;
        }

        if (!state.isPending()) {
            return SyncOutcome.SKIPPED_NOT_PENDING;
        }

        String bootstrapToken;

        try {
            bootstrapToken = store.getBootstrapToken();
        } catch (TokenStorageException exception) {
            store.markExchangeFailure(TOKEN_STORAGE_ERROR_CODE, true);
            return SyncOutcome.FAILED_TERMINAL;
        }

        if (bootstrapToken == null || bootstrapToken.trim().isEmpty()) {
            store.markExchangeFailure(MISSING_TOKEN_ERROR_CODE, true);
            return SyncOutcome.FAILED_TERMINAL;
        }

        if (!connectivity.isNetworkAvailable()) {
            return SyncOutcome.SKIPPED_OFFLINE;
        }

        try {
            store.applyExchangeResult(exchangeClient.exchange(bootstrapToken, runtimeInfo));
            return SyncOutcome.COMPLETED;
        } catch (IOException | JSONException exception) {
            store.markExchangeFailure(RETRY_ERROR_CODE, false);
            return SyncOutcome.FAILED_RETRYABLE;
        } catch (NativeAuthHttpException exception) {
            boolean terminal = isTerminalBootstrapError(exception);

            store.markExchangeFailure(SecPalNativeAuthPlugin.resolveErrorCode(exception), terminal);
            return terminal ? SyncOutcome.FAILED_TERMINAL : SyncOutcome.FAILED_RETRYABLE;
        } catch (RuntimeException exception) {
            store.markExchangeFailure(RETRY_ERROR_CODE, false);
            return SyncOutcome.FAILED_RETRYABLE;
        }
    }

    static boolean isTerminalBootstrapError(NativeAuthHttpException exception) {
        int statusCode = exception.getStatusCode();

        return statusCode == 409 || statusCode == 422;
    }
}
