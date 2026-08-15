/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

package app.secpal;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URL;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.function.BooleanSupplier;

@CapacitorPlugin(name = "SecPalNativeAuth")
public class SecPalNativeAuthPlugin extends Plugin {
    static final String NATIVE_AUTH_PREFERENCES_NAME = "secpal_native_auth";
    private static final String API_BASE_URL_PREFERENCE_KEY = "api_base_url";
    private static final String RUNTIME_BOOTSTRAP_PREFERENCE_KEY = "runtime_bootstrap";
    private static final String NATIVE_AUTH_LIFECYCLE_CHANGED_EVENT =
        "nativeAuthLifecycleChanged";
    private static final String VAULT_ROOT_KEY_BRIDGE_UNSUPPORTED_MESSAGE =
        "Android offline vault root keys cannot be bridged into WebView JavaScript";
    private static final String VAULT_ROOT_KEY_BRIDGE_UNSUPPORTED_CODE =
        "VAULT_ROOT_KEY_BRIDGE_UNSUPPORTED";
    private static final int MAX_LOGIN_EMAIL_CHARACTERS = 320;
    private static final int MAX_LOGIN_PASSWORD_CHARACTERS = 4 * 1024;
    static final int MAX_RUNTIME_DISPLAY_NAME_CHARACTERS = 256;
    static final int MAX_RUNTIME_URL_CHARACTERS = 2 * 1024;
    private static final int MAX_RUNTIME_METADATA_CHARACTERS = 64 * 1024;
    static final int MAX_PASSKEY_OPTIONS_CHARACTERS = 1024 * 1024;

    @FunctionalInterface
    interface NativeAuthenticationRevoker {
        void revoke(String apiOrigin, String token)
            throws IOException, JSONException, NativeAuthHttpException;
    }

    @FunctionalInterface
    interface AndroidPushLogout {
        void logout(String token) throws TokenStorageException;
    }

    @FunctionalInterface
    interface SessionMutation {
        boolean run(PushTask mutation) throws TokenStorageException;
    }

    private TokenStorage tokenStorage;
    private KeystoreVaultRootKeyWrapper vaultRootKeyWrapper;
    private NativeAuthHttpClient httpClient;
    private NetworkState networkState;
    private NativePasskeyAuthenticator passkeyAuthenticator;
    private AndroidPushRuntimeManager androidPushRuntimeManager;
    private AndroidPushRegistrationManager androidPushRegistrationManager;
    private final NativeAuthTaskExecutor taskExecutor = new NativeAuthTaskExecutor();
    private final AtomicBoolean runtimeMutationConfirmationPending = new AtomicBoolean(false);
    private final AtomicReference<AlertDialog> runtimeMutationConfirmationDialog =
        new AtomicReference<>();
    private volatile boolean destroyed = false;
    private volatile String apiBaseUrl;

