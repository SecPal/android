/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import java.util.ArrayList;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/** Bounded scheduling and cancellation policy for native authenticated work. */
class NativeAuthTaskExecutor {
    static final int MAX_CONCURRENT_TASKS = 1;
    static final int MAX_QUEUED_TASKS = 8;
    static final long MAX_TASK_LIFETIME_MILLIS =
        NativeAuthHttpClient.TOTAL_REQUEST_LIFETIME_MILLIS;
    static final int MAX_AGGREGATE_BUFFERED_BYTES = 128 * 1024 * 1024;
    // One response can be assembled at a time. Ten decoded-body equivalents conservatively
    // cover three raw-buffer copies, four equivalents for Base64 bytes plus the UTF-16 Java
    // string, and three equivalents for JSON/bridge serialization.
    static final int RESPONSE_WORKING_SET_MULTIPLIER = 10;
    static final int MAX_RESPONSE_WORKING_SET_BYTES =
        NativeAuthRequestPolicy.MAX_RESPONSE_BODY_BYTES * RESPONSE_WORKING_SET_MULTIPLIER;
    static final int MIN_TASK_RESERVATION_BYTES = 64 * 1024;

    enum SubmitResult {
        ACCEPTED,
        OVERLOADED,
        BUFFER_LIMIT,
        BACKGROUNDED,
        SHUTDOWN,
        DUPLICATE_ID
    }

    private final ExecutorService executorService;
    private final ScheduledExecutorService lifetimeScheduler;
    private final long taskLifetimeMillis;
    private final Map<String, ManagedTask> authenticatedTasks = new ConcurrentHashMap<>();
    private final Object generationLock = new Object();
    private final AtomicLong generation = new AtomicLong();
    private final AtomicInteger reservedBufferedBytes = new AtomicInteger();
    private final AtomicInteger sessionTransitions = new AtomicInteger();
    private volatile boolean authenticatedWorkPaused;

    NativeAuthTaskExecutor() {
        this(new ThreadPoolExecutor(
            MAX_CONCURRENT_TASKS,
            MAX_CONCURRENT_TASKS,
            0L,
            TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(MAX_QUEUED_TASKS),
            namedDaemonThreadFactory("secpal-native-auth")
        ));
    }

    NativeAuthTaskExecutor(ExecutorService executorService) {
        this(
            executorService,
            Executors.newSingleThreadScheduledExecutor(
                namedDaemonThreadFactory("secpal-native-auth-deadline")
            ),
            MAX_TASK_LIFETIME_MILLIS
        );
    }

    NativeAuthTaskExecutor(
        ExecutorService executorService,
        ScheduledExecutorService lifetimeScheduler,
        long taskLifetimeMillis
    ) {
        if (taskLifetimeMillis <= 0) {
            throw new IllegalArgumentException("Authenticated task lifetime must be positive");
        }
        this.executorService = executorService;
        this.lifetimeScheduler = lifetimeScheduler;
        this.taskLifetimeMillis = taskLifetimeMillis;
    }

    boolean submit(Runnable job) {
        if (executorService.isShutdown()) {
            return false;
        }

        try {
            executorService.execute(job);
        } catch (RejectedExecutionException ignored) {
            return false;
        }

        return true;
    }

    boolean submit(Runnable job, Consumer<RuntimeException> failureHandler) {
        return submit(() -> {
            try {
                job.run();
            } catch (RuntimeException exception) {
                failureHandler.accept(exception);
            }
        });
    }

    SubmitResult submitAuthenticated(
        String requestId,
        int requestBodyBytes,
        Runnable job,
        Consumer<String> cancellationHandler
    ) {
        synchronized (generationLock) {
            if (executorService.isShutdown()) {
                return SubmitResult.SHUTDOWN;
            }
            if (authenticatedWorkPaused || sessionTransitions.get() > 0) {
                return SubmitResult.BACKGROUNDED;
            }
            return submitManagedLocked(
                requestId,
                requestBodyBytes,
                false,
                job,
                cancellationHandler
            );
        }
    }

