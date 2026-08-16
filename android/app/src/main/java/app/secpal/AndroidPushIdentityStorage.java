/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.UUID;

final class AndroidPushIdentityStorage {
    static final String STATE_CIPHERTEXT_KEY = "android_push_state_ciphertext";
    static final String STATE_IV_KEY = "android_push_state_iv";
    static final String TOKEN_ROTATION_REQUIRED_KEY =
        "android_push_token_rotation_required";
    private static final String PREFERENCES_NAME = "secpal_native_auth";
    private static final int STATE_SCHEMA_VERSION = 1;
    private static final int MAX_PUSH_TOKEN_CHARACTERS = 4 * 1024;
    private static final int MAX_AUTH_TOKEN_CHARACTERS = 64 * 1024;

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
        private final String pendingRevocationAuthToken;
        private final String pendingRebindApiOrigin;
        private final String pendingRebindAuthToken;
        private final boolean reconfigurationRequired;

        State(
            String apiOrigin,
            int metadataRevision,
            String installationId,
            String token,
            long tokenReceivedAt,
            String registeredFingerprint,
            long registeredAt,
            String pendingRevocationApiOrigin,
            String pendingRevocationInstallationId,
            String pendingRevocationAuthToken,
            String pendingRebindApiOrigin,
            String pendingRebindAuthToken,
            boolean reconfigurationRequired
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
            this.pendingRevocationAuthToken = pendingRevocationAuthToken;
            this.pendingRebindApiOrigin = pendingRebindApiOrigin;
            this.pendingRebindAuthToken = pendingRebindAuthToken;
            this.reconfigurationRequired = reconfigurationRequired;
        }

        String apiOrigin() { return apiOrigin; }

        int metadataRevision() { return metadataRevision; }

        String installationId() { return installationId; }

        String token() { return token; }

        long tokenReceivedAt() { return tokenReceivedAt; }

        boolean hasServerRegistration() {
            return registeredFingerprint != null && !registeredFingerprint.isEmpty();
        }

