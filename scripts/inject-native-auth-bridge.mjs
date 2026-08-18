#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "parse5";

const BOOTSTRAP_SCRIPT_ID = "secpal-native-auth-bridge-bootstrap";
export const nativeAuthBridgeAssetPrefix = "secpal-native-auth-bridge.";
export const nativeAuthBridgeAssetPattern =
  /^secpal-native-auth-bridge\.([0-9a-f]{64})\.js$/;

export function isDirectNodeExecution(moduleUrl, argvPath = process.argv[1]) {
  if (!argvPath) {
    return false;
  }

  const directModuleUrls = new Set([pathToFileURL(resolve(argvPath)).href]);
  try {
    directModuleUrls.add(pathToFileURL(realpathSync(argvPath)).href);
  } catch {
    // The resolved URL still covers direct execution on non-canonical filesystems.
  }

  return directModuleUrls.has(moduleUrl);
}

function inspectAndroidWebApplicationShell(html) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const requiredElements = {
    body: false,
    head: false,
    html: false,
  };
  let headEndTagStartOffset = null;
  let hasHtmlDoctype = false;
  let hasModuleEntry = false;
  let moduleEntryStartOffset = null;
  const runtimeBridgeScripts = [];
  const pending = [document];

  while (pending.length > 0) {
    const node = pending.pop();
    const location = node.sourceCodeLocation;

    if (
      node.nodeName === "#documentType" &&
      node.name?.toLowerCase() === "html" &&
      location
    ) {
      hasHtmlDoctype = true;
    }

    if (
      Object.hasOwn(requiredElements, node.tagName) &&
      location?.startTag &&
      location.endTag
    ) {
      requiredElements[node.tagName] = true;
    }

    if (node.tagName === "head" && location?.endTag) {
      headEndTagStartOffset = location.endTag.startOffset;
    }

    if (
      node.tagName === "script" &&
      node.attrs?.some(
        ({ name, value }) => name === "id" && value === BOOTSTRAP_SCRIPT_ID
      )
    ) {
      runtimeBridgeScripts.push(node);
    }

    if (
      node.tagName === "script" &&
      location?.startTag &&
      location.endTag &&
      node.attrs?.some(
        ({ name, value }) =>
          name === "type" && value.trim().toLowerCase() === "module"
      ) &&
      node.attrs?.some(
        ({ name, value }) => name === "src" && value.trim().length > 0
      )
    ) {
      hasModuleEntry = true;
      moduleEntryStartOffset =
        moduleEntryStartOffset === null
          ? location.startTag.startOffset
          : Math.min(moduleEntryStartOffset, location.startTag.startOffset);
    }

    pending.push(...(node.childNodes ?? []));
  }

  return {
    hasHtmlDoctype,
    hasModuleEntry,
    headEndTagStartOffset,
    moduleEntryStartOffset,
    requiredElements,
    runtimeBridgeScripts,
  };
}

export function assertCompleteAndroidWebApplicationShell(
  html,
  sourceLabel = "Android web index"
) {
  const shell = inspectAndroidWebApplicationShell(html);

  if (
    !shell.hasHtmlDoctype ||
    !shell.requiredElements.html ||
    !shell.requiredElements.head ||
    !shell.requiredElements.body ||
    !shell.hasModuleEntry
  ) {
    throw new Error(
      `${sourceLabel} must contain a complete Android web application shell with an HTML doctype, explicit html/head/body elements, and a module entry script.`
    );
  }
}

function serializeInlineScriptString(value) {
  return JSON.stringify(value).replace(
    /<\/script(?=[\t\n\f\r />])/gi,
    "<\\/script"
  );
}

export function readApiBaseUrlFromStringsXml(stringsXml) {
  const match = stringsXml.match(
    /<string\s+name="api_base_url">([^<]+)<\/string>/
  );

  if (!match) {
    throw new Error(
      "Android strings.xml is missing the api_base_url string resource"
    );
  }

  return match[1].trim();
}

