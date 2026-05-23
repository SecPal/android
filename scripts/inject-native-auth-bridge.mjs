#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal
// SPDX-License-Identifier: MIT

import { readFileSync, writeFileSync } from "node:fs";

const BOOTSTRAP_SCRIPT_ID = "secpal-native-auth-bridge-bootstrap";
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
  const serializedApiBaseUrl = JSON.stringify(apiBaseUrl);

  return `
(function () {
  if (globalThis.__SecPalNativeAuthBootstrapInstalled) {
    return;
  }

  const fallbackApiOrigin = ${serializedApiBaseUrl};
  const runtimeStorageKey = "secpal.runtime.bootstrap";
  const discoveryGateId = "secpal-instance-discovery-gate";
  const discoveryInputId = "secpal-instance-discovery-url";
  const discoveryValidateId = "secpal-instance-discovery-validate";
  const discoveryConfirmId = "secpal-instance-discovery-confirm";
  const discoverySummaryId = "secpal-instance-discovery-summary";
  const discoveryErrorId = "secpal-instance-discovery-error";
  const authState = globalThis.__SecPalNativeAuthState ?? { active: false };
  globalThis.__SecPalNativeAuthState = authState;
  const runtimeState = globalThis.__SecPalRuntimeDiscoveryState ?? {
    configured: false,
    bootstrap: null,
    apiOrigin: null,
    pendingBootstrap: null,
    nativeConfigPromise: Promise.resolve(),
  };
  globalThis.__SecPalRuntimeDiscoveryState = runtimeState;

  const getPlugin = () => {
    const plugin = globalThis.Capacitor?.Plugins?.SecPalNativeAuth;
    if (!plugin) {
      throw new Error("SecPal native auth plugin is unavailable");
    }
    return plugin;
  };

  const getEnterprisePlugin = () => {
    const plugin = globalThis.Capacitor?.Plugins?.SecPalEnterprise;
    if (!plugin) {
      throw new Error("SecPal enterprise plugin is unavailable");
    }
    return plugin;
  };

  const getSessionStorage = () => {
    try {
      return globalThis.sessionStorage ?? null;
    } catch {
      return null;
    }
  };

  const clearPersistedBootstrap = () => {
    const storage = getSessionStorage();
    if (storage) {
      storage.removeItem(runtimeStorageKey);
    }
  };

  const persistBootstrap = (bootstrap) => {
    const storage = getSessionStorage();
    if (storage) {
      storage.setItem(runtimeStorageKey, JSON.stringify(bootstrap));
    }
  };

  const toErrorMessage = (error, fallback) => {
    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string" &&
      error.message.trim().length > 0
    ) {
      return error.message;
    }

    if (typeof error === "string" && error.trim().length > 0) {
      return error;
    }

    return fallback;
  };

  const createIncompatibleBootstrapError = () =>
    new Error("This SecPal deployment returned an incompatible bootstrap response.");

  const normalizeBootstrapApiBaseUrl = (value) => {
    let url;

    try {
      url = new URL(value);
    } catch {
      throw new Error("This SecPal deployment returned an invalid API base URL.");
    }

    if (url.protocol !== "https:") {
      throw new Error("This SecPal deployment returned an insecure API base URL.");
    }

    const pathname = url.pathname.replace(/\\/+$/, "");

    if (!pathname || pathname === "") {
      return url.origin;
    }

    if (pathname === "/v1") {
      return url.origin;
    }

    throw new Error("This SecPal deployment returned an incompatible API base URL.");
  };

  const normalizeDiscoveryOrigin = (value) => {
    let normalized = typeof value === "string" ? value.trim() : "";

    if (!normalized) {
      throw new Error("Enter the secure https:// address of your SecPal deployment.");
    }

    if (!/^[a-z][a-z0-9+.-]*:\\/\\//i.test(normalized)) {
      normalized = "https://" + normalized;
    }

    let url;

    try {
      url = new URL(normalized);
    } catch {
      throw new Error("Enter a valid secure https:// address for your SecPal deployment.");
    }

    if (url.protocol !== "https:") {
      throw new Error("Enter a secure https:// address. Insecure http:// deployments are not supported.");
    }

    return url.origin;
  };

  const getRuntimeInfo = async () => {
    const plugin = getPlugin();

    if (typeof plugin.getRuntimeInfo !== "function") {
      throw new Error("This SecPal app cannot read its version information yet.");
    }

    const result = await plugin.getRuntimeInfo();
    const clientPlatform =
      result && typeof result === "object" && typeof result.clientPlatform === "string"
        ? result.clientPlatform
        : "android";
    const appVersion =
      result && typeof result === "object" && typeof result.appVersion === "string"
        ? result.appVersion.trim()
        : "";
    const appBuild = result && typeof result === "object" ? Number(result.appBuild) : Number.NaN;

    if (!appVersion || !Number.isInteger(appBuild) || appBuild <= 0) {
      throw new Error("This SecPal app cannot read its version information yet.");
    }

    return {
      clientPlatform,
      appVersion,
      appBuild,
    };
  };

  const buildBootstrapUrl = (origin, runtimeInfo) => {
    const url = new URL("/v1/bootstrap", origin);
    url.searchParams.set("client_platform", runtimeInfo.clientPlatform);
    url.searchParams.set("app_version", runtimeInfo.appVersion);
    url.searchParams.set("app_build", String(runtimeInfo.appBuild));
    return url;
  };

  const decodeBootstrapJson = async (response) => {
    try {
      return await response.json();
    } catch {
      return null;
    }
  };

  const validateBootstrapPayload = (payload) => {
    const data = payload && typeof payload === "object" ? payload.data : null;

    if (!data || typeof data !== "object") {
      throw createIncompatibleBootstrapError();
    }

    if (data.client_platform !== "android") {
      throw new Error("This SecPal deployment is not compatible with the Android app.");
    }

    const instanceDisplayName =
      data.instance &&
      typeof data.instance === "object" &&
      typeof data.instance.display_name === "string"
        ? data.instance.display_name.trim()
        : "";

    if (!instanceDisplayName) {
      throw createIncompatibleBootstrapError();
    }

    const compatibility = data.compatibility;
    const bootstrapVersion =
      compatibility && typeof compatibility === "object"
        ? compatibility.bootstrap_version
        : null;
    const schemaVersion =
      compatibility && typeof compatibility === "object"
        ? Number(compatibility.schema_version)
        : Number.NaN;
    const minimumSupportedAppVersion =
      compatibility &&
      typeof compatibility === "object" &&
      typeof compatibility.minimum_supported_app_version === "string"
        ? compatibility.minimum_supported_app_version.trim()
        : "";
    const minimumSupportedAppBuild =
      compatibility && typeof compatibility === "object"
        ? Number(compatibility.minimum_supported_app_build)
        : Number.NaN;

    if (
      bootstrapVersion !== "v1" ||
      schemaVersion !== 1 ||
      !minimumSupportedAppVersion ||
      !Number.isInteger(minimumSupportedAppBuild) ||
      minimumSupportedAppBuild <= 0
    ) {
      throw createIncompatibleBootstrapError();
    }

    const features = data.features && typeof data.features === "object" ? data.features : {};

    return {
      instanceDisplayName,
      apiOrigin: normalizeBootstrapApiBaseUrl(data.api_base_url),
      rawApiBaseUrl: String(data.api_base_url),
      minimumSupportedAppVersion,
      minimumSupportedAppBuild,
      features: {
        passwordLoginEnabled: features.password_login === true,
        passkeyLoginEnabled: features.passkey_login === true,
        managedAndroidEnrollment: features.managed_android_enrollment === true,
      },
    };
  };

  const describeBootstrapFailure = (response, payload) => {
    const code = payload && typeof payload === "object" ? payload.code : null;
    const message =
      payload && typeof payload === "object" && typeof payload.message === "string"
        ? payload.message
        : "";

    if (response.status === 426 && message) {
      return message;
    }

    if (code === "BOOTSTRAP_CONFIG_UNAVAILABLE") {
      return (
        message ||
        "Public bootstrap is temporarily unavailable on this deployment. Try again later or contact your administrator."
      );
    }

    if (code === "BOOTSTRAP_STATE_INVALID") {
      return (
        message ||
        "This deployment has an invalid public bootstrap configuration. Contact your administrator."
      );
    }

    return message || "We could not validate that SecPal deployment right now.";
  };

  const applyRuntimeBootstrap = async (bootstrap) => {
    const plugin = getPlugin();

    runtimeState.configured = true;
    runtimeState.bootstrap = bootstrap;
    runtimeState.apiOrigin = bootstrap.apiOrigin;
    runtimeState.pendingBootstrap = null;
    persistBootstrap(bootstrap);

    if (typeof plugin.setApiBaseUrl === "function") {
      runtimeState.nativeConfigPromise = plugin
        .setApiBaseUrl({ apiBaseUrl: bootstrap.apiOrigin })
        .catch((error) => {
          clearPersistedBootstrap();
          runtimeState.configured = false;
          runtimeState.bootstrap = null;
          runtimeState.apiOrigin = null;
          throw error;
        });
    } else {
      runtimeState.nativeConfigPromise = Promise.resolve();
    }

    await runtimeState.nativeConfigPromise;
    return bootstrap.apiOrigin;
  };

  const restorePersistedBootstrap = () => {
    const storage = getSessionStorage();

    if (!storage) {
      return;
    }

    const rawValue = storage.getItem(runtimeStorageKey);

    if (!rawValue) {
      return;
    }

    try {
      const parsed = JSON.parse(rawValue);
      const instanceDisplayName =
        parsed && typeof parsed === "object" && typeof parsed.instanceDisplayName === "string"
          ? parsed.instanceDisplayName.trim()
          : "";
      const minimumSupportedAppVersion =
        parsed && typeof parsed === "object" && typeof parsed.minimumSupportedAppVersion === "string"
          ? parsed.minimumSupportedAppVersion.trim()
          : "";
      const minimumSupportedAppBuild =
        parsed && typeof parsed === "object"
          ? Number(parsed.minimumSupportedAppBuild)
          : Number.NaN;

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
        minimumSupportedAppVersion,
        minimumSupportedAppBuild,
        features: {
          passwordLoginEnabled:
            parsed && typeof parsed === "object" && parsed.features && typeof parsed.features === "object"
              ? parsed.features.passwordLoginEnabled === true
              : false,
          passkeyLoginEnabled:
            parsed && typeof parsed === "object" && parsed.features && typeof parsed.features === "object"
              ? parsed.features.passkeyLoginEnabled === true
              : false,
          managedAndroidEnrollment:
            parsed && typeof parsed === "object" && parsed.features && typeof parsed.features === "object"
              ? parsed.features.managedAndroidEnrollment === true
              : false,
        },
      };

      if (
        !restored.minimumSupportedAppVersion ||
        !Number.isInteger(restored.minimumSupportedAppBuild) ||
        restored.minimumSupportedAppBuild <= 0
      ) {
        throw createIncompatibleBootstrapError();
      }

      runtimeState.configured = true;
      runtimeState.bootstrap = restored;
      runtimeState.apiOrigin = restored.apiOrigin;
      runtimeState.pendingBootstrap = null;

      try {
        const plugin = getPlugin();
        if (typeof plugin.setApiBaseUrl === "function") {
          runtimeState.nativeConfigPromise = plugin
            .setApiBaseUrl({ apiBaseUrl: restored.apiOrigin })
            .catch((error) => {
              clearPersistedBootstrap();
              runtimeState.configured = false;
              runtimeState.bootstrap = null;
              runtimeState.apiOrigin = null;
              throw error;
            });
        }
      } catch {
        runtimeState.nativeConfigPromise = Promise.resolve();
      }
    } catch {
      clearPersistedBootstrap();
      runtimeState.configured = false;
      runtimeState.bootstrap = null;
      runtimeState.apiOrigin = null;
      runtimeState.pendingBootstrap = null;
      runtimeState.nativeConfigPromise = Promise.resolve();
    }
  };

  const ensureRuntimeConfigured = async () => {
    if (!runtimeState.configured || !runtimeState.apiOrigin) {
      throw new Error("This SecPal app is not configured for a deployment yet.");
    }

    await runtimeState.nativeConfigPromise;

    if (!runtimeState.configured || !runtimeState.apiOrigin) {
      throw new Error("This SecPal app is not configured for a deployment yet.");
    }

    return runtimeState.apiOrigin;
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

  const rewriteApiRequestUrl = (url) => {
    if (!runtimeState.configured || !runtimeState.apiOrigin || !isApiPath(url.pathname)) {
      return url;
    }

    const locationHost =
      globalThis.location && typeof globalThis.location.hostname === "string"
        ? globalThis.location.hostname
        : undefined;
    const matchesFallback = url.hostname === fallbackApiHost;
    const matchesLocation = locationHost !== undefined && url.hostname === locationHost;
    const matchesActive = url.hostname === getActiveApiHost();

    if (!matchesFallback && !matchesLocation && !matchesActive) {
      return url;
    }

    return new URL(url.pathname + url.search, runtimeState.apiOrigin);
  };

  const isNativeApiRequest = (url) => {
    return url.pathname.startsWith("/v1/") && url.hostname === getActiveApiHost();
  };

  let discoveryUi = null;

  const getDiscoveryLinkCandidate = () => {
    try {
      const locationHref =
        globalThis.location && typeof globalThis.location.href === "string"
          ? globalThis.location.href
          : fallbackApiOrigin;
      const currentUrl = new URL(locationHref, fallbackApiOrigin);

      return (
        currentUrl.searchParams.get("instance_url") ||
        currentUrl.searchParams.get("server_url") ||
        currentUrl.searchParams.get("bootstrap_url") ||
        null
      );
    } catch {
      return null;
    }
  };

  const removeDiscoveryGate = () => {
    const existing = globalThis.document?.getElementById?.(discoveryGateId);

    if (existing && typeof existing.remove === "function") {
      existing.remove();
    }

    discoveryUi = null;
  };

  const renderDiscoveryGate = () => {
    if (!globalThis.document || !globalThis.document.body || runtimeState.configured) {
      return null;
    }

    const existing = globalThis.document.getElementById(discoveryGateId);
    if (existing && discoveryUi) {
      return discoveryUi;
    }

    const root = globalThis.document.createElement("section");
    root.id = discoveryGateId;
    root.style.position = "fixed";
    root.style.inset = "0";
    root.style.zIndex = "2147483647";
    root.style.padding = "24px";
    root.style.background = "rgba(244, 241, 232, 0.98)";
    root.style.color = "#1f2937";

    const panel = globalThis.document.createElement("div");
    panel.style.maxWidth = "32rem";
    panel.style.margin = "10vh auto";
    panel.style.padding = "24px";
    panel.style.borderRadius = "20px";
    panel.style.border = "1px solid #d6d3d1";
    panel.style.background = "#ffffff";
    panel.style.boxShadow = "0 24px 60px rgba(15, 23, 42, 0.12)";

    const title = globalThis.document.createElement("h1");
    title.textContent = "Connect this SecPal app to your deployment";

    const description = globalThis.document.createElement("p");
    description.textContent =
      "Enter the secure https:// address of your customer-hosted SecPal deployment before login continues.";

    const input = globalThis.document.createElement("input");
    input.id = discoveryInputId;
    input.setAttribute("type", "url");
    input.setAttribute("inputmode", "url");
    input.setAttribute("placeholder", "customer.example or https://customer.example");
    input.style.display = "block";
    input.style.width = "100%";
    input.style.marginTop = "16px";
    input.style.padding = "12px 14px";
    input.style.border = "1px solid #cbd5e1";
    input.style.borderRadius = "12px";

    const validateButton = globalThis.document.createElement("button");
    validateButton.id = discoveryValidateId;
    validateButton.textContent = "Validate deployment";
    validateButton.style.marginTop = "16px";
    validateButton.style.padding = "12px 16px";

    const summary = globalThis.document.createElement("p");
    summary.id = discoverySummaryId;
    summary.style.whiteSpace = "pre-wrap";
    summary.style.marginTop = "16px";

    const error = globalThis.document.createElement("p");
    error.id = discoveryErrorId;
    error.style.marginTop = "16px";
    error.style.color = "#b91c1c";

    const confirmButton = globalThis.document.createElement("button");
    confirmButton.id = discoveryConfirmId;
    confirmButton.textContent = "Use this deployment";
    confirmButton.disabled = true;
    confirmButton.style.marginTop = "16px";
    confirmButton.style.padding = "12px 16px";

    panel.appendChild(title);
    panel.appendChild(description);
    panel.appendChild(input);
    panel.appendChild(validateButton);
    panel.appendChild(summary);
    panel.appendChild(error);
    panel.appendChild(confirmButton);
    root.appendChild(panel);
    globalThis.document.body.appendChild(root);

    discoveryUi = {
      root,
      input,
      validateButton,
      summary,
      error,
      confirmButton,
    };

    validateButton.addEventListener("click", (event) => {
      event.preventDefault();
      void validateDiscoverySelection();
    });

    confirmButton.addEventListener("click", (event) => {
      event.preventDefault();
      void confirmDiscoverySelection();
    });

    return discoveryUi;
  };

  const setDiscoveryBusy = (busy) => {
    const ui = renderDiscoveryGate();

    if (!ui) {
      return;
    }

    ui.input.disabled = busy;
    ui.validateButton.disabled = busy;
    ui.confirmButton.disabled = busy || !runtimeState.pendingBootstrap;
  };

  const setDiscoveryError = (message) => {
    const ui = renderDiscoveryGate();

    if (!ui) {
      return;
    }

    runtimeState.pendingBootstrap = null;
    ui.summary.textContent = "";
    ui.error.textContent = message;
    ui.confirmButton.disabled = true;
  };

  const setDiscoverySummary = (bootstrap) => {
    const ui = renderDiscoveryGate();

    if (!ui) {
      return;
    }

    runtimeState.pendingBootstrap = bootstrap;
    ui.error.textContent = "";
    ui.summary.textContent =
      "Instance: " + bootstrap.instanceDisplayName + "\\nAPI: " + bootstrap.apiOrigin;
    ui.confirmButton.disabled = false;
  };

  const validateDiscoverySelection = async () => {
    const ui = renderDiscoveryGate();

    if (!ui) {
      return;
    }

    setDiscoveryBusy(true);
    ui.error.textContent = "";
    ui.summary.textContent = "";
    runtimeState.pendingBootstrap = null;

    let discoveryOrigin;
    try {
      discoveryOrigin = normalizeDiscoveryOrigin(ui.input.value);
    } catch (error) {
      setDiscoveryBusy(false);
      setDiscoveryError(
        toErrorMessage(error, "Enter a valid secure https:// address for your SecPal deployment.")
      );
      return;
    }

    let runtimeInfo;
    try {
      runtimeInfo = await getRuntimeInfo();
    } catch (error) {
      setDiscoveryBusy(false);
      setDiscoveryError(
        toErrorMessage(error, "This SecPal app cannot read its version information yet.")
      );
      return;
    }

    if (!originalFetch) {
      setDiscoveryBusy(false);
      setDiscoveryError("This SecPal app cannot contact the selected deployment yet.");
      return;
    }

    let response;
    try {
      response = await originalFetch(
        new Request(buildBootstrapUrl(discoveryOrigin, runtimeInfo).toString(), {
          method: "GET",
          headers: new Headers({ Accept: "application/json" }),
        })
      );
    } catch {
      setDiscoveryBusy(false);
      setDiscoveryError(
        "We could not reach that SecPal deployment. Check the URL and your network connection."
      );
      return;
    }

    const payload = await decodeBootstrapJson(response);

    if (!response.ok) {
      setDiscoveryBusy(false);
      setDiscoveryError(describeBootstrapFailure(response, payload));
      return;
    }

    try {
      setDiscoverySummary(validateBootstrapPayload(payload));
    } catch (error) {
      setDiscoveryError(
        toErrorMessage(error, "This SecPal deployment returned an incompatible bootstrap response.")
      );
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const confirmDiscoverySelection = async () => {
    const ui = renderDiscoveryGate();

    if (!ui || !runtimeState.pendingBootstrap) {
      return;
    }

    setDiscoveryBusy(true);
    ui.error.textContent = "";

    try {
      await applyRuntimeBootstrap(runtimeState.pendingBootstrap);
      removeDiscoveryGate();
      if (globalThis.location && typeof globalThis.location.reload === "function") {
        globalThis.location.reload();
      }
    } catch {
      setDiscoveryBusy(false);
      setDiscoveryError("Failed to configure this SecPal deployment in the Android runtime.");
    }
  };

  const mountDiscoveryGate = () => {
    if (runtimeState.configured) {
      removeDiscoveryGate();
      return;
    }

    const ui = renderDiscoveryGate();

    if (!ui) {
      return;
    }

    const discoveryLink = getDiscoveryLinkCandidate();
    if (discoveryLink && !ui.input.value) {
      ui.input.value = discoveryLink;
      void validateDiscoverySelection();
    }
  };

  restorePersistedBootstrap();

  const bridge = {
    async login(credentials) {
      await ensureRuntimeConfigured();
      const result = await getPlugin().login(credentials);
      authState.active = true;
      return result;
    },
    async logout() {
      try {
        return await getPlugin().logout();
      } finally {
        authState.active = false;
      }
    },
    async getCurrentUser() {
      await ensureRuntimeConfigured();
      try {
        const result = await getPlugin().getCurrentUser();
        authState.active = true;
        return result;
      } catch (error) {
        const code = error && typeof error === "object" ? error.code : undefined;
        if (code === "HTTP_401" || code === "NO_STORED_TOKEN") {
          authState.active = false;
        }
        throw error;
      }
    },
    async isNetworkAvailable() {
      const result = await getPlugin().isNetworkAvailable();
      return result && typeof result === "object" ? result.available === true : result === true;
    },
    async request(request) {
      await ensureRuntimeConfigured();
      return getPlugin().request(request);
    },
    async createPasskeyAttestation(options) {
      const result = await getPlugin().createPasskeyAttestation({ publicKey: options });
      return result && typeof result === "object" && "credential" in result
        ? result.credential
        : result;
    },
  };

  if (typeof getPlugin().loginWithPasskey === "function") {
    bridge.loginWithPasskey = async () => {
      await ensureRuntimeConfigured();
      const result = await getPlugin().loginWithPasskey();
      authState.active = true;
      return result;
    };
  }

  if (
    typeof getPlugin().isVaultDeviceBoundWrapperAvailable === "function" &&
    typeof getPlugin().wrapVaultRootKey === "function" &&
    typeof getPlugin().unwrapVaultRootKey === "function"
  ) {
    bridge.isVaultDeviceBoundWrapperAvailable = async () => {
      const result = await getPlugin().isVaultDeviceBoundWrapperAvailable();
      return result && typeof result === "object" ? result.available === true : result === true;
    };
    bridge.wrapVaultRootKey = (options) => getPlugin().wrapVaultRootKey(options);
    bridge.unwrapVaultRootKey = (options) =>
      getPlugin().unwrapVaultRootKey({
        wrappedRootKey: options.wrappedRootKey,
        subjectHash: options.subjectHash,
        metadata: options.metadata,
      });
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
    openGestureNavigationSettings() {
      const plugin = getEnterprisePlugin();
      if (typeof plugin.openGestureNavigationSettings !== "function") {
        throw new Error("SecPal gesture navigation settings are unavailable");
      }
      return plugin.openGestureNavigationSettings();
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
      const request = new Request(input, init);
      let url;

      try {
        const locationHref =
          globalThis.location && typeof globalThis.location.href === "string"
            ? globalThis.location.href
            : fallbackApiOrigin;
        url = new URL(request.url, locationHref);
      } catch {
        return originalFetch(request);
      }

      const rewrittenUrl = rewriteApiRequestUrl(url);

      if (authState.active && isNativeApiRequest(rewrittenUrl)) {
        const requestBody =
          request.method === "GET" || request.method === "HEAD"
            ? undefined
            : await request.arrayBuffer();
        const nativeResponse = await bridge.request({
          method: request.method,
          path: buildPath(rewrittenUrl),
          bodyBase64:
            requestBody && requestBody.byteLength > 0
              ? encodeBase64(new Uint8Array(requestBody))
              : undefined,
          contentType: request.headers.get("Content-Type") ?? undefined,
          accept: request.headers.get("Accept") ?? undefined,
        });
        if (nativeResponse.status === 401) {
          authState.active = false;
        } else {
          authState.active = true;
        }
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
  }

  if (globalThis.document && globalThis.document.body) {
    mountDiscoveryGate();
  } else if (globalThis.document && typeof globalThis.document.addEventListener === "function") {
    globalThis.document.addEventListener("DOMContentLoaded", mountDiscoveryGate);
  }

  globalThis.__SecPalNativeAuthBootstrapInstalled = true;
})();
`.trim();
}

