/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package app.secpal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;

import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.CreateCredentialCancellationException;
import androidx.credentials.exceptions.CreateCredentialProviderConfigurationException;
import androidx.credentials.exceptions.CreateCredentialUnsupportedException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException;
import androidx.credentials.exceptions.GetCredentialUnsupportedException;
import androidx.credentials.exceptions.NoCredentialException;

import org.junit.Test;

public class NativePasskeyAuthenticatorTest {

    private static final class UnknownGetCredentialException extends GetCredentialException {
        private UnknownGetCredentialException() {
            super("UNKNOWN_GET_CREDENTIAL_EXCEPTION");
        }
    }

    private static final class UnknownCreateCredentialException extends CreateCredentialException {
        private UnknownCreateCredentialException() {
            super("UNKNOWN_CREATE_CREDENTIAL_EXCEPTION");
        }
    }

    @Test
    public void mapGetCredentialExceptionUsesCancelledCodeForUserCancellation() {
        GetCredentialCancellationException exception = new GetCredentialCancellationException();

        PasskeyAuthenticationException mappedException =
            NativePasskeyAuthenticator.mapGetCredentialException(exception);

        assertEquals("PASSKEY_CANCELLED", mappedException.getErrorCode());
        assertEquals("Passkey sign-in was cancelled.", mappedException.getMessage());
        assertSame(exception, mappedException.getCause());
    }

    @Test
    public void mapGetCredentialExceptionUsesUnavailableCodeWhenNoCredentialExists() {
        NoCredentialException exception = new NoCredentialException();

        PasskeyAuthenticationException mappedException =
            NativePasskeyAuthenticator.mapGetCredentialException(exception);

        assertEquals("PASSKEY_UNAVAILABLE", mappedException.getErrorCode());
        assertEquals(
            "No passkey is available on this device for the selected account.",
            mappedException.getMessage()
        );
        assertSame(exception, mappedException.getCause());
    }

    @Test
    public void mapGetCredentialExceptionUsesProviderUnavailableForProviderConfigurationErrors() {
        GetCredentialProviderConfigurationException exception =
            new GetCredentialProviderConfigurationException();

        PasskeyAuthenticationException mappedException =
            NativePasskeyAuthenticator.mapGetCredentialException(exception);

        assertEquals("PASSKEY_PROVIDER_UNAVAILABLE", mappedException.getErrorCode());
        assertEquals(
            "No credential provider is available on this device.",
            mappedException.getMessage()
        );
        assertSame(exception, mappedException.getCause());
    }

    @Test
    public void mapGetCredentialExceptionTreatsUnsupportedDevicesAsProviderUnavailable() {
        GetCredentialUnsupportedException exception = new GetCredentialUnsupportedException();

        PasskeyAuthenticationException mappedException =
            NativePasskeyAuthenticator.mapGetCredentialException(exception);

        assertEquals("PASSKEY_PROVIDER_UNAVAILABLE", mappedException.getErrorCode());
        assertEquals(
            "No credential provider is available on this device.",
            mappedException.getMessage()
        );
        assertSame(exception, mappedException.getCause());
    }

    @Test
    public void mapGetCredentialExceptionUsesGenericErrorForUnknownExceptionTypes() {
        UnknownGetCredentialException exception = new UnknownGetCredentialException();

        PasskeyAuthenticationException mappedException =
            NativePasskeyAuthenticator.mapGetCredentialException(exception);

        assertEquals("PASSKEY_ERROR", mappedException.getErrorCode());
        assertEquals("Passkey sign-in failed. Please try again.", mappedException.getMessage());
        assertSame(exception, mappedException.getCause());
    }

    @Test
    public void mapCreateCredentialExceptionUsesCancelledCodeForUserCancellation() {
        CreateCredentialCancellationException exception = new CreateCredentialCancellationException();

        PasskeyAuthenticationException mappedException =
            NativePasskeyAuthenticator.mapCreateCredentialException(exception);

        assertEquals("PASSKEY_CANCELLED", mappedException.getErrorCode());
        assertEquals("Passkey registration was cancelled.", mappedException.getMessage());
        assertSame(exception, mappedException.getCause());
    }

    @Test
    public void mapCreateCredentialExceptionTreatsUnsupportedDevicesAsProviderUnavailable() {
        CreateCredentialUnsupportedException exception = new CreateCredentialUnsupportedException();

        PasskeyAuthenticationException mappedException =
            NativePasskeyAuthenticator.mapCreateCredentialException(exception);

        assertEquals("PASSKEY_PROVIDER_UNAVAILABLE", mappedException.getErrorCode());
        assertEquals(
            "No credential provider is available on this device.",
            mappedException.getMessage()
        );
        assertSame(exception, mappedException.getCause());
    }

    @Test
    public void mapCreateCredentialExceptionUsesProviderUnavailableForProviderConfigurationErrors() {
        CreateCredentialProviderConfigurationException exception =
            new CreateCredentialProviderConfigurationException();

        PasskeyAuthenticationException mappedException =
            NativePasskeyAuthenticator.mapCreateCredentialException(exception);

        assertEquals("PASSKEY_PROVIDER_UNAVAILABLE", mappedException.getErrorCode());
        assertEquals(
            "No credential provider is available on this device.",
            mappedException.getMessage()
        );
        assertSame(exception, mappedException.getCause());
    }

    @Test
    public void mapCreateCredentialExceptionUsesGenericErrorForUnknownExceptionTypes() {
        UnknownCreateCredentialException exception = new UnknownCreateCredentialException();

        PasskeyAuthenticationException mappedException =
            NativePasskeyAuthenticator.mapCreateCredentialException(exception);

        assertEquals("PASSKEY_ERROR", mappedException.getErrorCode());
        assertEquals(
            "Passkey registration failed. Please try again.",
            mappedException.getMessage()
        );
        assertSame(exception, mappedException.getCause());
    }
}
