/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.Test;

public class NativeAuthTaskExecutorTest {

    @Test
    public void generationGuardDoesNotBlockLifecycleInvalidationDuringMutation()
        throws Exception {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        ExecutorService workers = Executors.newFixedThreadPool(2);
        CountDownLatch mutationStarted = new CountDownLatch(1);
        CountDownLatch releaseMutation = new CountDownLatch(1);

        try {
            long generation = taskExecutor.captureGeneration();
            Future<Boolean> guardedMutation = workers.submit(() ->
                taskExecutor.runIfGenerationCurrent(generation, () -> {
                    mutationStarted.countDown();
                    releaseMutation.await();
                })
            );
            assertTrue(mutationStarted.await(2, TimeUnit.SECONDS));

            Future<?> pause = workers.submit(taskExecutor::pauseAuthenticated);
            pause.get(1, TimeUnit.SECONDS);

            releaseMutation.countDown();
            assertTrue(guardedMutation.get(2, TimeUnit.SECONDS));
        } finally {
            releaseMutation.countDown();
            workers.shutdownNow();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void authenticatedMutationDoesNotBlockLifecycleInvalidation()
        throws Exception {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        ExecutorService lifecycle = Executors.newSingleThreadExecutor();
        CountDownLatch mutationStarted = new CountDownLatch(1);
        CountDownLatch releaseMutation = new CountDownLatch(1);
        CountDownLatch taskFinished = new CountDownLatch(1);
        CountDownLatch cancellationSettled = new CountDownLatch(1);
        AtomicBoolean mutationCompleted = new AtomicBoolean(false);
        AtomicBoolean cancellationObservedCompletedMutation = new AtomicBoolean(false);

        try {
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitAuthenticated(
                    "blocking-authenticated-mutation",
                    0,
                    () -> {
                        try {
                            taskExecutor.completeAuthenticatedMutation(
                                "blocking-authenticated-mutation",
                                () -> {
                                    mutationStarted.countDown();
                                    while (releaseMutation.getCount() > 0) {
                                        try {
                                            releaseMutation.await();
                                        } catch (InterruptedException ignored) {
                                            // Model a storage mutation that cannot stop midway.
                                        }
                                    }
                                    mutationCompleted.set(true);
                                }
                            );
                        } finally {
                            taskFinished.countDown();
                        }
                    },
                    reason -> {
                        cancellationObservedCompletedMutation.set(
                            mutationCompleted.get()
                        );
                        cancellationSettled.countDown();
                    }
                )
            );
            assertTrue(mutationStarted.await(2, TimeUnit.SECONDS));

            Future<?> pause = lifecycle.submit(taskExecutor::pauseAuthenticated);
            pause.get(1, TimeUnit.SECONDS);
            assertFalse(cancellationSettled.await(100, TimeUnit.MILLISECONDS));

            releaseMutation.countDown();
            assertTrue(taskFinished.await(2, TimeUnit.SECONDS));
            assertTrue(cancellationSettled.await(2, TimeUnit.SECONDS));
            assertTrue(cancellationObservedCompletedMutation.get());
        } finally {
            releaseMutation.countDown();
            lifecycle.shutdownNow();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void credentialReplacementKeepsTransitionsClosedWithoutHoldingMonitor()
        throws Exception {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        ExecutorService workers = Executors.newFixedThreadPool(2);
        CountDownLatch replacementStarted = new CountDownLatch(1);
        CountDownLatch releaseReplacement = new CountDownLatch(1);

        try {
            long generation = taskExecutor.captureGeneration();
            Future<Boolean> replacement = workers.submit(() ->
                taskExecutor.completeCredentialReplacement(
                    generation,
                    () -> {
                        replacementStarted.countDown();
                        releaseReplacement.await();
                    },
                    () -> {}
                )
            );
            assertTrue(replacementStarted.await(2, TimeUnit.SECONDS));

            Future<NativeAuthTaskExecutor.SubmitResult> competingTransition =
                workers.submit(() -> taskExecutor.submitSessionTransition(
                    "competing-transition",
                    0,
                    () -> {},
                    reason -> {}
                ));
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.TRANSITION_IN_PROGRESS,
                competingTransition.get(1, TimeUnit.SECONDS)
            );

            releaseReplacement.countDown();
            assertTrue(replacement.get(2, TimeUnit.SECONDS));
        } finally {
            releaseReplacement.countDown();
            workers.shutdownNow();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void pausedCredentialReplacementRollsBackBeforeCompletion()
        throws Exception {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        ExecutorService workers = Executors.newSingleThreadExecutor();
        CountDownLatch replacementStarted = new CountDownLatch(1);
        CountDownLatch releaseReplacement = new CountDownLatch(1);
        AtomicBoolean rolledBack = new AtomicBoolean(false);
        AtomicBoolean completed = new AtomicBoolean(false);

        try {
            long generation = taskExecutor.captureGeneration();
            Future<Boolean> replacement = workers.submit(() ->
                taskExecutor.completeCredentialReplacement(
                    generation,
                    () -> {
                        replacementStarted.countDown();
                        releaseReplacement.await();
                    },
                    () -> rolledBack.set(true),
                    () -> completed.set(true)
                )
            );
            assertTrue(replacementStarted.await(2, TimeUnit.SECONDS));

            taskExecutor.pauseAuthenticated();
            releaseReplacement.countDown();

            assertFalse(replacement.get(2, TimeUnit.SECONDS));
            assertTrue(rolledBack.get());
            assertFalse(completed.get());
        } finally {
            releaseReplacement.countDown();
            workers.shutdownNow();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void destroyedCredentialReplacementRollsBackBeforeCompletion()
        throws Exception {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        ExecutorService workers = Executors.newSingleThreadExecutor();
        CountDownLatch replacementStarted = new CountDownLatch(1);
        CountDownLatch releaseReplacement = new CountDownLatch(1);
        AtomicBoolean rolledBack = new AtomicBoolean(false);
        AtomicBoolean completed = new AtomicBoolean(false);

        try {
            long generation = taskExecutor.captureGeneration();
            Future<Boolean> replacement = workers.submit(() ->
                taskExecutor.completeCredentialReplacement(
                    generation,
                    () -> {
                        replacementStarted.countDown();
                        releaseReplacement.await();
                    },
                    () -> rolledBack.set(true),
                    () -> completed.set(true)
                )
            );
            assertTrue(replacementStarted.await(2, TimeUnit.SECONDS));

            taskExecutor.shutdownNow();
            releaseReplacement.countDown();

            assertFalse(replacement.get(2, TimeUnit.SECONDS));
            assertTrue(rolledBack.get());
            assertFalse(completed.get());
        } finally {
            releaseReplacement.countDown();
            workers.shutdownNow();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void pausedSessionCredentialReplacementRollsBackBeforeCompletion()
        throws Exception {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        ExecutorService workers = Executors.newSingleThreadExecutor();
        CountDownLatch replacementStarted = new CountDownLatch(1);
        CountDownLatch releaseReplacement = new CountDownLatch(1);
        AtomicBoolean rolledBack = new AtomicBoolean(false);
        AtomicBoolean completed = new AtomicBoolean(false);

        try {
            long generation = taskExecutor.captureSessionGeneration();
            Future<Boolean> replacement = workers.submit(() ->
                taskExecutor.completeSessionCredentialReplacement(
                    generation,
                    () -> {
                        replacementStarted.countDown();
                        releaseReplacement.await();
                    },
                    () -> rolledBack.set(true),
                    () -> completed.set(true)
                )
            );
            assertTrue(replacementStarted.await(2, TimeUnit.SECONDS));

            taskExecutor.pauseAuthenticated();
            releaseReplacement.countDown();

            assertFalse(replacement.get(2, TimeUnit.SECONDS));
            assertTrue(rolledBack.get());
            assertFalse(completed.get());
        } finally {
            releaseReplacement.countDown();
            workers.shutdownNow();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void memoryBudgetAccountsForBase64AndBridgeRepresentations() {
        assertEquals(
            NativeAuthRequestPolicy.MAX_RESPONSE_BODY_BYTES * 10,
            NativeAuthTaskExecutor.MAX_RESPONSE_WORKING_SET_BYTES
        );
        assertEquals(
            44 * 1024 * 1024,
            NativeAuthTaskExecutor.estimateRequestReservationBytes(
                NativeAuthRequestPolicy.MAX_REQUEST_BODY_BYTES
            )
        );
        assertTrue(
            NativeAuthTaskExecutor.MAX_AGGREGATE_BUFFERED_BYTES
                >= NativeAuthTaskExecutor.MAX_RESPONSE_WORKING_SET_BYTES
                    + NativeAuthTaskExecutor.MAX_AUXILIARY_RESPONSE_WORKING_SET_BYTES
                    + NativeAuthTaskExecutor.estimateRequestReservationBytes(
                        NativeAuthRequestPolicy.MAX_REQUEST_BODY_BYTES
                    )
        );
    }

    @Test
    public void defaultExecutorRejectsWorkBeyondItsExplicitCapacity()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        CountDownLatch workersStarted = new CountDownLatch(
            NativeAuthTaskExecutor.MAX_CONCURRENT_TASKS
        );
        CountDownLatch releaseWorkers = new CountDownLatch(1);

        try {
            for (int index = 0; index < NativeAuthTaskExecutor.MAX_CONCURRENT_TASKS; index++) {
                assertTrue(taskExecutor.submit(() -> {
                    workersStarted.countDown();
                    try {
                        releaseWorkers.await();
                    } catch (InterruptedException exception) {
                        Thread.currentThread().interrupt();
                    }
                }));
            }
            assertTrue(workersStarted.await(2, TimeUnit.SECONDS));

            for (int index = 0; index < NativeAuthTaskExecutor.MAX_QUEUED_TASKS; index++) {
                assertTrue(taskExecutor.submit(() -> {
                    // Deliberately queued behind the blocked workers.
                }));
            }

            assertFalse(taskExecutor.submit(() -> {
                // Must never enter an unbounded work queue.
            }));
        } finally {
            releaseWorkers.countDown();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void sessionTransitionDoesNotWaitForRunningOrdinaryWork()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        CountDownLatch blockerStarted = new CountDownLatch(1);
        CountDownLatch releaseBlocker = new CountDownLatch(1);
        CountDownLatch transitionStarted = new CountDownLatch(1);
        CountDownLatch evicted = new CountDownLatch(
            NativeAuthTaskExecutor.MAX_QUEUED_TASKS
        );
        AtomicReference<String> evictionReason = new AtomicReference<>();

        try {
            assertTrue(taskExecutor.submit(() -> {
                blockerStarted.countDown();
                try {
                    releaseBlocker.await();
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                }
            }));
            assertTrue(blockerStarted.await(2, TimeUnit.SECONDS));

            for (int index = 0; index < NativeAuthTaskExecutor.MAX_QUEUED_TASKS; index++) {
                assertTrue(taskExecutor.submit(
                    () -> {},
                    exception -> {},
                    reason -> {
                        evictionReason.compareAndSet(null, reason);
                        evicted.countDown();
                    }
                ));
            }

            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitSessionTransition(
                    "capacity-safe-logout",
                    0,
                    transitionStarted::countDown,
                    reason -> {}
                )
            );
            assertTrue(evicted.await(2, TimeUnit.SECONDS));
            assertEquals("SESSION_INVALIDATED", evictionReason.get());
            assertTrue(transitionStarted.await(2, TimeUnit.SECONDS));

            releaseBlocker.countDown();
        } finally {
            releaseBlocker.countDown();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void generationBoundMutationFinishesBeforeSessionTransitionStarts()
        throws Exception {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        long generation = taskExecutor.captureGeneration();
        CountDownLatch mutationStarted = new CountDownLatch(1);
        CountDownLatch releaseMutation = new CountDownLatch(1);
        CountDownLatch transitionStarted = new CountDownLatch(1);

        try {
            assertTrue(taskExecutor.submit(() -> {
                try {
                    assertTrue(taskExecutor.runIfGenerationCurrent(generation, () -> {
                        mutationStarted.countDown();
                        releaseMutation.await();
                    }));
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                }
            }));
            assertTrue(mutationStarted.await(2, TimeUnit.SECONDS));

            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.TRANSITION_IN_PROGRESS,
                taskExecutor.submitSessionTransition(
                    "ordered-push-logout",
                    0,
                    transitionStarted::countDown,
                    reason -> {}
                )
            );
            assertFalse(transitionStarted.await(100, TimeUnit.MILLISECONDS));
            releaseMutation.countDown();
            assertTrue(taskExecutor.awaitIdleForTest(2, TimeUnit.SECONDS));
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitSessionTransition(
                    "ordered-push-logout-retry",
                    0,
                    transitionStarted::countDown,
                    reason -> {}
                )
            );
            assertTrue(transitionStarted.await(2, TimeUnit.SECONDS));
        } finally {
            releaseMutation.countDown();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void generationBoundMutationIsRejectedAfterSessionTransitionStarts()
        throws Exception {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        long generation = taskExecutor.captureGeneration();
        CountDownLatch transitionStarted = new CountDownLatch(1);
        CountDownLatch releaseTransition = new CountDownLatch(1);
        AtomicBoolean mutationRan = new AtomicBoolean(false);

        try {
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitSessionTransition(
                    "reject-stale-push",
                    0,
                    () -> {
                        transitionStarted.countDown();
                        try {
                            releaseTransition.await();
                        } catch (InterruptedException exception) {
                            Thread.currentThread().interrupt();
                        }
                    },
                    reason -> {}
                )
            );
            assertTrue(transitionStarted.await(2, TimeUnit.SECONDS));

            assertFalse(taskExecutor.runIfGenerationCurrent(
                generation,
                () -> mutationRan.set(true)
            ));
            assertFalse(mutationRan.get());
        } finally {
            releaseTransition.countDown();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void rejectedSessionTransitionDoesNotInvalidateExistingAuthenticatedWork()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        CountDownLatch existingStarted = new CountDownLatch(1);
        CountDownLatch releaseExisting = new CountDownLatch(1);
        AtomicReference<String> cancellationReason = new AtomicReference<>();

        try {
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitAuthenticated(
                    "duplicate-transition-id",
                    0,
                    () -> {
                        existingStarted.countDown();
                        while (releaseExisting.getCount() > 0) {
                            try {
                                releaseExisting.await();
                            } catch (InterruptedException ignored) {
                                // Keep the original operation alive to expose premature invalidation.
                            }
                        }
                    },
                    cancellationReason::set
                )
            );
            assertTrue(existingStarted.await(2, TimeUnit.SECONDS));

            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.DUPLICATE_ID,
                taskExecutor.submitSessionTransition(
                    "duplicate-transition-id",
                    0,
                    () -> {},
                    reason -> {}
                )
            );
            assertNull(cancellationReason.get());
        } finally {
            releaseExisting.countDown();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void authenticatedSmallRequestsReachTheExplicitQueueCapacity()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        CountDownLatch running = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);

        try {
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitAuthenticated(
                    "small-running",
                    0,
                    () -> {
                        running.countDown();
                        try {
                            release.await();
                        } catch (InterruptedException exception) {
                            Thread.currentThread().interrupt();
                        }
                    },
                    reason -> {}
                )
            );
            assertTrue(running.await(2, TimeUnit.SECONDS));

            for (int index = 0; index < NativeAuthTaskExecutor.MAX_QUEUED_TASKS; index++) {
                assertEquals(
                    NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                    taskExecutor.submitAuthenticated(
                        "small-queued-" + index,
                        0,
                        () -> {},
                        reason -> {}
                    )
                );
            }

            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.OVERLOADED,
                taskExecutor.submitAuthenticated("small-overload", 0, () -> {}, reason -> {})
            );
        } finally {
            release.countDown();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void submittedJobsRunOnTheExecutor() throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor(Executors.newSingleThreadExecutor());
        CountDownLatch latch = new CountDownLatch(1);

        try {
            assertTrue(taskExecutor.submit(latch::countDown));
            assertTrue(latch.await(2, TimeUnit.SECONDS));
        } finally {
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void shutdownPreventsNewJobs() {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor(Executors.newSingleThreadExecutor());

        taskExecutor.shutdownNow();

        assertFalse(taskExecutor.submit(() -> {
            // no-op
        }));
    }

    @Test
    public void shutdownSettlesOrdinaryWorkThatNeverStarted()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        CountDownLatch blockerStarted = new CountDownLatch(1);
        CountDownLatch releaseBlocker = new CountDownLatch(1);
        CountDownLatch queuedCancellation = new CountDownLatch(1);
        AtomicReference<String> cancellationReason = new AtomicReference<>();

        assertTrue(taskExecutor.submit(() -> {
            blockerStarted.countDown();
            try {
                releaseBlocker.await();
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
            }
        }));
        assertTrue(blockerStarted.await(2, TimeUnit.SECONDS));
        assertTrue(taskExecutor.submit(
            () -> {},
            exception -> {},
            reason -> {
                cancellationReason.set(reason);
                queuedCancellation.countDown();
            }
        ));

        taskExecutor.shutdownNow();
        releaseBlocker.countDown();

        assertTrue(queuedCancellation.await(2, TimeUnit.SECONDS));
        assertEquals("PLUGIN_SHUTDOWN", cancellationReason.get());
    }

    @Test
    public void submittedRuntimeFailuresReachTheSettlementHandler()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor(Executors.newSingleThreadExecutor());
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<RuntimeException> captured = new AtomicReference<>();
        RuntimeException failure = new IllegalArgumentException("invalid request property");

        try {
            assertTrue(taskExecutor.submit(
                () -> { throw failure; },
                exception -> {
                    captured.set(exception);
                    latch.countDown();
                }
            ));
            assertTrue(latch.await(2, TimeUnit.SECONDS));
            assertTrue(captured.get() == failure);
        } finally {
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void managedRuntimeFailuresReachTheSettlementHandler()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor(
            Executors.newSingleThreadExecutor()
        );
        CountDownLatch failureSettled = new CountDownLatch(1);
        AtomicReference<RuntimeException> captured = new AtomicReference<>();
        RuntimeException failure = new IllegalStateException("native interop failed");

        try {
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitAuthenticated(
                    "managed-runtime-failure",
                    0,
                    () -> { throw failure; },
                    reason -> {},
                    exception -> {
                        captured.set(exception);
                        failureSettled.countDown();
                    }
                )
            );
            assertTrue(failureSettled.await(2, TimeUnit.SECONDS));
            assertTrue(captured.get() == failure);
        } finally {
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void sessionTransitionRuntimeFailuresReachTheSettlementHandler()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor(
            Executors.newSingleThreadExecutor()
        );
        CountDownLatch failureSettled = new CountDownLatch(1);
        AtomicReference<RuntimeException> captured = new AtomicReference<>();
        RuntimeException failure = new IllegalStateException("runtime mutation failed");

        try {
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitSessionTransition(
                    "transition-runtime-failure",
                    0,
                    () -> { throw failure; },
                    reason -> {},
                    reason -> {},
                    exception -> {
                        captured.set(exception);
                        failureSettled.countDown();
                    }
                )
            );
            assertTrue(failureSettled.await(2, TimeUnit.SECONDS));
            assertTrue(captured.get() == failure);
        } finally {
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void invalidationCancelsRunningAndQueuedAuthenticatedWorkAndReleasesBytes()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        CountDownLatch started = new CountDownLatch(
            NativeAuthTaskExecutor.MAX_CONCURRENT_TASKS
        );
        CountDownLatch cancelled = new CountDownLatch(
            NativeAuthTaskExecutor.MAX_CONCURRENT_TASKS + 1
        );
        CountDownLatch runningTasksFinished = new CountDownLatch(
            NativeAuthTaskExecutor.MAX_CONCURRENT_TASKS
        );

        try {
            for (int index = 0; index < NativeAuthTaskExecutor.MAX_CONCURRENT_TASKS + 1; index++) {
                String requestId = "request-" + index;
                assertEquals(
                    NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                    taskExecutor.submitAuthenticated(
                        requestId,
                        1024,
                        () -> {
                            started.countDown();
                            try {
                                Thread.sleep(10_000L);
                            } catch (InterruptedException exception) {
                                Thread.currentThread().interrupt();
                            } finally {
                                runningTasksFinished.countDown();
                            }
                        },
                        reason -> {
                            assertEquals("SESSION_INVALIDATED", reason);
                            cancelled.countDown();
                        }
                    )
                );
            }
            assertTrue(started.await(2, TimeUnit.SECONDS));

            taskExecutor.invalidateAuthenticated("SESSION_INVALIDATED");

            assertTrue(cancelled.await(2, TimeUnit.SECONDS));
            assertTrue(runningTasksFinished.await(2, TimeUnit.SECONDS));
            long reservationDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            while (taskExecutor.getReservedBufferedBytesForTest() != 0
                && System.nanoTime() < reservationDeadline) {
                Thread.yield();
            }
            assertEquals(0, taskExecutor.getReservedBufferedBytesForTest());
        } finally {
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void backgroundRejectsNewAuthenticatedWorkUntilForegrounded() {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();

        try {
            taskExecutor.pauseAuthenticated();
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.BACKGROUNDED,
                taskExecutor.submitAuthenticated("background", 0, () -> {}, reason -> {})
            );

            taskExecutor.resumeAuthenticated();
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitAuthenticated("foreground", 0, () -> {}, reason -> {})
            );
        } finally {
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void backgroundCancelsQueuedOrdinaryWorkWithTheLifecycleReason()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        CountDownLatch blockerStarted = new CountDownLatch(1);
        CountDownLatch releaseBlocker = new CountDownLatch(1);
        CountDownLatch queuedCancelled = new CountDownLatch(1);
        AtomicReference<String> cancellationReason = new AtomicReference<>();

        try {
            assertTrue(taskExecutor.submit(() -> {
                blockerStarted.countDown();
                try {
                    releaseBlocker.await();
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                }
            }));
            assertTrue(blockerStarted.await(2, TimeUnit.SECONDS));
            assertTrue(taskExecutor.submit(
                () -> {},
                exception -> {},
                reason -> {
                    cancellationReason.set(reason);
                    queuedCancelled.countDown();
                }
            ));

            taskExecutor.pauseAuthenticated();

            assertTrue(queuedCancelled.await(2, TimeUnit.SECONDS));
            assertEquals("APP_BACKGROUNDED", cancellationReason.get());
        } finally {
            releaseBlocker.countDown();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void nativePasskeySessionBindingSurvivesPauseButNotTenantInvalidation()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        long sessionGeneration = taskExecutor.captureSessionGeneration();
        CountDownLatch transitionStarted = new CountDownLatch(1);
        CountDownLatch releaseTransition = new CountDownLatch(1);

        try {
            taskExecutor.pauseAuthenticated();
            taskExecutor.resumeAuthenticated();

            assertTrue(taskExecutor.isSessionGenerationCurrent(sessionGeneration));
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitSessionTransition(
                    "runtime-switch",
                    0,
                    () -> {
                        transitionStarted.countDown();
                        try {
                            releaseTransition.await();
                        } catch (InterruptedException exception) {
                            Thread.currentThread().interrupt();
                        }
                    },
                    reason -> {}
                )
            );
            assertTrue(transitionStarted.await(2, TimeUnit.SECONDS));
            assertFalse(taskExecutor.isSessionGenerationCurrent(sessionGeneration));
        } finally {
            releaseTransition.countDown();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void credentialReplacementInvalidatesOldWorkBeforeNewAdmission()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        long credentialGeneration = taskExecutor.captureGeneration();
        AtomicReference<String> cancellationReason = new AtomicReference<>();
        CountDownLatch oldStarted = new CountDownLatch(1);

        try {
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitAuthenticated(
                    "old-credential",
                    0,
                    () -> {
                        oldStarted.countDown();
                        try {
                            Thread.sleep(10_000L);
                        } catch (InterruptedException exception) {
                            Thread.currentThread().interrupt();
                        }
                    },
                    cancellationReason::set
                )
            );
            assertTrue(oldStarted.await(2, TimeUnit.SECONDS));

            assertTrue(taskExecutor.completeCredentialReplacement(
                credentialGeneration,
                () -> {},
                () -> {}
            ));

            assertEquals("SESSION_INVALIDATED", cancellationReason.get());
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitAuthenticated(
                    "replacement-active",
                    0,
                    () -> {},
                    reason -> {}
                )
            );
        } finally {
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void aggregateRequestRepresentationsBoundLargeUploadAdmission()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        CountDownLatch running = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);

        try {
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitAuthenticated(
                    "large-upload",
                    NativeAuthRequestPolicy.MAX_REQUEST_BODY_BYTES,
                    () -> {
                        running.countDown();
                        try {
                            release.await();
                        } catch (InterruptedException exception) {
                            Thread.currentThread().interrupt();
                        }
                    },
                    reason -> {}
                )
            );
            assertTrue(running.await(2, TimeUnit.SECONDS));
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.BUFFER_LIMIT,
                taskExecutor.submitAuthenticated(
                    "second-large-upload",
                    NativeAuthRequestPolicy.MAX_REQUEST_BODY_BYTES,
                    () -> {},
                    reason -> {}
                )
            );
        } finally {
            release.countDown();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void totalLifetimeCancelsSlowAuthenticatedWorkExactlyOnce()
        throws InterruptedException {
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor(
            Executors.newSingleThreadExecutor(),
            scheduler,
            50L
        );
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch cancelled = new CountDownLatch(1);
        AtomicInteger terminalCallbacks = new AtomicInteger();
        AtomicReference<String> cancellationReason = new AtomicReference<>();

        try {
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitAuthenticated(
                    "slow-request",
                    0,
                    () -> {
                        started.countDown();
                        try {
                            Thread.sleep(10_000L);
                        } catch (InterruptedException exception) {
                            Thread.currentThread().interrupt();
                        }
                    },
                    reason -> {
                        cancellationReason.set(reason);
                        terminalCallbacks.incrementAndGet();
                        cancelled.countDown();
                    }
                )
            );
            assertTrue(started.await(2, TimeUnit.SECONDS));
            assertTrue(cancelled.await(2, TimeUnit.SECONDS));
            assertEquals("REQUEST_TIMEOUT", cancellationReason.get());
            assertEquals(1, terminalCallbacks.get());
        } finally {
            taskExecutor.shutdownNow();
            scheduler.shutdownNow();
        }
    }

    @Test
    public void completedTasksDoNotAccumulateCancelledDeadlineFutures()
        throws InterruptedException {
        ScheduledThreadPoolExecutor scheduler = new ScheduledThreadPoolExecutor(1);
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor(
            Executors.newSingleThreadExecutor(),
            scheduler,
            10_000L
        );
        CountDownLatch completed = new CountDownLatch(32);

        try {
            for (int index = 0; index < 32; index++) {
                String requestId = "deadline-cleanup-" + index;
                NativeAuthTaskExecutor.SubmitResult result;
                do {
                    result = taskExecutor.submitAuthenticated(
                        requestId,
                        0,
                        completed::countDown,
                        reason -> {}
                    );
                    if (result == NativeAuthTaskExecutor.SubmitResult.OVERLOADED) {
                        Thread.yield();
                    }
                } while (result == NativeAuthTaskExecutor.SubmitResult.OVERLOADED);
                assertEquals(NativeAuthTaskExecutor.SubmitResult.ACCEPTED, result);
            }

            assertTrue(completed.await(2, TimeUnit.SECONDS));
            assertTrue(taskExecutor.awaitIdleForTest(2, TimeUnit.SECONDS));
            assertEquals(0, scheduler.getQueue().size());
        } finally {
            taskExecutor.shutdownNow();
            scheduler.shutdownNow();
        }
    }

    @Test
    public void timedOutSessionTransitionCannotBeginItsMutationAfterCancellation()
        throws InterruptedException {
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor(
            Executors.newSingleThreadExecutor(),
            scheduler,
            50L
        );
        CountDownLatch mutationStarted = new CountDownLatch(1);
        CountDownLatch releaseMutation = new CountDownLatch(1);
        CountDownLatch cancellationSettled = new CountDownLatch(1);
        CountDownLatch jobFinished = new CountDownLatch(1);
        AtomicReference<Boolean> committedAtSettlement = new AtomicReference<>();
        AtomicReference<Boolean> committed = new AtomicReference<>(false);
        AtomicReference<Boolean> commitAccepted = new AtomicReference<>();

        try {
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitSessionTransition(
                    "non-interruptible-runtime-mutation",
                    0,
                    () -> {
                        mutationStarted.countDown();
                        while (releaseMutation.getCount() > 0) {
                            try {
                                releaseMutation.await();
                            } catch (InterruptedException ignored) {
                                // Preference and keystore writes cannot be interrupted safely.
                            }
                        }
                        commitAccepted.set(taskExecutor.completeAuthenticatedMutation(
                            "non-interruptible-runtime-mutation",
                            () -> committed.set(true)
                        ));
                        jobFinished.countDown();
                    },
                    reason -> {
                        assertEquals("REQUEST_TIMEOUT", reason);
                        committedAtSettlement.set(committed.get());
                        cancellationSettled.countDown();
                    }
                )
            );
            assertTrue(mutationStarted.await(2, TimeUnit.SECONDS));
            assertTrue(cancellationSettled.await(2, TimeUnit.SECONDS));
            assertEquals(Boolean.FALSE, committedAtSettlement.get());

            releaseMutation.countDown();

            assertTrue(jobFinished.await(2, TimeUnit.SECONDS));
            assertEquals(Boolean.FALSE, commitAccepted.get());
            assertEquals(Boolean.FALSE, committed.get());
        } finally {
            releaseMutation.countDown();
            taskExecutor.shutdownNow();
            scheduler.shutdownNow();
        }
    }

    @Test
    public void sessionTransitionInvalidatesOldWorkAndEndsWhenItsTaskFinishes()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        CountDownLatch oldStarted = new CountDownLatch(1);
        CountDownLatch oldCancelled = new CountDownLatch(1);
        CountDownLatch transitionStarted = new CountDownLatch(1);
        CountDownLatch releaseTransition = new CountDownLatch(1);

        try {
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitAuthenticated(
                    "old-session",
                    0,
                    () -> {
                        oldStarted.countDown();
                        try {
                            Thread.sleep(10_000L);
                        } catch (InterruptedException exception) {
                            Thread.currentThread().interrupt();
                        }
                    },
                    reason -> oldCancelled.countDown()
                )
            );
            assertTrue(oldStarted.await(2, TimeUnit.SECONDS));

            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitSessionTransition(
                    "logout-transition",
                    0,
                    () -> {
                        transitionStarted.countDown();
                        try {
                            releaseTransition.await();
                        } catch (InterruptedException exception) {
                            Thread.currentThread().interrupt();
                        }
                    },
                    reason -> {}
                )
            );
            assertTrue(oldCancelled.await(2, TimeUnit.SECONDS));
            assertTrue(transitionStarted.await(2, TimeUnit.SECONDS));
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.TRANSITION_IN_PROGRESS,
                taskExecutor.submitAuthenticated("new-session-too-early", 0, () -> {}, reason -> {})
            );

            releaseTransition.countDown();
            long transitionDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            NativeAuthTaskExecutor.SubmitResult result;
            do {
                result = taskExecutor.submitAuthenticated(
                    "new-session",
                    0,
                    () -> {},
                    reason -> {}
                );
                if (result == NativeAuthTaskExecutor.SubmitResult.TRANSITION_IN_PROGRESS) {
                    Thread.yield();
                }
            } while (result == NativeAuthTaskExecutor.SubmitResult.TRANSITION_IN_PROGRESS
                && System.nanoTime() < transitionDeadline);
            assertEquals(NativeAuthTaskExecutor.SubmitResult.ACCEPTED, result);
        } finally {
            releaseTransition.countDown();
            taskExecutor.shutdownNow();
        }
    }

    @Test
    public void backgroundCancelsARunningSessionTransitionAndReleasesItsGate()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        CountDownLatch transitionStarted = new CountDownLatch(1);
        CountDownLatch releaseTransition = new CountDownLatch(1);
        CountDownLatch transitionFinished = new CountDownLatch(1);
        CountDownLatch transitionCancelled = new CountDownLatch(1);

        try {
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitSessionTransition(
                    "running-runtime-reset",
                    0,
                    () -> {
                        transitionStarted.countDown();
                        try {
                            while (releaseTransition.getCount() > 0) {
                                try {
                                    releaseTransition.await();
                                } catch (InterruptedException ignored) {
                                    // Keep the transition open until the cancellation is observed.
                                }
                            }
                        } finally {
                            transitionFinished.countDown();
                        }
                    },
                    reason -> {
                        assertEquals("APP_BACKGROUNDED", reason);
                        transitionCancelled.countDown();
                    }
                )
            );
            assertTrue(transitionStarted.await(2, TimeUnit.SECONDS));

            taskExecutor.pauseAuthenticated();

            assertTrue(transitionCancelled.await(2, TimeUnit.SECONDS));
            releaseTransition.countDown();
            assertTrue(transitionFinished.await(2, TimeUnit.SECONDS));
            taskExecutor.resumeAuthenticated();
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitAuthenticated(
                    "foreground-after-reset-cancel",
                    0,
                    () -> {},
                    reason -> {}
                )
            );
        } finally {
            releaseTransition.countDown();
            taskExecutor.shutdownNow();
        }
    }
}