        boolean hasTokenChangedSinceRegistration() {
            return hasServerRegistration() && tokenReceivedAt > registeredAt;
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

        String pendingRevocationAuthToken() {
            return pendingRevocationAuthToken;
        }

        boolean hasPendingRebind() {
            return pendingRebindApiOrigin != null;
        }

        String pendingRebindApiOrigin() {
            return pendingRebindApiOrigin;
        }

        String pendingRebindAuthToken() {
            return pendingRebindAuthToken;
        }

        String resolveCurrentRegistrationRevocationAuthToken(
            String fallbackAuthToken
        ) throws TokenStorageException {
            if (hasPendingRebind()) {
                if (pendingRebindAuthToken != null) {
                    return pendingRebindAuthToken;
                }
                if (!apiOrigin.equals(pendingRebindApiOrigin)) {
                    return null;
                }
            }
            return normalizePendingAuthToken(fallbackAuthToken);
        }

        boolean isReconfigurationRequired() {
            return reconfigurationRequired;
        }

        State afterServerRegistrationRevoked() {
            return new State(
                apiOrigin,
                metadataRevision,
                installationId,
                token,
                tokenReceivedAt,
                null,
                0,
                pendingRevocationApiOrigin,
                pendingRevocationInstallationId,
                pendingRevocationAuthToken,
                null,
                null,
                reconfigurationRequired
            );
        }

        State afterRuntimeRebindRolledBack() {
            return hasPendingRebind()
                ? AndroidPushIdentityStorage.withoutPendingRebind(this)
                : this;
        }

        boolean needsRegistration(
            String authToken,
            String packageVersionName,
            long packageVersionCode
        ) {
            String normalizedAuthToken = normalizeRegistrationAuthToken(authToken);
            return token != null
                && !token.isEmpty()
                && (normalizedAuthToken.isEmpty()
                    || normalizedAuthToken.length() > MAX_AUTH_TOKEN_CHARACTERS
                    || !registrationFingerprint(
                        this,
                        normalizedAuthToken,
                        packageVersionName,
                        packageVersionCode
                    ).equals(registeredFingerprint));
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
                if (pendingRevocationAuthToken != null) {
                    json.put(
                        "pendingRevocationAuthToken",
                        pendingRevocationAuthToken
                    );
                }
            }
            if (hasPendingRebind()) {
                json.put("pendingRebindApiOrigin", pendingRebindApiOrigin);
                if (pendingRebindAuthToken != null) {
                    json.put("pendingRebindAuthToken", pendingRebindAuthToken);
                }
            }
            if (reconfigurationRequired) {
                json.put("reconfigurationRequired", true);
            }
            return json;
        }
    }

    static final class Snapshot {
        private final State state;
        private final boolean tokenRotationRequired;

        Snapshot(State state, boolean tokenRotationRequired) {
            this.state = state;
            this.tokenRotationRequired = tokenRotationRequired;
        }

        State state() {
            return state;
        }

        Snapshot withState(State replacementState) {
            return new Snapshot(replacementState, tokenRotationRequired);
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
        return bindRuntime(apiOrigin, metadataRevision, null);
    }

    synchronized State bindRuntime(
        String apiOrigin,
        int metadataRevision,
        String previousAuthToken
    ) throws TokenStorageException {
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

        String pendingRevocationAuthToken = current != null
            && current.hasServerRegistration()
            ? normalizePendingAuthToken(
                current.hasPendingRebind()
                    && normalizedOrigin.equals(current.pendingRebindApiOrigin())
                    ? current.pendingRebindAuthToken()
                    : previousAuthToken
            )
            : null;
        boolean registrationAuthorityUnavailable = current != null
            && current.hasServerRegistration()
            && current.hasPendingRebind()
            && pendingRevocationAuthToken == null;
        String pendingRevocationApiOrigin = current != null
            && current.hasServerRegistration()
            && !registrationAuthorityUnavailable
            ? current.apiOrigin()
            : null;
        String pendingRevocationInstallationId = current != null
            && current.hasServerRegistration()
            && !registrationAuthorityUnavailable
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
            pendingRevocationInstallationId,
            pendingRevocationAuthToken,
            null,
            null,
            false
        );
        save(replacement, false, registrationAuthorityUnavailable);
        return replacement;
    }

    synchronized void prepareRuntimeRebind(
        String nextApiOrigin,
        String previousAuthToken
    ) throws TokenStorageException {
        String normalizedOrigin = requireApiOrigin(nextApiOrigin);
        State current = load();
        if (current == null
            || !current.hasServerRegistration()) {
            return;
        }
        if (current.hasPendingRevocation()) {
            throw new TokenStorageException(
                "Previous Android push registration cleanup is still pending",
                new IllegalStateException("pendingRevocation")
            );
        }
        String normalizedAuthToken = normalizePendingAuthToken(previousAuthToken);
        if (current.hasPendingRebind()
            && current.pendingRebindAuthToken() != null) {
            normalizedAuthToken = current.pendingRebindAuthToken();
        }
        State prepared = new State(
            current.apiOrigin(),
            current.metadataRevision(),
            current.installationId(),
            current.token(),
            current.tokenReceivedAt(),
            current.registeredFingerprint,
            current.registeredAt,
            current.pendingRevocationApiOrigin(),
            current.pendingRevocationInstallationId(),
            current.pendingRevocationAuthToken(),
            normalizedOrigin,
            normalizedAuthToken,
            current.isReconfigurationRequired()
        );
        save(prepared);
    }

    synchronized void prepareRuntimeReset(String authToken)
        throws TokenStorageException {
        State current = load();
        if (current == null) {
            return;
        }
        if (current.hasPendingRevocation()) {
            if (current.hasServerRegistration()) {
                throw new TokenStorageException(
                    "Previous Android push registration cleanup is still pending",
                    new IllegalStateException("pendingRevocation")
                );
            }
            String pendingAuthToken = current.pendingRevocationAuthToken();
            if (current.apiOrigin().equals(current.pendingRevocationApiOrigin())) {
                String currentAuthToken = normalizePendingAuthToken(authToken);
                if (currentAuthToken != null) {
                    pendingAuthToken = currentAuthToken;
                }
            }
            State prepared = new State(
                current.apiOrigin(),
                current.metadataRevision(),
                current.installationId(),
                current.token(),
                current.tokenReceivedAt(),
                current.registeredFingerprint,
                current.registeredAt,
                current.pendingRevocationApiOrigin(),
                current.pendingRevocationInstallationId(),
                pendingAuthToken,
                null,
                null,
                current.isReconfigurationRequired()
            );
            save(prepared);
            return;
        }
        if (!current.hasServerRegistration()) {
            return;
        }
        prepareRuntimeRebind(current.apiOrigin(), authToken);
    }

    synchronized void retainLegacyInstallationForRevocation(
        String installationId,
        String authToken
    ) throws TokenStorageException {
        String normalizedInstallationId = installationId == null
            ? ""
            : installationId.trim();
        if (!isUuid(normalizedInstallationId)) {
            throw new TokenStorageException(
                "Legacy Android push installation identifier is invalid",
                new IllegalArgumentException("installationId")
            );
        }
        State current = load();
        if (current == null) {
            throw new TokenStorageException(
                "Android push runtime binding is unavailable",
                new IllegalStateException("runtimeBinding")
            );
        }
        if (normalizedInstallationId.equals(current.installationId())) {
            return;
        }
        if (current.hasPendingRevocation()) {
            if (current.apiOrigin().equals(current.pendingRevocationApiOrigin())
                && normalizedInstallationId.equals(
                    current.pendingRevocationInstallationId()
                )) {
                return;
            }
            throw new TokenStorageException(
                "Previous Android push registration cleanup is still pending",
                new IllegalStateException("pendingRevocation")
            );
        }
        State retained = new State(
            current.apiOrigin(),
            current.metadataRevision(),
            current.installationId(),
            current.token(),
            current.tokenReceivedAt(),
            current.registeredFingerprint,
            current.registeredAt,
            current.apiOrigin(),
            normalizedInstallationId,
            normalizePendingAuthToken(authToken),
            current.pendingRebindApiOrigin(),
            current.pendingRebindAuthToken(),
            current.isReconfigurationRequired()
        );
        save(retained);
    }

    synchronized State retainCurrentRegistrationForRevocation(String authToken)
        throws TokenStorageException {
        State current = load();
        if (current == null || !current.hasServerRegistration()) {
            return current;
        }
        if (current.hasPendingRevocation()) {
            throw new TokenStorageException(
                "Previous Android push registration cleanup is still pending",
                new IllegalStateException("pendingRevocation")
            );
        }
        String retainedAuthToken = current.pendingRebindAuthToken() != null
            ? current.pendingRebindAuthToken()
            : normalizePendingAuthToken(authToken);
        if (retainedAuthToken == null) {
            throw new TokenStorageException(
                "Android push revocation authority is unavailable",
                new IllegalArgumentException("authToken")
            );
        }
        State retained = new State(
            current.apiOrigin(),
            current.metadataRevision(),
            installationIdFactory.create(),
            current.token(),
            current.tokenReceivedAt(),
            null,
            0,
            current.apiOrigin(),
            current.installationId(),
            retainedAuthToken,
            null,
            null,
            false
        );
        save(retained);
        return retained;
    }

    synchronized State invalidateCurrentIdentityForTokenRotation()
        throws TokenStorageException {
        State current = load();
        if (current == null) {
            invalidateUnreadableIdentityForTokenRotation();
            return null;
        }
        if (current.hasServerRegistration()) {
            throw new TokenStorageException(
                "Android push registration must be retained before identity rotation",
                new IllegalStateException("serverRegistration")
            );
        }
        if (!current.hasPendingRevocation()) {
            invalidateUnreadableIdentityForTokenRotation();
            return null;
        }
        State retained = replacementRetainingLifecycleState(current);
        save(retained, false, true);
        return retained;
    }

    synchronized State rotateIdentityPreservingLifecycleState()
        throws TokenStorageException {
        State current = load();
        if (current == null
            || (!current.hasPendingRevocation()
                && !current.isReconfigurationRequired())) {
            discardIdentityForTokenRotation();
            return null;
        }
        State retained = replacementRetainingLifecycleState(current);
        save(retained, false, true);
        return retained;
    }

    private State replacementRetainingLifecycleState(State current) {
        return new State(
            current.apiOrigin(),
            current.metadataRevision(),
            installationIdFactory.create(),
            null,
            0,
            null,
            0,
            current.pendingRevocationApiOrigin(),
            current.pendingRevocationInstallationId(),
            current.pendingRevocationAuthToken(),
            null,
            null,
            current.isReconfigurationRequired()
        );
    }

    synchronized State rotateIdentityForPendingRuntimeClear()
        throws TokenStorageException {
        State current = load();
        if (current == null
            || !current.hasPendingRevocation()
            || current.hasServerRegistration()) {
            return current;
        }
        State retained = replacementRetainingLifecycleState(current);
        save(retained);
        return retained;
    }

    synchronized void cancelPreparedRuntimeRebind(String expectedApiOrigin)
        throws TokenStorageException {
        State current = load();
        if (current == null
            || !current.hasPendingRebind()
            || !current.pendingRebindApiOrigin().equals(
                requireApiOrigin(expectedApiOrigin)
            )) {
            return;
        }
        save(withoutPendingRebind(current));
    }

    synchronized State recordToken(
        String expectedApiOrigin,
        int expectedMetadataRevision,
        String expectedInstallationId,
        String token
    ) throws TokenStorageException {
        State current = load();
        String normalizedOrigin = requireApiOrigin(expectedApiOrigin);
        String normalizedInstallationId = requireInstallationId(
            expectedInstallationId
        );
        if (current == null
            || !current.apiOrigin().equals(normalizedOrigin)
            || current.metadataRevision() != expectedMetadataRevision
            || !current.installationId().equals(normalizedInstallationId)) {
            return current;
        }
        String normalizedToken = normalizeToken(token);
        if (normalizedToken.equals(current.token())) {
            return current;
        }

        long nextTokenReceivedAt = clock.currentTimeMillis();
        if (current.hasServerRegistration()) {
            nextTokenReceivedAt = currentTimeAfter(current.registeredAt);
        }
        State updated = new State(
            current.apiOrigin(),
            current.metadataRevision(),
            current.installationId(),
            normalizedToken,
            nextTokenReceivedAt,
            current.registeredFingerprint,
            current.registeredAt,
            current.pendingRevocationApiOrigin(),
            current.pendingRevocationInstallationId(),
            current.pendingRevocationAuthToken(),
            current.pendingRebindApiOrigin(),
            current.pendingRebindAuthToken(),
            current.isReconfigurationRequired()
        );
        save(updated, true);
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
        String normalizedAuthToken = normalizeRegistrationAuthToken(authToken);
        if (normalizedAuthToken.isEmpty()
            || normalizedAuthToken.length() > MAX_AUTH_TOKEN_CHARACTERS) {
            throw new TokenStorageException(
                "Android push registration authority is invalid",
                new IllegalArgumentException("authToken")
            );
        }
        State registered = new State(
            current.apiOrigin(),
            current.metadataRevision(),
            current.installationId(),
            current.token(),
            current.tokenReceivedAt(),
            registrationFingerprint(
                current,
                normalizedAuthToken,
                packageVersionName,
                packageVersionCode
            ),
            currentTimeAfter(current.tokenReceivedAt()),
            current.pendingRevocationApiOrigin(),
            current.pendingRevocationInstallationId(),
            current.pendingRevocationAuthToken(),
            current.pendingRebindApiOrigin(),
            current.pendingRebindAuthToken(),
            current.isReconfigurationRequired()
        );
        save(registered);
        return registered;
    }

    synchronized State markReconfigurationRequired(State expected)
        throws TokenStorageException {
        State current = load();
        if (!sameRegistrationCandidate(current, expected)) {
            return current;
        }
        if (current.isReconfigurationRequired()) {
            return current;
        }
        State rejected = new State(
            current.apiOrigin(),
            current.metadataRevision(),
            current.installationId(),
            current.token(),
            current.tokenReceivedAt(),
            current.registeredFingerprint,
            current.registeredAt,
            current.pendingRevocationApiOrigin(),
            current.pendingRevocationInstallationId(),
            current.pendingRevocationAuthToken(),
            current.pendingRebindApiOrigin(),
            current.pendingRebindAuthToken(),
            true
        );
        save(rejected);
        return rejected;
    }

    synchronized State clearRegistrationAuthority() throws TokenStorageException {
        State current = load();
        if (current == null) {
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
            null,
            null,
            null,
            null,
            null,
            current.isReconfigurationRequired()
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
            null,
            null,
            current.pendingRebindApiOrigin(),
            current.pendingRebindAuthToken(),
            current.isReconfigurationRequired()
        );
        save(cleared);
        return cleared;
    }

    synchronized State load() throws TokenStorageException {
        try {
            String ciphertext = preferences.getString(STATE_CIPHERTEXT_KEY, null);
            String initializationVector = preferences.getString(STATE_IV_KEY, null);
            if (ciphertext == null && initializationVector == null) {
                return null;
            }
            if (ciphertext == null || initializationVector == null) {
                throw new JSONException("Incomplete Android push identity state");
            }
            String plaintext = cipher.decrypt(
                new EncryptedTokenPayload(ciphertext, initializationVector)
            );
            JSONObject json = new JSONObject(plaintext);
            if (requirePositiveInteger(json, "schemaVersion")
                != STATE_SCHEMA_VERSION) {
                throw new JSONException("Unsupported Android push identity schema");
            }
            String apiOrigin = requireApiOrigin(json.getString("apiOrigin"));
            int metadataRevision = requirePositiveInteger(
                json,
                "metadataRevision"
            );
            String installationId = json.getString("installationId").trim();
            if (!isUuid(installationId)) {
                throw new JSONException("Invalid Android push identity state");
            }
            long tokenReceivedAt = requireNonNegativeLong(
                json,
                "tokenReceivedAt"
            );
            long registeredAt = requireNonNegativeLong(json, "registeredAt");
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
            String pendingRevocationAuthToken = json.has(
                "pendingRevocationAuthToken"
            )
                ? normalizePendingAuthToken(
                    json.getString("pendingRevocationAuthToken")
                )
                : null;
            String pendingRebindApiOrigin = json.has("pendingRebindApiOrigin")
                ? requireApiOrigin(json.getString("pendingRebindApiOrigin"))
                : null;
            String pendingRebindAuthToken = json.has("pendingRebindAuthToken")
                ? normalizePendingAuthToken(json.getString("pendingRebindAuthToken"))
                : null;
            boolean reconfigurationRequired = optionalBoolean(
                json,
                "reconfigurationRequired",
                false
            );
            if ((pendingRevocationApiOrigin == null)
                    != (pendingRevocationInstallationId == null)
                || (pendingRevocationInstallationId != null
                    && !isUuid(pendingRevocationInstallationId))
                || (pendingRevocationAuthToken != null
                    && pendingRevocationApiOrigin == null)
                || (pendingRebindAuthToken != null
                    && pendingRebindApiOrigin == null)) {
                throw new JSONException("Invalid pending Android push revocation");
            }
            return new State(
                apiOrigin,
                metadataRevision,
                installationId,
                token,
                tokenReceivedAt,
                registeredFingerprint,
                registeredAt,
                pendingRevocationApiOrigin,
                pendingRevocationInstallationId,
                pendingRevocationAuthToken,
                pendingRebindApiOrigin,
                pendingRebindAuthToken,
                reconfigurationRequired
            );
        } catch (JSONException | IllegalArgumentException | ClassCastException exception) {
            invalidateUnreadableIdentityForTokenRotation();
            throw new TokenStorageException(
                "Failed to decode Android push identity",
                exception
            );
        } catch (TokenStorageException exception) {
            invalidateUnreadableIdentityForTokenRotation();
            throw exception;
        }
    }

    synchronized boolean requiresTokenRotation() throws TokenStorageException {
        try {
            return preferences.getBoolean(TOKEN_ROTATION_REQUIRED_KEY, false);
        } catch (ClassCastException exception) {
            invalidateUnreadableIdentityForTokenRotation();
            throw new TokenStorageException(
                "Failed to decode Android push token rotation requirement",
                exception
            );
        }
    }

    synchronized Snapshot snapshot() throws TokenStorageException {
        return new Snapshot(load(), requiresTokenRotation());
    }

    synchronized void clear() throws TokenStorageException {
        if (!preferences.edit()
            .remove(STATE_CIPHERTEXT_KEY)
            .remove(STATE_IV_KEY)
            .remove(TOKEN_ROTATION_REQUIRED_KEY)
            .commit()) {
            throw new TokenStorageException(
                "Failed to clear Android push identity",
                new IllegalStateException("SharedPreferences commit failed")
            );
        }
    }

    synchronized void restore(State state) throws TokenStorageException {
        if (state == null) {
            clear();
            return;
        }
        save(state);
    }

    synchronized void restore(Snapshot snapshot) throws TokenStorageException {
        if (snapshot == null) {
            throw new TokenStorageException(
                "Android push identity snapshot is unavailable",
                new IllegalArgumentException("snapshot")
            );
        }
        if (snapshot.state == null) {
            SharedPreferences.Editor editor = preferences.edit()
                .remove(STATE_CIPHERTEXT_KEY)
                .remove(STATE_IV_KEY);
            if (snapshot.tokenRotationRequired) {
                editor.putBoolean(TOKEN_ROTATION_REQUIRED_KEY, true);
            } else {
                editor.remove(TOKEN_ROTATION_REQUIRED_KEY);
            }
            if (!editor.commit()) {
                throw new TokenStorageException(
                    "Failed to restore Android push identity",
                    new IllegalStateException("SharedPreferences commit failed")
                );
            }
            return;
        }
        save(
            snapshot.state,
            !snapshot.tokenRotationRequired,
            snapshot.tokenRotationRequired
        );
    }

    private void save(State state) throws TokenStorageException {
        save(state, false, false);
    }

    private void save(State state, boolean completeTokenRotation)
        throws TokenStorageException {
        save(state, completeTokenRotation, false);
    }

    private void save(
        State state,
        boolean completeTokenRotation,
        boolean requireTokenRotation
    ) throws TokenStorageException {
        try {
            EncryptedTokenPayload encrypted = cipher.encrypt(state.toJson().toString());
            SharedPreferences.Editor editor = preferences.edit()
                .putString(STATE_CIPHERTEXT_KEY, encrypted.getCiphertext())
                .putString(STATE_IV_KEY, encrypted.getInitializationVector());
            if (completeTokenRotation) {
                editor.remove(TOKEN_ROTATION_REQUIRED_KEY);
            } else if (requireTokenRotation) {
                editor.putBoolean(TOKEN_ROTATION_REQUIRED_KEY, true);
            }
            if (!editor.commit()) {
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

    synchronized void invalidateIdentityForTokenRotation()
        throws TokenStorageException {
        invalidateCurrentIdentityForTokenRotation();
    }

    synchronized void discardIdentityForTokenRotation()
        throws TokenStorageException {
        invalidateUnreadableIdentityForTokenRotation();
    }

    private void invalidateUnreadableIdentityForTokenRotation()
        throws TokenStorageException {
        if (!preferences.edit()
            .remove(STATE_CIPHERTEXT_KEY)
            .remove(STATE_IV_KEY)
            .putBoolean(TOKEN_ROTATION_REQUIRED_KEY, true)
            .commit()) {
            throw new TokenStorageException(
                "Failed to invalidate unreadable Android push identity",
                new IllegalStateException("SharedPreferences commit failed")
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

    private long currentTimeAfter(long previousTimestamp)
        throws TokenStorageException {
        if (previousTimestamp == Long.MAX_VALUE) {
            throw new TokenStorageException(
                "Android push lifecycle timestamp is exhausted",
                new IllegalStateException("previousTimestamp")
            );
        }
        return Math.max(clock.currentTimeMillis(), previousTimestamp + 1);
    }

    private static State withoutPendingRebind(State current) {
        return new State(
            current.apiOrigin(),
            current.metadataRevision(),
            current.installationId(),
            current.token(),
            current.tokenReceivedAt(),
            current.registeredFingerprint,
            current.registeredAt,
            current.pendingRevocationApiOrigin(),
            current.pendingRevocationInstallationId(),
            current.pendingRevocationAuthToken(),
            null,
            null,
            current.isReconfigurationRequired()
        );
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
            + normalizeRegistrationAuthToken(authToken)
            + "\n"
            + normalizePackageVersionName(packageVersionName)
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

    static String requireApiOrigin(String value) throws TokenStorageException {
        String normalized = value == null ? "" : value.trim();
        try {
            URI parsed = new URI(normalized);
            String host = parsed.getHost();
            int port = parsed.getPort();
            if (!"https".equalsIgnoreCase(parsed.getScheme())
                || host == null
                || host.isEmpty()
                || parsed.getRawUserInfo() != null
                || (parsed.getRawPath() != null && !parsed.getRawPath().isEmpty())
                || parsed.getRawQuery() != null
                || parsed.getRawFragment() != null
                || (port != -1 && (port < 1 || port > 65535))
                || (parsed.getRawAuthority() != null
                    && parsed.getRawAuthority().endsWith(":"))) {
                throw new URISyntaxException(normalized, "not a bare HTTPS origin");
            }

            String normalizedHost = host.toLowerCase(Locale.ROOT);
            if (normalizedHost.indexOf(':') >= 0
                && !normalizedHost.startsWith("[")) {
                normalizedHost = "[" + normalizedHost + "]";
            }
            return "https://"
                + normalizedHost
                + (port == -1 || port == 443 ? "" : ":" + port);
        } catch (URISyntaxException exception) {
            throw new TokenStorageException(
                "Android push runtime origin is invalid",
                new IllegalArgumentException("apiOrigin", exception)
            );
        }
    }

    private static String normalizeRegistrationAuthToken(String value) {
        return value == null ? "" : value.trim();
    }

    private static String normalizePackageVersionName(String value) {
        return value == null ? "" : value.trim();
    }

    private static String normalizePendingAuthToken(String value)
        throws TokenStorageException {
        if (value == null) {
            return null;
        }
        String normalized = value.trim();
        if (normalized.isEmpty()
            || normalized.length() > MAX_AUTH_TOKEN_CHARACTERS) {
            throw new TokenStorageException(
                "Android push revocation authority is invalid",
                new IllegalArgumentException("pendingRevocationAuthToken")
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

    private static int requirePositiveInteger(JSONObject json, String key)
        throws JSONException {
        Object value = json.get(key);
        if (!(value instanceof Number)) {
            throw new JSONException(key + " must be an integer");
        }
        Number number = (Number) value;
        double numericValue = number.doubleValue();
        int normalized = number.intValue();
        if (!Double.isFinite(numericValue)
            || numericValue != normalized
            || normalized <= 0) {
            throw new JSONException(key + " must be a positive integer");
        }
        return normalized;
    }

    private static long requireNonNegativeLong(JSONObject json, String key)
        throws JSONException {
        Object value = json.get(key);
        if (!(value instanceof Number)) {
            throw new JSONException(key + " must be an integer");
        }
        Number number = (Number) value;
        double numericValue = number.doubleValue();
        long normalized = number.longValue();
        if (!Double.isFinite(numericValue)
            || numericValue != normalized
            || normalized < 0) {
            throw new JSONException(key + " must be a non-negative integer");
        }
        return normalized;
    }

    private static boolean optionalBoolean(
        JSONObject json,
        String key,
        boolean defaultValue
    ) throws JSONException {
        if (!json.has(key)) {
            return defaultValue;
        }
        Object value = json.get(key);
        if (!(value instanceof Boolean)) {
            throw new JSONException(key + " must be a boolean");
        }
        return (Boolean) value;
    }

    private static String requireInstallationId(String value)
        throws TokenStorageException {
        String normalized = value == null ? "" : value.trim();
        if (!isUuid(normalized)) {
            throw new TokenStorageException(
                "Android push installation identifier is invalid",
                new IllegalArgumentException("installationId")
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
