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
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

/** Bounded scheduling and cancellation policy for native authenticated work. */
class NativeAuthTaskExecutor {
    static final int MAX_CONCURRENT_TASKS = 1;
    static final int MAX_QUEUED_TASKS = 8;
    static final long MAX_TASK_LIFETIME_MILLIS =
        NativeAuthHttpClient.resolveTotalRequestLifetimeMillis(
            NativeAuthRequestPolicy.MAX_REQUEST_BODY_BYTES
        );
    static final int MAX_AGGREGATE_BUFFERED_BYTES = 144 * 1024 * 1024;
    // One response can be assembled at a time. Ten decoded-body equivalents conservatively
    // cover three raw-buffer copies, four equivalents for Base64 bytes plus the UTF-16 Java
    // string, and three equivalents for JSON/bridge serialization.
    static final int RESPONSE_WORKING_SET_MULTIPLIER = 10;
    static final int MAX_RESPONSE_WORKING_SET_BYTES =
        NativeAuthRequestPolicy.MAX_RESPONSE_BODY_BYTES * RESPONSE_WORKING_SET_MULTIPLIER;
    // The ordinary, authenticated-request, and session-transition lanes can each briefly own
    // one dedicated JSON response while a lifecycle cancellation is propagating.
    static final int MAX_AUXILIARY_RESPONSE_WORKING_SET_BYTES =
        NativeAuthHttpClient.MAX_DEDICATED_JSON_RESPONSE_BODY_BYTES
            * RESPONSE_WORKING_SET_MULTIPLIER
            * 3;
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

    private final ExecutorService ordinaryExecutorService;
    private final ExecutorService authenticatedExecutorService;
    private final ExecutorService sessionExecutorService;
    private final ScheduledExecutorService lifetimeScheduler;
    private final long taskLifetimeMillis;
    private final Map<String, ManagedTask> authenticatedTasks = new ConcurrentHashMap<>();
    private final Object generationLock = new Object();
    private final AtomicLong generation = new AtomicLong();
    private final AtomicLong sessionGeneration = new AtomicLong();
    private final AtomicInteger reservedBufferedBytes = new AtomicInteger();
    private final AtomicInteger sessionTransitions = new AtomicInteger();
    private final AtomicInteger activeGenerationMutations = new AtomicInteger();
    private volatile boolean authenticatedWorkPaused;

    NativeAuthTaskExecutor() {
        this(
            newBoundedExecutor("secpal-native-auth-ordinary"),
            newBoundedExecutor("secpal-native-auth-request"),
            new ThreadPoolExecutor(
                1,
                1,
                0L,
                TimeUnit.MILLISECONDS,
                new SynchronousQueue<>(),
                namedDaemonThreadFactory("secpal-native-auth-session")
            ),
            newDeadlineScheduler("secpal-native-auth-deadline"),
            0L
        );
    }

    NativeAuthTaskExecutor(ExecutorService executorService) {
        this(
            executorService,
            executorService,
            executorService,
            newDeadlineScheduler("secpal-native-auth-deadline"),
            MAX_TASK_LIFETIME_MILLIS
        );
    }

    NativeAuthTaskExecutor(
        ExecutorService executorService,
        ScheduledExecutorService lifetimeScheduler,
        long taskLifetimeMillis
    ) {
        this(
            executorService,
            executorService,
            executorService,
            lifetimeScheduler,
            taskLifetimeMillis
        );
    }

    NativeAuthTaskExecutor(
        ExecutorService ordinaryExecutorService,
        ExecutorService authenticatedExecutorService,
        ExecutorService sessionExecutorService,
        ScheduledExecutorService lifetimeScheduler,
        long taskLifetimeMillis
    ) {
        if (taskLifetimeMillis < 0) {
            throw new IllegalArgumentException("Authenticated task lifetime must not be negative");
        }
        this.ordinaryExecutorService = ordinaryExecutorService;
        this.authenticatedExecutorService = authenticatedExecutorService;
        this.sessionExecutorService = sessionExecutorService;
        this.lifetimeScheduler = lifetimeScheduler;
        configureDeadlineScheduler(lifetimeScheduler);
        this.taskLifetimeMillis = taskLifetimeMillis;
    }

    boolean submit(Runnable job) {
        return submit(job, exception -> {});
    }

    boolean submit(Runnable job, Consumer<RuntimeException> failureHandler) {
        return submit(job, failureHandler, reason -> {});
    }

