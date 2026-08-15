/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;

final class AndroidPushIdentityStorage {
    static final String STATE_CIPHERTEXT_KEY = "android_push_state_ciphertext";
    static final String STATE_IV_KEY = "android_push_state_iv";
    private static final String PREFERENCES_NAME = "secpal_native_auth";
    private static final int STATE_SCHEMA_VERSION = 1;
    private static final int MAX_PUSH_TOKEN_CHARACTERS = 4 * 1024;

    interface InstallationIdFactory {
        String create();
    }

    interface Clock {
        long currentTimeMillis();
    }

    static final class State {
        private final String apiOrigin;
        private final int metadataRevision;
        private final String installationId;
        private final String token;
        private final long tokenReceivedAt;
        private final String registeredFingerprint;
        private final long registeredAt;
        private final String pendingRevocationApiOrigin;
        private final String pendingRevocationInstallationId;

        State(
            String apiOrigin,
            int metadataRevision,
            String installationId,
            String token,
            long tokenReceivedAt,
            String registeredFingerprint,
            long registeredAt,
            String pendingRevocationApiOrigin,
            String pendingRevocationInstallationId
        ) {
            this.apiOrigin = apiOrigin;
            this.metadataRevision = metadataRevision;
            this.installationId = installationId;
            this.token = token;
            this.tokenReceivedAt = tokenReceivedAt;
            this.registeredFingerprint = registeredFingerprint;
            this.registeredAt = registeredAt;
            this.pendingRevocationApiOrigin = pendingRevocationApiOrigin;
            this.pendingRevocationInstallationId = pendingRevocationInstallationId;
        }

        String apiOrigin() { return apiOrigin; }

        int metadataRevision() { return metadataRevision; }

        String installationId() { return installationId; }

        String token() { return token; }

        long tokenReceivedAt() { return tokenReceivedAt; }

        boolean hasServerRegistration() {
            return registeredFingerprint != null && !registeredFingerprint.isEmpty();
        }

        boolean hasPendingRevocation() {
            return pendingRevocationApiOrigin != null
                && pendingRevocationInstallationId != null;
        }

        String pendingRevocationApiOrigin() {
            return pendingRevocationApiOrigin;
        }

        String pendingRevocationInstallationId() {
            return pendingRevocationInstallationId;
        }

        boolean needsRegistration(
            String authToken,
            String packageVersionName,
            long packageVersionCode
        ) {
            return token != null
                && !token.isEmpty()
                && !registrationFingerprint(
                    this,
                    authToken,
                    packageVersionName,
                    packageVersionCode
                ).equals(registeredFingerprint);
        }

        JSONObject toJson() throws JSONException {
            JSONObject json = new JSONObject()
                .put("schemaVersion", STATE_SCHEMA_VERSION)
                .put("apiOrigin", apiOrigin)
                .put("metadataRevision", metadataRevision)
                .put("installationId", installationId)
                .put("tokenReceivedAt", tokenReceivedAt)
                .put("registeredAt", registeredAt);
            if (token != null) {
                json.put("token", token);
            }
            if (registeredFingerprint != null) {
                json.put("registeredFingerprint", registeredFingerprint);
            }
            if (hasPendingRevocation()) {
                json.put("pendingRevocationApiOrigin", pendingRevocationApiOrigin);
                json.put(
                    "pendingRevocationInstallationId",
                    pendingRevocationInstallationId
                );
            }
            return json;
        }
    }

    private final SharedPreferences preferences;
    private final TokenCipher cipher;
    private final InstallationIdFactory installationIdFactory;
    private final Clock clock;