    SubmitResult submitSessionTransition(
        String requestId,
        int requestBodyBytes,
        Runnable job,
        Consumer<String> cancellationHandler
    ) {
        synchronized (generationLock) {
            if (executorService.isShutdown()) {
                return SubmitResult.SHUTDOWN;
            }
            if (authenticatedWorkPaused || sessionTransitions.get() > 0) {
                return SubmitResult.BACKGROUNDED;
            }

            sessionTransitions.incrementAndGet();
            invalidateAuthenticatedLocked("SESSION_INVALIDATED");
            SubmitResult result = submitManagedLocked(
                requestId,
                requestBodyBytes,
                true,
                job,
                cancellationHandler
            );
            if (result != SubmitResult.ACCEPTED) {
                endSessionTransition();
            }
            return result;
        }
    }

    boolean cancelAuthenticated(String requestId) {
        ManagedTask task = authenticatedTasks.get(requestId);
        return task != null && task.cancel("REQUEST_CANCELLED");
    }

    boolean completeAuthenticated(String requestId, Runnable completion) {
        synchronized (generationLock) {
            ManagedTask task = authenticatedTasks.get(requestId);
            if (task == null || task.cancelled.get()
                || task.submittedGeneration != generation.get()) {
                return false;
            }
            completion.run();
            return true;
        }
    }

    void invalidateAuthenticated(String reasonCode) {
        synchronized (generationLock) {
            invalidateAuthenticatedLocked(reasonCode);
        }
    }

    void pauseAuthenticated() {
        authenticatedWorkPaused = true;
        invalidateAuthenticated("APP_BACKGROUNDED");
    }

    void resumeAuthenticated() {
        authenticatedWorkPaused = false;
    }

    void beginSessionTransition() {
        sessionTransitions.incrementAndGet();
        invalidateAuthenticated("SESSION_INVALIDATED");
    }

    void endSessionTransition() {
        sessionTransitions.updateAndGet(value -> Math.max(0, value - 1));
    }

    int getReservedBufferedBytesForTest() {
        return reservedBufferedBytes.get();
    }

    void shutdownNow() {
        authenticatedWorkPaused = true;
        invalidateAuthenticated("PLUGIN_SHUTDOWN");
        executorService.shutdownNow();
        lifetimeScheduler.shutdownNow();
    }

    private boolean reserveBufferedBytes(int bytes) {
        while (true) {
            int current = reservedBufferedBytes.get();
            int requestBudgetBytes = MAX_AGGREGATE_BUFFERED_BYTES
                - MAX_RESPONSE_WORKING_SET_BYTES;
            if (bytes > requestBudgetBytes - current) {
                return false;
            }
            if (reservedBufferedBytes.compareAndSet(current, current + bytes)) {
                return true;
            }
        }
    }

    private void releaseBufferedBytes(int bytes) {
        reservedBufferedBytes.addAndGet(-bytes);
    }

    private void removeQueuedTask(ManagedTask task) {
        if (executorService instanceof ThreadPoolExecutor) {
            ((ThreadPoolExecutor) executorService).remove(task);
        }
    }

    static int estimateRequestReservationBytes(int requestBodyBytes) {
        if (requestBodyBytes < 0
            || requestBodyBytes > NativeAuthRequestPolicy.MAX_REQUEST_BODY_BYTES) {
            return -1;
        }
        long encodedCharacters = ((long) requestBodyBytes + 2L) / 3L * 4L;
        long encodedStringBytes = encodedCharacters * Character.BYTES;
        long reservation = requestBodyBytes + encodedStringBytes;
        return (int) Math.max(MIN_TASK_RESERVATION_BYTES, reservation);
    }

