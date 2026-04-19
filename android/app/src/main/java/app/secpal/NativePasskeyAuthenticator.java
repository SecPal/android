/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import android.app.Activity;

import androidx.core.content.ContextCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.CreatePublicKeyCredentialRequest;
import androidx.credentials.CreatePublicKeyCredentialResponse;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPublicKeyCredentialOption;
import androidx.credentials.PublicKeyCredential;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialException;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

class NativePasskeyAuthenticator {
    private static final long PASSKEY_TIMEOUT_SECONDS = 90;

    String authenticate(Activity activity, String requestJson) throws PasskeyAuthenticationException {
        CredentialManager credentialManager = CredentialManager.create(activity);
        GetCredentialRequest request;

        try {
            request = new GetCredentialRequest.Builder()
                .addCredentialOption(new GetPublicKeyCredentialOption(requestJson))
                .build();
        } catch (RuntimeException exception) {
            throw new PasskeyAuthenticationException(
                "Passkey sign-in request is invalid.",
                "INVALID_INPUT",
                exception
            );
        }

        return awaitAuthenticationResponse(activity, credentialManager, request);
    }

    String register(Activity activity, String requestJson) throws PasskeyAuthenticationException {
        CredentialManager credentialManager = CredentialManager.create(activity);
        CreatePublicKeyCredentialRequest request;

        try {
            request = new CreatePublicKeyCredentialRequest(requestJson);
        } catch (RuntimeException exception) {
            throw new PasskeyAuthenticationException(
                "Passkey registration request is invalid.",
                "INVALID_INPUT",
                exception
            );
        }

        CompletableFuture<String> responseFuture = new CompletableFuture<>();

        activity.runOnUiThread(() -> credentialManager.createCredentialAsync(
            activity,
            request,
            null,
            ContextCompat.getMainExecutor(activity),
            new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                @Override
                public void onResult(CreateCredentialResponse result) {
                    if (!(result instanceof CreatePublicKeyCredentialResponse)) {
                        responseFuture.completeExceptionally(new PasskeyAuthenticationException(
                            "This device did not return a passkey credential.",
                            "PASSKEY_UNAVAILABLE"
                        ));
                        return;
                    }

                    responseFuture.complete(
                        ((CreatePublicKeyCredentialResponse) result).getRegistrationResponseJson()
                    );
                }

                @Override
                public void onError(CreateCredentialException exception) {
                    responseFuture.completeExceptionally(mapCreateCredentialException(exception));
                }
            }
        ));

        return awaitPasskeyResponse(
            responseFuture,
            "Passkey registration",
            "PASSKEY_ERROR"
        );
    }

    private String awaitAuthenticationResponse(
        Activity activity,
        CredentialManager credentialManager,
        GetCredentialRequest request
    ) throws PasskeyAuthenticationException {
        CompletableFuture<String> responseFuture = new CompletableFuture<>();

        activity.runOnUiThread(() -> credentialManager.getCredentialAsync(
            activity,
            request,
            null,
            ContextCompat.getMainExecutor(activity),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse result) {
                    Credential credential = result.getCredential();

                    if (!(credential instanceof PublicKeyCredential)) {
                        responseFuture.completeExceptionally(new PasskeyAuthenticationException(
                            "This device did not return a passkey credential.",
                            "PASSKEY_UNAVAILABLE"
                        ));
                        return;
                    }

                    responseFuture.complete(((PublicKeyCredential) credential).getAuthenticationResponseJson());
                }

                @Override
                public void onError(GetCredentialException exception) {
                    responseFuture.completeExceptionally(mapCredentialException(exception));
                }
            }
        ));

        return awaitPasskeyResponse(
            responseFuture,
            "Passkey sign-in",
            "PASSKEY_ERROR"
        );
    }

    private String awaitPasskeyResponse(
        CompletableFuture<String> responseFuture,
        String operationLabel,
        String fallbackErrorCode
    ) throws PasskeyAuthenticationException {
        try {
            return responseFuture.get(PASSKEY_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new PasskeyAuthenticationException(
                operationLabel + " was interrupted.",
                "PASSKEY_INTERRUPTED",
                exception
            );
        } catch (TimeoutException exception) {
            throw new PasskeyAuthenticationException(
                operationLabel + " timed out.",
                "PASSKEY_TIMEOUT",
                exception
            );
        } catch (ExecutionException exception) {
            Throwable cause = exception.getCause();

            if (cause instanceof PasskeyAuthenticationException) {
                throw (PasskeyAuthenticationException) cause;
            }

            throw new PasskeyAuthenticationException(
                operationLabel + " failed. Please try again.",
                fallbackErrorCode,
                cause
            );
        }
    }

    private PasskeyAuthenticationException mapCredentialException(GetCredentialException exception) {
        String className = exception.getClass().getSimpleName();

        if (className.contains("Cancellation") || className.contains("Canceled")) {
            return new PasskeyAuthenticationException(
                "Passkey sign-in was cancelled.",
                "PASSKEY_CANCELLED",
                exception
            );
        }

        if (className.contains("NoCredential")) {
            return new PasskeyAuthenticationException(
                "No passkey is available on this device for the selected account.",
                "PASSKEY_UNAVAILABLE",
                exception
            );
        }

        if (className.contains("ProviderConfiguration")) {
            return new PasskeyAuthenticationException(
                "No credential provider is available on this device.",
                "PASSKEY_PROVIDER_UNAVAILABLE",
                exception
            );
        }

        if (className.contains("Interrupted")) {
            return new PasskeyAuthenticationException(
                "Passkey sign-in was interrupted.",
                "PASSKEY_INTERRUPTED",
                exception
            );
        }

        return new PasskeyAuthenticationException(
            "Passkey sign-in failed. Please try again.",
            "PASSKEY_ERROR",
            exception
        );
    }

    private PasskeyAuthenticationException mapCreateCredentialException(CreateCredentialException exception) {
        String className = exception.getClass().getSimpleName();

        if (className.contains("Cancellation") || className.contains("Canceled")) {
            return new PasskeyAuthenticationException(
                "Passkey registration was cancelled.",
                "PASSKEY_CANCELLED",
                exception
            );
        }

        if (className.contains("ProviderConfiguration")) {
            return new PasskeyAuthenticationException(
                "No credential provider is available on this device.",
                "PASSKEY_PROVIDER_UNAVAILABLE",
                exception
            );
        }

        if (className.contains("Interrupted")) {
            return new PasskeyAuthenticationException(
                "Passkey registration was interrupted.",
                "PASSKEY_INTERRUPTED",
                exception
            );
        }

        return new PasskeyAuthenticationException(
            "Passkey registration failed. Please try again.",
            "PASSKEY_ERROR",
            exception
        );
    }
}