    boolean submit(
        Runnable job,
        Consumer<RuntimeException> failureHandler,
        Consumer<String> cancellationHandler
    ) {
        synchronized (generationLock) {
            if (ordinaryExecutorService.isShutdown()
                || authenticatedWorkPaused
                || sessionTransitions.get() > 0) {
                return false;
            }

            OrdinaryTask task = new OrdinaryTask(
                job,
                failureHandler,
                cancellationHandler
            );
            try {
                ordinaryExecutorService.execute(task);
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
        return submitAuthenticated(
            requestId,
            requestBodyBytes,
            job,
            reason -> {},
            cancellationHandler,
            failureHandler
        );
    }

    SubmitResult submitAuthenticated(
        String requestId,
        int requestBodyBytes,
        Runnable job,
        Consumer<String> cancellationAction,
        Consumer<String> cancellationHandler,
        Consumer<RuntimeException> failureHandler
    ) {
        synchronized (generationLock) {
            if (authenticatedExecutorService.isShutdown()) {
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
                cancellationAction,
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
            exception -> {},
            () -> {}
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
        return submitSessionTransition(
            requestId,
            requestBodyBytes,
            job,
            cancellationAction,
            cancellationHandler,
            failureHandler,
            () -> {}
        );
    }

    SubmitResult submitSessionTransition(
        String requestId,
        int requestBodyBytes,
        Runnable job,
        Consumer<String> cancellationAction,
        Consumer<String> cancellationHandler,
        Consumer<RuntimeException> failureHandler,
        Runnable transitionSettledHandler
    ) {
        synchronized (generationLock) {
            if (sessionExecutorService.isShutdown()) {
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
            evictQueuedOrdinaryTasksLocked("SESSION_INVALIDATED");
            invalidateAuthenticatedLocked("SESSION_INVALIDATED");
            Runnable orderedJob = () -> {
                if (awaitActiveGenerationMutations()) {
                    job.run();
                }
            };
            SubmitResult result = enqueueManagedLocked(
                requestId,
                requestBodyBytes,
                bufferReservationBytes,
                true,
                orderedJob,
                cancellationAction,
                cancellationHandler,
                failureHandler,
                transitionSettledHandler
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
            if (task == null || task.isCancelled()
                || task.submittedGeneration != generation.get()) {
                return false;
            }
            completion.run();
            return true;
        }
    }

    <E extends Exception> boolean completeAuthenticatedMutation(
        String requestId,
        CheckedMutation<E> mutation
    ) throws E {
        ManagedTask task;
        synchronized (generationLock) {
            task = authenticatedTasks.get(requestId);
            if (task == null || task.isCancelled()
                || task.submittedGeneration != generation.get()) {
                return false;
            }
            task.beginProtectedMutation();
            activeGenerationMutations.incrementAndGet();
        }
        try {
            mutation.run();
            return true;
        } finally {
            endGenerationMutation();
            task.endProtectedMutation();
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
            evictQueuedOrdinaryTasksLocked("APP_BACKGROUNDED");
            invalidateAuthenticatedLocked("APP_BACKGROUNDED");
        }
    }

    void resumeAuthenticated() {
        synchronized (generationLock) {
            authenticatedWorkPaused = false;
        }
    }

    long captureGeneration() {
        synchronized (generationLock) {
            return generation.get();
        }
    }

    boolean isGenerationCurrent(long expectedGeneration) {
        synchronized (generationLock) {
            return !authenticatedWorkPaused
                && sessionTransitions.get() == 0
                && generation.get() == expectedGeneration;
        }
    }

    <E extends Exception> boolean runIfGenerationCurrent(
        long expectedGeneration,
        CheckedMutation<E> mutation
    ) throws E {
        synchronized (generationLock) {
            if (ordinaryExecutorService.isShutdown()
                || authenticatedWorkPaused
                || sessionTransitions.get() > 0
                || generation.get() != expectedGeneration) {
                return false;
            }
            activeGenerationMutations.incrementAndGet();
        }
        try {
            mutation.run();
            return true;
        } finally {
            endGenerationMutation();
        }
    }

    private boolean awaitActiveGenerationMutations() {
        synchronized (generationLock) {
            while (activeGenerationMutations.get() > 0) {
                try {
                    generationLock.wait();
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    return false;
                }
            }
            return !sessionExecutorService.isShutdown();
        }
    }

    private void endGenerationMutation() {
        synchronized (generationLock) {
            activeGenerationMutations.decrementAndGet();
            generationLock.notifyAll();
        }
    }

    long captureSessionGeneration() {
        synchronized (generationLock) {
            return sessionGeneration.get();
        }
    }

    boolean isSessionGenerationCurrent(long expectedGeneration) {
        synchronized (generationLock) {
            return !ordinaryExecutorService.isShutdown()
                && sessionTransitions.get() == 0
                && sessionGeneration.get() == expectedGeneration;
        }
    }

    <E extends Exception> boolean completeCredentialReplacement(
        long expectedGeneration,
        CheckedMutation<E> mutation,
        Runnable completion
    ) throws E {
        return completeCredentialReplacement(
            expectedGeneration,
            mutation,
            () -> {},
            completion
        );
    }

    <E extends Exception> boolean completeCredentialReplacement(
        long expectedGeneration,
        CheckedMutation<E> mutation,
        CheckedMutation<E> rollback,
        Runnable completion
    ) throws E {
        return completeCredentialReplacement(
            expectedGeneration,
            false,
            mutation,
            rollback,
            completion
        );
    }

    <E extends Exception> boolean completeSessionCredentialReplacement(
        long expectedSessionGeneration,
        CheckedMutation<E> mutation,
        Runnable completion
    ) throws E {
        return completeCredentialReplacement(
            expectedSessionGeneration,
            true,
            mutation,
            () -> {},
            completion
        );
    }

    <E extends Exception> boolean completeSessionCredentialReplacement(
        long expectedSessionGeneration,
        CheckedMutation<E> mutation,
        CheckedMutation<E> rollback,
        Runnable completion
    ) throws E {
        return completeCredentialReplacement(
            expectedSessionGeneration,
            true,
            mutation,
            rollback,
            completion
        );
    }

    private <E extends Exception> boolean completeCredentialReplacement(
        long expectedGeneration,
        boolean sessionOnly,
        CheckedMutation<E> mutation,
        CheckedMutation<E> rollback,
        Runnable completion
    ) throws E {
        long replacementGeneration;
        long replacementSessionGeneration;
        synchronized (generationLock) {
            if (ordinaryExecutorService.isShutdown()
                || sessionTransitions.get() > 0
                || (sessionOnly
                    ? sessionGeneration.get() != expectedGeneration
                    : authenticatedWorkPaused || generation.get() != expectedGeneration)) {
                return false;
            }
            sessionTransitions.incrementAndGet();
            invalidateAuthenticatedLocked("SESSION_INVALIDATED");
            replacementGeneration = generation.get();
            replacementSessionGeneration = sessionGeneration.get();
        }
        try {
            mutation.run();
            synchronized (generationLock) {
                boolean replacementIsCurrent = !ordinaryExecutorService.isShutdown()
                    && !authenticatedWorkPaused
                    && (sessionOnly
                        ? sessionGeneration.get() == replacementSessionGeneration
                        : generation.get() == replacementGeneration);
                if (replacementIsCurrent) {
                    completion.run();
                    return true;
                }
            }
            rollback.run();
            return false;
        } finally {
            endSessionTransition();
        }
    }

    <E extends Exception> void invalidateAndRunSessionMutation(CheckedMutation<E> mutation)
        throws E {
        synchronized (generationLock) {
            sessionTransitions.incrementAndGet();
            try {
                invalidateAuthenticatedLocked(
                    "SESSION_INVALIDATED",
                    Thread.currentThread()
                );
                mutation.run();
            } finally {
                endSessionTransition();
            }
        }
    }

    int getReservedBufferedBytesForTest() {
        return reservedBufferedBytes.get();
    }

    void shutdownNow() {
        synchronized (generationLock) {
            authenticatedWorkPaused = true;
            invalidateAuthenticatedLocked("PLUGIN_SHUTDOWN");
            for (Runnable droppedTask : ordinaryExecutorService.shutdownNow()) {
                if (droppedTask instanceof OrdinaryTask) {
                    ((OrdinaryTask) droppedTask).rejectForPluginShutdown();
                }
            }
            shutdownDistinctExecutor(authenticatedExecutorService, ordinaryExecutorService);
            shutdownDistinctExecutor(sessionExecutorService, ordinaryExecutorService, authenticatedExecutorService);
            lifetimeScheduler.shutdownNow();
        }
    }

    private boolean reserveBufferedBytes(int bytes) {
        while (true) {
            int current = reservedBufferedBytes.get();
            int requestBudgetBytes = MAX_AGGREGATE_BUFFERED_BYTES
                - MAX_RESPONSE_WORKING_SET_BYTES
                - MAX_AUXILIARY_RESPONSE_WORKING_SET_BYTES;
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
        if (task.executorService instanceof ThreadPoolExecutor) {
            ((ThreadPoolExecutor) task.executorService).remove(task);
        }
    }

    private void evictQueuedOrdinaryTasksLocked(String reasonCode) {
        if (!(ordinaryExecutorService instanceof ThreadPoolExecutor)) {
            return;
        }

        ThreadPoolExecutor threadPool = (ThreadPoolExecutor) ordinaryExecutorService;
        for (Runnable queuedTask : new ArrayList<>(threadPool.getQueue())) {
            if (queuedTask instanceof OrdinaryTask && threadPool.remove(queuedTask)) {
                ((OrdinaryTask) queuedTask).cancel(reasonCode);
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
            failureHandler,
            () -> {}
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
        Consumer<RuntimeException> failureHandler,
        Runnable transitionSettledHandler
    ) {

        ManagedTask task = new ManagedTask(
            requestId,
            bufferReservationBytes,
            generation.get(),
            sessionTransition,
            sessionTransition ? sessionExecutorService : authenticatedExecutorService,
            job,
            cancellationAction,
            cancellationHandler,
            failureHandler,
            transitionSettledHandler,
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
            task.executorService.execute(task);
            return SubmitResult.ACCEPTED;
        } catch (RejectedExecutionException ignored) {
            authenticatedTasks.remove(requestId, task);
            task.cancelDeadline();
            task.releaseReservation();
            return task.executorService.isShutdown()
                ? SubmitResult.SHUTDOWN
                : SubmitResult.OVERLOADED;
        }
    }

    private void invalidateAuthenticatedLocked(String reasonCode) {
        invalidateAuthenticatedLocked(reasonCode, null);
    }

    private void invalidateAuthenticatedLocked(
        String reasonCode,
        Thread nonInterruptibleInitiator
    ) {
        generation.incrementAndGet();
        if ("SESSION_INVALIDATED".equals(reasonCode)) {
            sessionGeneration.incrementAndGet();
        }
        for (ManagedTask task : new ArrayList<>(authenticatedTasks.values())) {
            task.cancel(
                reasonCode,
                task.runner != nonInterruptibleInitiator
            );
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

    private static ThreadPoolExecutor newBoundedExecutor(String threadName) {
        return new ThreadPoolExecutor(
            MAX_CONCURRENT_TASKS,
            MAX_CONCURRENT_TASKS,
            0L,
            TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(MAX_QUEUED_TASKS),
            namedDaemonThreadFactory(threadName)
        );
    }

    private static ScheduledThreadPoolExecutor newDeadlineScheduler(String threadName) {
        ScheduledThreadPoolExecutor scheduler = new ScheduledThreadPoolExecutor(
            1,
            namedDaemonThreadFactory(threadName)
        );
        configureDeadlineScheduler(scheduler);
        return scheduler;
    }

    private static void configureDeadlineScheduler(ScheduledExecutorService scheduler) {
        if (scheduler instanceof ScheduledThreadPoolExecutor) {
            ScheduledThreadPoolExecutor threadPool = (ScheduledThreadPoolExecutor) scheduler;
            threadPool.setRemoveOnCancelPolicy(true);
            threadPool.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);
        }
    }

    private static void shutdownDistinctExecutor(
        ExecutorService executor,
        ExecutorService... previousExecutors
    ) {
        for (ExecutorService previous : previousExecutors) {
            if (executor == previous) {
                return;
            }
        }
        executor.shutdownNow();
    }

    boolean awaitIdleForTest(long timeout, TimeUnit unit) throws InterruptedException {
        long deadlineNanos = System.nanoTime() + unit.toNanos(timeout);
        while (System.nanoTime() < deadlineNanos) {
            if (authenticatedTasks.isEmpty()
                && executorIsIdle(ordinaryExecutorService)
                && executorIsIdle(authenticatedExecutorService)
                && executorIsIdle(sessionExecutorService)) {
                return true;
            }
            Thread.sleep(1L);
        }
        return false;
    }

    private static boolean executorIsIdle(ExecutorService executor) {
        if (!(executor instanceof ThreadPoolExecutor)) {
            return true;
        }
        ThreadPoolExecutor threadPool = (ThreadPoolExecutor) executor;
        return threadPool.getActiveCount() == 0 && threadPool.getQueue().isEmpty();
    }

    @FunctionalInterface
    interface CheckedMutation<E extends Exception> {
        void run() throws E;
    }

    private static final class OrdinaryTask implements Runnable {
        private final Runnable job;
        private final Consumer<RuntimeException> failureHandler;
        private final Consumer<String> cancellationHandler;
        private final AtomicBoolean claimed = new AtomicBoolean();

        OrdinaryTask(
            Runnable job,
            Consumer<RuntimeException> failureHandler,
            Consumer<String> cancellationHandler
        ) {
            this.job = job;
            this.failureHandler = failureHandler;
            this.cancellationHandler = cancellationHandler;
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

        void rejectForPluginShutdown() {
            cancel("PLUGIN_SHUTDOWN");
        }

        void cancel(String reasonCode) {
            if (!claimed.compareAndSet(false, true)) {
                return;
            }
            try {
                cancellationHandler.accept(reasonCode);
            } catch (RuntimeException ignored) {
                // The executor must remain available if callback settlement fails.
            }
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
        private final ExecutorService executorService;
        private final Runnable job;
        private final Consumer<String> cancellationAction;
        private final Consumer<String> cancellationHandler;
        private final Consumer<RuntimeException> failureHandler;
        private final Runnable transitionSettledHandler;
        private final long deadlineMillis;
        private final AtomicReference<String> cancellationReason = new AtomicReference<>();
        private final AtomicBoolean cancellationNotified = new AtomicBoolean();
        private final AtomicBoolean reservationReleased = new AtomicBoolean();
        private final AtomicBoolean finished = new AtomicBoolean();
        private final AtomicInteger protectedMutationDepth = new AtomicInteger();
        private volatile Thread runner;
        private volatile ScheduledFuture<?> deadline;

        ManagedTask(
            String requestId,
            int reservedBytes,
            long submittedGeneration,
            boolean sessionTransition,
            ExecutorService executorService,
            Runnable job,
            Consumer<String> cancellationAction,
            Consumer<String> cancellationHandler,
            Consumer<RuntimeException> failureHandler,
            Runnable transitionSettledHandler,
            long deadlineMillis
        ) {
            this.requestId = requestId;
            this.reservedBytes = reservedBytes;
            this.submittedGeneration = submittedGeneration;
            this.sessionTransition = sessionTransition;
            this.executorService = executorService;
            this.job = job;
            this.cancellationAction = cancellationAction;
            this.cancellationHandler = cancellationHandler;
            this.failureHandler = failureHandler;
            this.transitionSettledHandler = transitionSettledHandler;
            this.deadlineMillis = deadlineMillis;
        }

        @Override
        public void run() {
            if (isCancelled() || submittedGeneration != generation.get()) {
                cancelDeadline();
                finish();
                return;
            }

            runner = Thread.currentThread();
            try {
                if (!isCancelled() && submittedGeneration == generation.get()) {
                    job.run();
                }
            } catch (RuntimeException exception) {
                if (!isCancelled()) {
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
            synchronized (generationLock) {
                return cancelLocked(reasonCode, true);
            }
        }

        private boolean cancel(String reasonCode, boolean interruptRunner) {
            synchronized (generationLock) {
                return cancelLocked(reasonCode, interruptRunner);
            }
        }

        private boolean cancelLocked(String reasonCode, boolean interruptRunner) {
            if (!cancellationReason.compareAndSet(null, reasonCode)) {
                return false;
            }
            try {
                cancellationAction.accept(reasonCode);
            } catch (RuntimeException ignored) {
                // Cancellation cleanup must continue even if callback settlement fails.
            } finally {
                cancelDeadline();
                Thread runningThread = runner;
                if (runningThread != null) {
                    if (!hasProtectedMutation()) {
                        notifyCancellation();
                    }
                    if (interruptRunner) {
                        runningThread.interrupt();
                    }
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
            if (isCancelled()) {
                notifyCancellation();
            }
            authenticatedTasks.remove(requestId, this);
            releaseReservation();
            if (sessionTransition) {
                endSessionTransition();
                try {
                    transitionSettledHandler.run();
                } catch (RuntimeException ignored) {
                    // The session gate must remain released if follow-up scheduling fails.
                }
            }
        }

        private void notifyCancellation() {
            if (!cancellationNotified.compareAndSet(false, true)) {
                return;
            }
            try {
                cancellationHandler.accept(cancellationReason.get());
            } catch (RuntimeException ignored) {
                // Cancellation cleanup must continue if callback settlement fails.
            }
        }

        private void releaseReservation() {
            if (reservationReleased.compareAndSet(false, true)) {
                releaseBufferedBytes(reservedBytes);
            }
        }

        private void beginProtectedMutation() {
            protectedMutationDepth.incrementAndGet();
        }

        private void endProtectedMutation() {
            if (protectedMutationDepth.decrementAndGet() == 0 && isCancelled()) {
                notifyCancellation();
            }
        }

        private boolean hasProtectedMutation() {
            return protectedMutationDepth.get() > 0;
        }

        private boolean isCancelled() {
            return cancellationReason.get() != null;
        }
    }

    private void endSessionTransition() {
        sessionTransitions.updateAndGet(value -> Math.max(0, value - 1));
    }
}
