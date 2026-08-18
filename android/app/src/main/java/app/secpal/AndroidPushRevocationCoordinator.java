/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import com.getcapacitor.JSObject;

import java.io.IOException;

/**
 * Retries one protected Android push revocation tombstone.
 *
 * <p>The request origin, installation identifier, and authority always come from
 * the same durable tombstone. Callers can cancel work but cannot replace its
 * authority or redirect cleanup to another origin.</p>
 */
final class AndroidPushRevocationCoordinator {
    enum Status {
        CLEAN,
        AUTHORITY_REJECTED,
        RETRY_PENDING,
        CANCELLED
    }

    interface StatusPublisher {
        void publish(Status status);
    }

    interface Transport {
        int delete(
            String apiOrigin,
            String authority,
            String installationId,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException, NativeAuthHttpException;
    }

    static final class NativeTransport implements Transport {
        private final NativeAuthHttpClient httpClient;

        NativeTransport(NativeAuthHttpClient httpClient) {
            this.httpClient = httpClient;
        }

        @Override
        public int delete(
            String apiOrigin,
            String authority,
            String installationId,
            NativeAuthHttpClient.CancellationSignal cancellation
        ) throws IOException, NativeAuthHttpException {
            JSObject response = httpClient.requestAuxiliaryJson(
                apiOrigin,
                authority,
                "DELETE",
                "/v1/me/notification-installations/" + installationId,
                null,
                null,
                "application/json",
                cancellation
            );
            Integer statusCode = response.getInteger("status");
            return statusCode == null ? 0 : statusCode;
        }
    }

    static final class Outcome {
        enum Kind {
            SUCCESS(Status.CLEAN),
            AUTHORITY_REJECTED(Status.AUTHORITY_REJECTED),
            RETRYABLE_FAILURE(Status.RETRY_PENDING),
            CANCELLED(Status.CANCELLED);

            private final Status status;

            Kind(Status status) {
                this.status = status;
            }
        }

        private final Kind kind;

        private Outcome(Kind kind) {
            this.kind = kind;
        }

        static Outcome of(Kind kind) {
            return new Outcome(kind);
        }

        Kind kind() {
            return kind;
        }

        Status status() {
            return kind.status;
        }
    }

    private final AndroidPushIdentityStorage storage;
    private final Transport transport;
    private final StatusPublisher statusPublisher;

    AndroidPushRevocationCoordinator(
        AndroidPushIdentityStorage storage,
        Transport transport,
        StatusPublisher statusPublisher
    ) {
        this.storage = storage;
        this.transport = transport;
        this.statusPublisher = statusPublisher;
    }

    synchronized Outcome retry(
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        AndroidPushIdentityStorage.State tombstone;
        try {
            cancellation.throwIfCancelled();
            tombstone = storage.load();
            if (tombstone == null || !tombstone.hasPendingRevocation()) {
                return publish(Outcome.Kind.SUCCESS);
            }
        } catch (NativeAuthHttpClient.NativeAuthCancelledException exception) {
            return publish(cancelledOrTimedOut(exception));
        } catch (IOException | TokenStorageException | RuntimeException exception) {
            return publish(Outcome.Kind.RETRYABLE_FAILURE);
        }

        int statusCode;
        try {
            statusCode = transport.delete(
                tombstone.pendingRevocationApiOrigin(),
                tombstone.pendingRevocationAuthToken(),
                tombstone.pendingRevocationInstallationId(),
                cancellation
            );
        } catch (NativeAuthHttpClient.NativeAuthCancelledException exception) {
            if (isDefinitive(exception.getResponseStatusCode())) {
                Outcome.Kind persisted = persistDefinitiveOutcome(
                    tombstone,
                    exception.getResponseStatusCode()
                );
                return publish(
                    persisted == Outcome.Kind.RETRYABLE_FAILURE
                        ? persisted
                        : Outcome.Kind.CANCELLED
                );
            }
            return publish(cancelledOrTimedOut(exception));
        } catch (NativeAuthHttpException exception) {
            statusCode = exception.getStatusCode();
            if (!isDefinitive(statusCode)) {
                return publish(
                    cancellation.isCancelled()
                        ? Outcome.Kind.CANCELLED
                        : Outcome.Kind.RETRYABLE_FAILURE
                );
            }
        } catch (IOException | RuntimeException exception) {
            return publish(
                cancellation.isCancelled()
                    ? Outcome.Kind.CANCELLED
                    : Outcome.Kind.RETRYABLE_FAILURE
            );
        }

        Outcome.Kind persisted = persistDefinitiveOutcome(tombstone, statusCode);
        if (persisted == Outcome.Kind.RETRYABLE_FAILURE) {
            return publish(persisted);
        }
        if (cancellation.isCancelled()) {
            return publish(Outcome.Kind.CANCELLED);
        }
        return publish(persisted);
    }

    private Outcome.Kind persistDefinitiveOutcome(
        AndroidPushIdentityStorage.State tombstone,
        int statusCode
    ) {
        try {
            if (isSuccessful(statusCode)) {
                AndroidPushIdentityStorage.State current =
                    storage.clearPendingRevocation(
                        tombstone.pendingRevocationApiOrigin(),
                        tombstone.pendingRevocationInstallationId()
                    );
                return current != null && current.hasPendingRevocation()
                    ? Outcome.Kind.RETRYABLE_FAILURE
                    : Outcome.Kind.SUCCESS;
            }
            if (isAuthorityRejected(statusCode)) {
                boolean rejected = storage.markPendingRevocationAuthorityRejected(
                    tombstone.pendingRevocationApiOrigin(),
                    tombstone.pendingRevocationInstallationId(),
                    tombstone.pendingRevocationAuthToken()
                );
                if (rejected) {
                    return Outcome.Kind.AUTHORITY_REJECTED;
                }
                AndroidPushIdentityStorage.State current = storage.load();
                return current != null && current.hasPendingRevocation()
                    ? Outcome.Kind.RETRYABLE_FAILURE
                    : Outcome.Kind.SUCCESS;
            }
            return Outcome.Kind.RETRYABLE_FAILURE;
        } catch (TokenStorageException | RuntimeException exception) {
            return Outcome.Kind.RETRYABLE_FAILURE;
        }
    }

    private Outcome publish(Outcome.Kind kind) {
        Outcome outcome = Outcome.of(kind);
        statusPublisher.publish(outcome.status());
        return outcome;
    }

    private static Outcome.Kind cancelledOrTimedOut(
        NativeAuthHttpClient.NativeAuthCancelledException exception
    ) {
        return "REQUEST_TIMEOUT".equals(exception.getReasonCode())
            ? Outcome.Kind.RETRYABLE_FAILURE
            : Outcome.Kind.CANCELLED;
    }

    private static boolean isDefinitive(int statusCode) {
        return isSuccessful(statusCode) || isAuthorityRejected(statusCode);
    }

    private static boolean isSuccessful(int statusCode) {
        return statusCode == 200 || statusCode == 204 || statusCode == 404;
    }

    private static boolean isAuthorityRejected(int statusCode) {
        return statusCode == 401 || statusCode == 403;
    }
}
