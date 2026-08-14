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
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.Test;

public class NativeAuthTaskExecutorTest {

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
    public void sessionTransitionEvictsQueuedOrdinaryWorkInsteadOfRejectingTeardown()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        CountDownLatch blockerStarted = new CountDownLatch(1);
        CountDownLatch releaseBlocker = new CountDownLatch(1);
        CountDownLatch transitionStarted = new CountDownLatch(1);
        CountDownLatch evicted = new CountDownLatch(
            NativeAuthTaskExecutor.MAX_QUEUED_TASKS
        );

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
                    exception -> evicted.countDown()
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

            releaseBlocker.countDown();
            assertTrue(transitionStarted.await(2, TimeUnit.SECONDS));
        } finally {
            releaseBlocker.countDown();
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
        CountDownLatch queuedFailure = new CountDownLatch(1);

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
            exception -> queuedFailure.countDown()
        ));

        taskExecutor.shutdownNow();
        releaseBlocker.countDown();

        assertTrue(queuedFailure.await(2, TimeUnit.SECONDS));
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
    public void credentialReplacementInvalidatesOldWorkBeforeNewAdmission()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
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

            taskExecutor.beginSessionTransition();

            assertEquals("SESSION_INVALIDATED", cancellationReason.get());
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.TRANSITION_IN_PROGRESS,
                taskExecutor.submitAuthenticated(
                    "replacement-not-active",
                    0,
                    () -> {},
                    reason -> {}
                )
            );
            taskExecutor.endSessionTransition();
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
    public void runningSessionTransitionSettlesCancellationOnlyAfterMutationStops()
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
        AtomicReference<Boolean> committedAtSettlement = new AtomicReference<>();
        AtomicReference<Boolean> committed = new AtomicReference<>(false);

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
                        committed.set(true);
                    },
                    reason -> {
                        assertEquals("REQUEST_TIMEOUT", reason);
                        committedAtSettlement.set(committed.get());
                        cancellationSettled.countDown();
                    }
                )
            );
            assertTrue(mutationStarted.await(2, TimeUnit.SECONDS));
            assertFalse(cancellationSettled.await(150, TimeUnit.MILLISECONDS));

            releaseMutation.countDown();

            assertTrue(cancellationSettled.await(2, TimeUnit.SECONDS));
            assertEquals(Boolean.TRUE, committedAtSettlement.get());
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
    public void backgroundCancelsAQueuedSessionTransitionAndReleasesItsGate()
        throws InterruptedException {
        NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
        CountDownLatch blockerStarted = new CountDownLatch(1);
        CountDownLatch releaseBlocker = new CountDownLatch(1);
        CountDownLatch transitionCancelled = new CountDownLatch(1);

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
            assertEquals(
                NativeAuthTaskExecutor.SubmitResult.ACCEPTED,
                taskExecutor.submitSessionTransition(
                    "queued-runtime-reset",
                    0,
                    () -> {},
                    reason -> {
                        assertEquals("APP_BACKGROUNDED", reason);
                        transitionCancelled.countDown();
                    }
                )
            );

            taskExecutor.pauseAuthenticated();

            assertTrue(transitionCancelled.await(2, TimeUnit.SECONDS));
            releaseBlocker.countDown();
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
            releaseBlocker.countDown();
            taskExecutor.shutdownNow();
        }
    }
}
