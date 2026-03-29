/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.junit.Test;

public class NativeAuthTaskExecutorTest {

    @Test
    public void submittedJobsRunOnTheExecutor() throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor(Executors.newSingleThreadExecutor());
        CountDownLatch latch = new CountDownLatch(1);

        assertTrue(taskExecutor.submit(latch::countDown));
        assertTrue(latch.await(2, TimeUnit.SECONDS));

        taskExecutor.shutdownNow();
    }

    @Test
    public void shutdownPreventsNewJobs() {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor(Executors.newSingleThreadExecutor());

        taskExecutor.shutdownNow();

        assertFalse(taskExecutor.submit(() -> {
            // no-op
        }));
    }
}