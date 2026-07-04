/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

class NativeAuthTaskExecutor {
    private final ExecutorService executorService;

    NativeAuthTaskExecutor() {
        this(Executors.newSingleThreadExecutor());
    }

    NativeAuthTaskExecutor(ExecutorService executorService) {
        this.executorService = executorService;
    }

    boolean submit(Runnable job) {
        if (executorService.isShutdown()) {
            return false;
        }

        try {
            executorService.submit(job);
        } catch (java.util.concurrent.RejectedExecutionException ignored) {
            return false;
        }

        return true;
    }

    void shutdownNow() {
        executorService.shutdownNow();
    }
}