export function injectNativeAuthBridgeBootstrap(html, apiBaseUrl) {
  const scriptTag = `<script id="${BOOTSTRAP_SCRIPT_ID}">${buildNativeAuthBridgeBootstrapScript(apiBaseUrl)}</script>`;
  const existingScriptPattern = new RegExp(
    `<script id="${BOOTSTRAP_SCRIPT_ID}">[\\s\\S]*?<\\/script>`
  );

  if (existingScriptPattern.test(html)) {
    return html.replace(existingScriptPattern, scriptTag);
  }

  const moduleScriptIndex = html.indexOf('<script type="module"');

  if (moduleScriptIndex >= 0) {
    return `${html.slice(0, moduleScriptIndex)}${scriptTag}\n${html.slice(moduleScriptIndex)}`;
  }

  const headCloseIndex = html.indexOf("</head>");

  if (headCloseIndex >= 0) {
    return `${html.slice(0, headCloseIndex)}${scriptTag}\n${html.slice(headCloseIndex)}`;
  }

  return `${scriptTag}\n${html}`;
}

export function injectNativeAuthBridgeIntoFile(indexHtmlPath, stringsXmlPath) {
  const html = readFileSync(indexHtmlPath, "utf8");
  const stringsXml = readFileSync(stringsXmlPath, "utf8");
  const apiBaseUrl = readApiBaseUrlFromStringsXml(stringsXml);
  const injectedHtml = injectNativeAuthBridgeBootstrap(html, apiBaseUrl);
  writeFileSync(indexHtmlPath, injectedHtml, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
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
