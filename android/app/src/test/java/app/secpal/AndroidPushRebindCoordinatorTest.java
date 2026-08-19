/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

@RunWith(RobolectricTestRunner.class)
public class AndroidPushRebindCoordinatorTest {
    private static final String TENANT_A = "https://tenant-a.example";
    private static final String TENANT_B = "https://tenant-b.example";
    private static final String AUTHORITY_A = "tenant-a-auth-token";
    private static final String AUTHORITY_B = "tenant-b-auth-token";
    private static final String TOKEN =
        "fcm-token-one-1234567890abcdefghijklmnopqrstuvwxyz";

    private SharedPreferences preferences;
    private MemoryCipher cipher;
    private AtomicInteger ids;
    private AndroidPushIdentityStorage storage;
    private FakeRevocationTransport revocationTransport;
    private FakeRegistrationTransport registrationTransport;
    private RecordingPublisher publisher;
    private String tenantAInstallationId;

    @Before
    public void setUp() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        preferences = context.getSharedPreferences(
            "push-rebind-" + System.nanoTime(),
            Context.MODE_PRIVATE
        );
        cipher = new MemoryCipher();
        ids = new AtomicInteger();
        storage = createStorage();
        revocationTransport = new FakeRevocationTransport();
        registrationTransport = new FakeRegistrationTransport();
        publisher = new RecordingPublisher();
        tenantAInstallationId = registerTenantA();
    }

    @Test
    public void crossOriginCommitRevokesTheOldOriginWithItsOwnAuthorityOnly()
        throws Exception {
        AndroidPushRebindCoordinator coordinator = coordinator();

        AndroidPushRebindCoordinator.Outcome staged = coordinator.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        );
        AndroidPushRebindCoordinator.Outcome committed = coordinator.commit(
            staged.transaction(),
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.STAGED,
            staged.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.COMMITTED,
            committed.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.COMPLETED,
            committed.cleanup()
        );
        assertEquals(1, revocationTransport.calls.size());
        FakeRevocationTransport.Call revocation = revocationTransport.calls.get(0);
        assertEquals(TENANT_A, revocation.apiOrigin);
        assertEquals(AUTHORITY_A, revocation.authority);
        assertEquals(tenantAInstallationId, revocation.installationId);

        AndroidPushIdentityStorage.State rebound = storage.load();
        assertEquals(TENANT_B, rebound.apiOrigin());
        assertNotEquals(tenantAInstallationId, rebound.installationId());
        assertFalse(rebound.hasPendingRebind());
        assertFalse(rebound.hasPendingRevocation());
        assertFalse(rebound.hasServerRegistration());
        assertEquals(
            AndroidPushRebindCoordinator.Status.IDLE,
            publisher.lastStatus
        );
    }

    @Test
    public void stagedCrossOriginRebindBlocksEveryOrdinaryRegistrationSync()
        throws Exception {
        AndroidPushRebindCoordinator coordinator = coordinator();
        AndroidPushRebindCoordinator.Outcome staged = coordinator.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        );

        AndroidPushRegistrationCoordinator.Outcome blockedForOldOrigin =
            registrationCoordinator().synchronize(
                TENANT_A,
                AUTHORITY_A,
                new NativeAuthHttpClient.CancellationSignal()
            );
        AndroidPushRegistrationCoordinator.Outcome blockedForNewOrigin =
            registrationCoordinator().synchronize(
                TENANT_B,
                AUTHORITY_B,
                new NativeAuthHttpClient.CancellationSignal()
            );

        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.RETRYABLE_FAILURE,
            blockedForOldOrigin.kind()
        );
        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.RETRYABLE_FAILURE,
            blockedForNewOrigin.kind()
        );
        assertTrue(registrationTransport.calls.isEmpty());

        coordinator.rollback(staged.transaction());
        AndroidPushRegistrationCoordinator.Outcome resumed =
            registrationCoordinator().synchronize(
                TENANT_A,
                AUTHORITY_A,
                new NativeAuthHttpClient.CancellationSignal()
            );

        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.SUCCESS,
            resumed.kind()
        );
        assertEquals(1, registrationTransport.calls.size());
        assertEquals(TENANT_A, registrationTransport.calls.get(0).apiOrigin);
        assertEquals(AUTHORITY_A, registrationTransport.calls.get(0).authority);
    }

    @Test
    public void registrationRefusesAnAuthorityFromAnotherOrigin()
        throws Exception {
        AndroidPushRegistrationCoordinator.Outcome crossTenant =
            registrationCoordinator().synchronize(
                TENANT_B,
                AUTHORITY_B,
                new NativeAuthHttpClient.CancellationSignal()
            );

        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.RETRYABLE_FAILURE,
            crossTenant.kind()
        );
        assertTrue(registrationTransport.calls.isEmpty());
    }

    @Test
    public void commitAndRollbackAreSingleTerminalAndIdempotent()
        throws Exception {
        AndroidPushRebindCoordinator coordinator = coordinator();
        AndroidPushRebindCoordinator.Transaction transaction = coordinator.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        ).transaction();

        AndroidPushRebindCoordinator.Outcome committed = coordinator.commit(
            transaction,
            new NativeAuthHttpClient.CancellationSignal()
        );
        AndroidPushRebindCoordinator.Outcome recommitted = coordinator.commit(
            transaction,
            new NativeAuthHttpClient.CancellationSignal()
        );
        AndroidPushRebindCoordinator.Outcome lateRollback = coordinator.rollback(
            transaction
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.COMMITTED,
            committed.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.COMMITTED,
            recommitted.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.COMMITTED,
            lateRollback.kind()
        );
        assertEquals(1, revocationTransport.calls.size());
        assertEquals(TENANT_B, storage.load().apiOrigin());
    }

    @Test
    public void rollbackIsSingleTerminalAndKeepsThePreviousBinding()
        throws Exception {
        AndroidPushRebindCoordinator coordinator = coordinator();
        AndroidPushRebindCoordinator.Transaction transaction = coordinator.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        ).transaction();

        AndroidPushRebindCoordinator.Outcome rolledBack = coordinator.rollback(
            transaction
        );
        AndroidPushRebindCoordinator.Outcome repeated = coordinator.rollback(
            transaction
        );
        AndroidPushRebindCoordinator.Outcome lateCommit = coordinator.commit(
            transaction,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.ROLLED_BACK,
            rolledBack.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.ROLLED_BACK,
            repeated.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.ROLLED_BACK,
            lateCommit.kind()
        );
        assertTrue(revocationTransport.calls.isEmpty());
        AndroidPushIdentityStorage.State current = storage.load();
        assertEquals(TENANT_A, current.apiOrigin());
        assertEquals(tenantAInstallationId, current.installationId());
        assertTrue(current.hasServerRegistration());
        assertFalse(current.hasPendingRebind());
    }

    @Test
    public void aSupersededHandleCannotRevokeOrRotateANewerRegistration()
        throws Exception {
        AndroidPushRebindCoordinator coordinator = coordinator();
        AndroidPushRebindCoordinator.Transaction abandoned = coordinator.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        ).transaction();
        coordinator.rollback(abandoned);
        AndroidPushRebindCoordinator.Transaction current = coordinator.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        ).transaction();

        AndroidPushRebindCoordinator.Outcome stale = coordinator.commit(
            abandoned,
            new NativeAuthHttpClient.CancellationSignal()
        );
        AndroidPushRebindCoordinator.Outcome committed = coordinator.commit(
            current,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.ROLLED_BACK,
            stale.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.COMMITTED,
            committed.kind()
        );
        assertEquals(1, revocationTransport.calls.size());
        assertEquals(
            tenantAInstallationId,
            revocationTransport.calls.get(0).installationId
        );
        assertEquals(TENANT_B, storage.load().apiOrigin());
    }

    @Test
    public void aHandleStagedAgainstAReplacedRegistrationBecomesStale()
        throws Exception {
        AndroidPushRebindCoordinator coordinator = coordinator();
        AndroidPushRebindCoordinator.Transaction transaction = coordinator.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        ).transaction();
        storage.retainCurrentRegistrationForRevocation(AUTHORITY_A, false);
        storage.clearPendingRevocation(
            TENANT_A,
            tenantAInstallationId,
            AUTHORITY_A
        );

        AndroidPushRebindCoordinator.Outcome stale = coordinator.commit(
            transaction,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.STALE,
            stale.kind()
        );
        assertTrue(revocationTransport.calls.isEmpty());
        assertEquals(TENANT_A, storage.load().apiOrigin());
    }

    @Test
    public void aStaleCommitReleasesTheTransitionInsteadOfBlockingCleanup()
        throws Exception {
        AndroidPushRebindCoordinator coordinator = coordinator();
        AndroidPushRebindCoordinator.Transaction transaction = coordinator.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        ).transaction();
        storage.cancelPreparedRuntimeRebind(TENANT_B);

        AndroidPushRebindCoordinator.Outcome stale = coordinator.commit(
            transaction,
            new NativeAuthHttpClient.CancellationSignal()
        );
        AndroidPushRebindCoordinator.Outcome replayed = coordinator.commit(
            transaction,
            new NativeAuthHttpClient.CancellationSignal()
        );
        AndroidPushRebindCoordinator.Outcome loggedOut = coordinator.logout(
            credential(TENANT_A, AUTHORITY_A),
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.STALE,
            stale.kind()
        );
        assertTrue(transaction.isTerminal());
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.STALE,
            replayed.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CLEANED,
            loggedOut.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.COMPLETED,
            loggedOut.cleanup()
        );
        assertEquals(1, revocationTransport.calls.size());
        assertEquals(TENANT_A, revocationTransport.calls.get(0).apiOrigin);
        assertEquals(
            tenantAInstallationId,
            revocationTransport.calls.get(0).installationId
        );
        assertFalse(storage.load().hasServerRegistration());
    }

    @Test
    public void aFailedCommitKeepsTheTransactionStagedForARetry()
        throws Exception {
        AndroidPushRebindCoordinator coordinator = coordinator();
        AndroidPushRebindCoordinator.Transaction transaction = coordinator.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        ).transaction();
        cipher.unavailable = true;

        AndroidPushRebindCoordinator.Outcome failed = coordinator.commit(
            transaction,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.FAILED,
            failed.kind()
        );
        assertFalse(transaction.isTerminal());
        assertEquals(
            AndroidPushRebindCoordinator.Status.RETRY_PENDING,
            publisher.lastStatus
        );
        assertTrue(revocationTransport.calls.isEmpty());

        cipher.unavailable = false;
        AndroidPushRebindCoordinator.Outcome retried = coordinator.commit(
            transaction,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.COMMITTED,
            retried.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.COMPLETED,
            retried.cleanup()
        );
        assertEquals(TENANT_B, storage.load().apiOrigin());
        assertEquals(1, revocationTransport.calls.size());
    }

    @Test
    public void coldStartRecoveryResumesTheExactStagedTransaction()
        throws Exception {
        coordinator().begin(TENANT_B, 4, credential(TENANT_A, AUTHORITY_A));

        AndroidPushRebindCoordinator restarted = coordinator();
        AndroidPushRebindCoordinator.Outcome recovered = restarted.recover(
            TENANT_B,
            4,
            new NativeAuthHttpClient.CancellationSignal()
        );
        AndroidPushRebindCoordinator.Outcome committed = restarted.commit(
            recovered.transaction(),
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.RESUMED,
            recovered.kind()
        );
        assertEquals(TENANT_B, recovered.transaction().nextApiOrigin());
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.COMMITTED,
            committed.kind()
        );
        assertEquals(1, revocationTransport.calls.size());
        assertEquals(TENANT_A, revocationTransport.calls.get(0).apiOrigin);
        assertEquals(AUTHORITY_A, revocationTransport.calls.get(0).authority);
        assertEquals(TENANT_B, storage.load().apiOrigin());
    }

    @Test
    public void aResumedTransactionCarriesTheCurrentRuntimeRevision()
        throws Exception {
        coordinator().begin(TENANT_B, 4, credential(TENANT_A, AUTHORITY_A));

        AndroidPushRebindCoordinator restarted = coordinator();
        AndroidPushRebindCoordinator.Outcome resumed = restarted.recover(
            TENANT_B,
            5,
            new NativeAuthHttpClient.CancellationSignal()
        );
        AndroidPushRebindCoordinator.Outcome committed = restarted.commit(
            resumed.transaction(),
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.RESUMED,
            resumed.kind()
        );
        assertEquals(TENANT_B, resumed.transaction().nextApiOrigin());
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.COMMITTED,
            committed.kind()
        );
        AndroidPushIdentityStorage.State bound = storage.load();
        assertEquals(TENANT_B, bound.apiOrigin());
        assertEquals(5, bound.metadataRevision());
        assertEquals(1, revocationTransport.calls.size());
        assertEquals(TENANT_A, revocationTransport.calls.get(0).apiOrigin);
        assertEquals(AUTHORITY_A, revocationTransport.calls.get(0).authority);
    }

    @Test
    public void coldStartRecoveryInvalidatesAnObsoleteStagedTransaction()
        throws Exception {
        coordinator().begin(TENANT_B, 4, credential(TENANT_A, AUTHORITY_A));

        AndroidPushRebindCoordinator restarted = coordinator();
        AndroidPushRebindCoordinator.Outcome recovered = restarted.recover(
            TENANT_A,
            3,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.INVALIDATED,
            recovered.kind()
        );
        assertNull(recovered.transaction());
        assertFalse(storage.load().hasPendingRebind());
        assertTrue(revocationTransport.calls.isEmpty());
        assertEquals(
            AndroidPushRegistrationCoordinator.Outcome.Kind.SUCCESS,
            registrationCoordinator().synchronize(
                TENANT_A,
                AUTHORITY_A,
                new NativeAuthHttpClient.CancellationSignal()
            ).kind()
        );
    }

    @Test
    public void coldStartRecoveryRetriesDurableCleanupBeforeAnyTransition()
        throws Exception {
        storage.retainCurrentRegistrationForRevocation(AUTHORITY_A, true);
        revocationTransport.failure = new IOException("offline");

        AndroidPushRebindCoordinator.Outcome offline = coordinator().recover(
            TENANT_A,
            3,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CLEANED,
            offline.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.PENDING,
            offline.cleanup()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Status.CLEANUP_PENDING,
            publisher.lastStatus
        );
        assertTrue(storage.load().hasPendingRevocation());

        revocationTransport.failure = null;
        AndroidPushRebindCoordinator.Outcome recovered = coordinator().recover(
            TENANT_A,
            3,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CLEANED,
            recovered.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.COMPLETED,
            recovered.cleanup()
        );
        assertTrue(recovered.retiredAuthenticationAuthority());
        assertFalse(storage.load().hasPendingRevocation());
        assertEquals(2, revocationTransport.calls.size());
        assertEquals(AUTHORITY_A, revocationTransport.calls.get(1).authority);
    }

    @Test
    public void aCompletedLogoutCleanupStaysReportableAfterARestart()
        throws Exception {
        revocationTransport.failure = new IOException("offline");
        coordinator().logout(
            credential(TENANT_A, AUTHORITY_A),
            new NativeAuthHttpClient.CancellationSignal()
        );
        assertTrue(
            storage.load().pendingRevocationRequiresAuthenticationLogout()
        );

        revocationTransport.failure = null;
        AndroidPushRebindCoordinator.Outcome recovered = coordinator().recover(
            TENANT_A,
            3,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CLEANED,
            recovered.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.COMPLETED,
            recovered.cleanup()
        );
        assertTrue(recovered.retiredAuthenticationAuthority());
        assertFalse(storage.load().hasPendingRevocation());

        AndroidPushRebindCoordinator restarted = coordinator();
        AndroidPushRebindCoordinator.Outcome afterRestart = restarted.recover(
            TENANT_A,
            3,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.IDLE,
            afterRestart.kind()
        );
        assertTrue(afterRestart.retiredAuthenticationAuthority());

        restarted.acknowledgeRetiredAuthority();
        AndroidPushRebindCoordinator.Outcome settled = coordinator().recover(
            TENANT_A,
            3,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.IDLE,
            settled.kind()
        );
        assertFalse(settled.retiredAuthenticationAuthority());
    }

    @Test
    public void aCredentialReplacementDoesNotClaimToRetireAnAuthority()
        throws Exception {
        AndroidPushRebindCoordinator.Outcome replaced =
            coordinator().replaceCredential(
                credential(TENANT_A, AUTHORITY_A),
                credential(TENANT_A, "tenant-a-replacement-token"),
                new NativeAuthHttpClient.CancellationSignal()
            );

        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.COMPLETED,
            replaced.cleanup()
        );
        assertFalse(replaced.retiredAuthenticationAuthority());
    }

    @Test
    public void cancellationKeepsTheTransactionStagedAndTheTombstoneRetained()
        throws Exception {
        AndroidPushRebindCoordinator coordinator = coordinator();
        AndroidPushRebindCoordinator.Transaction transaction = coordinator.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        ).transaction();
        NativeAuthHttpClient.CancellationSignal cancelled =
            new NativeAuthHttpClient.CancellationSignal();
        cancelled.cancel();

        AndroidPushRebindCoordinator.Outcome cancelledCommit = coordinator.commit(
            transaction,
            cancelled
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CANCELLED,
            cancelledCommit.kind()
        );
        assertFalse(transaction.isTerminal());
        assertEquals(TENANT_A, storage.load().apiOrigin());
        assertTrue(revocationTransport.calls.isEmpty());

        revocationTransport.cancelDuringRequest = true;
        AndroidPushRebindCoordinator.Outcome cancelledCleanup = coordinator.commit(
            transaction,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.COMMITTED,
            cancelledCleanup.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.CANCELLED,
            cancelledCleanup.cleanup()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Status.CANCELLED,
            publisher.lastStatus
        );
        AndroidPushIdentityStorage.State rebound = storage.load();
        assertEquals(TENANT_B, rebound.apiOrigin());
        assertTrue(rebound.hasPendingRevocation());
        assertEquals(TENANT_A, rebound.pendingRevocationApiOrigin());
        assertEquals(AUTHORITY_A, rebound.pendingRevocationAuthToken());
    }

    @Test
    public void logoutReportsTypedCleanupAndRetainsTheAuthorityWhilePending()
        throws Exception {
        revocationTransport.failure = new IOException("offline");

        AndroidPushRebindCoordinator.Outcome pending = coordinator().logout(
            credential(TENANT_A, AUTHORITY_A),
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CLEANED,
            pending.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.PENDING,
            pending.cleanup()
        );
        AndroidPushIdentityStorage.State retained = storage.load();
        assertTrue(retained.hasPendingRevocation());
        assertTrue(retained.pendingRevocationRequiresAuthenticationLogout());
        assertEquals(AUTHORITY_A, retained.pendingRevocationAuthToken());
        assertEquals(TENANT_A, retained.pendingRevocationApiOrigin());

        revocationTransport.failure = null;
        AndroidPushRebindCoordinator.Outcome completed = coordinator().logout(
            credential(TENANT_A, AUTHORITY_A),
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.COMPLETED,
            completed.cleanup()
        );
        assertFalse(storage.load().hasPendingRevocation());
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.NOT_REQUIRED,
            coordinator().logout(
                credential(TENANT_A, AUTHORITY_A),
                new NativeAuthHttpClient.CancellationSignal()
            ).cleanup()
        );
        assertEquals(2, revocationTransport.calls.size());
    }

    @Test
    public void logoutWithoutAuthorityReportsThatCleanupCannotRun()
        throws Exception {
        AndroidPushRebindCoordinator.Outcome outcome = coordinator().logout(
            credential(TENANT_A, "  "),
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.AUTHORITY_UNAVAILABLE,
            outcome.cleanup()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Status.CLEANUP_REJECTED,
            publisher.lastStatus
        );
        assertTrue(revocationTransport.calls.isEmpty());
        assertTrue(storage.load().hasServerRegistration());
    }

    @Test
    public void credentialReplacementRevokesWithTheSupersededCredential()
        throws Exception {
        AndroidPushRebindCoordinator.Outcome unchanged =
            coordinator().replaceCredential(
                credential(TENANT_A, AUTHORITY_A),
                credential(TENANT_A, AUTHORITY_A),
                new NativeAuthHttpClient.CancellationSignal()
            );

        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.NOT_REQUIRED,
            unchanged.cleanup()
        );
        assertTrue(revocationTransport.calls.isEmpty());

        AndroidPushRebindCoordinator.Outcome replaced =
            coordinator().replaceCredential(
                credential(TENANT_A, AUTHORITY_A),
                credential(TENANT_A, "tenant-a-replacement-token"),
                new NativeAuthHttpClient.CancellationSignal()
            );

        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.COMPLETED,
            replaced.cleanup()
        );
        assertEquals(1, revocationTransport.calls.size());
        assertEquals(TENANT_A, revocationTransport.calls.get(0).apiOrigin);
        assertEquals(AUTHORITY_A, revocationTransport.calls.get(0).authority);
        assertEquals(
            tenantAInstallationId,
            revocationTransport.calls.get(0).installationId
        );
        AndroidPushIdentityStorage.State current = storage.load();
        assertFalse(current.hasServerRegistration());
        assertNotEquals(tenantAInstallationId, current.installationId());
    }

    @Test
    public void durableCleanupAndAnOpenTransactionBlockANewTransition()
        throws Exception {
        AndroidPushRebindCoordinator coordinator = coordinator();
        AndroidPushRebindCoordinator.Transaction transaction = coordinator.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        ).transaction();

        AndroidPushRebindCoordinator.Outcome concurrent = coordinator.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        );
        AndroidPushRebindCoordinator.Outcome concurrentLogout =
            coordinator.logout(
                credential(TENANT_A, AUTHORITY_A),
                new NativeAuthHttpClient.CancellationSignal()
            );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CONFLICT,
            concurrent.kind()
        );
        assertNull(concurrent.transaction());
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CONFLICT,
            concurrentLogout.kind()
        );

        coordinator.rollback(transaction);
        revocationTransport.failure = new IOException("offline");
        coordinator.logout(
            credential(TENANT_A, AUTHORITY_A),
            new NativeAuthHttpClient.CancellationSignal()
        );

        AndroidPushRebindCoordinator.Outcome blocked = coordinator.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CONFLICT,
            blocked.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.PENDING,
            blocked.cleanup()
        );
        assertFalse(storage.load().hasPendingRebind());
    }

    @Test
    public void aRejectedSupersededCredentialIsReportedAndNeverRetried()
        throws Exception {
        revocationTransport.statusCode = 403;

        AndroidPushRebindCoordinator.Outcome rejected =
            coordinator().replaceCredential(
                credential(TENANT_A, AUTHORITY_A),
                credential(TENANT_A, "tenant-a-replacement-token"),
                new NativeAuthHttpClient.CancellationSignal()
            );
        AndroidPushRebindCoordinator.Status rejectedStatus = publisher.lastStatus;
        AndroidPushRebindCoordinator.Outcome repeated =
            coordinator().replaceCredential(
                credential(TENANT_A, AUTHORITY_A),
                credential(TENANT_A, "tenant-a-replacement-token"),
                new NativeAuthHttpClient.CancellationSignal()
            );

        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.AUTHORITY_REJECTED,
            rejected.cleanup()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Status.CLEANUP_REJECTED,
            rejectedStatus
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.NOT_REQUIRED,
            repeated.cleanup()
        );
        assertEquals(1, revocationTransport.calls.size());
        assertFalse(storage.load().hasPendingRevocation());
        assertTrue(storage.requiresTokenRotation());
    }

    @Test
    public void coldStartRecoveryNeverReplacesATransactionOpenInThisProcess()
        throws Exception {
        AndroidPushRebindCoordinator coordinator = coordinator();
        AndroidPushRebindCoordinator.Transaction transaction = coordinator.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        ).transaction();

        AndroidPushRebindCoordinator.Outcome refused = coordinator.recover(
            TENANT_A,
            3,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CONFLICT,
            refused.kind()
        );
        assertTrue(storage.load().hasPendingRebind());
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.COMMITTED,
            coordinator.commit(
                transaction,
                new NativeAuthHttpClient.CancellationSignal()
            ).kind()
        );
    }

    @Test
    public void logoutAlsoRemovesTheCurrentRegistrationBehindALegacyTombstone()
        throws Exception {
        storage.retainLegacyInstallationForRevocation(
            "00000000-0000-4000-8000-999999999999",
            AUTHORITY_A
        );

        AndroidPushRebindCoordinator.Outcome outcome = coordinator().logout(
            credential(TENANT_A, AUTHORITY_A),
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.COMPLETED,
            outcome.cleanup()
        );
        assertEquals(2, revocationTransport.calls.size());
        assertEquals(
            "00000000-0000-4000-8000-999999999999",
            revocationTransport.calls.get(0).installationId
        );
        assertEquals(
            tenantAInstallationId,
            revocationTransport.calls.get(1).installationId
        );
        assertFalse(storage.load().hasServerRegistration());
    }

    @Test
    public void noCredentialTransitionAcceptsAnAuthorityFromAnotherOrigin()
        throws Exception {
        AndroidPushRebindCoordinator.Outcome foreignLogout =
            coordinator().logout(
                credential(TENANT_B, AUTHORITY_B),
                new NativeAuthHttpClient.CancellationSignal()
            );
        AndroidPushRebindCoordinator.Outcome foreignReplacement =
            coordinator().replaceCredential(
                credential(TENANT_B, AUTHORITY_B),
                credential(TENANT_B, "tenant-b-replacement-token"),
                new NativeAuthHttpClient.CancellationSignal()
            );
        AndroidPushRebindCoordinator.Outcome foreignRebind = coordinator().begin(
            TENANT_B,
            4,
            credential(TENANT_B, AUTHORITY_B)
        );

        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.AUTHORITY_UNAVAILABLE,
            foreignLogout.cleanup()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.AUTHORITY_UNAVAILABLE,
            foreignReplacement.cleanup()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CONFLICT,
            foreignRebind.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.AUTHORITY_UNAVAILABLE,
            foreignRebind.cleanup()
        );
        assertTrue(revocationTransport.calls.isEmpty());
        AndroidPushIdentityStorage.State current = storage.load();
        assertTrue(current.hasServerRegistration());
        assertFalse(current.hasPendingRevocation());
        assertFalse(current.hasPendingRebind());
    }

    @Test
    public void aCrossOriginReplacementIsRefusedInsteadOfBeingTreatedAsARebind()
        throws Exception {
        AndroidPushRebindCoordinator.Outcome outcome =
            coordinator().replaceCredential(
                credential(TENANT_A, AUTHORITY_A),
                credential(TENANT_B, AUTHORITY_B),
                new NativeAuthHttpClient.CancellationSignal()
            );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CONFLICT,
            outcome.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.AUTHORITY_UNAVAILABLE,
            outcome.cleanup()
        );
        assertTrue(revocationTransport.calls.isEmpty());
        assertTrue(storage.load().hasServerRegistration());
    }

    @Test
    public void anUnusableReplacementIsRefusedInsteadOfReportingNoCleanup()
        throws Exception {
        AndroidPushRebindCoordinator.Outcome absent =
            coordinator().replaceCredential(
                credential(TENANT_A, AUTHORITY_A),
                null,
                new NativeAuthHttpClient.CancellationSignal()
            );
        AndroidPushRebindCoordinator.Outcome blankAuthority =
            coordinator().replaceCredential(
                credential(TENANT_A, AUTHORITY_A),
                credential(TENANT_A, "  "),
                new NativeAuthHttpClient.CancellationSignal()
            );
        AndroidPushRebindCoordinator.Outcome unusableOrigin =
            coordinator().replaceCredential(
                credential(TENANT_A, AUTHORITY_A),
                credential("http://tenant-a.example", "tenant-a-replacement"),
                new NativeAuthHttpClient.CancellationSignal()
            );

        for (AndroidPushRebindCoordinator.Outcome refused : List.of(
            absent,
            blankAuthority,
            unusableOrigin
        )) {
            assertEquals(
                AndroidPushRebindCoordinator.Outcome.Kind.CONFLICT,
                refused.kind()
            );
            assertEquals(
                AndroidPushRebindCoordinator.Cleanup.AUTHORITY_UNAVAILABLE,
                refused.cleanup()
            );
        }
        assertEquals(
            AndroidPushRebindCoordinator.Status.CLEANUP_REJECTED,
            publisher.lastStatus
        );
        assertTrue(revocationTransport.calls.isEmpty());
        AndroidPushIdentityStorage.State current = storage.load();
        assertTrue(current.hasServerRegistration());
        assertFalse(current.hasPendingRevocation());
    }

    @Test
    public void anOversizedAuthorityIsRefusedBeforeAnyDestructiveCleanup()
        throws Exception {
        String oversized = "a".repeat(
            AndroidPushIdentityStorage.MAX_AUTH_TOKEN_CHARACTERS + 1
        );

        AndroidPushRebindCoordinator.Outcome staged = coordinator().begin(
            TENANT_B,
            4,
            credential(TENANT_A, oversized)
        );
        AndroidPushRebindCoordinator.Outcome replaced =
            coordinator().replaceCredential(
                credential(TENANT_A, AUTHORITY_A),
                credential(TENANT_A, oversized),
                new NativeAuthHttpClient.CancellationSignal()
            );
        AndroidPushRebindCoordinator.Outcome loggedOut = coordinator().logout(
            credential(TENANT_A, oversized),
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CONFLICT,
            staged.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.AUTHORITY_UNAVAILABLE,
            staged.cleanup()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CONFLICT,
            replaced.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.AUTHORITY_UNAVAILABLE,
            loggedOut.cleanup()
        );
        assertTrue(revocationTransport.calls.isEmpty());
        AndroidPushIdentityStorage.State current = storage.load();
        assertTrue(current.hasServerRegistration());
        assertFalse(current.hasPendingRebind());
        assertFalse(current.hasPendingRevocation());
    }

    @Test
    public void aDurableStagedRebindIsResumedByRecoveryAndNeverOverwritten()
        throws Exception {
        coordinator().begin(TENANT_B, 4, credential(TENANT_A, AUTHORITY_A));

        AndroidPushRebindCoordinator restarted = coordinator();
        AndroidPushRebindCoordinator.Outcome overwritten = restarted.begin(
            "https://tenant-c.example",
            5,
            credential(TENANT_A, AUTHORITY_A)
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CONFLICT,
            overwritten.kind()
        );
        AndroidPushIdentityStorage.State staged = storage.load();
        assertEquals(TENANT_B, staged.pendingRebindApiOrigin());
        assertEquals(AUTHORITY_A, staged.pendingRebindAuthToken());

        AndroidPushRebindCoordinator.Outcome resumed = restarted.recover(
            TENANT_B,
            4,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.RESUMED,
            resumed.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.COMMITTED,
            restarted.commit(
                resumed.transaction(),
                new NativeAuthHttpClient.CancellationSignal()
            ).kind()
        );
        assertEquals(TENANT_B, storage.load().apiOrigin());
    }

    @Test
    public void anUnchangedCredentialFromAnotherOriginIsNotReportedAsNoCleanup()
        throws Exception {
        AndroidPushRebindCoordinator.Outcome foreign =
            coordinator().replaceCredential(
                credential(TENANT_B, AUTHORITY_B),
                credential(TENANT_B, AUTHORITY_B),
                new NativeAuthHttpClient.CancellationSignal()
            );
        AndroidPushRebindCoordinator.Outcome owned =
            coordinator().replaceCredential(
                credential(TENANT_A, AUTHORITY_A),
                credential(TENANT_A, AUTHORITY_A),
                new NativeAuthHttpClient.CancellationSignal()
            );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CONFLICT,
            foreign.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.AUTHORITY_UNAVAILABLE,
            foreign.cleanup()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.NOT_REQUIRED,
            owned.cleanup()
        );
        assertTrue(revocationTransport.calls.isEmpty());
        assertTrue(storage.load().hasServerRegistration());
    }

    @Test
    public void aRollbackAgainstAReplacedIdentityIsStaleInsteadOfTerminal()
        throws Exception {
        AndroidPushRebindCoordinator coordinator = coordinator();
        AndroidPushRebindCoordinator.Transaction transaction = coordinator.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        ).transaction();
        storage.retainCurrentRegistrationForRevocation(AUTHORITY_A, false);
        storage.clearPendingRevocation(
            TENANT_A,
            tenantAInstallationId,
            AUTHORITY_A
        );
        String replacedInstallationId = storage.load().installationId();

        AndroidPushRebindCoordinator.Outcome stale = coordinator.rollback(
            transaction
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.STALE,
            stale.kind()
        );
        assertTrue(transaction.isTerminal());
        assertNotEquals(tenantAInstallationId, replacedInstallationId);
        assertEquals(
            replacedInstallationId,
            storage.load().installationId()
        );
        assertTrue(revocationTransport.calls.isEmpty());
    }

    @Test
    public void aRejectedLegacyTombstoneStillRemovesTheLiveRegistration()
        throws Exception {
        storage.retainLegacyInstallationForRevocation(
            "00000000-0000-4000-8000-999999999999",
            "expired-legacy-authority"
        );
        revocationTransport.statusCode = 401;

        AndroidPushRebindCoordinator.Outcome outcome = coordinator().logout(
            credential(TENANT_A, AUTHORITY_A),
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CLEANED,
            outcome.kind()
        );
        assertEquals(2, revocationTransport.calls.size());
        assertEquals(
            "00000000-0000-4000-8000-999999999999",
            revocationTransport.calls.get(0).installationId
        );
        assertEquals(
            "expired-legacy-authority",
            revocationTransport.calls.get(0).authority
        );
        assertEquals(
            tenantAInstallationId,
            revocationTransport.calls.get(1).installationId
        );
        assertEquals(AUTHORITY_A, revocationTransport.calls.get(1).authority);
        assertFalse(storage.load().hasServerRegistration());
    }

    /**
     * Every transition validates a credential against a loaded state and then
     * calls a storage method that reloads the state itself. This rebinds the
     * runtime in between, so any transition that is not compare-and-set would
     * carry tenant A's authority into the tenant B binding.
     */
    @Test
    public void noTransitionAppliesToABindingThatChangedAfterValidation()
        throws Exception {
        for (String transition : List.of("begin", "logout", "replace")) {
            setUp();
            cipher.rebindAfterNextRead = () -> {
                try {
                    storage.bindRuntime(TENANT_B, 4, AUTHORITY_A);
                } catch (TokenStorageException exception) {
                    throw new AssertionError(exception);
                }
            };

            AndroidPushRebindCoordinator.Outcome outcome;
            switch (transition) {
                case "begin":
                    outcome = coordinator().begin(
                        "https://tenant-c.example",
                        5,
                        credential(TENANT_A, AUTHORITY_A)
                    );
                    break;
                case "logout":
                    outcome = coordinator().logout(
                        credential(TENANT_A, AUTHORITY_A),
                        new NativeAuthHttpClient.CancellationSignal()
                    );
                    break;
                default:
                    outcome = coordinator().replaceCredential(
                        credential(TENANT_A, AUTHORITY_A),
                        credential(TENANT_A, "tenant-a-replacement-token"),
                        new NativeAuthHttpClient.CancellationSignal()
                    );
            }

            assertEquals(
                transition,
                AndroidPushRebindCoordinator.Outcome.Kind.FAILED,
                outcome.kind()
            );
            AndroidPushIdentityStorage.State current = storage.load();
            assertEquals(transition, TENANT_B, current.apiOrigin());
            assertFalse(transition, current.hasPendingRebind());
            for (FakeRevocationTransport.Call call : revocationTransport.calls) {
                assertEquals(transition, TENANT_A, call.apiOrigin);
            }
            if (current.hasPendingRevocation()) {
                assertEquals(
                    transition,
                    TENANT_A,
                    current.pendingRevocationApiOrigin()
                );
            }
        }
    }

    @Test
    public void aTransactionStagedAgainstAnEmptyStoreRefusesANewIdentity()
        throws Exception {
        storage.clear();
        AndroidPushRebindCoordinator coordinator = coordinator();
        AndroidPushRebindCoordinator.Outcome staged = coordinator.begin(
            TENANT_B,
            4,
            null
        );
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.STAGED,
            staged.kind()
        );
        AndroidPushRebindCoordinator.Transaction transaction =
            staged.transaction();
        assertNotNull(transaction);
        AndroidPushIdentityStorage.State appeared = storage.bindRuntime(
            TENANT_A,
            3
        );
        storage.recordToken(TENANT_A, 3, appeared.installationId(), TOKEN);

        AndroidPushRebindCoordinator.Outcome stale = coordinator.commit(
            transaction,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.STALE,
            stale.kind()
        );
        AndroidPushIdentityStorage.State current = storage.load();
        assertEquals(TENANT_A, current.apiOrigin());
        assertEquals(appeared.installationId(), current.installationId());
        assertEquals(TOKEN, current.token());
    }

    @Test
    public void aLateCancellationStillReportsARetiredAuthority()
        throws Exception {
        revocationTransport.failure = new IOException("offline");
        coordinator().logout(
            credential(TENANT_A, AUTHORITY_A),
            new NativeAuthHttpClient.CancellationSignal()
        );
        revocationTransport.failure = null;
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();
        revocationTransport.cancelAfterResponse = cancellation;

        AndroidPushRebindCoordinator.Outcome outcome = coordinator().cleanup(
            cancellation
        );

        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.CANCELLED,
            outcome.cleanup()
        );
        assertFalse(storage.load().hasPendingRevocation());
        assertTrue(outcome.retiredAuthenticationAuthority());
    }

    @Test
    public void aDurableStagedRebindBlocksCredentialCleanupAfterARestart()
        throws Exception {
        coordinator().begin(TENANT_B, 4, credential(TENANT_A, AUTHORITY_A));

        AndroidPushRebindCoordinator restarted = coordinator();
        AndroidPushRebindCoordinator.Outcome loggedOut = restarted.logout(
            credential(TENANT_A, AUTHORITY_A),
            new NativeAuthHttpClient.CancellationSignal()
        );
        AndroidPushRebindCoordinator.Outcome replaced =
            restarted.replaceCredential(
                credential(TENANT_A, AUTHORITY_A),
                credential(TENANT_A, "tenant-a-replacement-token"),
                new NativeAuthHttpClient.CancellationSignal()
            );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CONFLICT,
            loggedOut.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CONFLICT,
            replaced.kind()
        );
        assertTrue(revocationTransport.calls.isEmpty());
        AndroidPushIdentityStorage.State current = storage.load();
        assertTrue(current.hasPendingRebind());
        assertEquals(AUTHORITY_A, current.pendingRebindAuthToken());
        assertTrue(current.hasServerRegistration());
    }

    @Test
    public void unusableRecoveryMetadataNeverDiscardsAStagedAuthority()
        throws Exception {
        coordinator().begin(TENANT_B, 4, credential(TENANT_A, AUTHORITY_A));

        AndroidPushRebindCoordinator restarted = coordinator();
        AndroidPushRebindCoordinator.Outcome malformed = restarted.recover(
            "http://tenant-b.example",
            4,
            new NativeAuthHttpClient.CancellationSignal()
        );
        AndroidPushRebindCoordinator.Outcome unconfigured = restarted.recover(
            TENANT_B,
            0,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.FAILED,
            malformed.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.FAILED,
            unconfigured.kind()
        );
        AndroidPushIdentityStorage.State staged = storage.load();
        assertTrue(staged.hasPendingRebind());
        assertEquals(TENANT_B, staged.pendingRebindApiOrigin());
        assertEquals(AUTHORITY_A, staged.pendingRebindAuthToken());

        AndroidPushRebindCoordinator.Outcome resumed = restarted.recover(
            TENANT_B,
            4,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.RESUMED,
            resumed.kind()
        );
    }

    @Test
    public void aForeignCredentialIsRefusedEvenBeforeRegistrationAppears()
        throws Exception {
        storage.clearRegistrationAuthority();
        assertFalse(storage.load().hasServerRegistration());
        AndroidPushIdentityStorage.State unregistered = storage.load();
        cipher.rebindAfterNextRead = () -> {
            try {
                storage.markRegistered(
                    storage.snapshot(),
                    "e".repeat(64),
                    "f".repeat(64)
                );
            } catch (TokenStorageException exception) {
                throw new AssertionError(exception);
            }
        };

        AndroidPushRebindCoordinator.Outcome outcome = coordinator().begin(
            "https://tenant-c.example",
            5,
            credential(TENANT_B, AUTHORITY_B)
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CONFLICT,
            outcome.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.AUTHORITY_UNAVAILABLE,
            outcome.cleanup()
        );
        AndroidPushIdentityStorage.State current = storage.load();
        assertFalse(current.hasPendingRebind());
        assertEquals(TENANT_A, current.apiOrigin());
        assertEquals(unregistered.installationId(), current.installationId());
    }

    @Test
    public void aRejectedAuthorityIsAlsoReportedAsRetired() throws Exception {
        revocationTransport.failure = new IOException("offline");
        coordinator().logout(
            credential(TENANT_A, AUTHORITY_A),
            new NativeAuthHttpClient.CancellationSignal()
        );
        revocationTransport.failure = null;
        revocationTransport.statusCode = 403;

        AndroidPushRebindCoordinator.Outcome outcome = coordinator().cleanup(
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.AUTHORITY_REJECTED,
            outcome.cleanup()
        );
        assertTrue(outcome.retiredAuthenticationAuthority());
        assertFalse(storage.load().hasPendingRevocation());
    }

    @Test
    public void aPendingCleanupNeverClaimsTheAuthorityIsRetired()
        throws Exception {
        revocationTransport.failure = new IOException("offline");

        AndroidPushRebindCoordinator.Outcome outcome = coordinator().logout(
            credential(TENANT_A, AUTHORITY_A),
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.PENDING,
            outcome.cleanup()
        );
        assertFalse(outcome.retiredAuthenticationAuthority());
        assertTrue(
            storage.load().pendingRevocationRequiresAuthenticationLogout()
        );
    }

    @Test
    public void aRetirementSurvivesASecondDrainInTheSameTransition()
        throws Exception {
        AndroidPushRebindCoordinator coordinator = coordinator();
        revocationTransport.failure = new IOException("offline");
        coordinator.commit(
            coordinator.begin(
                TENANT_B,
                4,
                credential(TENANT_A, AUTHORITY_A)
            ).transaction(),
            new NativeAuthHttpClient.CancellationSignal()
        );
        AndroidPushIdentityStorage.State rebound = storage.load();
        assertTrue(rebound.pendingRevocationRequiresAuthenticationLogout());

        revocationTransport.failure = null;
        storage.recordToken(TENANT_B, 4, rebound.installationId(), TOKEN + "-b");
        storage.markRegistered(
            storage.snapshot(),
            "1".repeat(64),
            "2".repeat(64)
        );

        AndroidPushRebindCoordinator.Outcome replaced =
            coordinator().replaceCredential(
                credential(TENANT_B, AUTHORITY_B),
                credential(TENANT_B, "tenant-b-replacement-token"),
                new NativeAuthHttpClient.CancellationSignal()
            );

        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.COMPLETED,
            replaced.cleanup()
        );
        assertTrue(replaced.retiredAuthenticationAuthority());
        assertEquals(3, revocationTransport.calls.size());
        for (int attempt = 0; attempt < 2; attempt++) {
            assertEquals(
                TENANT_A,
                revocationTransport.calls.get(attempt).apiOrigin
            );
            assertEquals(
                AUTHORITY_A,
                revocationTransport.calls.get(attempt).authority
            );
        }
        assertEquals(TENANT_B, revocationTransport.calls.get(2).apiOrigin);
        assertEquals(AUTHORITY_B, revocationTransport.calls.get(2).authority);
        assertFalse(storage.load().hasPendingRevocation());
    }

    @Test
    public void aRetirementSurvivesEveryOutcomeOfTheFollowingTransition()
        throws Exception {
        for (String followUp : List.of("failure", "unauthorized")) {
            setUp();
            AndroidPushRebindCoordinator coordinator = coordinator();
            revocationTransport.failure = new IOException("offline");
            coordinator.commit(
                coordinator.begin(
                    TENANT_B,
                    4,
                    credential(TENANT_A, AUTHORITY_A)
                ).transaction(),
                new NativeAuthHttpClient.CancellationSignal()
            );
            AndroidPushIdentityStorage.State rebound = storage.load();
            assertTrue(
                followUp,
                rebound.pendingRevocationRequiresAuthenticationLogout()
            );
            revocationTransport.failure = null;
            storage.recordToken(
                TENANT_B,
                4,
                rebound.installationId(),
                TOKEN + "-b"
            );
            storage.markRegistered(
                storage.snapshot(),
                "1".repeat(64),
                "2".repeat(64)
            );

            AndroidPushRebindCoordinator.Outcome outcome;
            if (followUp.equals("failure")) {
                cipher.failOnceTombstoneCleared = true;
                outcome = coordinator().logout(
                    credential(TENANT_B, AUTHORITY_B),
                    new NativeAuthHttpClient.CancellationSignal()
                );
                assertEquals(
                    followUp,
                    AndroidPushRebindCoordinator.Outcome.Kind.FAILED,
                    outcome.kind()
                );
            } else {
                outcome = coordinator().logout(
                    credential(TENANT_A, AUTHORITY_A),
                    new NativeAuthHttpClient.CancellationSignal()
                );
                assertEquals(
                    followUp,
                    AndroidPushRebindCoordinator.Cleanup.AUTHORITY_UNAVAILABLE,
                    outcome.cleanup()
                );
            }

            assertTrue(followUp, outcome.retiredAuthenticationAuthority());
        }
    }

    @Test
    public void aRetirementSurvivesProcessDeathBeforeItIsConsumed()
        throws Exception {
        revocationTransport.failure = new IOException("offline");
        coordinator().logout(
            credential(TENANT_A, AUTHORITY_A),
            new NativeAuthHttpClient.CancellationSignal()
        );
        revocationTransport.failure = null;

        coordinator().cleanup(new NativeAuthHttpClient.CancellationSignal());

        assertFalse(storage.load().hasPendingRevocation());
        assertTrue(storage.hasRetiredAuthenticationAuthority());
        AndroidPushRebindCoordinator afterRestart = coordinator();
        assertTrue(
            afterRestart.cleanup(
                new NativeAuthHttpClient.CancellationSignal()
            ).retiredAuthenticationAuthority()
        );

        afterRestart.acknowledgeRetiredAuthority();

        assertFalse(
            coordinator().cleanup(
                new NativeAuthHttpClient.CancellationSignal()
            ).retiredAuthenticationAuthority()
        );
    }

    @Test
    public void aRestagedTransactionIsDistinguishedFromTheOlderHandle()
        throws Exception {
        AndroidPushRebindCoordinator first = coordinator();
        AndroidPushRebindCoordinator.Transaction older = first.begin(
            TENANT_B,
            4,
            credential(TENANT_A, AUTHORITY_A)
        ).transaction();

        AndroidPushRebindCoordinator second = coordinator();
        AndroidPushRebindCoordinator.Outcome resumed = second.recover(
            TENANT_B,
            4,
            new NativeAuthHttpClient.CancellationSignal()
        );
        AndroidPushRebindCoordinator.Outcome rolledBack = second.rollback(
            resumed.transaction()
        );
        AndroidPushRebindCoordinator.Transaction restaged = second.begin(
            TENANT_B,
            4,
            credential(TENANT_A, "restaged-authority")
        ).transaction();

        AndroidPushRebindCoordinator.Outcome stale = first.commit(
            older,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.ROLLED_BACK,
            rolledBack.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.STALE,
            stale.kind()
        );
        assertTrue(revocationTransport.calls.isEmpty());
        assertEquals(TENANT_A, storage.load().apiOrigin());
        assertEquals(
            "restaged-authority",
            storage.load().pendingRebindAuthToken()
        );

        AndroidPushRebindCoordinator.Outcome committed = second.commit(
            restaged,
            new NativeAuthHttpClient.CancellationSignal()
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.COMMITTED,
            committed.kind()
        );
        assertEquals(
            "restaged-authority",
            revocationTransport.calls.get(0).authority
        );
    }

    @Test
    public void anUnusableRuntimeOriginFailsInsteadOfStagingATransition()
        throws Exception {
        AndroidPushRebindCoordinator.Outcome outcome = coordinator().begin(
            "http://tenant-b.example",
            4,
            credential(TENANT_A, AUTHORITY_A)
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.FAILED,
            outcome.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Status.RETRY_PENDING,
            publisher.lastStatus
        );
        assertFalse(storage.load().hasPendingRebind());
    }

    @Test
    public void rebindWithoutRevocationAuthorityIsRefusedInsteadOfOrphaning()
        throws Exception {
        AndroidPushRebindCoordinator.Outcome refused = coordinator().begin(
            TENANT_B,
            4,
            credential(TENANT_A, " ")
        );

        assertEquals(
            AndroidPushRebindCoordinator.Outcome.Kind.CONFLICT,
            refused.kind()
        );
        assertEquals(
            AndroidPushRebindCoordinator.Cleanup.AUTHORITY_UNAVAILABLE,
            refused.cleanup()
        );
        assertFalse(storage.load().hasPendingRebind());
        assertTrue(storage.load().hasServerRegistration());
    }

    private String registerTenantA() throws Exception {
        AndroidPushIdentityStorage.State bound = storage.bindRuntime(TENANT_A, 3);
        storage.recordToken(TENANT_A, 3, bound.installationId(), TOKEN);
        AndroidPushIdentityStorage.State registered = storage.markRegistered(
            storage.snapshot(),
            "a".repeat(64),
            "b".repeat(64)
        );
        return registered.installationId();
    }

    private static AndroidPushRebindCoordinator.Credential credential(
        String apiOrigin,
        String authority
    ) {
        return new AndroidPushRebindCoordinator.Credential(apiOrigin, authority);
    }

    private AndroidPushRebindCoordinator coordinator() {
        return new AndroidPushRebindCoordinator(
            storage,
            new AndroidPushRevocationCoordinator(
                storage,
                revocationTransport,
                status -> { }
            ),
            publisher
        );
    }

    private AndroidPushRegistrationCoordinator registrationCoordinator() {
        return new AndroidPushRegistrationCoordinator(
            storage,
            registrationTransport,
            new AndroidPushRegistrationCoordinator.ClientMetadata(
                "Samsung reception tablet",
                "app.secpal",
                "1.2.3",
                7,
                "Samsung",
                "SM-G556B",
                "16",
                36,
                "v1",
                4
            ),
            status -> { }
        );
    }

    private AndroidPushIdentityStorage createStorage() {
        return new AndroidPushIdentityStorage(
            preferences,
            cipher,
            () -> String.format(
                "00000000-0000-4000-8000-%012d",
                ids.incrementAndGet()
            ),
            () -> 1_700_000_000_000L
        );
    }

    private static final class FakeRevocationTransport
        implements AndroidPushRevocationCoordinator.Transport {
        private final List<Call> calls = new ArrayList<>();
        private int statusCode = 204;
        private IOException failure;
        private boolean cancelDuringRequest;
        private NativeAuthHttpClient.CancellationSignal cancelAfterResponse;

        @Override
        public int delete(
            String apiOrigin,
            String authority,
            String installationId,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException {
            calls.add(new Call(apiOrigin, authority, installationId));
            if (cancelDuringRequest) {
                cancellation.cancel();
                cancellation.throwIfCancelled();
            }
            if (failure != null) {
                throw failure;
            }
            if (cancelAfterResponse != null) {
                cancelAfterResponse.cancel();
            }
            return statusCode;
        }

        private static final class Call {
            private final String apiOrigin;
            private final String authority;
            private final String installationId;

            Call(String apiOrigin, String authority, String installationId) {
                this.apiOrigin = apiOrigin;
                this.authority = authority;
                this.installationId = installationId;
            }
        }
    }

    private static final class FakeRegistrationTransport
        implements AndroidPushRegistrationCoordinator.Transport {
        private final List<Call> calls = new ArrayList<>();

        @Override
        public Response put(
            String apiOrigin,
            String authority,
            String installationId,
            JSONObject requestPayload,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) {
            calls.add(new Call(apiOrigin, authority));
            return new Response(200, null);
        }

        private static final class Call {
            private final String apiOrigin;
            private final String authority;

            Call(String apiOrigin, String authority) {
                this.apiOrigin = apiOrigin;
                this.authority = authority;
            }
        }
    }

    private static final class RecordingPublisher
        implements AndroidPushRebindCoordinator.StatusPublisher {
        private AndroidPushRebindCoordinator.Status lastStatus;

        @Override
        public void publish(AndroidPushRebindCoordinator.Status status) {
            lastStatus = status;
        }
    }

    private static final class MemoryCipher implements TokenCipher {
        private final Map<String, String> plaintextByCiphertext = new HashMap<>();
        private int sequence;
        private boolean unavailable;
        private boolean failOnceTombstoneCleared;
        private Runnable rebindAfterNextRead;

        @Override
        public EncryptedTokenPayload encrypt(String plaintext) {
            requireAvailable();
            String ciphertext = "encrypted-" + ++sequence;
            plaintextByCiphertext.put(ciphertext, plaintext);
            return new EncryptedTokenPayload(ciphertext, "iv-" + sequence);
        }

        @Override
        public String decrypt(EncryptedTokenPayload payload) {
            requireAvailable();
            String plaintext = plaintextByCiphertext.get(payload.getCiphertext());
            assertNotNull(plaintext);
            if (failOnceTombstoneCleared
                && !plaintext.contains("pendingRevocationApiOrigin")) {
                throw new IllegalStateException("keystore unavailable");
            }
            Runnable pending = rebindAfterNextRead;
            if (pending != null) {
                rebindAfterNextRead = null;
                pending.run();
            }
            return plaintext;
        }

        private void requireAvailable() {
            if (unavailable) {
                throw new IllegalStateException("keystore unavailable");
            }
        }
    }
}