    AndroidPushIdentityStorage(Context context) {
        this(
            context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE),
            new KeystoreTokenCipher(
                "secpal_android_push_identity",
                "Android push identity"
            ),
            () -> UUID.randomUUID().toString(),
            System::currentTimeMillis
        );
    }

    AndroidPushIdentityStorage(
        SharedPreferences preferences,
        TokenCipher cipher,
        InstallationIdFactory installationIdFactory,
        Clock clock
    ) {
        this.preferences = preferences;
        this.cipher = cipher;
        this.installationIdFactory = installationIdFactory;
        this.clock = clock;
    }

    synchronized State bindRuntime(String apiOrigin, int metadataRevision)
        throws TokenStorageException {
        String normalizedOrigin = requireApiOrigin(apiOrigin);
        if (metadataRevision <= 0) {
            throw new TokenStorageException(
                "Android push runtime metadata revision is invalid",
                new IllegalArgumentException("metadataRevision")
            );
        }

        State current = load();
        if (current != null
            && normalizedOrigin.equals(current.apiOrigin())
            && metadataRevision == current.metadataRevision()) {
            return current;
        }
        if (current != null && current.hasPendingRevocation()) {
            throw new TokenStorageException(
                "Previous Android push registration cleanup is still pending",
                new IllegalStateException("pendingRevocation")
            );
        }

        String pendingRevocationApiOrigin = current != null
            && current.hasServerRegistration()
            ? current.apiOrigin()
            : null;
        String pendingRevocationInstallationId = current != null
            && current.hasServerRegistration()
            ? current.installationId()
            : null;

        State replacement = new State(
            normalizedOrigin,
            metadataRevision,
            installationIdFactory.create(),
            null,
            0,
            null,
            0,
            pendingRevocationApiOrigin,
            pendingRevocationInstallationId
        );
        save(replacement);
        return replacement;
    }

    synchronized State recordToken(
        String expectedApiOrigin,
        int expectedMetadataRevision,
        String token
    ) throws TokenStorageException {
        State current = load();
        String normalizedToken = normalizeToken(token);
        if (current == null
            || !current.apiOrigin().equals(requireApiOrigin(expectedApiOrigin))
            || current.metadataRevision() != expectedMetadataRevision) {
            return current;
        }
        if (normalizedToken.equals(current.token())) {
            return current;
        }

        State updated = new State(
            current.apiOrigin(),
            current.metadataRevision(),
            current.installationId(),
            normalizedToken,
            clock.currentTimeMillis(),
            current.registeredFingerprint,
            current.registeredAt,
            current.pendingRevocationApiOrigin(),
            current.pendingRevocationInstallationId()
        );
        save(updated);
        return updated;
    }

    synchronized State markRegistered(
        State expected,
        String authToken,
        String packageVersionName,
        long packageVersionCode
    ) throws TokenStorageException {
        State current = load();
        if (!sameRegistrationCandidate(current, expected)) {
            return current;
        }
        State registered = new State(
            current.apiOrigin(),
            current.metadataRevision(),
            current.installationId(),
            current.token(),
            current.tokenReceivedAt(),
            registrationFingerprint(
                current,
                authToken,
                packageVersionName,
                packageVersionCode
            ),
            clock.currentTimeMillis(),
            current.pendingRevocationApiOrigin(),
            current.pendingRevocationInstallationId()
        );
        save(registered);
        return registered;
    }

    synchronized State clearServerRegistration() throws TokenStorageException {
        State current = load();
        if (current == null || !current.hasServerRegistration()) {
            return current;
        }
        State cleared = new State(
            current.apiOrigin(),
            current.metadataRevision(),
            current.installationId(),
            current.token(),
            current.tokenReceivedAt(),
            null,
            0,
            current.pendingRevocationApiOrigin(),
            current.pendingRevocationInstallationId()
        );
        save(cleared);
        return cleared;
    }

    synchronized State clearPendingRevocation(
        String expectedApiOrigin,
        String expectedInstallationId
    ) throws TokenStorageException {
        State current = load();
        if (current == null
            || !current.hasPendingRevocation()
            || !current.pendingRevocationApiOrigin().equals(expectedApiOrigin)
            || !current.pendingRevocationInstallationId().equals(
                expectedInstallationId
            )) {
            return current;
        }
        State cleared = new State(
            current.apiOrigin(),
            current.metadataRevision(),
            current.installationId(),
            current.token(),
            current.tokenReceivedAt(),
            current.registeredFingerprint,
            current.registeredAt,
            null,
            null
        );
        save(cleared);
        return cleared;
    }

    synchronized State load() throws TokenStorageException {
        String ciphertext = preferences.getString(STATE_CIPHERTEXT_KEY, null);
        String initializationVector = preferences.getString(STATE_IV_KEY, null);
        if (ciphertext == null || initializationVector == null) {
            return null;
        }

        try {
            String plaintext = cipher.decrypt(
                new EncryptedTokenPayload(ciphertext, initializationVector)
            );
            JSONObject json = new JSONObject(plaintext);
            if (json.getInt("schemaVersion") != STATE_SCHEMA_VERSION) {
                throw new JSONException("Unsupported Android push identity schema");
            }
            String apiOrigin = requireApiOrigin(json.getString("apiOrigin"));
            int metadataRevision = json.getInt("metadataRevision");
            String installationId = json.getString("installationId").trim();
            if (metadataRevision <= 0 || !isUuid(installationId)) {
                throw new JSONException("Invalid Android push identity state");
            }
            String token = json.has("token") ? normalizeToken(json.getString("token")) : null;
            String registeredFingerprint = json.has("registeredFingerprint")
                ? json.getString("registeredFingerprint").trim()
                : null;
            if (registeredFingerprint != null
                && !registeredFingerprint.matches("[0-9a-f]{64}")) {
                throw new JSONException("Invalid Android push registration fingerprint");
            }
            String pendingRevocationApiOrigin = json.has(
                "pendingRevocationApiOrigin"
            )
                ? requireApiOrigin(json.getString("pendingRevocationApiOrigin"))
                : null;
            String pendingRevocationInstallationId = json.has(
                "pendingRevocationInstallationId"
            )
                ? json.getString("pendingRevocationInstallationId").trim()
                : null;
            if ((pendingRevocationApiOrigin == null)
                    != (pendingRevocationInstallationId == null)
                || (pendingRevocationInstallationId != null
                    && !isUuid(pendingRevocationInstallationId))) {
                throw new JSONException("Invalid pending Android push revocation");
            }
            return new State(
                apiOrigin,
                metadataRevision,
                installationId,
                token,
                json.optLong("tokenReceivedAt", 0),
                registeredFingerprint,
                json.optLong("registeredAt", 0),
                pendingRevocationApiOrigin,
                pendingRevocationInstallationId
            );
        } catch (JSONException | IllegalArgumentException exception) {
            clear();
            throw new TokenStorageException(
                "Failed to decode Android push identity",
                exception
            );
        } catch (TokenStorageException exception) {
            clear();
            throw exception;
        }
    }

    synchronized void clear() {
        preferences.edit()
            .remove(STATE_CIPHERTEXT_KEY)
            .remove(STATE_IV_KEY)
            .apply();
    }

    synchronized void restore(State state) throws TokenStorageException {
        if (state == null) {
            clear();
            return;
        }
        save(state);
    }

    private void save(State state) throws TokenStorageException {
        try {
            EncryptedTokenPayload encrypted = cipher.encrypt(state.toJson().toString());
            if (!preferences.edit()
                .putString(STATE_CIPHERTEXT_KEY, encrypted.getCiphertext())
                .putString(STATE_IV_KEY, encrypted.getInitializationVector())
                .commit()) {
                throw new TokenStorageException(
                    "Failed to persist Android push identity",
                    new IllegalStateException("SharedPreferences commit failed")
                );
            }
        } catch (JSONException exception) {
            throw new TokenStorageException(
                "Failed to encode Android push identity",
                exception
            );
        }
    }

    private static boolean sameRegistrationCandidate(State left, State right) {
        return left != null
            && right != null
            && left.apiOrigin().equals(right.apiOrigin())
            && left.metadataRevision() == right.metadataRevision()
            && left.installationId().equals(right.installationId())
            && left.token() != null
            && left.token().equals(right.token());
    }

    private static String registrationFingerprint(
        State state,
        String authToken,
        String packageVersionName,
        long packageVersionCode
    ) {
        String material = state.apiOrigin()
            + "\n"
            + state.metadataRevision()
            + "\n"
            + state.token()
            + "\n"
            + authToken.trim()
            + "\n"
            + packageVersionName
            + "\n"
            + packageVersionCode;
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                material.getBytes(StandardCharsets.UTF_8)
            );
            StringBuilder encoded = new StringBuilder(digest.length * 2);
            for (byte value : digest) {
                encoded.append(String.format("%02x", value & 0xff));
            }
            return encoded.toString();
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static String requireApiOrigin(String value) throws TokenStorageException {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty()) {
            throw new TokenStorageException(
                "Android push runtime origin is unavailable",
                new IllegalArgumentException("apiOrigin")
            );
        }
        return normalized;
    }

    private static String normalizeToken(String value) throws TokenStorageException {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty() || normalized.length() > MAX_PUSH_TOKEN_CHARACTERS) {
            throw new TokenStorageException(
                "Android push token is invalid",
                new IllegalArgumentException("token")
            );
        }
        return normalized;
    }

    private static boolean isUuid(String value) {
        try {
            UUID.fromString(value);
            return true;
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }
}