export function buildNativeAuthBridgeBootstrapScript(apiBaseUrl) {
  const serializedApiBaseUrl = serializeInlineScriptString(apiBaseUrl);
  return (
    `
(function () {
  if (globalThis.__SecPalNativeAuthBootstrapInstalled) {
    return;
  }

  const fallbackApiOrigin = ${serializedApiBaseUrl};
  const nativeAuthLogoutEventName = "secpal:native-auth-logout";
  const nativeAuthLifecycleChangedEventName = "nativeAuthLifecycleChanged";
  const authVaultStateStorageKey = "auth_vault_state";
  const runtimeResetPendingStorageKey =
    "secpal-android-runtime-reset-pending";
  const incompatibleVaultWrapperKind = "native-device-bound";
  const passkeyCapabilityUnavailableReason = "PASSKEY_CAPABILITY_UNAVAILABLE";
  const maxAndroidPushMetadataRevision = 2147483647;
  const legacyAndroidPushIdentityStorageKeyPrefixes = [
    "secpal-android-push-installation:",
    "secpal-android-push-token:",
    "secpal-android-push-token-app:",
    "secpal-android-push-token-saved-at:",
  ];
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
  runtimeState.bootstrapEpoch = Number.isSafeInteger(runtimeState.bootstrapEpoch)
    ? runtimeState.bootstrapEpoch
    : 0;
  runtimeState.bootstrapMutationPromise =
    runtimeState.bootstrapMutationPromise ?? Promise.resolve();
  runtimeState.bootstrapWriteInFlight = runtimeState.bootstrapWriteInFlight === true;
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

  const clearLegacyAndroidPushIdentityStorage = () => {
    for (const storage of [getLocalStorage(), getSessionStorage()]) {
      if (
        !storage ||
        typeof storage.key !== "function" ||
        typeof storage.removeItem !== "function"
      ) {
        continue;
      }

      try {
        const legacyKeys = [];
        const storageLength = Number.isSafeInteger(storage.length)
          ? storage.length
          : 0;

        for (let index = 0; index < storageLength; index += 1) {
          const key = storage.key(index);

          if (
            typeof key === "string" &&
            legacyAndroidPushIdentityStorageKeyPrefixes.some((prefix) =>
              key.startsWith(prefix)
            )
          ) {
            legacyKeys.push(key);
          }
        }

        for (const key of legacyKeys) {
          storage.removeItem(key);
        }
      } catch {
        // Legacy sensitive WebView state cleanup is best-effort only.
      }
    }
  };

  clearLegacyAndroidPushIdentityStorage();

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
      markRuntimeResetPending();
      try {
        await plugin.confirmRuntimeReset();
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

    const pathname = url.pathname.replace(/\\/+$/, "");

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

  const setAuthActive = (nextActive) => {
    const wasActive = authState.active === true;
    const willBeActive = nextActive === true;

    authState.active = willBeActive;
    if (wasActive && !willBeActive) {
      invalidateScheduledNativeFetches();
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
    setAuthActive(false);
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
    }
  };

  restorePersistedBootstrap();
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
      const wasAuthActive = authState.active === true;
      try {
        setAuthActive(false);
        result = await getPlugin().logout();
        didLogoutSucceed = true;
      } finally {
        setAuthActive(didLogoutSucceed ? false : wasAuthActive);
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
`.trimEnd() + "\n"
  );
}

export function buildNativeAuthBridgeAssetName(bootstrapScript) {
  const sha256 = createHash("sha256")
    .update(bootstrapScript, "utf8")
    .digest("hex");
  return `${nativeAuthBridgeAssetPrefix}${sha256}.js`;
}

