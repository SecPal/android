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
        NativeAuthHttpClient.resolveTotalRequestLifetimeMillis(
            NativeAuthRequestPolicy.MAX_REQUEST_BODY_BYTES
        );
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
        TRANSITION_IN_PROGRESS,
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
        this(
            new ThreadPoolExecutor(
                MAX_CONCURRENT_TASKS,
                MAX_CONCURRENT_TASKS,
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(MAX_QUEUED_TASKS),
                namedDaemonThreadFactory("secpal-native-auth")
            ),
            Executors.newSingleThreadScheduledExecutor(
                namedDaemonThreadFactory("secpal-native-auth-deadline")
            ),
            0L
        );
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
        if (taskLifetimeMillis < 0) {
            throw new IllegalArgumentException("Authenticated task lifetime must not be negative");
        }
        this.executorService = executorService;
        this.lifetimeScheduler = lifetimeScheduler;
        this.taskLifetimeMillis = taskLifetimeMillis;
    }

    boolean submit(Runnable job) {
        return submit(job, exception -> {});
    }

    boolean submit(Runnable job, Consumer<RuntimeException> failureHandler) {
        synchronized (generationLock) {
            if (executorService.isShutdown()
                || authenticatedWorkPaused
                || sessionTransitions.get() > 0) {
                return false;
            }

            OrdinaryTask task = new OrdinaryTask(job, failureHandler);
            try {
                executorService.execute(task);
            } catch (RejectedExecutionException ignored) {
                return false;
            }

            return true;
        }
    }

    SubmitResult submitAuthenticated(
        String requestId,
        int requestBodyBytes,
        Runnable job,
        Consumer<String> cancellationHandler
    ) {
        return submitAuthenticated(
            requestId,
            requestBodyBytes,
            job,
            cancellationHandler,
            exception -> {}
        );
    }

    SubmitResult submitAuthenticated(
        String requestId,
        int requestBodyBytes,
        Runnable job,
        Consumer<String> cancellationHandler,
        Consumer<RuntimeException> failureHandler
    ) {
        synchronized (generationLock) {
            if (executorService.isShutdown()) {
                return SubmitResult.SHUTDOWN;
            }
            if (authenticatedWorkPaused) {
                return SubmitResult.BACKGROUNDED;
            }
            if (sessionTransitions.get() > 0) {
                return SubmitResult.TRANSITION_IN_PROGRESS;
            }
            return submitManagedLocked(
                requestId,
                requestBodyBytes,
                false,
                job,
                reason -> {},
                cancellationHandler,
                failureHandler
            );
        }
    }

    SubmitResult submitSessionTransition(
        String requestId,
        int requestBodyBytes,
        Runnable job,
        Consumer<String> cancellationHandler
    ) {
        return submitSessionTransition(
            requestId,
            requestBodyBytes,
            job,
            reason -> {},
            cancellationHandler
        );
    }

    SubmitResult submitSessionTransition(
        String requestId,
        int requestBodyBytes,
        Runnable job,
        Consumer<String> cancellationAction,
        Consumer<String> cancellationHandler
    ) {
        return submitSessionTransition(
            requestId,
            requestBodyBytes,
            job,
            cancellationAction,
            cancellationHandler,
            exception -> {}
        );
    }

    SubmitResult submitSessionTransition(
        String requestId,
        int requestBodyBytes,
        Runnable job,
        Consumer<String> cancellationAction,
        Consumer<String> cancellationHandler,
        Consumer<RuntimeException> failureHandler
    ) {
        synchronized (generationLock) {
            if (executorService.isShutdown()) {
                return SubmitResult.SHUTDOWN;
            }
            if (authenticatedWorkPaused) {
                return SubmitResult.BACKGROUNDED;
            }
            if (sessionTransitions.get() > 0) {
                return SubmitResult.TRANSITION_IN_PROGRESS;
            }

            int bufferReservationBytes = reserveManagedBytes(requestBodyBytes);
            if (bufferReservationBytes < 0) {
                return SubmitResult.BUFFER_LIMIT;
            }
            if (authenticatedTasks.containsKey(requestId)) {
                releaseBufferedBytes(bufferReservationBytes);
                return SubmitResult.DUPLICATE_ID;
            }

            sessionTransitions.incrementAndGet();
            evictQueuedOrdinaryTasksLocked();
            invalidateAuthenticatedLocked("SESSION_INVALIDATED");
            SubmitResult result = enqueueManagedLocked(
                requestId,
                requestBodyBytes,
                bufferReservationBytes,
                true,
                job,
                cancellationAction,
                cancellationHandler,
                failureHandler
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
        synchronized (generationLock) {
            authenticatedWorkPaused = true;
            invalidateAuthenticatedLocked("APP_BACKGROUNDED");
        }
    }

    void resumeAuthenticated() {
        synchronized (generationLock) {
            authenticatedWorkPaused = false;
        }
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
        synchronized (generationLock) {
            authenticatedWorkPaused = true;
            invalidateAuthenticatedLocked("PLUGIN_SHUTDOWN");
            for (Runnable droppedTask : executorService.shutdownNow()) {
                if (droppedTask instanceof OrdinaryTask) {
                    ((OrdinaryTask) droppedTask).rejectForPluginShutdown();
                }
            }
            lifetimeScheduler.shutdownNow();
        }
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

    private void evictQueuedOrdinaryTasksLocked() {
        if (!(executorService instanceof ThreadPoolExecutor)) {
            return;
        }

        ThreadPoolExecutor threadPool = (ThreadPoolExecutor) executorService;
        for (Runnable queuedTask : new ArrayList<>(threadPool.getQueue())) {
            if (queuedTask instanceof OrdinaryTask && threadPool.remove(queuedTask)) {
                ((OrdinaryTask) queuedTask).rejectForSessionTransition();
            }
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
        Consumer<String> cancellationAction,
        Consumer<String> cancellationHandler,
        Consumer<RuntimeException> failureHandler
    ) {
        int bufferReservationBytes = reserveManagedBytes(requestBodyBytes);
        if (bufferReservationBytes < 0) {
            return SubmitResult.BUFFER_LIMIT;
        }

        return enqueueManagedLocked(
            requestId,
            requestBodyBytes,
            bufferReservationBytes,
            sessionTransition,
            job,
            cancellationAction,
            cancellationHandler,
            failureHandler
        );
    }

    private int reserveManagedBytes(int requestBodyBytes) {
        int bufferReservationBytes = estimateRequestReservationBytes(requestBodyBytes);
        return bufferReservationBytes >= 0 && reserveBufferedBytes(bufferReservationBytes)
            ? bufferReservationBytes
            : -1;
    }

    private SubmitResult enqueueManagedLocked(
        String requestId,
        int requestBodyBytes,
        int bufferReservationBytes,
        boolean sessionTransition,
        Runnable job,
        Consumer<String> cancellationAction,
        Consumer<String> cancellationHandler,
        Consumer<RuntimeException> failureHandler
    ) {

        ManagedTask task = new ManagedTask(
            requestId,
            bufferReservationBytes,
            generation.get(),
            sessionTransition,
            job,
            cancellationAction,
            cancellationHandler,
            failureHandler,
            taskLifetimeMillis > 0
                ? taskLifetimeMillis
                : NativeAuthHttpClient.resolveTotalRequestLifetimeMillis(requestBodyBytes)
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

    private final class OrdinaryTask implements Runnable {
        private final Runnable job;
        private final Consumer<RuntimeException> failureHandler;
        private final AtomicBoolean claimed = new AtomicBoolean();

        OrdinaryTask(Runnable job, Consumer<RuntimeException> failureHandler) {
            this.job = job;
            this.failureHandler = failureHandler;
        }

        @Override
        public void run() {
            if (!claimed.compareAndSet(false, true)) {
                return;
            }
            try {
                job.run();
            } catch (RuntimeException exception) {
                notifyFailure(exception);
            }
        }

        void rejectForSessionTransition() {
            reject("Native auth work was superseded by a session transition");
        }

        void rejectForPluginShutdown() {
            reject("Native auth work was cancelled during plugin shutdown");
        }

        private void reject(String message) {
            if (!claimed.compareAndSet(false, true)) {
                return;
            }
            notifyFailure(new RejectedExecutionException(message));
        }

        private void notifyFailure(RuntimeException exception) {
            try {
                failureHandler.accept(exception);
            } catch (RuntimeException ignored) {
                // The executor must remain available if callback settlement fails.
            }
        }
    }

    private final class ManagedTask implements Runnable {
        private final String requestId;
        private final int reservedBytes;
        private final long submittedGeneration;
        private final boolean sessionTransition;
        private final Runnable job;
        private final Consumer<String> cancellationAction;
        private final Consumer<String> cancellationHandler;
        private final Consumer<RuntimeException> failureHandler;
        private final long deadlineMillis;
        private final AtomicBoolean cancelled = new AtomicBoolean();
        private final AtomicBoolean cancellationNotified = new AtomicBoolean();
        private final AtomicBoolean reservationReleased = new AtomicBoolean();
        private final AtomicBoolean finished = new AtomicBoolean();
        private volatile Thread runner;
        private volatile ScheduledFuture<?> deadline;
        private volatile String cancellationReason;

        ManagedTask(
            String requestId,
            int reservedBytes,
            long submittedGeneration,
            boolean sessionTransition,
            Runnable job,
            Consumer<String> cancellationAction,
            Consumer<String> cancellationHandler,
            Consumer<RuntimeException> failureHandler,
            long deadlineMillis
        ) {
            this.requestId = requestId;
            this.reservedBytes = reservedBytes;
            this.submittedGeneration = submittedGeneration;
            this.sessionTransition = sessionTransition;
            this.job = job;
            this.cancellationAction = cancellationAction;
            this.cancellationHandler = cancellationHandler;
            this.failureHandler = failureHandler;
            this.deadlineMillis = deadlineMillis;
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
            } catch (RuntimeException exception) {
                if (!cancelled.get()) {
                    try {
                        completeAuthenticated(
                            requestId,
                            () -> failureHandler.accept(exception)
                        );
                    } catch (RuntimeException ignored) {
                        // The executor must still release the task if settlement fails.
                    }
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
                deadlineMillis,
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
            cancellationReason = reasonCode;
            try {
                cancellationAction.accept(reasonCode);
            } catch (RuntimeException ignored) {
                // Cancellation cleanup must continue even if callback settlement fails.
            } finally {
                cancelDeadline();
                Thread runningThread = runner;
                if (runningThread != null) {
                    if (!sessionTransition) {
                        notifyCancellation();
                    }
                    runningThread.interrupt();
                } else {
                    notifyCancellation();
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
            if (cancelled.get()) {
                notifyCancellation();
            }
            authenticatedTasks.remove(requestId, this);
            releaseReservation();
            if (sessionTransition) {
                endSessionTransition();
            }
        }

        private void notifyCancellation() {
            if (!cancellationNotified.compareAndSet(false, true)) {
                return;
            }
            try {
                cancellationHandler.accept(cancellationReason);
            } catch (RuntimeException ignored) {
                // Cancellation cleanup must continue if callback settlement fails.
            }
        }

        private void releaseReservation() {
            if (reservationReleased.compareAndSet(false, true)) {
                releaseBufferedBytes(reservedBytes);
            }
        }
    }
}