    private SubmitResult submitManagedLocked(
        String requestId,
        int requestBodyBytes,
        boolean sessionTransition,
        Runnable job,
        Consumer<String> cancellationHandler
    ) {
        int bufferReservationBytes = estimateRequestReservationBytes(requestBodyBytes);
        if (bufferReservationBytes < 0) {
            return SubmitResult.BUFFER_LIMIT;
        }
        if (!reserveBufferedBytes(bufferReservationBytes)) {
            return SubmitResult.BUFFER_LIMIT;
        }

        ManagedTask task = new ManagedTask(
            requestId,
            bufferReservationBytes,
            generation.get(),
            sessionTransition,
            job,
            cancellationHandler
        );
        if (authenticatedTasks.putIfAbsent(requestId, task) != null) {
            releaseBufferedBytes(bufferReservationBytes);
            return SubmitResult.DUPLICATE_ID;
        }

        try {
            task.armDeadline();
            executorService.execute(task);
            return SubmitResult.ACCEPTED;
        } catch (RejectedExecutionException ignored) {
            authenticatedTasks.remove(requestId, task);
            task.cancelDeadline();
            task.releaseReservation();
            return executorService.isShutdown()
                ? SubmitResult.SHUTDOWN
                : SubmitResult.OVERLOADED;
        }
    }

    private void invalidateAuthenticatedLocked(String reasonCode) {
        generation.incrementAndGet();
        for (ManagedTask task : new ArrayList<>(authenticatedTasks.values())) {
            task.cancel(reasonCode);
        }
    }

    private static ThreadFactory namedDaemonThreadFactory(String prefix) {
        AtomicInteger sequence = new AtomicInteger();
        return runnable -> {
            Thread thread = new Thread(runnable, prefix + "-" + sequence.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }

    private final class ManagedTask implements Runnable {
        private final String requestId;
        private final int reservedBytes;
        private final long submittedGeneration;
        private final boolean sessionTransition;
        private final Runnable job;
        private final Consumer<String> cancellationHandler;
        private final AtomicBoolean cancelled = new AtomicBoolean();
        private final AtomicBoolean reservationReleased = new AtomicBoolean();
        private final AtomicBoolean finished = new AtomicBoolean();
        private volatile Thread runner;
        private volatile ScheduledFuture<?> deadline;

        ManagedTask(
            String requestId,
            int reservedBytes,
            long submittedGeneration,
            boolean sessionTransition,
            Runnable job,
            Consumer<String> cancellationHandler
        ) {
            this.requestId = requestId;
            this.reservedBytes = reservedBytes;
            this.submittedGeneration = submittedGeneration;
            this.sessionTransition = sessionTransition;
            this.job = job;
            this.cancellationHandler = cancellationHandler;
        }

        @Override
        public void run() {
            if (cancelled.get() || submittedGeneration != generation.get()) {
                cancelDeadline();
                finish();
                return;
            }

            runner = Thread.currentThread();
            try {
                if (!cancelled.get() && submittedGeneration == generation.get()) {
                    job.run();
                }
            } finally {
                cancelDeadline();
                runner = null;
                finish();
            }
        }

        void armDeadline() {
            deadline = lifetimeScheduler.schedule(
                () -> cancel("REQUEST_TIMEOUT"),
                taskLifetimeMillis,
                TimeUnit.MILLISECONDS
            );
        }

        void cancelDeadline() {
            ScheduledFuture<?> currentDeadline = deadline;
            if (currentDeadline != null) {
                currentDeadline.cancel(false);
            }
        }

        boolean cancel(String reasonCode) {
            if (!cancelled.compareAndSet(false, true)) {
                return false;
            }
            try {
                cancellationHandler.accept(reasonCode);
            } catch (RuntimeException ignored) {
                // Cancellation cleanup must continue even if callback settlement fails.
            } finally {
                cancelDeadline();
                Thread runningThread = runner;
                if (runningThread != null) {
                    runningThread.interrupt();
                } else {
                    removeQueuedTask(this);
                    finish();
                }
            }
            return true;
        }

        private void finish() {
            if (!finished.compareAndSet(false, true)) {
                return;
            }
            authenticatedTasks.remove(requestId, this);
            releaseReservation();
            if (sessionTransition) {
                endSessionTransition();
            }
        }

        private void releaseReservation() {
            if (reservationReleased.compareAndSet(false, true)) {
                releaseBufferedBytes(reservedBytes);
            }
        }
    }
}