export function injectNativeAuthBridgeBootstrap(html, apiBaseUrl) {
  const bootstrapScript = buildNativeAuthBridgeBootstrapScript(apiBaseUrl);
  const assetName = buildNativeAuthBridgeAssetName(bootstrapScript);
  const scriptTag = `<script id="${BOOTSTRAP_SCRIPT_ID}" src="/${assetName}"></script>`;
  const shell = inspectAndroidWebApplicationShell(html);

  if (shell.runtimeBridgeScripts.length > 1) {
    throw new Error(
      "Android web index must not contain duplicate native-auth bridge scripts."
    );
  }

  if (shell.runtimeBridgeScripts.length === 1) {
    const [runtimeBridgeScript] = shell.runtimeBridgeScripts;
    const location = runtimeBridgeScript.sourceCodeLocation;
    if (!location?.startTag || !location.endTag) {
      throw new Error(
        "Android web index contains an unterminated native-auth bridge script."
      );
    }
    if (
      shell.moduleEntryStartOffset !== null &&
      location.startTag.startOffset > shell.moduleEntryStartOffset
    ) {
      const htmlWithoutRuntimeBridge = `${html.slice(0, location.startTag.startOffset)}${html.slice(location.endTag.endOffset)}`;
      return injectNativeAuthBridgeBootstrap(
        htmlWithoutRuntimeBridge,
        apiBaseUrl
      );
    }
    return `${html.slice(0, location.startTag.startOffset)}${scriptTag}${html.slice(location.endTag.endOffset)}`;
  }

  if (shell.moduleEntryStartOffset !== null) {
    const lineStartOffset = html.lastIndexOf(
      "\n",
      shell.moduleEntryStartOffset - 1
    );
    const indentation = html.slice(
      lineStartOffset + 1,
      shell.moduleEntryStartOffset
    );
    const moduleIndentation = /^\s*$/.test(indentation) ? indentation : "";
    return `${html.slice(0, shell.moduleEntryStartOffset)}${scriptTag}\n${moduleIndentation}${html.slice(shell.moduleEntryStartOffset)}`;
  }

  if (shell.headEndTagStartOffset !== null) {
    return `${html.slice(0, shell.headEndTagStartOffset)}${scriptTag}\n${html.slice(shell.headEndTagStartOffset)}`;
  }

  return `${scriptTag}\n${html}`;
}

export function injectNativeAuthBridgeIntoFile(indexHtmlPath, stringsXmlPath) {
  const html = readFileSync(indexHtmlPath, "utf8");
  const stringsXml = readFileSync(stringsXmlPath, "utf8");
  assertCompleteAndroidWebApplicationShell(html, indexHtmlPath);
  const apiBaseUrl = readApiBaseUrlFromStringsXml(stringsXml);
  const bootstrapScript = buildNativeAuthBridgeBootstrapScript(apiBaseUrl);
  const assetName = buildNativeAuthBridgeAssetName(bootstrapScript);
  const assetRoot = dirname(indexHtmlPath);
  const injectedHtml = injectNativeAuthBridgeBootstrap(html, apiBaseUrl);

  for (const entry of readdirSync(assetRoot, { withFileTypes: true })) {
    if (!entry.name.startsWith(nativeAuthBridgeAssetPrefix)) {
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `${assetRoot} contains an unsupported native-auth bridge asset entry ${entry.name}.`
      );
    }
    if (entry.name !== assetName) {
      unlinkSync(resolve(assetRoot, entry.name));
    }
  }

  writeFileSync(resolve(assetRoot, assetName), bootstrapScript, "utf8");
  writeFileSync(indexHtmlPath, injectedHtml, "utf8");
}

if (isDirectNodeExecution(import.meta.url)) {
  const indexHtmlPath = process.argv[2];
  const stringsXmlPath = process.argv[3];

  if (!indexHtmlPath || !stringsXmlPath) {
    console.error(
      "Usage: node scripts/inject-native-auth-bridge.mjs <dist-index-html> <strings-xml>"
    );
    process.exit(1);
  }

  injectNativeAuthBridgeIntoFile(indexHtmlPath, stringsXmlPath);
}