    @Override
    public void load() {
        super.load();
        tokenStorage = new KeystoreTokenStorage(getContext());
        httpClient = new NativeAuthHttpClient();
        androidPushRegistrationManager = new AndroidPushRegistrationManager(
            getContext(),
            httpClient
        );
        androidPushRuntimeManager = new AndroidPushRuntimeManager(
            getContext(),
            createAndroidPushMessagingListener()
        );
        JSObject persistedRuntimeBootstrap = getPersistedRuntimeBootstrap();
        if (persistedRuntimeBootstrap == null) {
            clearRejectedLegacyRuntimeState(getNativeAuthPreferences(), tokenStorage);
        }
        persistedRuntimeBootstrap = applyPersistedRuntimeBootstrap(
            getNativeAuthPreferences(),
            tokenStorage,
            androidPushRuntimeManager,
            persistedRuntimeBootstrap,
            this::restoreAndroidPushIdentityBinding
        );
        apiBaseUrl = persistedRuntimeBootstrap != null
            ? persistedRuntimeBootstrap.optString("apiOrigin", null)
            : null;
        vaultRootKeyWrapper = new KeystoreVaultRootKeyWrapper();
        networkState = new NetworkState();
        passkeyAuthenticator = new NativePasskeyAuthenticator();
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        dismissRuntimeConfirmationOnDestroy(
            runtimeMutationConfirmationDialog,
            runtimeMutationConfirmationPending
        );
        taskExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    @Override
    protected void handleOnPause() {
        pauseAuthenticatedForLifecycle(
            taskExecutor,
            (event, payload) -> notifyListeners(event, payload, true)
        );
        super.handleOnPause();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        resumeAuthenticatedForLifecycle(
            taskExecutor,
            (event, payload) -> notifyListeners(event, payload, true)
        );
        submitForegroundPushRefresh(
            taskExecutor,
            androidPushRuntimeManager::refreshToken,
            androidPushRegistrationManager::onRegistrationSchedulingError
        );
    }

    @PluginMethod
    public void login(PluginCall call) {
        if (!requireOnlyKeys(call, "email", "password")) {
            return;
        }
        String email = requireValue(call, "email", MAX_LOGIN_EMAIL_CHARACTERS);
        String password = requireValue(call, "password", MAX_LOGIN_PASSWORD_CHARACTERS);

        if (email == null || password == null) {
            return;
        }
        long loginGeneration = taskExecutor.captureGeneration();
        String loginApiBaseUrl = apiBaseUrl;
        runAsync(call, () -> {
            try {
                requireNetworkConnection();
                NativeAuthHttpClient.LoginResponse response = httpClient.login(
                    loginApiBaseUrl,
                    email,
                    password
                );
                JSObject payload = new JSObject();
                payload.put("user", response.getUser());
                if (!taskExecutor.completeCredentialReplacement(
                    loginGeneration,
                    () -> tokenStorage.saveToken(response.getToken()),
                    tokenStorage::clearToken,
                    () -> call.resolve(payload)
                )) {
                    call.reject(
                        cancellationMessage("SESSION_INVALIDATED"),
                        "SESSION_INVALIDATED"
                    );
                } else {
                    scheduleAndroidPushAfterAuthentication(
                        taskExecutor,
                        cancellation -> synchronizeAndroidPushAfterAuthentication(
                            response.getToken(),
                            cancellation
                        ),
                        androidPushRegistrationManager::onProtectedStateError,
                        androidPushRegistrationManager::onRegistrationSchedulingError
                    );
                }
            } catch (IOException | JSONException | NativeAuthHttpException | NetworkUnavailableException exception) {
                rejectSessionBoundCall(call, loginGeneration, exception);
            } catch (TokenStorageException exception) {
                call.reject("Failed to persist Android auth token", "TOKEN_STORAGE_ERROR", exception);
            }
        });
    }

    @PluginMethod
    public void loginWithPasskey(PluginCall call) {
        if (!requireOnlyKeys(call)) {
            return;
        }
        NativePasskeyCapability capability = NativePasskeyCapability.forCurrentDevice();

        if (!requirePasskeyCapability(call, capability)) {
            return;
        }

        long loginGeneration = taskExecutor.captureSessionGeneration();
        String loginApiBaseUrl = apiBaseUrl;
        runAsync(call, () -> {
            try {
                Activity activity = getActivity();

                if (activity == null) {
                    call.reject(
                        "Android passkey sign-in is unavailable because no activity is attached.",
                        "PASSKEY_UNAVAILABLE"
                    );
                    return;
                }

                requireNetworkConnection();

                NativeAuthHttpClient.PasskeyChallenge challenge = httpClient.startTokenPasskeyAuthenticationChallenge(
                    loginApiBaseUrl,
                    NativeAuthHttpClient.buildDeviceName(Build.MANUFACTURER, Build.MODEL)
                );
                String requestJson = PasskeyAuthenticationJson.buildAuthenticationRequestJson(challenge.getPublicKey());
                String authenticationResponseJson = passkeyAuthenticator.authenticate(
                    activity,
                    requestJson,
                    capability
                );
                requireBoundedPasskeyResult(authenticationResponseJson);
                JSObject credential = PasskeyAuthenticationJson.buildAuthenticationVerificationCredential(
                    authenticationResponseJson
                );
                if (!taskExecutor.isSessionGenerationCurrent(loginGeneration)) {
                    call.reject(
                        cancellationMessage("SESSION_INVALIDATED"),
                        "SESSION_INVALIDATED"
                    );
                    return;
                }
                NativeAuthHttpClient.LoginResponse response = httpClient.verifyTokenPasskeyAuthenticationChallenge(
                    loginApiBaseUrl,
                    challenge.getChallengeId(),
                    credential
                );

                JSObject payload = new JSObject();
                payload.put("user", response.getUser());
                if (!taskExecutor.completeSessionCredentialReplacement(
                    loginGeneration,
                    () -> tokenStorage.saveToken(response.getToken()),
                    tokenStorage::clearToken,
                    () -> call.resolve(payload)
                )) {
                    call.reject(
                        cancellationMessage("SESSION_INVALIDATED"),
                        "SESSION_INVALIDATED"
                    );
                } else {
                    scheduleAndroidPushAfterAuthentication(
                        taskExecutor,
                        cancellation -> synchronizeAndroidPushAfterAuthentication(
                            response.getToken(),
                            cancellation
                        ),
                        androidPushRegistrationManager::onProtectedStateError,
                        androidPushRegistrationManager::onRegistrationSchedulingError
                    );
                }
            } catch (
                IOException
                | JSONException
                | NativeAuthHttpException
                | NetworkUnavailableException
                | PasskeyAuthenticationException exception
            ) {
                rejectPasskeySessionBoundCall(call, loginGeneration, exception);
            } catch (TokenStorageException exception) {
                call.reject("Failed to persist Android auth token", "TOKEN_STORAGE_ERROR", exception);
            }
        });
    }

    @PluginMethod
    public void createPasskeyAttestation(PluginCall call) {
        if (!requireOnlyKeys(call, "publicKey")) {
            return;
        }
        NativePasskeyCapability capability = NativePasskeyCapability.forCurrentDevice();

        if (!requirePasskeyCapability(call, capability)) {
            return;
        }

        JSObject publicKey = call.getObject("publicKey");

        if (publicKey == null) {
            call.reject("Missing required value: publicKey", "INVALID_INPUT");
            return;
        }
        if (!isBoundedJsonObject(publicKey, MAX_PASSKEY_OPTIONS_CHARACTERS)) {
            call.reject("Android passkey options exceed the allowed size", "INVALID_INPUT");
            return;
        }

        runAsync(call, () -> {
            try {
                Activity activity = getActivity();

                if (activity == null) {
                    call.reject(
                        "Android passkey registration is unavailable because no activity is attached.",
                        "PASSKEY_UNAVAILABLE"
                    );
                    return;
                }

                String requestJson = PasskeyAuthenticationJson.buildRegistrationRequestJson(publicKey);
                String registrationResponseJson = passkeyAuthenticator.register(
                    activity,
                    requestJson,
                    capability
                );
                requireBoundedPasskeyResult(registrationResponseJson);
                JSObject credential = PasskeyAuthenticationJson.buildRegistrationVerificationCredential(
                    registrationResponseJson
                );

                JSObject payload = new JSObject();
                payload.put("credential", credential);
                call.resolve(payload);
            } catch (JSONException | NativeAuthHttpException | PasskeyAuthenticationException exception) {
                rejectCall(call, exception);
            }
        });
    }

    @PluginMethod
    public void getCurrentUser(PluginCall call) {
        if (!requireOnlyKeys(call)) {
            return;
        }
        String requestId = UUID.randomUUID().toString();
        AtomicBoolean settled = new AtomicBoolean(false);
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();
        NativeAuthTaskExecutor.SubmitResult submitResult = taskExecutor.submitAuthenticated(
            requestId,
            0,
            () -> {
                try {
                    String token = tokenStorage.getToken();
                    if (token == null || token.trim().isEmpty()) {
                        taskExecutor.completeAuthenticated(requestId, () -> {
                            settleOnce(
                                settled,
                                () -> call.reject(
                                    "Android auth token is not available",
                                    "NO_STORED_TOKEN"
                                )
                            );
                        });
                        return;
                    }

                    requireNetworkConnection();
                    JSObject response = httpClient.getCurrentUser(apiBaseUrl, token, cancellation);
                    if (!taskExecutor.completeAuthenticated(
                        requestId,
                        () -> settleOnce(settled, () -> call.resolve(response))
                    )) {
                        return;
                    }
                    scheduleAndroidPushAfterAuthentication(
                        taskExecutor,
                        pushCancellation -> synchronizeAndroidPushAfterAuthentication(
                            token,
                            pushCancellation
                        ),
                        androidPushRegistrationManager::onProtectedStateError,
                        androidPushRegistrationManager::onRegistrationSchedulingError
                    );
                } catch (IOException | JSONException | NativeAuthHttpException | NetworkUnavailableException exception) {
                    taskExecutor.completeAuthenticated(requestId, () -> {
                        settleOnce(settled, () -> {
                            maybeClearToken(exception);
                            rejectCall(call, exception);
                        });
                    });
                } catch (TokenStorageException exception) {
                    taskExecutor.completeAuthenticated(requestId, () -> {
                        settleOnce(
                            settled,
                            () -> call.reject(
                                "Failed to load Android auth token",
                                "TOKEN_STORAGE_ERROR",
                                exception
                            )
                        );
                    });
                }
            },
            reasonCode -> {
                cancellation.cancel();
                settleOnce(
                    settled,
                    () -> call.reject(cancellationMessage(reasonCode), reasonCode)
                );
            },
            exception -> {
                settleOnce(
                    settled,
                    () -> call.reject(
                        "Android native auth operation failed unexpectedly",
                        "NATIVE_AUTH_INTERNAL_ERROR",
                        exception
                    )
                );
            }
        );

        if (submitResult != NativeAuthTaskExecutor.SubmitResult.ACCEPTED) {
            settleOnce(settled, () -> rejectSubmission(call, submitResult));
        }
    }

    @PluginMethod
    public void isNetworkAvailable(PluginCall call) {
        JSObject payload = new JSObject();
        payload.put("available", networkState.isNetworkAvailable(getContext()));
        call.resolve(payload);
    }

    @PluginMethod
    public void getAndroidPushRegistrationState(PluginCall call) {
        if (!requireOnlyKeys(call)) {
            return;
        }
        call.resolve(androidPushRegistrationManager.getStatus());
    }

    @PluginMethod
    public void retryAndroidPushRegistration(PluginCall call) {
        if (!requireOnlyKeys(call)) {
            return;
        }
        long generation = taskExecutor.captureGeneration();
        runAsync(call, () -> {
            try {
                if (!retryAndroidPushRegistrationIfCurrent(
                    taskExecutor,
                    generation,
                    androidPushRegistrationManager::prepareRetry,
                    androidPushRuntimeManager::refreshToken,
                    () -> androidPushRegistrationManager.onAuthenticated(
                        tokenStorage.getToken()
                    )
                )) {
                    call.reject(
                        cancellationMessage("SESSION_INVALIDATED"),
                        "SESSION_INVALIDATED"
                    );
                    return;
                }
                call.resolve(androidPushRegistrationManager.getStatus());
            } catch (TokenStorageException exception) {
                call.reject(
                    "Failed to access protected Android push state",
                    "PUSH_STORAGE_ERROR",
                    exception
                );
            }
        });
    }

    @PluginMethod
    public void getPasskeyCapabilities(PluginCall call) {
        call.resolve(buildPasskeyCapabilities(NativePasskeyCapability.forCurrentDevice()));
    }

    @PluginMethod
    public void getRuntimeInfo(PluginCall call) {
        AndroidRuntimeInfo runtimeInfo = AndroidRuntimeInfo.fromContext(getContext());
        String appVersion = runtimeInfo.getPackageVersionName();
        long appBuild = runtimeInfo.getPackageVersionCode();

        if (appVersion == null || appVersion.trim().isEmpty() || appBuild <= 0) {
            call.reject(
                "Android runtime version metadata is unavailable",
                "RUNTIME_INFO_UNAVAILABLE"
            );
            return;
        }

        JSObject payload = new JSObject();
        payload.put("clientPlatform", "android");
        payload.put("appVersion", appVersion);
        payload.put("appBuild", appBuild);
        call.resolve(payload);
    }

    @PluginMethod
    public void confirmRuntimeBootstrap(PluginCall call) {
        if (!requireOnlyKeys(
            call,
            "instanceDisplayName",
            "apiOrigin",
            "rawApiBaseUrl",
            "androidPush",
            "features"
        )) {
            return;
        }
        String instanceDisplayName = requireValue(
            call,
            "instanceDisplayName",
            MAX_RUNTIME_DISPLAY_NAME_CHARACTERS
        );
        String apiOrigin = requireValue(call, "apiOrigin", MAX_RUNTIME_URL_CHARACTERS);
        String rawApiBaseUrl = requireValue(
            call,
            "rawApiBaseUrl",
            MAX_RUNTIME_URL_CHARACTERS
        );
        JSObject androidPush = call.getObject("androidPush");
        JSObject features = call.getObject("features");

        if (instanceDisplayName == null
            || apiOrigin == null
            || rawApiBaseUrl == null) {
            return;
        }
        if (!isBoundedJsonObject(androidPush, MAX_RUNTIME_METADATA_CHARACTERS)
            || !isBoundedJsonObject(features, MAX_RUNTIME_METADATA_CHARACTERS)) {
            call.reject("Android runtime bootstrap exceeds the allowed size", "INVALID_INPUT");
            return;
        }

        final JSObject bootstrap;
        try {
            bootstrap = buildRuntimeBootstrap(
                instanceDisplayName,
                apiOrigin,
                rawApiBaseUrl,
                androidPush,
                features
            );
        } catch (RuntimeException exception) {
            rejectRuntimeBootstrap(call, exception);
            return;
        } catch (JSONException exception) {
            rejectInvalidRuntimeBootstrap(call, exception);
            return;
        }

        runAsync(call, () -> {
            String canonicalApiOrigin = bootstrap.getString("apiOrigin");
            String confirmationMessage = formatRuntimeConfirmationMessage(
                getContext().getString(R.string.runtime_confirmation_switch_message),
                canonicalApiOrigin
            );

            confirmNativeRuntimeMutation(
                call,
                R.string.runtime_confirmation_switch_title,
                confirmationMessage,
                () -> applyConfirmedRuntimeBootstrap(call, bootstrap)
            );
        });
    }

    private void applyConfirmedRuntimeBootstrap(
        PluginCall call,
        JSObject bootstrap
    ) {
        String requestId = "runtime-switch-" + UUID.randomUUID();
        AtomicBoolean settled = new AtomicBoolean(false);
        AtomicBoolean runtimeApplied = new AtomicBoolean(false);
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();
        NativeAuthTaskExecutor.SubmitResult submitResult = taskExecutor.submitSessionTransition(
            requestId,
            0,
            () -> {
                try {
                    String nextApiBaseUrl = bootstrap.getString("apiOrigin");
                    SharedPreferences preferences = getNativeAuthPreferences();
                    JSObject previousBootstrap = loadPersistedRuntimeBootstrap(preferences);
                    String previousRuntimeBootstrap = preferences.getString(
                        RUNTIME_BOOTSTRAP_PREFERENCE_KEY,
                        null
                    );
                    String previousApiBaseUrl = preferences.getString(
                        API_BASE_URL_PREFERENCE_KEY,
                        null
                    );
                    AndroidPushRuntimeMetadata previousPushRuntime = previousBootstrap == null
                        ? null
                        : AndroidPushRuntimeMetadata.fromBootstrap(
                            previousBootstrap.optJSONObject("androidPush")
                        );
                    AndroidPushRuntimeMetadata nextPushRuntime =
                        AndroidPushRuntimeMetadata.fromBootstrap(
                            bootstrap.optJSONObject("androidPush")
                        );
                    String previousToken = readStoredTokenForRuntimeMutation(tokenStorage);
                    AtomicBoolean replacementSucceeded = new AtomicBoolean(false);
                    if (!taskExecutor.completeAuthenticatedMutation(requestId, () -> {
                        androidPushRegistrationManager.prepareRuntimeRebind(
                            nextApiBaseUrl,
                            previousToken
                        );
                        try {
                            replacementSucceeded.set(replaceRuntimeBootstrapStateWithRollback(
                                apiBaseUrl,
                                nextApiBaseUrl,
                                tokenStorage,
                                () -> persistRuntimeBootstrap(bootstrap),
                                () -> restoreRuntimeBootstrapPersistenceSynchronously(
                                    preferences,
                                    previousRuntimeBootstrap,
                                    previousApiBaseUrl
                                ),
                                () -> applyAndroidPushRuntimeRebind(
                                    nextApiBaseUrl,
                                    nextPushRuntime,
                                    previousPushRuntime,
                                    previousToken,
                                    cancellation
                                )
                            ));
                        } finally {
                            if (!replacementSucceeded.get()) {
                                androidPushRegistrationManager.cancelPreparedRuntimeRebind(
                                    nextApiBaseUrl
                                );
                            }
                        }
                        if (replacementSucceeded.get()) {
                            apiBaseUrl = nextApiBaseUrl;
                            runtimeApplied.set(true);
                        }
                    })) {
                        return;
                    }
                    if (!replacementSucceeded.get()) {
                        taskExecutor.completeAuthenticated(requestId, () -> settleOnce(
                            settled,
                            () -> call.reject(
                                "Failed to persist Android runtime bootstrap",
                                "RUNTIME_BOOTSTRAP_PERSISTENCE_FAILED"
                            )
                        ));
                        return;
                    }

                    JSObject payload = new JSObject();
                    payload.put("bootstrap", bootstrap);
                    taskExecutor.completeAuthenticated(
                        requestId,
                        () -> settleOnce(settled, () -> call.resolve(payload))
                    );
                } catch (TokenStorageException exception) {
                    taskExecutor.completeAuthenticated(requestId, () -> settleOnce(
                        settled,
                        () -> call.reject(
                            "Failed to access Android auth token during runtime rebind",
                            "TOKEN_STORAGE_ERROR",
                            exception
                        )
                    ));
                } catch (RuntimeException exception) {
                    taskExecutor.completeAuthenticated(
                        requestId,
                        () -> settleOnce(settled, () -> rejectRuntimeBootstrap(call, exception))
                    );
                }
            },
            reasonCode -> cancellation.cancel(),
            reasonCode -> settleOnce(settled, () -> {
                if (runtimeApplied.get()) {
                    JSObject payload = new JSObject();
                    payload.put("bootstrap", bootstrap);
                    call.resolve(payload);
                } else {
                    call.reject(cancellationMessage(reasonCode), reasonCode);
                }
            })
        );
        if (submitResult != NativeAuthTaskExecutor.SubmitResult.ACCEPTED) {
            settleOnce(settled, () -> rejectSubmission(call, submitResult));
        }
    }

    @PluginMethod
    public void getRuntimeBootstrap(PluginCall call) {
        if (!requireOnlyKeys(call)) {
            return;
        }
        runAsync(call, () -> {
            JSObject payload = buildRuntimeBootstrapPayload(getPersistedRuntimeBootstrap());
            call.resolve(payload);
        });
    }

    @PluginMethod
    public void confirmRuntimeReset(PluginCall call) {
        if (!requireOnlyKeys(call)) {
            return;
        }
        runAsync(call, () -> {
            JSObject persistedBootstrap = getPersistedRuntimeBootstrap();
            String currentApiOrigin = apiBaseUrl;
            if (persistedBootstrap != null) {
                currentApiOrigin = persistedBootstrap.optString("apiOrigin", currentApiOrigin);
            }
            if (currentApiOrigin == null || currentApiOrigin.trim().isEmpty()) {
                call.reject(
                    "Android runtime reset requires a configured instance",
                    "RUNTIME_NOT_CONFIGURED"
                );
                return;
            }

            String confirmedApiOrigin = currentApiOrigin.trim();

            String confirmationMessage = formatRuntimeConfirmationMessage(
                getContext().getString(R.string.runtime_confirmation_reset_message),
                confirmedApiOrigin
            );
            confirmNativeRuntimeMutation(
                call,
                R.string.runtime_confirmation_reset_title,
                confirmationMessage,
                () -> clearConfirmedRuntime(call, confirmedApiOrigin)
            );
        });
    }

    private void clearConfirmedRuntime(
        PluginCall call,
        String confirmedApiOrigin
    ) {
        String requestId = "runtime-reset-" + UUID.randomUUID();
        AtomicBoolean settled = new AtomicBoolean(false);
        AtomicBoolean localRuntimeCleared = new AtomicBoolean(false);
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();
        NativeAuthTaskExecutor.SubmitResult submitResult = taskExecutor.submitSessionTransition(
            requestId,
            0,
            () -> {
                try {
                    String tokenForServerRevocation = readStoredTokenForRuntimeMutation(tokenStorage);
                    JSObject previousBootstrap = getPersistedRuntimeBootstrap();
                    AndroidPushRuntimeMetadata previousPushRuntime = previousBootstrap == null
                        ? null
                        : AndroidPushRuntimeMetadata.fromBootstrap(
                            previousBootstrap.optJSONObject("androidPush")
                        );
                    AtomicBoolean clearSucceeded = new AtomicBoolean(false);
                    if (!taskExecutor.completeAuthenticatedMutation(requestId, () -> {
                        clearSucceeded.set(clearRuntimeBootstrapStateWithPushRollback(
                            getNativeAuthPreferences(),
                            tokenStorage,
                            tokenForServerRevocation,
                            androidPushRuntimeManager,
                            previousPushRuntime
                        ));
                        if (clearSucceeded.get()) {
                            apiBaseUrl = null;
                            localRuntimeCleared.set(true);
                        }
                    })) {
                        return;
                    }
                    if (!clearSucceeded.get()) {
                        taskExecutor.completeAuthenticated(requestId, () -> settleOnce(
                            settled,
                            () -> call.reject(
                                "Failed to clear Android runtime bootstrap state",
                                "RUNTIME_BOOTSTRAP_PERSISTENCE_FAILED"
                            )
                        ));
                        return;
                    }
                    androidPushRegistrationManager.clearRuntime(tokenForServerRevocation);
                    revokeNativeAuthenticationAfterRuntimeClear(
                        tokenForServerRevocation,
                        confirmedApiOrigin,
                        (apiOrigin, token) -> httpClient.logout(
                            apiOrigin,
                            token,
                            cancellation
                        )
                    );
                    taskExecutor.completeAuthenticated(
                        requestId,
                        () -> settleOnce(settled, call::resolve)
                    );
                } catch (TokenStorageException exception) {
                    taskExecutor.completeAuthenticated(requestId, () -> settleOnce(
                        settled,
                        () -> call.reject(
                            "Failed to access Android auth token during runtime reset",
                            "TOKEN_STORAGE_ERROR",
                            exception
                        )
                    ));
                } catch (RuntimeException exception) {
                    taskExecutor.completeAuthenticated(requestId, () -> settleOnce(
                        settled,
                        () -> call.reject(
                            exception.getMessage(),
                            resolveRuntimeBootstrapErrorCode(exception),
                            exception
                        )
                    ));
                }
            },
            reasonCode -> cancellation.cancel(),
            reasonCode -> {
                settleOnce(settled, () -> {
                    if (localRuntimeCleared.get()) {
                        call.resolve();
                    } else {
                        call.reject(cancellationMessage(reasonCode), reasonCode);
                    }
                });
            },
            exception -> {
                settleOnce(
                    settled,
                    () -> call.reject(
                        "Android native auth operation failed unexpectedly",
                        "NATIVE_AUTH_INTERNAL_ERROR",
                        exception
                    )
                );
            }
        );
        if (submitResult != NativeAuthTaskExecutor.SubmitResult.ACCEPTED) {
            settleOnce(settled, () -> rejectSubmission(call, submitResult));
        }
    }

    @PluginMethod
    public void isVaultDeviceBoundWrapperAvailable(PluginCall call) {
        JSObject payload = new JSObject();
        payload.put(
            "available",
            isVaultDeviceBoundWrapperAvailableForWebView(
                isVaultRootKeyBridgeEnabledForWebView(),
                vaultRootKeyWrapper != null && vaultRootKeyWrapper.isAvailable()
            )
        );
        call.resolve(payload);
    }

    @PluginMethod
    public void logout(PluginCall call) {
        if (!requireOnlyKeys(call)) {
            return;
        }
        String requestId = "logout-" + UUID.randomUUID();
        AtomicBoolean settled = new AtomicBoolean(false);
        AtomicBoolean localCredentialCleared = new AtomicBoolean(false);
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();
        NativeAuthTaskExecutor.SubmitResult submitResult = taskExecutor.submitSessionTransition(
            requestId,
            0,
            () -> {
                try {
                    String token = tokenStorage.getToken();
                    if (token == null || token.trim().isEmpty()) {
                        taskExecutor.completeAuthenticated(requestId, () -> settleOnce(
                            settled,
                            () -> call.reject(
                                "Android auth token is not available",
                                "NO_STORED_TOKEN"
                            )
                        ));
                        return;
                    }

                    if (!performNativeLogoutTeardown(
                        apiBaseUrl,
                        token,
                        androidPushRegistrationManager::onLogout,
                        tokenStorage,
                        localCredentialCleared,
                        mutation -> taskExecutor.completeAuthenticatedMutation(
                            requestId,
                            mutation::run
                        ),
                        (apiOrigin, authToken) -> httpClient.logout(
                            apiOrigin,
                            authToken,
                            cancellation
                        )
                    )) {
                        return;
                    }
                    taskExecutor.completeAuthenticated(
                        requestId,
                        () -> settleOnce(settled, call::resolve)
                    );
                } catch (TokenStorageException exception) {
                    taskExecutor.completeAuthenticated(requestId, () -> settleOnce(
                        settled,
                        () -> call.reject(
                            "Failed to load Android auth token",
                            "TOKEN_STORAGE_ERROR",
                            exception
                        )
                    ));
                }
            },
            reasonCode -> cancellation.cancel(),
            reasonCode -> {
                settleOnce(settled, () -> {
                    if (localCredentialCleared.get()) {
                        call.resolve();
                    } else {
                        call.reject(cancellationMessage(reasonCode), reasonCode);
                    }
                });
            },
            exception -> {
                settleOnce(
                    settled,
                    () -> call.reject(
                        "Android native auth operation failed unexpectedly",
                        "NATIVE_AUTH_INTERNAL_ERROR",
                        exception
                    )
                );
            }
        );
        if (submitResult != NativeAuthTaskExecutor.SubmitResult.ACCEPTED) {
            settleOnce(settled, () -> rejectSubmission(call, submitResult));
        }
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (!requireOnlyKeys(
            call,
            "requestId",
            "method",
            "path",
            "bodyBase64",
            "contentType",
            "accept"
        )) {
            return;
        }
        String method = requireValue(
            call,
            "method",
            NativeAuthRequestPolicy.MAX_METHOD_CHARACTERS
        );
        String path = requireValue(
            call,
            "path",
            NativeAuthRequestPolicy.MAX_REQUEST_TARGET_CHARACTERS
        );

        if (method == null || path == null) {
            return;
        }

        String bodyBase64 = call.getString("bodyBase64");
        String contentType = call.getString("contentType");
        String accept = call.getString("accept");
        String requestId = normalizeRequiredRequestId(call.getString("requestId"));
        if (requestId == null) {
            call.reject("Android auth request id is invalid", "INVALID_INPUT");
            return;
        }
        final int requestBodyBytes;
        final NativeAuthRequestPolicy.AuthorizedRequest authorizedRequest;
        try {
            requestBodyBytes = NativeAuthHttpClient.decodedRequestBodyLength(bodyBase64);
            authorizedRequest = NativeAuthRequestPolicy.authorize(
                method,
                path,
                contentType,
                accept,
                requestBodyBytes
            );
        } catch (NativeAuthHttpException exception) {
            rejectCall(call, exception);
            return;
        }

        AtomicBoolean settled = new AtomicBoolean(false);
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();
        NativeAuthTaskExecutor.SubmitResult submitResult = taskExecutor.submitAuthenticated(
            requestId,
            requestBodyBytes,
            () -> {
                try {
                    String token = tokenStorage.getToken();
                    if (token == null || token.trim().isEmpty()) {
                        taskExecutor.completeAuthenticated(requestId, () -> settleOnce(
                            settled,
                            () -> call.reject(
                                "Android auth token is not available",
                                "NO_STORED_TOKEN"
                            )
                        ));
                        return;
                    }

                    requireNetworkConnection();
                    JSObject response = httpClient.requestAuthorized(
                        apiBaseUrl,
                        token,
                        authorizedRequest,
                        bodyBase64,
                        cancellation
                    );

                    taskExecutor.completeAuthenticated(requestId, () -> {
                        settleOnce(settled, () -> {
                            Integer statusCode = response.getInteger("status");
                            if (statusCode != null && statusCode == 401) {
                                maybeClearToken(new NativeAuthHttpException("Unauthenticated", 401));
                            }
                            call.resolve(response);
                        });
                    });
                } catch (IOException | NativeAuthHttpException | NetworkUnavailableException exception) {
                    taskExecutor.completeAuthenticated(requestId, () -> {
                        settleOnce(settled, () -> {
                            maybeClearToken(exception);
                            rejectCall(call, exception);
                        });
                    });
                } catch (TokenStorageException exception) {
                    taskExecutor.completeAuthenticated(requestId, () -> {
                        settleOnce(
                            settled,
                            () -> call.reject(
                                "Failed to load Android auth token",
                                "TOKEN_STORAGE_ERROR",
                                exception
                            )
                        );
                    });
                }
            },
            reasonCode -> {
                cancellation.cancel();
                settleOnce(
                    settled,
                    () -> call.reject(cancellationMessage(reasonCode), reasonCode)
                );
            },
            exception -> {
                settleOnce(
                    settled,
                    () -> call.reject(
                        "Android native auth operation failed unexpectedly",
                        "NATIVE_AUTH_INTERNAL_ERROR",
                        exception
                    )
                );
            }
        );

        if (submitResult != NativeAuthTaskExecutor.SubmitResult.ACCEPTED) {
            settleOnce(settled, () -> rejectSubmission(call, submitResult));
        }
    }

    @PluginMethod
    public void cancelRequest(PluginCall call) {
        if (!requireOnlyKeys(call, "requestId")) {
            return;
        }
        String requestId = normalizeRequiredRequestId(call.getString("requestId"));
        if (requestId == null) {
            call.reject("Android auth request id is invalid", "INVALID_INPUT");
            return;
        }

        JSObject payload = new JSObject();
        payload.put("cancelled", taskExecutor.cancelAuthenticated(requestId));
        call.resolve(payload);
    }

    @PluginMethod
    public void wrapVaultRootKey(PluginCall call) {
        rejectVaultRootKeyBridgeCall(call);
    }

    @PluginMethod
    public void unwrapVaultRootKey(PluginCall call) {
        rejectVaultRootKeyBridgeCall(call);
    }

    private boolean runAsync(PluginCall call, Runnable job) {
        if (!taskExecutor.submit(
            job,
            exception -> call.reject(
                "Android native auth operation failed unexpectedly",
                "NATIVE_AUTH_INTERNAL_ERROR",
                exception
            ),
            reasonCode -> call.reject(cancellationMessage(reasonCode), reasonCode)
        )) {
            if (destroyed) {
                call.reject("Android native auth plugin is unavailable", "PLUGIN_SHUTDOWN");
            } else {
                call.reject("Android native auth is temporarily busy", "NATIVE_AUTH_BUSY");
            }
            return false;
        }
        return true;
    }

    private void rejectSessionBoundCall(
        PluginCall call,
        long expectedGeneration,
        Exception exception
    ) {
        if (!taskExecutor.isGenerationCurrent(expectedGeneration)) {
            call.reject(
                cancellationMessage("SESSION_INVALIDATED"),
                "SESSION_INVALIDATED"
            );
            return;
        }
        rejectCall(call, exception);
    }

    private void rejectPasskeySessionBoundCall(
        PluginCall call,
        long expectedGeneration,
        Exception exception
    ) {
        if (!taskExecutor.isSessionGenerationCurrent(expectedGeneration)) {
            call.reject(
                cancellationMessage("SESSION_INVALIDATED"),
                "SESSION_INVALIDATED"
            );
            return;
        }
        rejectCall(call, exception);
    }

    static String normalizeRequiredRequestId(String requestId) {
        if (requestId == null) {
            return null;
        }
        String normalized = requestId.trim();
        return normalized.matches("[A-Za-z0-9_-]{1,64}") ? normalized : null;
    }

    private static String cancellationMessage(String reasonCode) {
        switch (reasonCode) {
            case "REQUEST_TIMEOUT":
                return "Android authenticated request exceeded its lifetime limit";
            case "APP_BACKGROUNDED":
                return "Android authenticated request was cancelled in the background";
            case "SESSION_INVALIDATED":
                return "Android authenticated request belongs to an expired session";
            case "PLUGIN_SHUTDOWN":
                return "Android native auth plugin is unavailable";
            default:
                return "Android authenticated request was cancelled";
        }
    }

    static boolean settleOnce(AtomicBoolean settled, Runnable terminalCallback) {
        if (!settled.compareAndSet(false, true)) {
            return false;
        }
        terminalCallback.run();
        return true;
    }

    private static void rejectSubmission(
        PluginCall call,
        NativeAuthTaskExecutor.SubmitResult submitResult
    ) {
        switch (submitResult) {
            case BUFFER_LIMIT:
                call.reject("Android native auth buffered-data limit reached", "NATIVE_AUTH_BUFFER_LIMIT");
                return;
            case BACKGROUNDED:
                call.reject(
                    "Android authenticated requests are paused in the background",
                    submissionErrorCode(submitResult)
                );
                return;
            case TRANSITION_IN_PROGRESS:
                call.reject(
                    "Android native auth is temporarily busy",
                    submissionErrorCode(submitResult)
                );
                return;
            case SHUTDOWN:
                call.reject("Android native auth plugin is unavailable", "PLUGIN_SHUTDOWN");
                return;
            case DUPLICATE_ID:
                call.reject("Android auth request id is already active", "INVALID_INPUT");
                return;
            default:
                call.reject("Android native auth is temporarily busy", "NATIVE_AUTH_BUSY");
        }
    }

    static String submissionErrorCode(NativeAuthTaskExecutor.SubmitResult submitResult) {
        return submitResult == NativeAuthTaskExecutor.SubmitResult.BACKGROUNDED
            ? "NATIVE_AUTH_BACKGROUND"
            : "NATIVE_AUTH_BUSY";
    }

    private void confirmNativeRuntimeMutation(
        PluginCall call,
        int titleResource,
        String message,
        Runnable confirmedMutation
    ) {
        if (!beginRuntimeConfirmation(runtimeMutationConfirmationPending)) {
            call.reject(
                "Another Android runtime confirmation is already pending",
                "RUNTIME_CONFIRMATION_PENDING"
            );
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            runtimeMutationConfirmationPending.set(false);
            call.reject(
                "Android runtime changes require an attached native activity",
                "RUNTIME_CONFIRMATION_UNAVAILABLE"
            );
            return;
        }

        AtomicBoolean decisionPending = new AtomicBoolean(true);
        activity.runOnUiThread(() -> {
            try {
                DialogInterface.OnClickListener decisionListener = (dialog, which) -> {
                    runtimeMutationConfirmationDialog.set(null);
                    dialog.dismiss();
                    if (isConfirmedRuntimeButton(which)) {
                        completeRuntimeConfirmation(decisionPending, confirmedMutation);
                        return;
                    }
                    cancelRuntimeConfirmation(call, decisionPending);
                };
                AlertDialog confirmationDialog = new AlertDialog.Builder(activity)
                    .setTitle(titleResource)
                    .setMessage(message)
                    .setPositiveButton(
                        R.string.runtime_confirmation_continue,
                        decisionListener
                    )
                    .setNegativeButton(
                        R.string.runtime_confirmation_cancel,
                        decisionListener
                    )
                    .setCancelable(true)
                    .setOnCancelListener(dialog -> {
                        runtimeMutationConfirmationDialog.set(null);
                        dialog.dismiss();
                        cancelRuntimeConfirmation(call, decisionPending);
                    })
                    .create();
                confirmationDialog.show();
                runtimeMutationConfirmationDialog.set(confirmationDialog);
                if (destroyed) {
                    dismissRuntimeConfirmationOnDestroy(
                        runtimeMutationConfirmationDialog,
                        runtimeMutationConfirmationPending
                    );
                }
            } catch (RuntimeException exception) {
                runtimeMutationConfirmationDialog.set(null);
                if (finishRuntimeConfirmation(decisionPending, runtimeMutationConfirmationPending)) {
                    call.reject(
                        "Android runtime confirmation could not be displayed",
                        "RUNTIME_CONFIRMATION_UNAVAILABLE",
                        exception
                    );
                }
            }
        });
    }

    private void completeRuntimeConfirmation(
        AtomicBoolean decisionPending,
        Runnable confirmedMutation
    ) {
        if (!finishRuntimeConfirmation(decisionPending, runtimeMutationConfirmationPending)) {
            return;
        }
        confirmedMutation.run();
    }

    private void cancelRuntimeConfirmation(PluginCall call, AtomicBoolean decisionPending) {
        if (!finishRuntimeConfirmation(decisionPending, runtimeMutationConfirmationPending)) {
            return;
        }
        call.reject(
            "Android runtime change was not confirmed",
            "RUNTIME_CONFIRMATION_CANCELLED"
        );
    }

    static String formatRuntimeConfirmationMessage(String template, String canonicalApiOrigin) {
        return String.format(Locale.US, template, canonicalApiOrigin);
    }

    static boolean beginRuntimeConfirmation(AtomicBoolean confirmationPending) {
        return confirmationPending.compareAndSet(false, true);
    }

    static boolean isConfirmedRuntimeButton(int button) {
        return button == DialogInterface.BUTTON_POSITIVE;
    }

    static boolean finishRuntimeConfirmation(
        AtomicBoolean decisionPending,
        AtomicBoolean confirmationPending
    ) {
        if (!decisionPending.compareAndSet(true, false)) {
            return false;
        }
        confirmationPending.set(false);
        return true;
    }

    static <T extends DialogInterface> boolean dismissRuntimeConfirmationOnDestroy(
        AtomicReference<T> dialogReference,
        AtomicBoolean confirmationPending
    ) {
        T dialog = dialogReference.getAndSet(null);
        confirmationPending.set(false);
        if (dialog == null) {
            return false;
        }
        dialog.dismiss();
        return true;
    }

    AlertDialog getActiveRuntimeConfirmationDialog() {
        return runtimeMutationConfirmationDialog.get();
    }

    private static void rejectRuntimeBootstrap(PluginCall call, RuntimeException exception) {
        call.reject(
            exception.getMessage(),
            resolveRuntimeBootstrapErrorCode(exception),
            exception
        );
    }

    private static void rejectInvalidRuntimeBootstrap(PluginCall call, JSONException exception) {
        call.reject(
            "Failed to serialize Android runtime bootstrap",
            "RUNTIME_BOOTSTRAP_INVALID",
            exception
        );
    }

    private boolean requirePasskeyCapability(
        PluginCall call,
        NativePasskeyCapability capability
    ) {
        try {
            capability.requirePasskeysAvailable();
            return true;
        } catch (PasskeyAuthenticationException exception) {
            rejectCall(call, exception);
            return false;
        }
    }

    interface DestroyedCheck {
        boolean isDestroyed();
    }

    interface RetainedEventNotifier {
        void notifyRetained(String event, JSObject payload);
    }

    interface AndroidPushMessageHandler {
        void onTokenReceived(String appName, String token);

        void onTokenError(String appName);
    }

    static void pauseAuthenticatedForLifecycle(
        NativeAuthTaskExecutor taskExecutor,
        RetainedEventNotifier notifier
    ) {
        notifier.notifyRetained(
            NATIVE_AUTH_LIFECYCLE_CHANGED_EVENT,
            buildNativeAuthLifecyclePayload(false)
        );
        taskExecutor.pauseAuthenticated();
    }

    static void resumeAuthenticatedForLifecycle(
        NativeAuthTaskExecutor taskExecutor,
        RetainedEventNotifier notifier
    ) {
        taskExecutor.resumeAuthenticated();
        notifier.notifyRetained(
            NATIVE_AUTH_LIFECYCLE_CHANGED_EVENT,
            buildNativeAuthLifecyclePayload(true)
        );
    }

    private static JSObject buildNativeAuthLifecyclePayload(boolean foreground) {
        JSObject payload = new JSObject();
        payload.put("foreground", foreground);
        return payload;
    }

    static boolean isVaultRootKeyBridgeEnabledForWebView() {
        return false;
    }

    static JSObject buildPasskeyCapabilities(NativePasskeyCapability capability) {
        JSObject payload = new JSObject();
        payload.put("passkeysAvailable", capability.isPasskeysAvailable());

        if (!capability.isPasskeysAvailable()) {
            payload.put("reason", capability.getUnavailableReason());
        }

        return payload;
    }

    static boolean isVaultDeviceBoundWrapperAvailableForWebView(
        boolean vaultRootKeyBridgeEnabledForWebView,
        boolean wrapperAvailable
    ) {
        return vaultRootKeyBridgeEnabledForWebView && wrapperAvailable;
    }

    private void rejectVaultRootKeyBridgeCall(PluginCall call) {
        call.reject(
            VAULT_ROOT_KEY_BRIDGE_UNSUPPORTED_MESSAGE,
            VAULT_ROOT_KEY_BRIDGE_UNSUPPORTED_CODE
        );
    }

    private AndroidPushRuntimeManager.MessagingListener createAndroidPushMessagingListener() {
        return buildAndroidPushMessagingListener(
            () -> destroyed,
            new AndroidPushMessageHandler() {
                @Override
                public void onTokenReceived(String appName, String token) {
                    scheduleAndroidPushAfterAuthentication(
                        taskExecutor,
                        cancellation -> {
                            String authToken = tokenStorage.getToken();
                            androidPushRegistrationManager.onTokenReceived(
                                appName,
                                token,
                                authToken,
                                cancellation
                            );
                        },
                        androidPushRegistrationManager::onProtectedStateError,
                        androidPushRegistrationManager::onRegistrationSchedulingError
                    );
                }

                @Override
                public void onTokenError(String appName) {
                    runNativePushTask(() ->
                        androidPushRegistrationManager.onTokenError(appName)
                    );
                }
            }
        );
    }

    static AndroidPushRuntimeManager.MessagingListener buildAndroidPushMessagingListener(
        DestroyedCheck destroyedCheck,
        AndroidPushMessageHandler handler
    ) {
        return new AndroidPushRuntimeManager.MessagingListener() {
            @Override
            public void onTokenReceived(String appName, String token) {
                if (destroyedCheck.isDestroyed()) {
                    return;
                }
                handler.onTokenReceived(appName, token);
            }

            @Override
            public void onTokenError(String appName, Exception exception) {
                if (destroyedCheck.isDestroyed()) {
                    return;
                }
                handler.onTokenError(appName);
            }
        };
    }

    private void runNativePushTask(PushTask task) {
        submitNativePushTask(
            taskExecutor,
            task,
            androidPushRegistrationManager::onProtectedStateError,
            () -> androidPushRegistrationManager.onTokenError(
                AndroidPushRegistrationManager.RUNTIME_APP_NAME
            )
        );
    }

    static boolean submitForegroundPushRefresh(
        NativeAuthTaskExecutor taskExecutor,
        Runnable refreshToken,
        Runnable retryMarker
    ) {
        return submitNativePushTask(
            taskExecutor,
            refreshToken::run,
            retryMarker
        );
    }

    static boolean submitNativePushTaskWithoutRetryMarker(
        NativeAuthTaskExecutor taskExecutor,
        PushTask task
    ) {
        return submitNativePushTask(taskExecutor, task, () -> {});
    }

    static boolean submitNativePushTask(
        NativeAuthTaskExecutor taskExecutor,
        PushTask task,
        Runnable retryMarker
    ) {
        return submitNativePushTask(taskExecutor, task, retryMarker, retryMarker);
    }

    static boolean submitNativePushTask(
        NativeAuthTaskExecutor taskExecutor,
        PushTask task,
        Runnable protectedStorageErrorMarker,
        Runnable retryMarker
    ) {
        long generation = taskExecutor.captureGeneration();
        boolean accepted = taskExecutor.submit(
            () -> {
                try {
                    if (!taskExecutor.runIfGenerationCurrent(generation, task::run)) {
                        retryMarker.run();
                    }
                } catch (TokenStorageException exception) {
                    protectedStorageErrorMarker.run();
                }
            },
            exception -> retryMarker.run(),
            reasonCode -> retryMarker.run()
        );
        if (!accepted) {
            retryMarker.run();
        }
        return accepted;
    }

    @FunctionalInterface
    interface PushTask {
        void run() throws TokenStorageException;
    }

    @FunctionalInterface
    interface CancellablePushTask {
        void run(NativeAuthHttpClient.CancellationSignal cancellation)
            throws TokenStorageException;
    }

    @FunctionalInterface
    interface PushRetryPreparation {
        boolean prepare() throws TokenStorageException;
    }

    static NativeAuthTaskExecutor.SubmitResult scheduleAndroidPushAfterAuthentication(
        NativeAuthTaskExecutor taskExecutor,
        PushTask task,
        Runnable protectedStorageErrorMarker,
        Runnable schedulingErrorMarker
    ) {
        return scheduleAndroidPushAfterAuthentication(
            taskExecutor,
            cancellation -> task.run(),
            protectedStorageErrorMarker,
            schedulingErrorMarker
        );
    }

    static NativeAuthTaskExecutor.SubmitResult scheduleAndroidPushAfterAuthentication(
        NativeAuthTaskExecutor taskExecutor,
        CancellablePushTask task,
        Runnable protectedStorageErrorMarker,
        Runnable schedulingErrorMarker
    ) {
        String requestId = "android-push-auth-" + UUID.randomUUID();
        NativeAuthHttpClient.CancellationSignal cancellation =
            new NativeAuthHttpClient.CancellationSignal();
        NativeAuthTaskExecutor.SubmitResult result = taskExecutor.submitAuthenticated(
            requestId,
            0,
            () -> {
                try {
                    task.run(cancellation);
                } catch (TokenStorageException exception) {
                    protectedStorageErrorMarker.run();
                }
            },
            reasonCode -> cancellation.cancel(),
            reasonCode -> schedulingErrorMarker.run(),
            exception -> schedulingErrorMarker.run()
        );
        if (result != NativeAuthTaskExecutor.SubmitResult.ACCEPTED) {
            schedulingErrorMarker.run();
        }
        return result;
    }

    static void retryAndroidPushRegistrationNow(
        PushRetryPreparation preparation,
        Runnable tokenRefresh,
        PushTask registrationSync
    ) throws TokenStorageException {
        if (!preparation.prepare()) {
            return;
        }
        tokenRefresh.run();
        registrationSync.run();
    }

    static boolean retryAndroidPushRegistrationIfCurrent(
        NativeAuthTaskExecutor taskExecutor,
        long generation,
        PushRetryPreparation preparation,
        Runnable tokenRefresh,
        PushTask registrationSync
    ) throws TokenStorageException {
        return taskExecutor.runIfGenerationCurrent(
            generation,
            () -> retryAndroidPushRegistrationNow(
                preparation,
                tokenRefresh,
                registrationSync
            )
        );
    }

    private void synchronizeAndroidPushAfterAuthentication(
        String authToken,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        try {
            androidPushRegistrationManager.onAuthenticated(authToken, cancellation);
        } catch (TokenStorageException exception) {
            androidPushRegistrationManager.onProtectedStateError();
        }
    }

    static void clearCredentialAfterPushLogout(
        String token,
        AndroidPushLogout pushLogout,
        TokenStorage tokenStorage,
        AtomicBoolean localCredentialCleared
    ) throws TokenStorageException {
        try {
            pushLogout.logout(token);
        } catch (TokenStorageException | RuntimeException ignored) {
            // Auxiliary push state must never retain the bearer during explicit logout.
        }
        tokenStorage.clearToken();
        localCredentialCleared.set(true);
    }

    static boolean performNativeLogoutTeardown(
        String apiOrigin,
        String token,
        AndroidPushLogout pushLogout,
        TokenStorage tokenStorage,
        AtomicBoolean localCredentialCleared,
        SessionMutation sessionMutation,
        NativeAuthenticationRevoker authenticationRevoker
    ) throws TokenStorageException {
        if (!sessionMutation.run(() -> clearCredentialAfterPushLogout(
            token,
            pushLogout,
            tokenStorage,
            localCredentialCleared
        ))) {
            return false;
        }
        try {
            authenticationRevoker.revoke(apiOrigin, token);
        } catch (
            IOException
            | JSONException
            | NativeAuthHttpException
            | RuntimeException ignored
        ) {
            // Server revocation is best effort after the local credential is gone.
        }
        return true;
    }

    private String requireValue(PluginCall call, String key, int maximumCharacters) {
        String value = call.getString(key);

        if (value == null) {
            call.reject("Missing required value: " + key, "INVALID_INPUT");
            return null;
        }
        if (value.length() > maximumCharacters) {
            call.reject("Android native auth value exceeds the allowed size", "INVALID_INPUT");
            return null;
        }

        String normalized = value.trim();
        if (normalized.isEmpty()) {
            call.reject("Missing required value: " + key, "INVALID_INPUT");
            return null;
        }

        return normalized;
    }

    private boolean requireOnlyKeys(PluginCall call, String... allowedKeys) {
        if (hasOnlyKeys(call.getData(), allowedKeys)) {
            return true;
        }
        call.reject("Android native auth call contains unsupported input", "INVALID_INPUT");
        return false;
    }

    static boolean hasOnlyKeys(JSObject data, String... allowedKeys) {
        Set<String> allowed = new HashSet<>(Arrays.asList(allowedKeys));
        Iterator<String> keys = data.keys();
        while (keys.hasNext()) {
            if (!allowed.contains(keys.next())) {
                return false;
            }
        }
        return true;
    }

    static boolean isBoundedValue(String value, int maximumCharacters) {
        return value != null && value.length() <= maximumCharacters;
    }

    static boolean isBoundedJsonObject(JSONObject value, int maximumCharacters) {
        return value == null || value.toString().length() <= maximumCharacters;
    }

    private static void requireBoundedPasskeyResult(String value)
        throws PasskeyAuthenticationException {
        if (!isBoundedValue(value, MAX_PASSKEY_OPTIONS_CHARACTERS)) {
            throw new PasskeyAuthenticationException(
                "Android passkey response exceeds the allowed size.",
                "INVALID_INPUT"
            );
        }
    }

    private void rejectCall(PluginCall call, Exception exception) {
        String errorCode = resolveErrorCode(exception);

        if (errorCode != null) {
            call.reject(exception.getMessage(), errorCode, exception);
            return;
        }

        call.reject(exception.getMessage(), exception.getClass().getSimpleName(), exception);
    }

    static String resolveErrorCode(Exception exception) {
        if (exception instanceof NetworkUnavailableException) {
            return "NETWORK_OFFLINE";
        }

        if (exception instanceof NativeAuthHttpClient.NativeAuthCancelledException) {
            return ((NativeAuthHttpClient.NativeAuthCancelledException) exception)
                .getReasonCode();
        }

        if (exception instanceof PasskeyAuthenticationException) {
            return ((PasskeyAuthenticationException) exception).getErrorCode();
        }

        if (!(exception instanceof NativeAuthHttpException)) {
            return null;
        }

        int statusCode = ((NativeAuthHttpException) exception).getStatusCode();

        return statusCode > 0 ? "HTTP_" + statusCode : "VALIDATION_ERROR";
    }

    static String resolveRuntimeBootstrapErrorCode(RuntimeException exception) {
        if (exception instanceof ConfiguredApiBaseUrlException) {
            return ((ConfiguredApiBaseUrlException) exception).getErrorCode();
        }

        if (exception instanceof InvalidRuntimeBootstrapException) {
            return ((InvalidRuntimeBootstrapException) exception).getErrorCode();
        }

        return "RUNTIME_BOOTSTRAP_INVALID";
    }

    static String resolveConfiguredApiBaseUrl(String configuredValue) {
        try {
            return NativeAuthHttpClient.normalizeBaseUrl(configuredValue);
        } catch (InsecureApiBaseUrlException exception) {
            throw new ConfiguredApiBaseUrlException(
                "Android auth API origin must use HTTPS",
                "INSECURE_API_BASE_URL",
                exception
            );
        } catch (NativeAuthHttpException exception) {
            throw new ConfiguredApiBaseUrlException(
                "Invalid Android auth API origin configuration",
                "INVALID_API_BASE_URL",
                exception
            );
        }
    }

    static String resolveRuntimeApiBaseUrl(String configuredValue) {
        return resolveConfiguredApiBaseUrl(configuredValue);
    }

    static String resolveCanonicalBootstrapApiOrigin(String configuredValue) {
        if (configuredValue == null || configuredValue.trim().isEmpty()) {
            throw new InvalidRuntimeBootstrapException(
                "Android runtime bootstrap requires a raw API base URL",
                "RUNTIME_BOOTSTRAP_INVALID"
            );
        }

        URL parsedUrl;

        try {
            parsedUrl = new URL(configuredValue.trim());
        } catch (MalformedURLException exception) {
            throw new InvalidRuntimeBootstrapException(
                "Android runtime bootstrap requires a valid API base URL",
                "RUNTIME_BOOTSTRAP_INVALID"
            );
        }

        if ((parsedUrl.getUserInfo() != null && !parsedUrl.getUserInfo().isEmpty())
            || parsedUrl.getQuery() != null
            || parsedUrl.getRef() != null) {
            throw new InvalidRuntimeBootstrapException(
                "Android runtime bootstrap requires a bare API base URL or its /v1 endpoint",
                "RUNTIME_BOOTSTRAP_INVALID"
            );
        }

        String path = parsedUrl.getPath() == null ? "" : parsedUrl.getPath().replaceAll("/+$", "");

        if (!path.isEmpty() && !"/v1".equals(path)) {
            throw new InvalidRuntimeBootstrapException(
                "Android runtime bootstrap requires a bare API base URL or its /v1 endpoint",
                "RUNTIME_BOOTSTRAP_INVALID"
            );
        }

        StringBuilder origin = new StringBuilder(parsedUrl.getProtocol())
            .append("://")
            .append(parsedUrl.getHost());

        if (parsedUrl.getPort() != -1 && parsedUrl.getPort() != parsedUrl.getDefaultPort()) {
            origin.append(":").append(parsedUrl.getPort());
        }

        return resolveRuntimeApiBaseUrl(origin.toString());
    }

    static boolean shouldClearStoredToken(String currentApiBaseUrl, String nextApiBaseUrl) {
        return !Objects.equals(currentApiBaseUrl, nextApiBaseUrl);
    }

    static boolean replaceRuntimeBootstrapStateWithRollback(
        String currentApiBaseUrl,
        String nextApiBaseUrl,
        TokenStorage tokenStorage,
        BooleanSupplier persistence,
        BooleanSupplier runtimeRollback,
        Runnable pushReplacement
    ) throws TokenStorageException {
        boolean credentialMustBeRebound = shouldClearStoredToken(
            currentApiBaseUrl,
            nextApiBaseUrl
        );
        String previousToken = credentialMustBeRebound
            ? readStoredTokenForRuntimeMutation(tokenStorage)
            : null;
        if (credentialMustBeRebound) {
            tokenStorage.clearToken();
        }

        final boolean persisted;
        try {
            persisted = persistence.getAsBoolean();
        } catch (RuntimeException exception) {
            rollbackRuntimeBootstrapReplacement(
                exception,
                runtimeRollback,
                tokenStorage,
                previousToken,
                credentialMustBeRebound
            );
            throw exception;
        }

        if (!persisted) {
            RuntimeException failure = new RuntimeException(
                "Failed to persist Android runtime bootstrap"
            );
            if (!rollbackRuntimeBootstrapReplacement(
                failure,
                runtimeRollback,
                tokenStorage,
                previousToken,
                credentialMustBeRebound
            )) {
                throw failure;
            }
            return false;
        }

        try {
            pushReplacement.run();
            return true;
        } catch (RuntimeException exception) {
            rollbackRuntimeBootstrapReplacement(
                exception,
                runtimeRollback,
                tokenStorage,
                previousToken,
                credentialMustBeRebound
            );
            throw exception;
        }
    }

    private static boolean rollbackRuntimeBootstrapReplacement(
        RuntimeException failure,
        BooleanSupplier runtimeRollback,
        TokenStorage tokenStorage,
        String previousToken,
        boolean restoreCredential
    ) throws TokenStorageException {
        final boolean runtimeRestored;
        try {
            runtimeRestored = runtimeRollback.getAsBoolean();
        } catch (RuntimeException rollbackFailure) {
            failure.addSuppressed(rollbackFailure);
            return false;
        }

        if (!runtimeRestored) {
            failure.addSuppressed(new IllegalStateException(
                "Failed to restore Android runtime bootstrap after replacement failure"
            ));
            return false;
        }

        try {
            restoreRuntimeCredential(tokenStorage, previousToken, restoreCredential);
        } catch (TokenStorageException tokenException) {
            tokenException.addSuppressed(failure);
            throw tokenException;
        }
        return true;
    }

    private static void restoreRuntimeCredential(
        TokenStorage tokenStorage,
        String previousToken,
        boolean restoreCredential
    ) throws TokenStorageException {
        if (restoreCredential && previousToken != null) {
            tokenStorage.saveToken(previousToken);
        }
    }

    static void clearRejectedLegacyRuntimeState(SharedPreferences preferences, TokenStorage tokenStorage) {
        String legacyApiBaseUrl = preferences.getString(API_BASE_URL_PREFERENCE_KEY, null);

        if (legacyApiBaseUrl == null || legacyApiBaseUrl.trim().isEmpty()) {
            return;
        }

        preferences.edit().remove(API_BASE_URL_PREFERENCE_KEY).apply();
        tokenStorage.clearToken();
    }

    static JSObject applyPersistedRuntimeBootstrap(
        SharedPreferences preferences,
        TokenStorage tokenStorage,
        AndroidPushRuntimeManager androidPushRuntimeManager,
        JSObject persistedRuntimeBootstrap,
        Consumer<JSObject> pushIdentityBinder
    ) {
        if (persistedRuntimeBootstrap == null) {
            pushIdentityBinder.accept(null);
            androidPushRuntimeManager.apply(null);
            return null;
        }

        try {
            pushIdentityBinder.accept(persistedRuntimeBootstrap);
            androidPushRuntimeManager.apply(
                AndroidPushRuntimeMetadata.fromBootstrap(persistedRuntimeBootstrap.optJSONObject("androidPush"))
            );
            return persistedRuntimeBootstrap;
        } catch (RuntimeException exception) {
            preferences.edit()
                .remove(RUNTIME_BOOTSTRAP_PREFERENCE_KEY)
                .remove(API_BASE_URL_PREFERENCE_KEY)
                .apply();
            tokenStorage.clearToken();
            pushIdentityBinder.accept(null);
            androidPushRuntimeManager.apply(null);
            return null;
        }
    }

    static boolean clearRuntimeBootstrapState(
        SharedPreferences preferences,
        TokenStorage tokenStorage
    ) {
        String previousRuntimeBootstrap = preferences.getString(
            RUNTIME_BOOTSTRAP_PREFERENCE_KEY,
            null
        );
        String previousApiBaseUrl = preferences.getString(API_BASE_URL_PREFERENCE_KEY, null);
        boolean persisted = preferences.edit()
            .remove(RUNTIME_BOOTSTRAP_PREFERENCE_KEY)
            .remove(API_BASE_URL_PREFERENCE_KEY)
            .commit();

        if (!persisted) {
            final boolean persistenceRestored;
            try {
                persistenceRestored = restoreRuntimeBootstrapPersistenceSynchronously(
                    preferences,
                    previousRuntimeBootstrap,
                    previousApiBaseUrl
                );
            } catch (RuntimeException rollbackFailure) {
                tokenStorage.clearToken();
                throw rollbackFailure;
            }
            if (!persistenceRestored) {
                tokenStorage.clearToken();
            }
            return false;
        }

        tokenStorage.clearToken();

        return true;
    }

    static boolean clearRuntimeBootstrapStateWithPushRollback(
        SharedPreferences preferences,
        TokenStorage tokenStorage,
        String previousToken,
        AndroidPushRuntimeManager androidPushRuntimeManager,
        AndroidPushRuntimeMetadata previousPushRuntime
    ) throws TokenStorageException {
        return clearRuntimeBootstrapStateWithPushRollback(
            preferences,
            tokenStorage,
            previousToken,
            () -> androidPushRuntimeManager.applyWithRollback(null, previousPushRuntime)
        );
    }

    static boolean clearRuntimeBootstrapStateWithPushRollback(
        SharedPreferences preferences,
        TokenStorage tokenStorage,
        String previousToken,
        Runnable pushCleanup
    ) throws TokenStorageException {
        String previousRuntimeBootstrap = preferences.getString(
            RUNTIME_BOOTSTRAP_PREFERENCE_KEY,
            null
        );
        String previousApiBaseUrl = preferences.getString(API_BASE_URL_PREFERENCE_KEY, null);
        if (!clearRuntimeBootstrapState(preferences, tokenStorage)) {
            return false;
        }

        try {
            pushCleanup.run();
            return true;
        } catch (RuntimeException exception) {
            final boolean persistenceRestored;
            try {
                persistenceRestored = restoreRuntimeBootstrapPersistenceSynchronously(
                    preferences,
                    previousRuntimeBootstrap,
                    previousApiBaseUrl
                );
            } catch (RuntimeException rollbackException) {
                exception.addSuppressed(rollbackException);
                throw exception;
            }
            if (persistenceRestored && previousToken != null) {
                try {
                    tokenStorage.saveToken(previousToken);
                } catch (TokenStorageException tokenException) {
                    tokenException.addSuppressed(exception);
                    throw tokenException;
                }
            }
            if (!persistenceRestored) {
                exception.addSuppressed(new IllegalStateException(
                    "Failed to restore Android runtime bootstrap after push cleanup failure"
                ));
            }
            throw exception;
        }
    }

    static String readStoredTokenForRuntimeMutation(TokenStorage tokenStorage) {
        try {
            return tokenStorage.getToken();
        } catch (TokenStorageException ignored) {
            return null;
        }
    }

    static void revokeNativeAuthenticationAfterRuntimeClear(
        String token,
        String apiOrigin,
        NativeAuthenticationRevoker revoker
    ) {
        String normalizedApiOrigin = apiOrigin == null ? "" : apiOrigin.trim();
        if (normalizedApiOrigin.isEmpty() || token == null || token.trim().isEmpty()) {
            return;
        }

        try {
            revoker.revoke(normalizedApiOrigin, token);
        } catch (IOException | JSONException | NativeAuthHttpException | RuntimeException ignored) {
            // Runtime reset remains available offline; server logout is best-effort.
        }
    }

    static boolean restoreRuntimeBootstrapPersistenceSynchronously(
        SharedPreferences preferences,
        String previousRuntimeBootstrap,
        String previousApiBaseUrl
    ) {
        SharedPreferences.Editor editor = preferences.edit();

        if (previousRuntimeBootstrap == null || previousRuntimeBootstrap.trim().isEmpty()) {
            editor.remove(RUNTIME_BOOTSTRAP_PREFERENCE_KEY);
        } else {
            editor.putString(RUNTIME_BOOTSTRAP_PREFERENCE_KEY, previousRuntimeBootstrap);
        }
        if (previousApiBaseUrl == null || previousApiBaseUrl.trim().isEmpty()) {
            editor.remove(API_BASE_URL_PREFERENCE_KEY);
        } else {
            editor.putString(API_BASE_URL_PREFERENCE_KEY, previousApiBaseUrl);
        }

        return editor.commit();
    }

    private boolean persistRuntimeBootstrap(JSObject bootstrap) {
        return getNativeAuthPreferences()
            .edit()
            .putString(RUNTIME_BOOTSTRAP_PREFERENCE_KEY, bootstrap.toString())
            .remove(API_BASE_URL_PREFERENCE_KEY)
            .commit();
    }

    static JSObject buildRuntimeBootstrapPayload(JSObject bootstrap) {
        JSObject payload = new JSObject();

        if (bootstrap == null) {
            payload.put("configured", false);
            return payload;
        }

        payload.put("configured", true);
        payload.put("bootstrap", bootstrap);

        return payload;
    }

    private JSObject getPersistedRuntimeBootstrap() {
        return loadPersistedRuntimeBootstrap(getNativeAuthPreferences());
    }

    private void restoreAndroidPushIdentityBinding(JSObject bootstrap) {
        if (bootstrap == null) {
            androidPushRegistrationManager.clearRuntime(null);
            return;
        }
        try {
            AndroidPushRegistrationManager.RebindResult rebind =
                androidPushRegistrationManager.restoreRuntime(
                    bootstrap.getString("apiOrigin"),
                    AndroidPushRuntimeMetadata.fromBootstrap(
                        bootstrap.optJSONObject("androidPush")
                    )
                );
            String authToken = readStoredTokenForRuntimeMutation(tokenStorage);
            if (rebind.hasPreviousRevocationAuthority(authToken)) {
                scheduleAndroidPushAfterAuthentication(
                    taskExecutor,
                    cancellation -> androidPushRegistrationManager.revokePrevious(
                        rebind,
                        authToken,
                        cancellation
                    ),
                    androidPushRegistrationManager::onProtectedStateError,
                    androidPushRegistrationManager::onRegistrationSchedulingError
                );
            } else if (androidPushRegistrationManager.hasPendingRevocationAuthority(
                authToken
            )) {
                submitNativePushTaskWithoutRetryMarker(
                    taskExecutor,
                    () -> androidPushRegistrationManager.onAuthenticated(authToken)
                );
            }
        } catch (TokenStorageException exception) {
            androidPushRegistrationManager.clearRuntime(null);
            throw new IllegalStateException(
                "Failed to restore protected Android push binding",
                exception
            );
        }
    }

    static boolean shouldSchedulePreviousPushRevocation(
        boolean hasPreviousBinding,
        String authToken
    ) {
        return hasPreviousBinding
            && authToken != null
            && !authToken.trim().isEmpty();
    }

    private void applyAndroidPushRuntimeRebind(
        String nextApiBaseUrl,
        AndroidPushRuntimeMetadata nextPushRuntime,
        AndroidPushRuntimeMetadata previousPushRuntime,
        String previousToken,
        NativeAuthHttpClient.CancellationSignal cancellation
    ) {
        AndroidPushRegistrationManager.RebindResult rebind = null;
        boolean runtimeApplied = false;
        try {
            rebind = androidPushRegistrationManager.rebindRuntime(
                nextApiBaseUrl,
                nextPushRuntime,
                previousToken
            );
            androidPushRuntimeManager.applyWithRollback(
                nextPushRuntime,
                previousPushRuntime
            );
            runtimeApplied = true;
            androidPushRegistrationManager.revokePrevious(
                rebind,
                previousToken,
                cancellation
            );
        } catch (TokenStorageException exception) {
            rollbackAndroidPushRebind(rebind, exception);
            throw new IllegalStateException(
                "Failed to persist protected Android push binding",
                exception
            );
        } catch (RuntimeException exception) {
            if (runtimeApplied) {
                try {
                    androidPushRuntimeManager.applyWithRollback(
                        previousPushRuntime,
                        nextPushRuntime
                    );
                } catch (RuntimeException rollbackException) {
                    exception.addSuppressed(rollbackException);
                }
            }
            rollbackAndroidPushRebind(rebind, exception);
            throw exception;
        }
    }

    private void rollbackAndroidPushRebind(
        AndroidPushRegistrationManager.RebindResult rebind,
        Exception failure
    ) {
        try {
            androidPushRegistrationManager.rollbackRebind(rebind);
        } catch (TokenStorageException rollbackException) {
            failure.addSuppressed(rollbackException);
        }
    }

    static JSObject loadPersistedRuntimeBootstrap(SharedPreferences preferences) {
        String rawBootstrap = preferences.getString(RUNTIME_BOOTSTRAP_PREFERENCE_KEY, null);

        if (rawBootstrap == null || rawBootstrap.trim().isEmpty()) {
            return null;
        }

        try {
            return normalizeRuntimeBootstrap(new JSONObject(rawBootstrap));
        } catch (JSONException | ConfiguredApiBaseUrlException | InvalidRuntimeBootstrapException exception) {
            preferences.edit().remove(RUNTIME_BOOTSTRAP_PREFERENCE_KEY).apply();
            return null;
        }
    }

    static JSObject buildRuntimeBootstrap(
        String instanceDisplayName,
        String apiOrigin,
        String rawApiBaseUrl,
        JSONObject androidPush,
        JSONObject features
    ) throws JSONException {
        JSObject bootstrap = new JSObject();
        bootstrap.put("instanceDisplayName", instanceDisplayName);
        bootstrap.put("apiOrigin", apiOrigin);
        bootstrap.put("rawApiBaseUrl", rawApiBaseUrl);

        if (androidPush != null) {
            bootstrap.put("androidPush", androidPush);
        }

        if (features != null) {
            bootstrap.put("features", features);
        }

        return normalizeRuntimeBootstrap(bootstrap);
    }

    static JSObject normalizeRuntimeBootstrap(JSONObject bootstrap)
        throws JSONException, ConfiguredApiBaseUrlException, InvalidRuntimeBootstrapException {
        if (bootstrap == null) {
            throw new InvalidRuntimeBootstrapException(
                "Android runtime bootstrap is missing",
                "RUNTIME_BOOTSTRAP_INVALID"
            );
        }

        String instanceDisplayName = normalizeRequiredString(
            bootstrap.optString("instanceDisplayName", null),
            "Android runtime bootstrap requires an instance display name"
        );
        String rawApiBaseUrl = normalizeRequiredString(
            firstNonBlank(bootstrap.optString("rawApiBaseUrl", null), bootstrap.optString("apiOrigin", null)),
            "Android runtime bootstrap requires a raw API base URL"
        );
        if (!isBoundedValue(instanceDisplayName, MAX_RUNTIME_DISPLAY_NAME_CHARACTERS)
            || !isBoundedValue(rawApiBaseUrl, MAX_RUNTIME_URL_CHARACTERS)) {
            throw new InvalidRuntimeBootstrapException(
                "Android runtime bootstrap exceeds the allowed size",
                "RUNTIME_BOOTSTRAP_INVALID"
            );
        }
        String canonicalApiOrigin = resolveCanonicalBootstrapApiOrigin(
            firstNonBlank(bootstrap.optString("apiOrigin", null), rawApiBaseUrl)
        );

        JSONObject features = bootstrap.optJSONObject("features");
        JSObject normalized = new JSObject();
        normalized.put("instanceDisplayName", instanceDisplayName);
        normalized.put("apiOrigin", canonicalApiOrigin);
        normalized.put("rawApiBaseUrl", rawApiBaseUrl.trim());

        JSObject normalizedFeatures = new JSObject();
        normalizedFeatures.put(
            "passwordLoginEnabled",
            features != null && features.optBoolean("passwordLoginEnabled", false)
        );
        normalizedFeatures.put(
            "passkeyLoginEnabled",
            features != null && features.optBoolean("passkeyLoginEnabled", false)
        );
        normalized.put("features", normalizedFeatures);

        AndroidPushRuntimeMetadata androidPush = AndroidPushRuntimeMetadata.fromBootstrap(
            bootstrap.optJSONObject("androidPush")
        );

        if (androidPush != null) {
            normalized.put("androidPush", androidPush.toJsObject());
        }

        return normalized;
    }

    static String normalizeRequiredString(String value, String message)
        throws InvalidRuntimeBootstrapException {
        if (value == null || value.trim().isEmpty()) {
            throw new InvalidRuntimeBootstrapException(message, "RUNTIME_BOOTSTRAP_INVALID");
        }

        return value.trim();
    }

    static String firstNonBlank(String preferred, String fallback) {
        if (preferred != null && !preferred.trim().isEmpty()) {
            return preferred;
        }

        return fallback;
    }

    private SharedPreferences getNativeAuthPreferences() {
        return getContext().getSharedPreferences(NATIVE_AUTH_PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    private void maybeClearToken(Exception exception) {
        if (exception instanceof NativeAuthHttpException) {
            NativeAuthHttpException httpException = (NativeAuthHttpException) exception;

            if (httpException.getStatusCode() == 401) {
                taskExecutor.invalidateAndRunSessionMutation(tokenStorage::clearToken);
            }
        }
    }

    private void requireNetworkConnection() throws NetworkUnavailableException {
        if (!networkState.isNetworkAvailable(getContext())) {
            throw new NetworkUnavailableException(
                "Android auth requires an active internet connection"
            );
        }
    }

    static final class ConfiguredApiBaseUrlException extends IllegalStateException {
        private final String errorCode;

        ConfiguredApiBaseUrlException(String message, String errorCode, Throwable cause) {
            super(message, cause);
            this.errorCode = errorCode;
        }

        ConfiguredApiBaseUrlException(String message, String errorCode) {
            super(message);
            this.errorCode = errorCode;
        }

        String getErrorCode() {
            return errorCode;
        }
    }

    static final class InvalidRuntimeBootstrapException extends IllegalStateException {
        private final String errorCode;

        InvalidRuntimeBootstrapException(String message, String errorCode) {
            super(message);
            this.errorCode = errorCode;
        }

        String getErrorCode() {
            return errorCode;
        }
    }
}
