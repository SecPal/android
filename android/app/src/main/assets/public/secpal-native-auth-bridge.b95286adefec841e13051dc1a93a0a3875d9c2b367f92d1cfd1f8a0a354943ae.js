
(function () {
  if (globalThis.__SecPalNativeAuthBootstrapInstalled) {
    return;
  }

  const fallbackApiOrigin = "https://runtime-bootstrap-required.secpal.dev";
  const nativeAuthLogoutEventName = "secpal:native-auth-logout";
  const nativeAuthLifecycleChangedEventName = "nativeAuthLifecycleChanged";
  const authVaultStateStorageKey = "auth_vault_state";
  const runtimeResetPendingStorageKey =
    "secpal-android-runtime-reset-pending";
  const incompatibleVaultWrapperKind = "native-device-bound";
  const currentBootstrapVersion = "v1";
  const currentBootstrapSchemaVersion = 4;
  const maxAndroidPushMetadataRevision = 2147483647;
  const maxNativeAuthRequestBodyBytes = 12 * 1024 * 1024;
  const maxNativeAuthRequestBodyBase64Characters =
    Math.ceil(maxNativeAuthRequestBodyBytes / 3) * 4;
  const baseNativeAuthRequestLifetimeMillis = 30_000;
  const minimumNativeAuthUploadBytesPerSecond = 64 * 1024;
  const nativeAuthUploadDeadlineOverheadMillis = 15_000;
  const nativeAuthReadTimeoutMillis = 15_000;
  const nativeAuthTotalDeadlineOverheadMillis = 5_000;
  const maxQueuedNativeFetches = 8;
  const queuedNativeFetches = [];
  let activeNativeFetch = null;
  let nativeFetchSessionTransitions = 0;
  let nativeFetchBackgrounded = false;
  const nativeSetTimeout = globalThis.setTimeout?.bind(globalThis);
  const nativeClearTimeout = globalThis.clearTimeout?.bind(globalThis);
  const nativeNow = Date.now.bind(Date);
  if (!nativeSetTimeout || !nativeClearTimeout) {
    throw new Error("Android native auth requires WebView timer support.");
  }
  const androidPushInstallationIdStorageKeyPrefix =
    "secpal-android-push-installation:";
  const androidPushTokenStorageKeyPrefix = "secpal-android-push-token:";
  const androidPushTokenAppStorageKeyPrefix =
    "secpal-android-push-token-app:";
  const androidPushTokenSavedAtStorageKeyPrefix =
    "secpal-android-push-token-saved-at:";
  const androidPushInstallationIdUnavailableErrorCode =
    "ANDROID_PUSH_INSTALLATION_ID_UNAVAILABLE";
  const minAndroidPushTokenLength = 32;
  const androidPushDeviceName = "SecPal Android";
  const androidPushRuntimeAppName = "secpal-runtime-push";
  const passkeyCapabilityUnavailableReason = "PASSKEY_CAPABILITY_UNAVAILABLE";
  function normalizeAndroidPushDisabledError(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const code = typeof value.code === "string" ? value.code.trim() : "";
    const message = typeof value.message === "string" ? value.message.trim() : "";
    const apiOrigin =
      typeof value.apiOrigin === "string" && value.apiOrigin.trim().length > 0
        ? value.apiOrigin.trim()
        : null;

    if (
      code !== androidPushInstallationIdUnavailableErrorCode ||
      message.length === 0 ||
      value.retryable !== false
    ) {
      return null;
    }

    return {
      apiOrigin,
      code,
      message,
      retryable: false,
    };
  }

  function createAndroidPushInstallationIdUnavailableError(apiOrigin) {
    const error = new Error(
      "Android push device registration is disabled because secure UUID generation is unavailable."
    );

    error.name = "SecPalAndroidPushRegistrationError";
    error.code = androidPushInstallationIdUnavailableErrorCode;
    error.apiOrigin =
      typeof apiOrigin === "string" && apiOrigin.trim().length > 0
        ? apiOrigin.trim()
        : null;
    error.retryable = false;

    return error;
  }

  const maxCanonicalPushTokenSavedAt = 253402300799000;

  const isPushTokenSavedAtValueUsable = (value) =>
    Number.isFinite(value) &&
    value >= 0 &&
    value <= maxCanonicalPushTokenSavedAt;

  const getPushTokenSavedAtOrderingValue = (value) => {
    if (typeof value === "number") {
      return isPushTokenSavedAtValueUsable(value)
        ? Math.trunc(value)
        : -1;
    }

    if (typeof value !== "string") {
      return -1;
    }

    const trimmedValue = value.trim();

    if (trimmedValue.length === 0) {
      return -1;
    }

    if (/^\d+$/.test(trimmedValue)) {
      const parsedLegacyValue = Number(trimmedValue);

      return isPushTokenSavedAtValueUsable(parsedLegacyValue)
        ? Math.trunc(parsedLegacyValue)
        : -1;
    }

    const parsedTimestamp = Date.parse(trimmedValue);

    return isPushTokenSavedAtValueUsable(parsedTimestamp)
      ? Math.trunc(parsedTimestamp)
      : -1;
  };

  const normalizePushTokenSavedAt = (value) => {
    const orderingValue = getPushTokenSavedAtOrderingValue(value);

    return orderingValue >= 0
      ? Math.trunc(orderingValue / 1000) * 1000
      : -1;
  };

  const serializePushTokenSavedAt = (value) => {
    const normalizedSavedAt = normalizePushTokenSavedAt(value);
    const effectiveSavedAt =
      normalizedSavedAt >= 0 ? normalizedSavedAt : getCurrentPushTokenSavedAt();
    const isoString = new Date(effectiveSavedAt).toISOString();

    return isoString.endsWith(".000Z")
      ? isoString.slice(0, -5) + "Z"
      : isoString;
  };

  const authState = globalThis.__SecPalNativeAuthState ?? { active: false };
  globalThis.__SecPalNativeAuthState = authState;
  authState.nativeFetchGeneration = Number.isSafeInteger(
    authState.nativeFetchGeneration
  )
    ? authState.nativeFetchGeneration
    : 0;
  const runtimeState = globalThis.__SecPalRuntimeDiscoveryState ?? {
    configured: false,
    bootstrap: null,
    apiOrigin: null,
    pendingBootstrap: null,
    nativeConfigPromise: Promise.resolve(),
  };
  globalThis.__SecPalRuntimeDiscoveryState = runtimeState;
  const androidPushSyncState = globalThis.__SecPalAndroidPushSyncState ?? {};
  globalThis.__SecPalAndroidPushSyncState = androidPushSyncState;
  runtimeState.bootstrapEpoch = Number.isSafeInteger(runtimeState.bootstrapEpoch)
    ? runtimeState.bootstrapEpoch
    : 0;
  runtimeState.bootstrapMutationPromise = runtimeState.bootstrapMutationPromise ?? Promise.resolve();
  runtimeState.bootstrapWriteInFlight = runtimeState.bootstrapWriteInFlight === true;
  androidPushSyncState.currentToken =
    typeof androidPushSyncState.currentToken === "string" &&
    androidPushSyncState.currentToken.trim().length >= minAndroidPushTokenLength
      ? androidPushSyncState.currentToken.trim()
      : null;
  androidPushSyncState.currentTokenSourceAppName =
    typeof androidPushSyncState.currentTokenSourceAppName === "string" &&
    androidPushSyncState.currentTokenSourceAppName.trim().length > 0
      ? androidPushSyncState.currentTokenSourceAppName.trim()
      : null;
  androidPushSyncState.currentTokenSavedAt = normalizePushTokenSavedAt(
    androidPushSyncState.currentTokenSavedAt
  );
  if (androidPushSyncState.currentToken === null) {
    androidPushSyncState.currentTokenSourceAppName = null;
    androidPushSyncState.currentTokenSavedAt = -1;
  }
  androidPushSyncState.lastSyncedToken =
    typeof androidPushSyncState.lastSyncedToken === "string" &&
    androidPushSyncState.lastSyncedToken.trim().length >= minAndroidPushTokenLength
      ? androidPushSyncState.lastSyncedToken.trim()
      : null;
  androidPushSyncState.lastSyncedApiOrigin =
    typeof androidPushSyncState.lastSyncedApiOrigin === "string" &&
    androidPushSyncState.lastSyncedApiOrigin.trim().length > 0
      ? androidPushSyncState.lastSyncedApiOrigin.trim()
      : null;
  androidPushSyncState.lastSyncedMetadataRevision = Number.isInteger(
    androidPushSyncState.lastSyncedMetadataRevision
  )
    ? Number(androidPushSyncState.lastSyncedMetadataRevision)
    : null;
  androidPushSyncState.suspended = androidPushSyncState.suspended === true;
  androidPushSyncState.installationIds =
    androidPushSyncState.installationIds &&
    typeof androidPushSyncState.installationIds === "object"
      ? androidPushSyncState.installationIds
      : {};
  androidPushSyncState.disabledError = normalizeAndroidPushDisabledError(
    androidPushSyncState.disabledError
  );
  androidPushSyncState.syncPromise = Promise.resolve(
    androidPushSyncState.syncPromise
  ).catch(() => undefined);
  const cloneAndroidPushDisabledError = (value) => {
    const normalized = normalizeAndroidPushDisabledError(value);

    return normalized ? { ...normalized } : null;
  };
  const getAndroidPushRegistrationState = () => {
    return {
      disabledError: cloneAndroidPushDisabledError(
        androidPushSyncState.disabledError
      ),
    };
  };
  const getPlugin = () => {
    const plugin = globalThis.Capacitor?.Plugins?.SecPalNativeAuth;
    if (!plugin) {
      throw new Error("SecPal native auth plugin is unavailable");
    }
    return plugin;
  };

  const getPasskeyCapabilities = async () => {
    const plugin = getPlugin();

    if (typeof plugin.getPasskeyCapabilities !== "function") {
      return {
        passkeysAvailable: false,
        reason: passkeyCapabilityUnavailableReason,
      };
    }

    const capabilities = await plugin.getPasskeyCapabilities();
    return capabilities && typeof capabilities === "object"
      ? capabilities
      : {
          passkeysAvailable: false,
          reason: passkeyCapabilityUnavailableReason,
        };
  };

  const requirePasskeyCapabilities = async () => {
    const capabilities = await getPasskeyCapabilities();

    if (capabilities.passkeysAvailable === true) {
      return;
    }

    const error = new Error("Passkeys are unavailable on this Android device.");
    error.code =
      typeof capabilities.reason === "string" && capabilities.reason.length > 0
        ? capabilities.reason
        : passkeyCapabilityUnavailableReason;
    throw error;
  };

  const getEnterprisePlugin = () => {
    const plugin = globalThis.Capacitor?.Plugins?.SecPalEnterprise;
    if (!plugin) {
      throw new Error("SecPal enterprise plugin is unavailable");
    }
    return plugin;
  };

  const getLocalStorage = () => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };

  const getSessionStorage = () => {
    try {
      return globalThis.sessionStorage ?? null;
    } catch {
      return null;
    }
  };

  const hasPendingRuntimeReset = () => {
    const storage = getLocalStorage();

    if (!storage || typeof storage.getItem !== "function") {
      return false;
    }

    try {
      return storage.getItem(runtimeResetPendingStorageKey) === "1";
    } catch {
      return false;
    }
  };

  const markRuntimeResetPending = () => {
    const storage = getLocalStorage();

    if (
      !storage ||
      typeof storage.setItem !== "function" ||
      typeof storage.getItem !== "function"
    ) {
      throw new Error("Android runtime reset recovery storage is unavailable.");
    }

    try {
      storage.setItem(runtimeResetPendingStorageKey, "1");
      if (storage.getItem(runtimeResetPendingStorageKey) !== "1") {
        throw new Error("Android runtime reset recovery marker was not persisted.");
      }
    } catch (error) {
      throw new Error("Android runtime reset recovery marker was not persisted.", {
        cause: error,
      });
    }
  };

  const clearPendingRuntimeReset = () => {
    const storage = getLocalStorage();

    if (!storage || typeof storage.removeItem !== "function") {
      return;
    }

    try {
      storage.removeItem(runtimeResetPendingStorageKey);
    } catch {
      // A stale marker is reconciled against native state on the next startup.
    }
  };

  const clearPersistedBootstrap = async () => {
    const plugin = getPlugin();
    if (typeof plugin.confirmRuntimeReset === "function") {
      const apiOrigin =
        typeof runtimeState.apiOrigin === "string" ? runtimeState.apiOrigin.trim() : "";
      const installationId = apiOrigin ? getStoredPushInstallationId(apiOrigin) : null;
      markRuntimeResetPending();
      try {
        await plugin.confirmRuntimeReset(
          installationId ? { androidPushInstallationId: installationId } : {}
        );
      } catch (error) {
        clearPendingRuntimeReset();
        throw error;
      }
      return;
    }

    throw new Error("Android native-confirmed runtime reset is unavailable.");
  };

  const clearSessionStorage = () => {
    const storage = getSessionStorage();

    if (!storage || typeof storage.clear !== "function") {
      throw new Error("Android runtime reset session cleanup is unavailable.");
    }

    storage.clear();
  };

  const clearLocalStoragePreservingLocale = () => {
    const storage = getLocalStorage();

    if (!storage || typeof storage.clear !== "function") {
      throw new Error("Android runtime reset local cleanup is unavailable.");
    }

    let locale = null;
    let resetPending = false;
    try {
      locale =
        typeof storage.getItem === "function"
          ? storage.getItem("secpal-locale")
          : null;
      resetPending =
        typeof storage.getItem === "function" &&
        storage.getItem(runtimeResetPendingStorageKey) === "1";
    } catch {
      throw new Error("Android runtime reset browser cleanup failed.");
    }

    storage.clear();

    if (resetPending) {
      if (typeof storage.setItem !== "function") {
        throw new Error("Android runtime reset browser cleanup failed.");
      }
      storage.setItem(runtimeResetPendingStorageKey, "1");
    }

    if (locale !== null && typeof storage.setItem === "function") {
      try {
        storage.setItem("secpal-locale", locale);
      } catch {
        // Locale restoration is best-effort during destructive resets.
      }
    }
  };

  const clearCacheStorage = async () => {
    const cacheStorage = globalThis.caches;

    if (
      !cacheStorage ||
      typeof cacheStorage.keys !== "function" ||
      typeof cacheStorage.delete !== "function"
    ) {
      return;
    }

    const cacheNames = await cacheStorage.keys();
    const deletions = await Promise.all(
      (Array.isArray(cacheNames) ? cacheNames : []).map((cacheName) =>
        Promise.resolve(cacheStorage.delete(cacheName))
      )
    );
    if (deletions.some((deleted) => deleted !== true)) {
      throw new Error("Android runtime reset cache cleanup failed.");
    }
  };

  const deleteIndexedDatabase = (indexedDb, databaseName) =>
    new Promise((resolve, reject) => {
      let request;

      try {
        request = indexedDb.deleteDatabase(databaseName);
      } catch (error) {
        reject(error);
        return;
      }

      if (!request || typeof request !== "object") {
        reject(new Error("Android runtime reset IndexedDB cleanup failed."));
        return;
      }

      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error("Android runtime reset IndexedDB cleanup failed."));
      request.onblocked = () =>
        reject(new Error("Android runtime reset IndexedDB cleanup was blocked."));
    });

  const clearIndexedDatabases = async () => {
    const indexedDb = globalThis.indexedDB;

    if (
      !indexedDb ||
      typeof indexedDb.deleteDatabase !== "function" ||
      typeof indexedDb.databases !== "function"
    ) {
      return;
    }

    const databases = await indexedDb.databases();

    const databaseNames = Array.isArray(databases)
      ? databases
          .map((database) =>
            database && typeof database.name === "string" ? database.name : null
          )
          .filter(
            (databaseName) =>
              typeof databaseName === "string" && databaseName.length > 0
          )
      : [];

    await Promise.all(
      databaseNames.map((databaseName) =>
        deleteIndexedDatabase(indexedDb, databaseName)
      )
    );
  };

  const clearServiceWorkers = async () => {
    const serviceWorker = globalThis.navigator?.serviceWorker;

    if (!serviceWorker || typeof serviceWorker.getRegistrations !== "function") {
      return;
    }

    const registrations = await serviceWorker.getRegistrations();
    const removals = await Promise.all(
      (Array.isArray(registrations) ? registrations : []).map((registration) =>
        typeof registration?.unregister === "function"
          ? Promise.resolve(registration.unregister())
          : false
      )
    );
    if (removals.some((removed) => removed !== true)) {
      throw new Error("Android runtime reset service-worker cleanup failed.");
    }
  };

  const clearTenantScopedBrowserState = async () => {
    clearSessionStorage();
    clearLocalStoragePreservingLocale();
    await Promise.all([
      clearCacheStorage(),
      clearIndexedDatabases(),
      clearServiceWorkers(),
    ]);
  };

  const recoverPendingRuntimeResetOnStartup = async (bootstrapEpoch) => {
    if (!hasPendingRuntimeReset()) {
      return false;
    }

    let restored;
    try {
      restored = await loadPersistedBootstrap();
    } catch {
      restored = await loadPersistedBootstrap();
    }

    if (runtimeState.bootstrapEpoch !== bootstrapEpoch) {
      return false;
    }

    if (restored) {
      clearPendingRuntimeReset();
      return false;
    }

    try {
      await completeConfirmedRuntimeReset({ reloadOnFailure: false });
    } catch (error) {
      console.warn(
        "Failed to finish interrupted Android runtime-reset browser cleanup.",
        error
      );
    }
    return true;
  };

  const hasIncompatibleNativeDeviceBoundVaultWrapper = (
    value,
    visited = new Set()
  ) => {
    if (!value || typeof value !== "object") {
      return false;
    }

    if (visited.has(value)) {
      return false;
    }

    visited.add(value);

    const wrapper =
      !Array.isArray(value) &&
      value.wrapper &&
      typeof value.wrapper === "object"
        ? value.wrapper
        : null;
    const wrapperKind =
      wrapper && typeof wrapper.kind === "string" ? wrapper.kind.trim() : "";

    if (wrapperKind === incompatibleVaultWrapperKind) {
      return true;
    }

    if (Array.isArray(value)) {
      return value.some((entry) =>
        hasIncompatibleNativeDeviceBoundVaultWrapper(entry, visited)
      );
    }

    return Object.values(value).some((entry) =>
      hasIncompatibleNativeDeviceBoundVaultWrapper(entry, visited)
    );
  };

  const hasIncompatibleNativeDeviceBoundVaultState = () => {
    const storage = getLocalStorage();

    if (!storage) {
      return false;
    }

    let rawValue;

    try {
      rawValue = storage.getItem(authVaultStateStorageKey);
    } catch {
      return false;
    }

    if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
      return false;
    }

    try {
      return hasIncompatibleNativeDeviceBoundVaultWrapper(JSON.parse(rawValue));
    } catch {
      return false;
    }
  };

  const clearIncompatibleNativeDeviceBoundVaultStateOnStartup = async (bootstrapEpoch) => {
    if (!hasIncompatibleNativeDeviceBoundVaultState()) {
      return false;
    }

    try {
      await clearPersistedBootstrap();
    } catch (error) {
      console.warn(
        "Failed to clear persisted bootstrap for incompatible Android offline vault state.",
        error
      );
      return false;
    }

    if (runtimeState.bootstrapEpoch !== bootstrapEpoch) {
      return false;
    }

    try {
      await completeConfirmedRuntimeReset({ reloadOnFailure: false });
    } catch (error) {
      console.warn(
        "Failed to finish incompatible Android offline-vault browser cleanup.",
        error
      );
    }
    console.warn(
      "Cleared incompatible Android offline vault state that required the removed native-device-bound wrapper bridge."
    );

    return true;
  };

  const createIncompatibleBootstrapError = () =>
    new Error("Android runtime bootstrap is incompatible.");

  const normalizeStoredBootstrap = (parsed) => {
    const instanceDisplayName =
      parsed && typeof parsed === "object" && typeof parsed.instanceDisplayName === "string"
        ? parsed.instanceDisplayName.trim()
        : "";
    const androidPush = normalizeBootstrapAndroidPush(
      parsed && typeof parsed === "object" ? parsed.androidPush ?? null : null,
      parsed && typeof parsed === "object" ? parsed.androidPush != null : false
    );

    if (!instanceDisplayName) {
      throw createIncompatibleBootstrapError();
    }

    const restored = {
      instanceDisplayName,
      apiOrigin: normalizeBootstrapApiBaseUrl(parsed.apiOrigin ?? parsed.rawApiBaseUrl),
      rawApiBaseUrl:
        parsed && typeof parsed === "object" && typeof parsed.rawApiBaseUrl === "string"
          ? parsed.rawApiBaseUrl
          : String(parsed.apiOrigin ?? ""),
      features: {
        passwordLoginEnabled:
          parsed && typeof parsed === "object" && parsed.features && typeof parsed.features === "object"
            ? parsed.features.passwordLoginEnabled === true
            : false,
        passkeyLoginEnabled:
          parsed && typeof parsed === "object" && parsed.features && typeof parsed.features === "object"
            ? parsed.features.passkeyLoginEnabled === true
            : false,
      },
      ...(androidPush ? { androidPush } : {}),
    };

    return restored;
  };

  const normalizeLoadedBootstrapState = (value) => {
    if (!value || typeof value !== "object") {
      return null;
    }

    if (typeof value.instanceDisplayName === "string") {
      const bootstrap = normalizeStoredBootstrap(value);
      return {
        apiOrigin: bootstrap.apiOrigin,
        bootstrap,
      };
    }

    return null;
  };

  const unwrapRuntimeBootstrapPayload = (value) => {
    if (!value || typeof value !== "object") {
      return null;
    }

    if ("configured" in value) {
      if (value.configured !== true) {
        return null;
      }

      if (value.bootstrap && typeof value.bootstrap === "object") {
        return value.bootstrap;
      }

      return null;
    }

    return value;
  };

  const loadPersistedBootstrap = async () => {
    const plugin = getPlugin();

    if (typeof plugin.getRuntimeBootstrap === "function") {
      const payload = await plugin.getRuntimeBootstrap();
      const bootstrap = unwrapRuntimeBootstrapPayload(payload);

      return bootstrap ? normalizeLoadedBootstrapState(bootstrap) : null;
    }

    return null;
  };

  const persistBootstrap = async (bootstrap) => {
    const plugin = getPlugin();

    if (typeof plugin.confirmRuntimeBootstrap === "function") {
      await plugin.confirmRuntimeBootstrap(bootstrap);
      return;
    }

    throw new Error("Android native-confirmed runtime selection is unavailable.");
  };

  const queueRuntimeBootstrapMutation = (operation) => {
    const previous = runtimeState.bootstrapMutationPromise.catch(() => {});
    const next = previous.then(operation);
    runtimeState.bootstrapMutationPromise = next.catch(() => {});
    return next;
  };

  const beginRuntimeBootstrapMutation = () => {
    invalidateScheduledNativeFetches();
    runtimeState.bootstrapEpoch += 1;
    return runtimeState.bootstrapEpoch;
  };

  const createSupersededBootstrapMutationError = () =>
    new Error("Android runtime-bootstrap mutation was superseded.");

  const createInvalidAndroidPushMetadataError = () =>
    new Error("Android runtime bootstrap push metadata is invalid.");

  const normalizeBootstrapApiBaseUrl = (value) => {
    let url;

    try {
      url = new URL(value);
    } catch {
      throw new Error("Android runtime bootstrap API URL is invalid.");
    }

    if (url.protocol !== "https:") {
      throw new Error("Android runtime bootstrap API URL must use HTTPS.");
    }

    const pathname = url.pathname.replace(/\/+$/, "");

    if (pathname === "" || pathname === "/v1") {
      return url.origin;
    }

    throw new Error("Android runtime bootstrap API URL is incompatible.");
  };

  const getRuntimeInfo = async () => {
    const plugin = getPlugin();

    if (typeof plugin.getRuntimeInfo !== "function") {
      throw new Error("Android runtime information is unavailable.");
    }

    const result = await plugin.getRuntimeInfo();
    const appVersion =
      result && typeof result === "object" && typeof result.appVersion === "string"
        ? result.appVersion.trim()
        : "";
    const appBuild = result && typeof result === "object" ? Number(result.appBuild) : Number.NaN;

    if (!appVersion || !Number.isInteger(appBuild) || appBuild <= 0) {
      throw new Error("Android runtime information is unavailable.");
    }

    return { appVersion, appBuild };
  };

  const normalizeBootstrapAndroidPush = (value, required) => {
    if (value == null) {
      if (required) {
        throw createInvalidAndroidPushMetadataError();
      }

      return null;
    }

    if (!value || typeof value !== "object") {
      throw createInvalidAndroidPushMetadataError();
    }

    const provider =
      typeof value.provider === "string" ? value.provider.trim().toLowerCase() : "";

    if (provider !== "fcm") {
      throw createInvalidAndroidPushMetadataError();
    }

    const metadataRevision = Number(value.metadata_revision ?? value.metadataRevision);
    const publicClientMetadataSource =
      value.public_client_metadata && typeof value.public_client_metadata === "object"
        ? value.public_client_metadata
        : value.publicClientMetadata && typeof value.publicClientMetadata === "object"
          ? value.publicClientMetadata
          : null;

    if (
      !publicClientMetadataSource ||
      !Number.isInteger(metadataRevision) ||
      metadataRevision <= 0 ||
      metadataRevision > maxAndroidPushMetadataRevision
    ) {
      throw createInvalidAndroidPushMetadataError();
    }

    const apiKey =
      typeof publicClientMetadataSource.api_key === "string"
        ? publicClientMetadataSource.api_key.trim()
        : typeof publicClientMetadataSource.apiKey === "string"
          ? publicClientMetadataSource.apiKey.trim()
          : "";
    const projectId =
      typeof publicClientMetadataSource.project_id === "string"
        ? publicClientMetadataSource.project_id.trim()
        : typeof publicClientMetadataSource.projectId === "string"
          ? publicClientMetadataSource.projectId.trim()
          : "";
    const applicationId =
      typeof publicClientMetadataSource.application_id === "string"
        ? publicClientMetadataSource.application_id.trim()
        : typeof publicClientMetadataSource.applicationId === "string"
          ? publicClientMetadataSource.applicationId.trim()
          : "";
    const senderId =
      typeof publicClientMetadataSource.sender_id === "string"
        ? publicClientMetadataSource.sender_id.trim()
        : typeof publicClientMetadataSource.senderId === "string"
          ? publicClientMetadataSource.senderId.trim()
          : "";

    if (!apiKey || !projectId || !applicationId || !senderId) {
      throw createInvalidAndroidPushMetadataError();
    }

    return {
      provider: "fcm",
      metadataRevision,
      publicClientMetadata: {
        apiKey,
        projectId,
        applicationId,
        senderId,
      },
    };
  };

  const applyRuntimeBootstrap = async (bootstrap, bootstrapEpoch) => {
    if (runtimeState.bootstrapEpoch !== bootstrapEpoch) {
      throw createSupersededBootstrapMutationError();
    }
    if (hasPendingRuntimeReset()) {
      throw new Error("Android runtime reset recovery is still pending.");
    }
    runtimeState.pendingBootstrap = null;
    runtimeState.bootstrapWriteInFlight = true;
    const previousRuntime = {
      configured: runtimeState.configured,
      bootstrap: runtimeState.bootstrap,
      apiOrigin: runtimeState.apiOrigin,
    };

    runtimeState.nativeConfigPromise = (async () => {
      try {
        await persistBootstrap(bootstrap);
        if (runtimeState.bootstrapEpoch !== bootstrapEpoch) {
          throw createSupersededBootstrapMutationError();
        }
        runtimeState.configured = true;
        runtimeState.bootstrap = bootstrap;
        runtimeState.apiOrigin = bootstrap.apiOrigin;
        hydrateRetainedPushTokenState(bootstrap.apiOrigin);
      } catch (error) {
        if (runtimeState.bootstrapEpoch !== bootstrapEpoch) {
          throw error;
        }
        runtimeState.configured = previousRuntime.configured;
        runtimeState.bootstrap = previousRuntime.bootstrap;
        runtimeState.apiOrigin = previousRuntime.apiOrigin;
        throw error;
      }
    })();

    try {
      await runtimeState.nativeConfigPromise;
      return bootstrap.apiOrigin;
    } finally {
      runtimeState.bootstrapWriteInFlight = false;
    }
  };

  const restorePersistedBootstrap = () => {
    const bootstrapEpoch = runtimeState.bootstrapEpoch;
    runtimeState.nativeConfigPromise = queueRuntimeBootstrapMutation(async () => {
      if (await recoverPendingRuntimeResetOnStartup(bootstrapEpoch)) {
        return;
      }

      if (await clearIncompatibleNativeDeviceBoundVaultStateOnStartup(bootstrapEpoch)) {
        return;
      }

      if (runtimeState.bootstrapEpoch !== bootstrapEpoch) {
        return;
      }

      let plugin;

      try {
        plugin = getPlugin();
      } catch {
        return;
      }

      let hasNativeRestore = false;

      try {
        hasNativeRestore = typeof plugin.getRuntimeBootstrap === "function";
      } catch {
        return;
      }

      if (hasNativeRestore) {
        try {
          const restored = await loadPersistedBootstrap();

          if (runtimeState.bootstrapEpoch !== bootstrapEpoch) {
            return;
          }

          if (!restored) {
            return;
          }

          runtimeState.pendingBootstrap = null;
          runtimeState.configured = true;
          runtimeState.bootstrap = restored.bootstrap;
          runtimeState.apiOrigin = restored.apiOrigin;
          hydrateRetainedPushTokenState(restored.apiOrigin);
        } catch (error) {
          if (runtimeState.bootstrapEpoch !== bootstrapEpoch) {
            return;
          }

          await clearPersistedBootstrap().catch(() => {});
          runtimeState.configured = false;
          runtimeState.bootstrap = null;
          runtimeState.apiOrigin = null;
          runtimeState.pendingBootstrap = null;
          console.warn("Failed to restore persisted SecPal bootstrap.", error);
        }

        return;
      }
    });
  };

  const ensureRuntimeConfigured = async () => {
    await runtimeState.nativeConfigPromise;

    if (!runtimeState.configured || !runtimeState.apiOrigin) {
      throw new Error("This SecPal app is not configured for a deployment yet.");
    }

    return runtimeState.apiOrigin;
  };

  const createAbortError = () => {
    const error = new Error("The authenticated request was aborted.");
    error.name = "AbortError";
    return error;
  };

  const createRequestTooLargeError = () => {
    const error = new Error("The authenticated request exceeds the allowed size.");
    error.code = "NATIVE_AUTH_REQUEST_TOO_LARGE";
    return error;
  };

  const createNativeAuthBusyError = () => {
    const error = new Error("Android native auth is temporarily busy");
    error.code = "NATIVE_AUTH_BUSY";
    return error;
  };

  const createNativeAuthLifecycleError = (code) => {
    const message =
      code === "REQUEST_TIMEOUT"
        ? "Android authenticated request exceeded its lifetime limit"
        : code === "APP_BACKGROUNDED"
          ? "Android authenticated request was cancelled in the background"
          : "Android authenticated request belongs to an expired session";
    const error = new Error(message);
    error.code = code;
    return error;
  };

  const resolveNativeAuthRequestLifetimeMillis = (requestBodyBytes) => {
    if (requestBodyBytes <= 0) {
      return baseNativeAuthRequestLifetimeMillis;
    }
    const transferMillis = Math.ceil(
      (requestBodyBytes * 1000) / minimumNativeAuthUploadBytesPerSecond
    );
    const writeTimeoutMillis = Math.max(
      15_000,
      transferMillis + nativeAuthUploadDeadlineOverheadMillis
    );
    return Math.max(
      baseNativeAuthRequestLifetimeMillis,
      writeTimeoutMillis +
        nativeAuthReadTimeoutMillis +
        nativeAuthTotalDeadlineOverheadMillis
    );
  };

  const utf8ByteLength = (value) => {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit < 0x80) {
        bytes += 1;
      } else if (codeUnit < 0x800) {
        bytes += 2;
      } else if (
        codeUnit >= 0xd800 &&
        codeUnit <= 0xdbff &&
        index + 1 < value.length &&
        value.charCodeAt(index + 1) >= 0xdc00 &&
        value.charCodeAt(index + 1) <= 0xdfff
      ) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  };

  const getKnownRequestBodyBytes = (request, init) => {
    if (request.method === "GET" || request.method === "HEAD" || !request.body) {
      return 0;
    }
    const declaredLengthHeader = request.headers.get("Content-Length");
    if (declaredLengthHeader !== null && declaredLengthHeader.trim() !== "") {
      const declaredLength = Number(declaredLengthHeader);
      if (Number.isSafeInteger(declaredLength) && declaredLength >= 0) {
        return Math.min(declaredLength, maxNativeAuthRequestBodyBytes);
      }
    }
    const body = init?.body;
    if (typeof body === "string") {
      return utf8ByteLength(body);
    }
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      return body.byteLength;
    }
    if (typeof globalThis.Blob === "function" && body instanceof globalThis.Blob) {
      return body.size;
    }
    if (
      typeof globalThis.URLSearchParams === "function" &&
      body instanceof globalThis.URLSearchParams
    ) {
      return utf8ByteLength(body.toString());
    }
    return null;
  };

  const throwIfAborted = (signal) => {
    if (signal?.aborted) {
      throw createAbortError();
    }
  };

  const awaitWithAbort = (promise, signal) => {
    throwIfAborted(signal);
    if (!signal?.addEventListener) {
      return Promise.resolve(promise);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener?.("abort", abort);
        callback(value);
      };
      const abort = () => finish(reject, createAbortError());
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(promise).then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error)
      );
    });
  };

  const scheduleNativeFetch = (
    operation,
    callerSignal,
    submittedGeneration,
    initialLifetimeMillis
  ) => {
    throwIfAborted(callerSignal);
    return new Promise((resolve, reject) => {
      const startedAt = nativeNow();
      const lifecycleListeners = new Set();
      let lifecycleAborted = false;
      let deadline;
      let deadlineAt;
      let settled = false;
      const lifecycleSignal = {
        get aborted() {
          return lifecycleAborted;
        },
        addEventListener(type, listener) {
          if (type === "abort" && typeof listener === "function") {
            lifecycleListeners.add(listener);
          }
        },
        removeEventListener(type, listener) {
          if (type === "abort") {
            lifecycleListeners.delete(listener);
          }
        },
      };
      const abortOperation = () => {
        if (lifecycleAborted) {
          return;
        }
        lifecycleAborted = true;
        for (const listener of lifecycleListeners) {
          try {
            listener.call(lifecycleSignal, { type: "abort" });
          } catch {
            // Cancellation must continue through every registered listener.
          }
        }
        lifecycleListeners.clear();
      };
      const clearDeadline = () => {
        if (deadline !== undefined && nativeClearTimeout) {
          nativeClearTimeout(deadline);
        }
        deadline = undefined;
      };
      const removeQueuedEntry = () => {
        const index = queuedNativeFetches.indexOf(entry);
        if (index >= 0) {
          queuedNativeFetches.splice(index, 1);
        }
      };
      const settle = (callback, value) => {
        if (settled) {
          return false;
        }
        settled = true;
        clearDeadline();
        callerSignal?.removeEventListener?.("abort", abortForCaller);
        callback(value);
        return true;
      };
      const cancel = (error) => {
        if (settled) {
          return;
        }
        removeQueuedEntry();
        abortOperation();
        settle(reject, error);
      };
      const abortForCaller = () => cancel(createAbortError());
      const armDeadline = (lifetimeMillis) => {
        clearDeadline();
        deadlineAt = startedAt + lifetimeMillis;
        const remainingMillis = deadlineAt - nativeNow();
        if (remainingMillis <= 0) {
          cancel(createNativeAuthLifecycleError("REQUEST_TIMEOUT"));
          return;
        }
        if (nativeSetTimeout) {
          deadline = nativeSetTimeout(
            () => cancel(createNativeAuthLifecycleError("REQUEST_TIMEOUT")),
            remainingMillis
          );
        }
      };
      const entry = {
        cancelForLifecycle(reasonCode) {
          cancel(createNativeAuthLifecycleError(reasonCode));
        },
        start() {
          if (
            settled ||
            submittedGeneration !== authState.nativeFetchGeneration
          ) {
            entry.cancelForLifecycle("SESSION_INVALIDATED");
            return;
          }
          if (nativeNow() >= deadlineAt) {
            cancel(createNativeAuthLifecycleError("REQUEST_TIMEOUT"));
            return;
          }
          activeNativeFetch = entry;
          Promise.resolve()
            .then(() =>
              operation({
                signal: lifecycleSignal,
                updateRequestBodyBytes(requestBodyBytes) {
                  armDeadline(
                    resolveNativeAuthRequestLifetimeMillis(requestBodyBytes)
                  );
                  throwIfAborted(lifecycleSignal);
                },
              })
            )
            .then(
              (value) => {
                if (nativeNow() >= deadlineAt) {
                  cancel(createNativeAuthLifecycleError("REQUEST_TIMEOUT"));
                  return;
                }
                settle(resolve, value);
              },
              (error) => {
                if (nativeNow() >= deadlineAt) {
                  cancel(createNativeAuthLifecycleError("REQUEST_TIMEOUT"));
                  return;
                }
                settle(reject, error);
              }
            )
            .finally(() => {
              if (activeNativeFetch === entry) {
                activeNativeFetch = null;
                queuedNativeFetches.shift()?.start();
              }
            });
        },
      };
      callerSignal?.addEventListener?.("abort", abortForCaller, { once: true });
      armDeadline(initialLifetimeMillis);

      if (settled) {
        return;
      }
      if (!activeNativeFetch) {
        entry.start();
        return;
      }
      if (queuedNativeFetches.length >= maxQueuedNativeFetches) {
        cancel(createNativeAuthBusyError());
        return;
      }
      queuedNativeFetches.push(entry);
    });
  };

  const invalidateScheduledNativeFetches = (
    reasonCode = "SESSION_INVALIDATED"
  ) => {
    authState.nativeFetchGeneration += 1;
    activeNativeFetch?.cancelForLifecycle(reasonCode);
    for (const entry of [...queuedNativeFetches]) {
      entry.cancelForLifecycle(reasonCode);
    }
  };

  const beginNativeFetchSessionTransition = () => {
    nativeFetchSessionTransitions += 1;
    invalidateScheduledNativeFetches();
  };

  const endNativeFetchSessionTransition = () => {
    nativeFetchSessionTransitions = Math.max(
      0,
      nativeFetchSessionTransitions - 1
    );
  };

  const readBoundedRequestBody = async (request, signal = request.signal) => {
    throwIfAborted(signal);
    const declaredLength = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxNativeAuthRequestBodyBytes) {
      throw createRequestTooLargeError();
    }
    if (!request.body) {
      return undefined;
    }

    const reader = request.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    const cancelReader = () => {
      const cancellation = reader.cancel(createAbortError());
      cancellation?.catch?.(() => {});
    };
    signal?.addEventListener?.("abort", cancelReader, { once: true });
    try {
      while (true) {
        const { done, value } = await awaitWithAbort(reader.read(), signal);
        if (done) {
          break;
        }
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        if (chunk.byteLength > maxNativeAuthRequestBodyBytes - totalBytes) {
          await reader.cancel().catch(() => {});
          throw createRequestTooLargeError();
        }
        chunks.push(chunk);
        totalBytes += chunk.byteLength;
      }
    } finally {
      signal?.removeEventListener?.("abort", cancelReader);
      reader.releaseLock();
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  };

  const encodeBase64 = (bytes) => {
    let binary = "";
    const chunkSize = 32768;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  };

  const decodeBase64 = (value) => {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  };

  const decodeBase64Text = (value) => {
    const bytes = decodeBase64(value);

    if (typeof globalThis.TextDecoder === "function") {
      return new globalThis.TextDecoder().decode(bytes);
    }

    // Manual UTF-8 decode: walk the byte array and reconstruct code points.
    let text = "";
    let index = 0;
    while (index < bytes.length) {
      const byte = bytes[index];
      let codePoint;

      if (byte < 0x80) {
        codePoint = byte;
        index += 1;
      } else if ((byte & 0xe0) === 0xc0) {
        codePoint = ((byte & 0x1f) << 6) | (bytes[index + 1] & 0x3f);
        index += 2;
      } else if ((byte & 0xf0) === 0xe0) {
        codePoint =
          ((byte & 0x0f) << 12) |
          ((bytes[index + 1] & 0x3f) << 6) |
          (bytes[index + 2] & 0x3f);
        index += 3;
      } else {
        codePoint =
          ((byte & 0x07) << 18) |
          ((bytes[index + 1] & 0x3f) << 12) |
          ((bytes[index + 2] & 0x3f) << 6) |
          (bytes[index + 3] & 0x3f);
        index += 4;
      }

      text += String.fromCodePoint(codePoint);
    }

    return text;
  };

  const decodeNativeJsonBody = (response) => {
    if (!response || typeof response !== "object") {
      return null;
    }

    const bodyBase64 =
      typeof response.bodyBase64 === "string" ? response.bodyBase64.trim() : "";
    const contentType =
      typeof response.contentType === "string"
        ? response.contentType.trim().toLowerCase()
        : "";

    if (!bodyBase64 || (contentType && !contentType.includes("json"))) {
      return null;
    }

    try {
      const parsed = JSON.parse(decodeBase64Text(bodyBase64));

      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  };

  const normalizePushToken = (value) => {
    return typeof value === "string" ? value.trim() : "";
  };

  const getCurrentPushTokenSavedAt = () => {
    const currentValue =
      globalThis.Date && typeof globalThis.Date.now === "function"
        ? globalThis.Date.now()
        : Number.NaN;

    return Number.isFinite(currentValue) && currentValue >= 0
      ? Math.trunc(currentValue / 1000) * 1000
      : 0;
  };

  const isUuid = (value) => {
    return typeof value === "string"
      ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value.trim()
        )
      : false;
  };

  const disableAndroidPushRegistration = (error) => {
    if (androidPushSyncState.disabledError !== null) {
      return androidPushSyncState.disabledError;
    }

    const disabledError = normalizeAndroidPushDisabledError(error);

    if (!disabledError) {
      return null;
    }

    androidPushSyncState.disabledError = disabledError;
    console.error("Android push device registration is disabled.", disabledError);

    return disabledError;
  };

  const generateInstallationId = (apiOrigin) => {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }

    if (typeof globalThis.crypto?.getRandomValues === "function") {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");

      return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
      ].join("-");
    }

    throw createAndroidPushInstallationIdUnavailableError(apiOrigin);
  };

  const getPushInstallationStorageKey = (apiOrigin) => {
    return androidPushInstallationIdStorageKeyPrefix + encodeURIComponent(apiOrigin);
  };

  const getPushTokenStorageKey = (apiOrigin) => {
    return androidPushTokenStorageKeyPrefix + encodeURIComponent(apiOrigin);
  };

  const getPushTokenAppStorageKey = (apiOrigin) => {
    return androidPushTokenAppStorageKeyPrefix + encodeURIComponent(apiOrigin);
  };

  const getPushTokenSavedAtStorageKey = (apiOrigin) => {
    return androidPushTokenSavedAtStorageKeyPrefix + encodeURIComponent(apiOrigin);
  };

  const isTrustedPushTokenSource = (appName) => {
    return (
      typeof appName === "string" && appName.trim() === androidPushRuntimeAppName
    );
  };

  const getPendingPushApiOrigin = () => {
    return runtimeState.pendingBootstrap &&
      typeof runtimeState.pendingBootstrap === "object" &&
      typeof runtimeState.pendingBootstrap.apiOrigin === "string" &&
      runtimeState.pendingBootstrap.apiOrigin.trim().length > 0
      ? runtimeState.pendingBootstrap.apiOrigin.trim()
      : null;
  };

  const getActivePushApiOrigin = () => {
    if (typeof runtimeState.apiOrigin === "string" && runtimeState.apiOrigin.trim().length > 0) {
      return runtimeState.apiOrigin.trim();
    }

    return getPendingPushApiOrigin();
  };

  const getPushTokenCleanupOrigins = () => {
    const origins = [];
    const configuredApiOrigin =
      typeof runtimeState.apiOrigin === "string" ? runtimeState.apiOrigin.trim() : "";
    const pendingApiOrigin = getPendingPushApiOrigin() ?? "";
    const lastSyncedApiOrigin =
      typeof androidPushSyncState.lastSyncedApiOrigin === "string"
        ? androidPushSyncState.lastSyncedApiOrigin.trim()
        : "";

    if (configuredApiOrigin) {
      origins.push(configuredApiOrigin);
    }

    if (pendingApiOrigin && !origins.includes(pendingApiOrigin)) {
      origins.push(pendingApiOrigin);
    }

    if (lastSyncedApiOrigin && !origins.includes(lastSyncedApiOrigin)) {
      origins.push(lastSyncedApiOrigin);
    }

    return origins;
  };

  const getPushTokenStorages = () => {
    const storages = [];
    const localStorage = getLocalStorage();
    const sessionStorage = getSessionStorage();

    if (localStorage && typeof localStorage.getItem === "function") {
      storages.push(localStorage);
    }

    if (
      sessionStorage &&
      typeof sessionStorage.getItem === "function" &&
      sessionStorage !== localStorage
    ) {
      storages.push(sessionStorage);
    }

    return storages;
  };

  const readStoredPushToken = (storage, apiOrigin) => {
    if (
      !storage ||
      typeof storage.getItem !== "function" ||
      typeof apiOrigin !== "string" ||
      apiOrigin.trim().length === 0
    ) {
      return { token: "", appName: "", savedAt: -1 };
    }

    try {
      const normalizedApiOrigin = apiOrigin.trim();
      const appName = normalizePushToken(
        storage.getItem(getPushTokenAppStorageKey(normalizedApiOrigin))
      );

      if (!isTrustedPushTokenSource(appName)) {
        return { token: "", appName: "", savedAt: -1 };
      }

      return {
        token: normalizePushToken(
          storage.getItem(getPushTokenStorageKey(normalizedApiOrigin))
        ),
        appName,
        orderingSavedAt: getPushTokenSavedAtOrderingValue(
          storage.getItem(getPushTokenSavedAtStorageKey(normalizedApiOrigin))
        ),
        savedAt: normalizePushTokenSavedAt(
          storage.getItem(getPushTokenSavedAtStorageKey(normalizedApiOrigin))
        ),
      };
    } catch {
      return { token: "", appName: "", savedAt: -1 };
    }
  };

  const getStoredPushTokenEntry = (apiOrigin) => {
    if (typeof apiOrigin !== "string" || apiOrigin.trim().length === 0) {
      return { token: "", savedAt: -1 };
    }

    const normalizedApiOrigin = apiOrigin.trim();
    let selectedToken = "";
    let selectedAppName = "";
    let selectedOrderingSavedAt = -1;
    let selectedSavedAt = -1;

    for (const storage of getPushTokenStorages()) {
      const { token, appName, orderingSavedAt, savedAt } = readStoredPushToken(
        storage,
        normalizedApiOrigin
      );

      if (
        token.length >= minAndroidPushTokenLength &&
        (selectedToken.length < minAndroidPushTokenLength ||
          orderingSavedAt > selectedOrderingSavedAt)
      ) {
        selectedToken = token;
        selectedAppName = appName;
        selectedOrderingSavedAt = orderingSavedAt;
        selectedSavedAt = savedAt;
      }
    }

    if (selectedToken.length >= minAndroidPushTokenLength) {
      const persistedSavedAt =
        selectedSavedAt >= 0 ? selectedSavedAt : getCurrentPushTokenSavedAt();
      persistPushToken(
        normalizedApiOrigin,
        selectedToken,
        selectedAppName,
        persistedSavedAt
      );
      return { token: selectedToken, savedAt: persistedSavedAt };
    }

    return { token: "", savedAt: -1 };
  };

  const getStoredPushToken = (apiOrigin) => {
    return getStoredPushTokenEntry(apiOrigin).token;
  };

  const persistPushToken = (
    apiOrigin,
    token,
    appName = androidPushRuntimeAppName,
    savedAt = getCurrentPushTokenSavedAt()
  ) => {
    const normalizedApiOrigin =
      typeof apiOrigin === "string" ? apiOrigin.trim() : "";
    const normalizedToken = normalizePushToken(token);
    const normalizedAppName = typeof appName === "string" ? appName.trim() : "";
    const persistedSavedAt = serializePushTokenSavedAt(savedAt);

    if (
      normalizedApiOrigin.length === 0 ||
      normalizedToken.length < minAndroidPushTokenLength ||
      !isTrustedPushTokenSource(normalizedAppName)
    ) {
      return;
    }

    for (const storage of getPushTokenStorages()) {
      if (!storage || typeof storage.setItem !== "function") {
        continue;
      }

      try {
        storage.setItem(getPushTokenStorageKey(normalizedApiOrigin), normalizedToken);
        storage.setItem(
          getPushTokenAppStorageKey(normalizedApiOrigin),
          normalizedAppName
        );
        storage.setItem(
          getPushTokenSavedAtStorageKey(normalizedApiOrigin),
          persistedSavedAt
        );
      } catch {
        // Push token persistence is best-effort only.
      }
    }
  };

  const clearStoredPushToken = (apiOrigin) => {
    if (typeof apiOrigin !== "string" || apiOrigin.trim().length === 0) {
      return;
    }

    const normalizedApiOrigin = apiOrigin.trim();

    for (const storage of getPushTokenStorages()) {
      if (!storage || typeof storage.removeItem !== "function") {
        continue;
      }

      try {
        storage.removeItem(getPushTokenStorageKey(normalizedApiOrigin));
        storage.removeItem(getPushTokenAppStorageKey(normalizedApiOrigin));
        storage.removeItem(getPushTokenSavedAtStorageKey(normalizedApiOrigin));
      } catch {
        // Push token cleanup is best-effort only.
      }
    }
  };

  const hydrateRetainedPushTokenState = (apiOrigin = getActivePushApiOrigin()) => {
    const currentToken = normalizePushToken(androidPushSyncState.currentToken);
    const normalizedApiOrigin =
      typeof apiOrigin === "string" ? apiOrigin.trim() : "";

    if (
      isTrustedPushTokenSource(androidPushSyncState.currentTokenSourceAppName) &&
      currentToken.length >= minAndroidPushTokenLength
    ) {
      const effectiveSavedAt =
        androidPushSyncState.currentTokenSavedAt >= 0
          ? androidPushSyncState.currentTokenSavedAt
          : getCurrentPushTokenSavedAt();

      androidPushSyncState.currentTokenSavedAt = effectiveSavedAt;

      if (normalizedApiOrigin.length > 0) {
        persistPushToken(
          normalizedApiOrigin,
          currentToken,
          androidPushSyncState.currentTokenSourceAppName,
          effectiveSavedAt
        );
      }

      return currentToken;
    }

    if (normalizedApiOrigin.length === 0) {
      androidPushSyncState.currentToken = null;
      androidPushSyncState.currentTokenSourceAppName = null;
      androidPushSyncState.currentTokenSavedAt = -1;
      return "";
    }

    const { token: retainedToken, savedAt: retainedSavedAt } =
      getStoredPushTokenEntry(normalizedApiOrigin);

    if (retainedToken.length >= minAndroidPushTokenLength) {
      androidPushSyncState.currentToken = retainedToken;
      androidPushSyncState.currentTokenSourceAppName = androidPushRuntimeAppName;
      androidPushSyncState.currentTokenSavedAt = retainedSavedAt;
      return retainedToken;
    }

    androidPushSyncState.currentToken = null;
    androidPushSyncState.currentTokenSourceAppName = null;
    androidPushSyncState.currentTokenSavedAt = -1;
    return "";
  };

  const hasTrustedRetainedPushToken = () => {
    const currentToken = normalizePushToken(androidPushSyncState.currentToken);

    if (
      isTrustedPushTokenSource(androidPushSyncState.currentTokenSourceAppName) &&
      currentToken.length >= minAndroidPushTokenLength
    ) {
      return true;
    }

    for (const apiOrigin of getPushTokenCleanupOrigins()) {
      if (getStoredPushToken(apiOrigin).length >= minAndroidPushTokenLength) {
        return true;
      }
    }

    return false;
  };

  const clearRetainedPushTokenState = () => {
    androidPushSyncState.currentToken = null;
    androidPushSyncState.currentTokenSourceAppName = null;
    androidPushSyncState.currentTokenSavedAt = -1;

    for (const apiOrigin of getPushTokenCleanupOrigins()) {
      clearStoredPushToken(apiOrigin);
    }
  };

  const getStoredPushInstallationId = (apiOrigin) => {
    if (typeof apiOrigin !== "string" || apiOrigin.trim().length === 0) {
      return null;
    }

    const storageKey = getPushInstallationStorageKey(apiOrigin.trim());
    const storage = getLocalStorage();

    if (storage && typeof storage.getItem === "function") {
      try {
        const stored = storage.getItem(storageKey);

        if (isUuid(stored)) {
          return stored.trim();
        }
      } catch {
        // Installation identifier persistence is best-effort only.
      }
    }

    const fallback = androidPushSyncState.installationIds[storageKey];

    return isUuid(fallback) ? fallback.trim() : null;
  };

  const getOrCreatePushInstallationId = (apiOrigin) => {
    const normalizedApiOrigin = apiOrigin.trim();
    const existing = getStoredPushInstallationId(normalizedApiOrigin);

    if (existing) {
      return existing;
    }

    const installationId = generateInstallationId(normalizedApiOrigin);
    const storageKey = getPushInstallationStorageKey(normalizedApiOrigin);
    const storage = getLocalStorage();

    androidPushSyncState.installationIds[storageKey] = installationId;

    if (storage && typeof storage.setItem === "function") {
      try {
        storage.setItem(storageKey, installationId);
      } catch {
        // Installation identifier persistence is best-effort only.
      }
    }

    return installationId;
  };

  const getConfiguredAndroidPushMetadata = () => {
    if (!runtimeState.configured || typeof runtimeState.apiOrigin !== "string") {
      return null;
    }

    const bootstrap = runtimeState.bootstrap;

    if (!bootstrap || typeof bootstrap !== "object") {
      return null;
    }

    const androidPush = bootstrap.androidPush;
    const provider =
      androidPush && typeof androidPush === "object" && typeof androidPush.provider === "string"
        ? androidPush.provider.trim()
        : "";
    const metadataRevision =
      androidPush && typeof androidPush === "object"
        ? Number(androidPush.metadataRevision)
        : Number.NaN;

    if (
      provider !== "fcm" ||
      !Number.isInteger(metadataRevision) ||
      metadataRevision <= 0
    ) {
      return null;
    }

    return {
      apiOrigin: runtimeState.apiOrigin.trim(),
      provider,
      metadataRevision,
    };
  };

  const clearAndroidPushSyncState = ({
    preserveCurrentToken = false,
  } = {}) => {
    if (!preserveCurrentToken) {
      for (const apiOrigin of getPushTokenCleanupOrigins()) {
        clearStoredPushToken(apiOrigin);
      }

      androidPushSyncState.currentToken = null;
      androidPushSyncState.currentTokenSourceAppName = null;
      androidPushSyncState.currentTokenSavedAt = -1;
    }

    androidPushSyncState.lastSyncedToken = null;
    androidPushSyncState.lastSyncedApiOrigin = null;
    androidPushSyncState.lastSyncedMetadataRevision = null;
    androidPushSyncState.syncPromise = Promise.resolve();
  };

  const encodeJsonRequestBody = (value) => {
    const json = JSON.stringify(value);
    const encoder =
      typeof globalThis.TextEncoder === "function"
        ? new globalThis.TextEncoder()
        : null;
    const bytes = encoder
      ? encoder.encode(json)
      : Uint8Array.from(json, (character) => character.charCodeAt(0));

    return encodeBase64(bytes);
  };

  const queueAndroidPushSync = () => {
    androidPushSyncState.syncPromise = Promise.resolve(
      androidPushSyncState.syncPromise
    )
      .catch(() => undefined)
      .then(async () => {
        const pushMetadata = getConfiguredAndroidPushMetadata();
        const token = pushMetadata
          ? hydrateRetainedPushTokenState(pushMetadata.apiOrigin)
          : hydrateRetainedPushTokenState();

        if (
          !pushMetadata ||
          androidPushSyncState.suspended === true ||
          androidPushSyncState.disabledError !== null ||
          authState.active !== true ||
          token.length < minAndroidPushTokenLength
        ) {
          return;
        }

        if (
          androidPushSyncState.lastSyncedToken === token &&
          androidPushSyncState.lastSyncedApiOrigin === pushMetadata.apiOrigin &&
          androidPushSyncState.lastSyncedMetadataRevision ===
            pushMetadata.metadataRevision
        ) {
          return;
        }

        const lifecycleEvent =
          androidPushSyncState.lastSyncedApiOrigin === pushMetadata.apiOrigin &&
          typeof androidPushSyncState.lastSyncedToken === "string" &&
          androidPushSyncState.lastSyncedToken !== token
            ? "credential_rotated"
            : "registered";
        const runtimeInfo = await getRuntimeInfo();
        let installationId;

        try {
          installationId = getOrCreatePushInstallationId(pushMetadata.apiOrigin);
        } catch (error) {
          if (disableAndroidPushRegistration(error)) {
            return;
          }

          throw error;
        }

        const response = await sendAuthenticatedNativeRequest(
          {
            method: "PUT",
            path: "/v1/me/notification-installations/" + installationId,
            bodyBase64: encodeJsonRequestBody({
              channel: "android_fcm",
              installation_name: androidPushDeviceName,
              lifecycle_event: lifecycleEvent,
              registration: {
                push_token: token,
                app: {
                  package_name: "app.secpal",
                  package_version_name: runtimeInfo.appVersion,
                  package_version_code: runtimeInfo.appBuild,
                },
              },
              runtime: {
                bootstrap_version: currentBootstrapVersion,
                schema_version: currentBootstrapSchemaVersion,
                metadata_revision: pushMetadata.metadataRevision,
              },
            }),
            contentType: "application/json",
            accept: "application/json",
          },
          { markAuthenticatedOnSuccess: false }
        );
        const status =
          response && typeof response === "object"
            ? Number(response.status)
            : Number.NaN;

        if (status === 200 || status === 201) {
          androidPushSyncState.lastSyncedToken = token;
          androidPushSyncState.lastSyncedApiOrigin = pushMetadata.apiOrigin;
          androidPushSyncState.lastSyncedMetadataRevision =
            pushMetadata.metadataRevision;
          return;
        }

        if (status === 401) {
          androidPushSyncState.lastSyncedToken = null;
          androidPushSyncState.lastSyncedApiOrigin = null;
          androidPushSyncState.lastSyncedMetadataRevision = null;
          return;
        }

        if (status === 409) {
          const responseBody = decodeNativeJsonBody(response);
          const responseCode =
            responseBody && typeof responseBody === "object" && typeof responseBody.code === "string"
              ? responseBody.code.trim()
              : "";

          if (
            responseCode === "NOTIFICATION_RUNTIME_STATE_INVALID" ||
            responseCode === "NOTIFICATION_CHANNEL_UNSUPPORTED"
          ) {
            await clearConfiguredRuntimeState();
            return;
          }
        }

        throw new Error(
          "Android push device registration request failed with status " +
            String(status)
        );
      })
      .catch((error) => {
        console.warn("Failed to sync Android push device registration.", error);
      });

    return androidPushSyncState.syncPromise;
  };

  const setAuthActive = (nextActive) => {
    const wasActive = authState.active === true;
    const willBeActive = nextActive === true;

    authState.active = willBeActive;
    if (wasActive && !willBeActive) {
      invalidateScheduledNativeFetches();
    }

    if (!wasActive && authState.active && androidPushSyncState.suspended !== true) {
      queueAndroidPushSync();
    }
  };

  const sendAuthenticatedNativeRequest = async (
    request,
    { markAuthenticatedOnSuccess = true, signal } = {}
  ) => {
    const requestSignal = signal ?? request?.signal;
    throwIfAborted(requestSignal);
    if (
      typeof request?.bodyBase64 === "string" &&
      request.bodyBase64.length > maxNativeAuthRequestBodyBase64Characters
    ) {
      throw createRequestTooLargeError();
    }
    await awaitWithAbort(ensureRuntimeConfigured(), requestSignal);
    authState.nativeRequestSequence =
      Number.isSafeInteger(authState.nativeRequestSequence)
        ? authState.nativeRequestSequence + 1
        : 1;
    const requestId =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : "webview-" + Date.now().toString(36) + "-" + authState.nativeRequestSequence.toString(36);
    const nativeRequest = { ...request };
    delete nativeRequest.signal;
    nativeRequest.requestId = requestId;
    const cancel = () => {
      const cancellation = getPlugin().cancelRequest?.({ requestId });
      cancellation?.catch?.(() => {
        // The native request may already have reached its terminal callback.
      });
    };
    requestSignal?.addEventListener?.("abort", cancel, { once: true });

    let response;
    try {
      response = await getPlugin().request(nativeRequest);
    } catch (error) {
      if (requestSignal?.aborted) {
        throw createAbortError();
      }
      const code = error && typeof error === "object" ? error.code : undefined;
      if (code === "HTTP_401" || code === "NO_STORED_TOKEN") {
        setAuthActive(false);
      }
      throw error;
    } finally {
      requestSignal?.removeEventListener?.("abort", cancel);
    }
    if (requestSignal?.aborted) {
      throw createAbortError();
    }
    const status =
      response && typeof response === "object" ? Number(response.status) : Number.NaN;

    if (status === 401) {
      setAuthActive(false);
    } else if (markAuthenticatedOnSuccess && status >= 200 && status < 300) {
      setAuthActive(true);
    }

    return response;
  };

  const revokeConfiguredAndroidPushRegistrationDirect = async () => {
    const apiOrigin =
      typeof runtimeState.apiOrigin === "string" ? runtimeState.apiOrigin.trim() : "";
    const installationId = apiOrigin ? getStoredPushInstallationId(apiOrigin) : null;

    if (!runtimeState.configured || !apiOrigin || !installationId) {
      clearAndroidPushSyncState({ preserveCurrentToken: true });
      return;
    }

    try {
      const response = await sendAuthenticatedNativeRequest(
        {
          method: "DELETE",
          path: "/v1/me/notification-installations/" + installationId,
          accept: "application/json",
        },
        { markAuthenticatedOnSuccess: false }
      );
      const status =
        response && typeof response === "object"
          ? Number(response.status)
          : Number.NaN;

      if (status === 200 || status === 204 || status === 401 || status === 404) {
        return;
      }

      throw new Error(
        "Android push device revocation request failed with status " +
          String(status)
      );
    } catch (error) {
      console.warn("Failed to revoke Android push device registration.", error);
    } finally {
      clearAndroidPushSyncState({ preserveCurrentToken: true });
    }
  };

  const revokeAndroidPushRegistration = () => {
    androidPushSyncState.syncPromise = Promise.resolve(
      androidPushSyncState.syncPromise
    )
      .catch(() => undefined)
      .then(() => revokeConfiguredAndroidPushRegistrationDirect());

    return androidPushSyncState.syncPromise;
  };

  const installAndroidPushListeners = () => {
    const plugin = getPlugin();

    if (typeof plugin.addListener !== "function") {
      return;
    }

    const rememberListenerHandle = (key, handleOrPromise) => {
      Promise.resolve(handleOrPromise)
        .then((handle) => {
          androidPushSyncState[key] = handle ?? null;
        })
        .catch(() => {
          androidPushSyncState[key] = null;
        });
    };

    rememberListenerHandle(
      "tokenReceivedHandle",
      plugin.addListener("androidPushTokenReceived", (payload) => {
        const appName =
          payload && typeof payload === "object" && typeof payload.appName === "string"
            ? payload.appName.trim()
            : "";
        const provider =
          payload && typeof payload === "object" && typeof payload.provider === "string"
            ? payload.provider.trim()
            : "";
        const token = normalizePushToken(
          payload && typeof payload === "object" ? payload.token : null
        );

        if (appName !== androidPushRuntimeAppName) {
          if (!hasTrustedRetainedPushToken()) {
            clearRetainedPushTokenState();
          }
          return;
        }

        if (provider !== "fcm" || token.length < minAndroidPushTokenLength) {
          return;
        }

        androidPushSyncState.currentToken = token;
        androidPushSyncState.currentTokenSourceAppName = appName;
        androidPushSyncState.currentTokenSavedAt = getCurrentPushTokenSavedAt();
        persistPushToken(getActivePushApiOrigin(), token, appName, androidPushSyncState.currentTokenSavedAt);
        queueAndroidPushSync();
      })
    );
    rememberListenerHandle(
      "tokenErrorHandle",
      plugin.addListener("androidPushTokenError", (payload) => {
        const appName =
          payload && typeof payload === "object" && typeof payload.appName === "string"
            ? payload.appName.trim()
            : "";

        if (appName !== androidPushRuntimeAppName) {
          return;
        }

        console.warn(
          "Failed to retrieve Android push registration token.",
          payload
        );
      })
    );
  };

  const installNativeAuthLifecycleListener = () => {
    const plugin = getPlugin();

    if (typeof plugin.addListener !== "function") {
      return;
    }

    const handleOrPromise = plugin.addListener(
      nativeAuthLifecycleChangedEventName,
      (payload) => {
        if (!payload || typeof payload !== "object") {
          return;
        }
        if (payload.foreground === false) {
          nativeFetchBackgrounded = true;
          invalidateScheduledNativeFetches("APP_BACKGROUNDED");
        } else if (payload.foreground === true) {
          nativeFetchBackgrounded = false;
        }
      }
    );
    Promise.resolve(handleOrPromise)
      .then((handle) => {
        authState.nativeAuthLifecycleHandle = handle ?? null;
      })
      .catch(() => {
        authState.nativeAuthLifecycleHandle = null;
      });
  };

  const buildPath = (url) => url.pathname + url.search;
  const fallbackApiHost = new URL(fallbackApiOrigin).hostname;
  const originalFetch =
    typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;

  const getActiveApiOrigin = () => runtimeState.apiOrigin || fallbackApiOrigin;
  const getActiveApiHost = () => {
    try {
      return new URL(getActiveApiOrigin()).hostname;
    } catch {
      return fallbackApiHost;
    }
  };

  const isApiPath = (pathname) => {
    return (
      pathname === "/v1" ||
      pathname.startsWith("/v1/") ||
      pathname.startsWith("/sanctum/") ||
      pathname === "/health" ||
      pathname.startsWith("/health/")
    );
  };

  const publicApiPaths = new Set([
    "/v1/bootstrap",
    "/v1/release",
    "/v1/onboarding/validate-token",
    "/v1/onboarding/complete",
  ]);
  const isNativeApiPath = (pathname) =>
    !publicApiPaths.has(pathname) &&
    (pathname === "/v1" || pathname.startsWith("/v1/"));
  const isRoutableApiHost = (url) => {
    const locationHost =
      globalThis.location && typeof globalThis.location.hostname === "string"
        ? globalThis.location.hostname
        : undefined;
    return (
      url.hostname === fallbackApiHost ||
      (locationHost !== undefined && url.hostname === locationHost) ||
      url.hostname === getActiveApiHost()
    );
  };

  const rewriteApiRequestUrl = (url) => {
    if (!runtimeState.configured || !runtimeState.apiOrigin || !isApiPath(url.pathname)) {
      return url;
    }

    if (!isRoutableApiHost(url)) {
      return url;
    }

    return new URL(url.pathname + url.search, runtimeState.apiOrigin);
  };

  const isNativeApiRequest = (url) => {
    return (
      isNativeApiPath(url.pathname) &&
      url.hostname === getActiveApiHost()
    );
  };
  const isNativeApiCandidate = (url) =>
    isNativeApiPath(url.pathname) && isRoutableApiHost(url);

  let runtimeResetBusy = false;

  const markRuntimeResetConfirmed = () => {
    androidPushSyncState.suspended = false;
    setAuthActive(false);
    clearAndroidPushSyncState();
    runtimeState.configured = false;
    runtimeState.bootstrap = null;
    runtimeState.apiOrigin = null;
    runtimeState.pendingBootstrap = null;
  };

  const leaveConfirmedRuntimeResetShell = (reload) => {
    try {
      globalThis.dispatchEvent?.(new Event(nativeAuthLogoutEventName));
    } catch (error) {
      console.warn("Failed to dispatch the SecPal runtime-reset logout event.", error);
    }

    if (reload) {
      try {
        if (globalThis.location && typeof globalThis.location.reload === "function") {
          globalThis.location.reload();
        }
      } catch (error) {
        console.warn("Failed to reload after the SecPal runtime reset.", error);
      }
    }
  };

  const completeConfirmedRuntimeReset = async ({
    reloadAfterCleanup = false,
    reloadOnFailure = true,
  } = {}) => {
    beginRuntimeBootstrapMutation();
    markRuntimeResetConfirmed();
    try {
      await clearTenantScopedBrowserState();
      clearPendingRuntimeReset();
    } catch (error) {
      leaveConfirmedRuntimeResetShell(reloadOnFailure);
      throw error;
    }

    if (reloadAfterCleanup) {
      leaveConfirmedRuntimeResetShell(true);
    }
  };

  const clearConfiguredRuntimeState = async () => {
    if (runtimeResetBusy || !runtimeState.configured) {
      return;
    }

    runtimeResetBusy = true;
    try {
      await queueRuntimeBootstrapMutation(async () => {
        await clearPersistedBootstrap();
        await completeConfirmedRuntimeReset({ reloadAfterCleanup: true });
      });
    } catch (error) {
      console.warn("Failed to clear the current SecPal runtime.", error);
    } finally {
      runtimeResetBusy = false;
      androidPushSyncState.suspended = false;
    }
  };

  restorePersistedBootstrap();
  installAndroidPushListeners();
  installNativeAuthLifecycleListener();

  const bridge = {
    async login(credentials) {
      await ensureRuntimeConfigured();
      beginNativeFetchSessionTransition();
      try {
        const result = await getPlugin().login(credentials);
        setAuthActive(true);
        return result;
      } finally {
        endNativeFetchSessionTransition();
      }
    },
    async logout() {
      await ensureRuntimeConfigured();
      let result;
      let didLogoutSucceed = false;
      try {
        androidPushSyncState.suspended = true;
        setAuthActive(false);
        await revokeAndroidPushRegistration();
        result = await getPlugin().logout();
        didLogoutSucceed = true;
      } finally {
        setAuthActive(false);
        clearAndroidPushSyncState({ preserveCurrentToken: true });
        androidPushSyncState.suspended = false;
      }

      if (didLogoutSucceed) {
        globalThis.dispatchEvent?.(new Event(nativeAuthLogoutEventName));
      }

      return result;
    },
    async getCurrentUser() {
      await ensureRuntimeConfigured();
      try {
        const result = await getPlugin().getCurrentUser();
        setAuthActive(true);
        return result;
      } catch (error) {
        const code = error && typeof error === "object" ? error.code : undefined;
        if (code === "HTTP_401" || code === "NO_STORED_TOKEN") {
          setAuthActive(false);
        }
        throw error;
      }
    },
    async isNetworkAvailable() {
      const result = await getPlugin().isNetworkAvailable();
      return result && typeof result === "object" ? result.available === true : result === true;
    },
    async getAndroidPushRegistrationState() {
      return getAndroidPushRegistrationState();
    },
    async getRuntimeInfo() {
      return getPlugin().getRuntimeInfo();
    },
    async getRuntimeBootstrap() {
      return getPlugin().getRuntimeBootstrap();
    },
    async setRuntimeBootstrap(bootstrap) {
      const normalizedBootstrap = normalizeStoredBootstrap(bootstrap);
      if (!runtimeState.configured && runtimeState.bootstrapWriteInFlight !== true) {
        beginRuntimeBootstrapMutation();
      }
      const apiOrigin = await queueRuntimeBootstrapMutation(() => {
        const bootstrapEpoch = beginRuntimeBootstrapMutation();
        return applyRuntimeBootstrap(normalizedBootstrap, bootstrapEpoch);
      });
      return apiOrigin;
    },
    async clearRuntimeBootstrap() {
      if (!runtimeState.configured && runtimeState.bootstrapWriteInFlight !== true) {
        beginRuntimeBootstrapMutation();
      }
      await queueRuntimeBootstrapMutation(async () => {
        await clearPersistedBootstrap();
        await completeConfirmedRuntimeReset();
      });
    },
    async request(request) {
      return sendAuthenticatedNativeRequest(request, {
        markAuthenticatedOnSuccess: false,
      });
    },
    async createPasskeyAttestation(options) {
      await requirePasskeyCapabilities();
      const result = await getPlugin().createPasskeyAttestation({ publicKey: options });
      return result && typeof result === "object" && "credential" in result
        ? result.credential
        : result;
    },
    async getPasskeyCapabilities() {
      return getPasskeyCapabilities();
    },
  };

  if (typeof getPlugin().loginWithPasskey === "function") {
    bridge.loginWithPasskey = async () => {
      await ensureRuntimeConfigured();
      await requirePasskeyCapabilities();
      beginNativeFetchSessionTransition();
      try {
        const result = await getPlugin().loginWithPasskey();
        setAuthActive(true);
        return result;
      } finally {
        endNativeFetchSessionTransition();
      }
    };
  }

  const enterpriseBridge = {
    getManagedState() {
      return getEnterprisePlugin().getManagedState();
    },
    launchPhone() {
      return getEnterprisePlugin().launchPhone();
    },
    launchSms() {
      return getEnterprisePlugin().launchSms();
    },
    launchAllowedApp(options) {
      return getEnterprisePlugin().launchAllowedApp(options);
    },
    openOssLicenses() {
      return getEnterprisePlugin().openOssLicenses();
    },
    addHardwareButtonListener(listener) {
      const plugin = getEnterprisePlugin();
      if (typeof plugin.addListener !== "function") {
        throw new Error("SecPal hardware button events are unavailable");
      }
      return plugin.addListener("hardwareButtonPressed", listener);
    },
    addHardwareButtonShortPressListener(listener) {
      const plugin = getEnterprisePlugin();
      if (typeof plugin.addListener !== "function") {
        throw new Error("SecPal hardware button short-press events are unavailable");
      }
      return plugin.addListener("hardwareButtonShortPressed", listener);
    },
    addHardwareButtonLongPressListener(listener) {
      const plugin = getEnterprisePlugin();
      if (typeof plugin.addListener !== "function") {
        throw new Error("SecPal hardware button long-press events are unavailable");
      }
      return plugin.addListener("hardwareButtonLongPressed", listener);
    },
  };

  globalThis.SecPalNativeAuthBridge = bridge;
  globalThis.SecPalEnterpriseBridge = enterpriseBridge;

  const enterprisePlugin = globalThis.Capacitor?.Plugins?.SecPalEnterprise;
  if (typeof enterprisePlugin?.addListener === "function") {
    const openRoute = (pathname) => {
      const location = globalThis.location;
      if (!location) {
        return;
      }
      try {
        const currentUrl = new URL(location.href ?? fallbackApiOrigin, fallbackApiOrigin);
        if (currentUrl.pathname === pathname) {
          return;
        }
        location.href = new URL(pathname, currentUrl.href).toString();
      } catch {
        location.href = pathname;
      }
    };
    enterpriseBridge.addHardwareButtonShortPressListener(() => {
      openRoute("/profile");
    });
    enterpriseBridge.addHardwareButtonLongPressListener(() => {
      openRoute("/about");
    });
  }

  if (originalFetch) {
    globalThis.fetch = async (input, init) => {
      let request;
      let candidateUrl;

      try {
        request = new Request(input, init);
        const locationHref =
          globalThis.location && typeof globalThis.location.href === "string"
            ? globalThis.location.href
            : fallbackApiOrigin;
        candidateUrl = new URL(request.url, locationHref);
      } catch {
        return originalFetch(input, init);
      }

      const dispatchRequest = async (scheduledContext) => {
        const requestSignal = scheduledContext?.signal ?? request.signal;
        const url = new URL(request.url, candidateUrl);
        if (isApiPath(url.pathname)) {
          try {
            await awaitWithAbort(runtimeState.nativeConfigPromise, requestSignal);
          } catch (error) {
            if (error?.name === "AbortError") {
              throw error;
            }
            // Keep the original request path when runtime bootstrap restore fails.
          }
        }

        const rewrittenUrl = rewriteApiRequestUrl(url);

        if (scheduledContext) {
          if (
            !authState.active ||
            scheduledContext.submittedGeneration !==
              authState.nativeFetchGeneration ||
            !isNativeApiRequest(rewrittenUrl)
          ) {
            throw createNativeAuthLifecycleError("SESSION_INVALIDATED");
          }
          const requestBody =
            request.method === "GET" || request.method === "HEAD"
              ? undefined
              : await readBoundedRequestBody(request, requestSignal);
          scheduledContext.updateRequestBodyBytes(
            requestBody?.byteLength ?? 0
          );
          const nativeResponse = await bridge.request({
            method: request.method,
            path: buildPath(rewrittenUrl),
            bodyBase64:
              requestBody && requestBody.byteLength > 0
                ? encodeBase64(requestBody)
                : undefined,
            contentType: request.headers.get("Content-Type") ?? undefined,
            accept: request.headers.get("Accept") ?? undefined,
            signal: requestSignal,
          });
          const headers = new Headers();
          if (nativeResponse.contentType) {
            headers.set("Content-Type", nativeResponse.contentType);
          }
          return new Response(
            nativeResponse.bodyBase64 ? decodeBase64(nativeResponse.bodyBase64) : undefined,
            { status: nativeResponse.status, headers }
          );
        }

        if (rewrittenUrl.toString() === request.url) {
          return originalFetch(request);
        }

        return originalFetch(new Request(rewrittenUrl.toString(), request));
      };

      if (
        isNativeApiCandidate(candidateUrl) &&
        (authState.active || nativeFetchSessionTransitions > 0)
      ) {
        if (nativeFetchBackgrounded) {
          throw createNativeAuthLifecycleError("APP_BACKGROUNDED");
        }
        if (nativeFetchSessionTransitions > 0) {
          throw createNativeAuthLifecycleError("SESSION_INVALIDATED");
        }
        const submittedGeneration = authState.nativeFetchGeneration;
        const knownRequestBodyBytes = getKnownRequestBodyBytes(request, init);
        const initialLifetimeMillis = resolveNativeAuthRequestLifetimeMillis(
          knownRequestBodyBytes ?? maxNativeAuthRequestBodyBytes
        );
        return scheduleNativeFetch(
          (context) =>
            dispatchRequest({
              ...context,
              submittedGeneration,
            }),
          request.signal,
          submittedGeneration,
          initialLifetimeMillis
        );
      }
      return dispatchRequest();
    };
  }

  globalThis.__SecPalNativeAuthBootstrapInstalled = true;
})();
