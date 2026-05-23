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
  const serializedApiBaseUrl = JSON.stringify(apiBaseUrl).replace(
    /<\/script>/gi,
    "<\\/script>"
  );

  return `
(function () {
  if (globalThis.__SecPalNativeAuthBootstrapInstalled) {
    return;
  }

  const fallbackApiOrigin = ${serializedApiBaseUrl};
  const localeStorageKey = "secpal-locale";
  const runtimeStorageKey = "runtimeBootstrapState";
  const discoveryGateId = "secpal-instance-discovery-gate";
  const discoveryStylesId = "secpal-instance-discovery-styles";
  const discoveryTitleId = "secpal-instance-discovery-title";
  const discoveryDescriptionId = "secpal-instance-discovery-description";
  const discoveryLocaleId = "secpal-instance-discovery-locale";
  const discoveryLogoLightId = "secpal-instance-discovery-logo-light";
  const discoveryLogoDarkId = "secpal-instance-discovery-logo-dark";
  const discoveryInputId = "secpal-instance-discovery-url";
  const discoveryValidateId = "secpal-instance-discovery-validate";
  const discoveryConfirmId = "secpal-instance-discovery-confirm";
  const discoveryNoteTitleId = "secpal-instance-discovery-note-title";
  const discoveryNoteDescriptionId = "secpal-instance-discovery-note-description";
  const discoverySummaryId = "secpal-instance-discovery-summary";
  const discoveryErrorId = "secpal-instance-discovery-error";
  const discoveryFooterPoweredId = "secpal-instance-discovery-footer-powered";
  const discoveryFooterLicenseId = "secpal-instance-discovery-footer-license";
  const discoveryFooterSourceId = "secpal-instance-discovery-footer-source";
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
  runtimeState.discoveryBusyAction = runtimeState.discoveryBusyAction ?? null;
  runtimeState.discoveryErrorMessage = runtimeState.discoveryErrorMessage ?? "";
  runtimeState.discoveryLocale = runtimeState.discoveryLocale ?? null;

  const discoveryLocales = {
    en: "English",
    de: "Deutsch",
  };

  const discoveryTranslations = {
    en: {
      title: "Enter your instance URL",
      description:
        "Enter the instance URL you received from your supervisor.",
      languageLabel: "Select language",
      inputLabel: "Instance URL",
      inputPlaceholder: "https://instance.example",
      noteTitle: "Need the URL?",
      noteDescription:
        "Please ask your supervisor for the instance URL.",
      summaryTitle: "Instance found",
      validate: "Check instance",
      validateBusy: "Checking instance...",
      confirm: "Continue to login",
      confirmBusy: "Preparing login...",
      summaryTemplate: "Instance: {instanceDisplayName}",
      footerPoweredBy: "Powered by SecPal – A guard's best friend",
      footerLicense: "AGPL v3+",
      footerSource: "Source Code",
      errorBootstrapResponse:
        "This instance could not be verified. Contact your administrator.",
      errorBootstrapInvalidApi:
        "This instance could not be verified. Contact your administrator.",
      errorBootstrapInsecureApi:
        "This instance cannot be used. Contact your administrator.",
      errorBootstrapIncompatibleApi:
        "This instance is not compatible with this app. Contact your administrator.",
      errorEnterSecureUrl:
        "Enter the secure https:// instance URL you received from your supervisor.",
      errorEnterValidSecureUrl:
        "Enter a valid secure https:// instance URL.",
      errorInsecureUrl:
        "Only secure https:// instance URLs are supported.",
      errorRuntimeInfoUnavailable:
        "This SecPal app cannot read its version information yet.",
      errorAndroidCompatibility:
        "This instance is not compatible with this app.",
      errorContactSelectedDeployment:
        "This instance cannot be reached right now.",
      errorReachDeployment:
        "We could not reach this instance. Check the URL or contact your supervisor.",
      errorBootstrapUnavailable:
        "This instance is temporarily unavailable. Try again later or contact your administrator.",
      errorBootstrapStateInvalid:
        "This instance is not configured correctly. Contact your administrator.",
      errorConfigureRuntime:
        "This instance could not be set up in the app.",
    },
    de: {
      title: "Instanz-URL eingeben",
      description:
        "Geben Sie die Instanz-URL ein, die Sie von Ihrem Vorgesetzten erhalten haben.",
      languageLabel: "Sprache auswählen",
      inputLabel: "Instanz-URL",
      inputPlaceholder: "https://instanz.example",
      noteTitle: "Noch keine Instanz-URL?",
      noteDescription:
        "Bitte wenden Sie sich an Ihren Vorgesetzten, um die Instanz-URL zu erhalten.",
      summaryTitle: "Instanz gefunden",
      validate: "Instanz prüfen",
      validateBusy: "Instanz wird geprüft...",
      confirm: "Weiter zur Anmeldung",
      confirmBusy: "Anmeldung wird vorbereitet...",
      summaryTemplate: "Instanz: {instanceDisplayName}",
      footerPoweredBy: "Powered by SecPal – Der beste Freund jeder Wache",
      footerLicense: "AGPL v3+",
      footerSource: "Quellcode",
      errorBootstrapResponse:
        "Diese Instanz konnte nicht verifiziert werden. Wenden Sie sich an Ihre Administration.",
      errorBootstrapInvalidApi:
        "Diese Instanz konnte nicht verifiziert werden. Wenden Sie sich an Ihre Administration.",
      errorBootstrapInsecureApi:
        "Diese Instanz kann nicht verwendet werden. Wenden Sie sich an Ihre Administration.",
      errorBootstrapIncompatibleApi:
        "Diese Instanz ist mit dieser App nicht kompatibel. Wenden Sie sich an Ihre Administration.",
      errorEnterSecureUrl:
        "Geben Sie die sichere https://-Instanz-URL ein, die Sie von Ihrem Vorgesetzten erhalten haben.",
      errorEnterValidSecureUrl:
        "Geben Sie eine gültige sichere https://-Instanz-URL ein.",
      errorInsecureUrl:
        "Es werden nur sichere https://-Instanz-URLs unterstützt.",
      errorRuntimeInfoUnavailable:
        "Diese SecPal-App kann ihre Versionsinformationen noch nicht lesen.",
      errorAndroidCompatibility:
        "Diese Instanz ist mit dieser App nicht kompatibel.",
      errorContactSelectedDeployment:
        "Diese Instanz ist derzeit nicht erreichbar.",
      errorReachDeployment:
        "Diese Instanz konnte nicht erreicht werden. Prüfen Sie die URL oder wenden Sie sich an Ihren Vorgesetzten.",
      errorBootstrapUnavailable:
        "Diese Instanz ist vorübergehend nicht verfügbar. Versuchen Sie es später erneut oder wenden Sie sich an Ihre Administration.",
      errorBootstrapStateInvalid:
        "Diese Instanz ist nicht korrekt eingerichtet. Wenden Sie sich an Ihre Administration.",
      errorConfigureRuntime:
        "Diese Instanz konnte in der App nicht eingerichtet werden.",
    },
  };

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

  const getLocalStorage = () => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };

  const normalizeDiscoveryLocale = (value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      return null;
    }

    const normalized = value.trim().toLowerCase().split("-")[0];

    return normalized in discoveryLocales ? normalized : null;
  };

  const detectDiscoveryLocale = () => {
    const storage = getLocalStorage();
    const storedLocale = normalizeDiscoveryLocale(storage?.getItem(localeStorageKey));

    if (storedLocale) {
      return storedLocale;
    }

    const documentLocale = normalizeDiscoveryLocale(globalThis.document?.documentElement?.lang);

    if (documentLocale) {
      return documentLocale;
    }

    const navigatorLocale = normalizeDiscoveryLocale(
      typeof globalThis.navigator === "object" && globalThis.navigator
        ? globalThis.navigator.language
        : null
    );

    return navigatorLocale ?? "en";
  };

  const applyDiscoveryLocale = (value) => {
    const locale = normalizeDiscoveryLocale(value) ?? "en";
    runtimeState.discoveryLocale = locale;

    const storage = getLocalStorage();

    if (storage) {
      try {
        storage.setItem(localeStorageKey, locale);
      } catch {
        // Locale persistence is best-effort; bootstrap must still initialize.
      }
    }

    if (globalThis.document?.documentElement) {
      globalThis.document.documentElement.lang = locale;
    }

    return locale;
  };

  const formatDiscoveryMessage = (template, values) => {
    if (!values || typeof values !== "object") {
      return template;
    }

    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
      if (!(key in values)) {
        return match;
      }

      const replacement = values[key];

      return replacement == null ? "" : String(replacement);
    });
  };

  const translateDiscovery = (key, values) => {
    const locale = normalizeDiscoveryLocale(runtimeState.discoveryLocale) ?? "en";
    const messages = discoveryTranslations[locale] ?? discoveryTranslations.en;
    const fallbackMessages = discoveryTranslations.en;
    const template = messages[key] ?? fallbackMessages[key] ?? key;

    return formatDiscoveryMessage(template, values);
  };

  const ensureDiscoveryStyles = () => {
    if (!globalThis.document) {
      return;
    }

    const existing = globalThis.document.getElementById(discoveryStylesId);

    if (existing) {
      return existing;
    }

    const style = globalThis.document.createElement("style");
    style.id = discoveryStylesId;
    style.textContent = [
      "#" + discoveryGateId + "{position:fixed;inset:0;z-index:2147483647;overflow-y:auto;font-family:Inter,system-ui,sans-serif;color-scheme:light;background:#ffffff;color:#09090b;--secpal-discovery-bg:#ffffff;--secpal-discovery-bg-lg:#fafafa;--secpal-discovery-panel-bg:#ffffff;--secpal-discovery-panel-border:rgba(9,9,11,0.05);--secpal-discovery-panel-shadow:0 1px 2px rgba(15,23,42,0.04),0 24px 48px rgba(15,23,42,0.08);--secpal-discovery-fg:#09090b;--secpal-discovery-muted:#52525b;--secpal-discovery-subtle:#71717a;--secpal-discovery-control-bg:#ffffff;--secpal-discovery-control-border:rgba(9,9,11,0.1);--secpal-discovery-control-border-hover:rgba(9,9,11,0.18);--secpal-discovery-control-shadow:0 1px 2px rgba(15,23,42,0.06);--secpal-discovery-control-ring:#2563eb;--secpal-discovery-note-bg:#fafafa;--secpal-discovery-note-border:rgba(9,9,11,0.08);--secpal-discovery-summary-bg:#f0fdf4;--secpal-discovery-summary-border:#bbf7d0;--secpal-discovery-summary-fg:#166534;--secpal-discovery-error-bg:#fef2f2;--secpal-discovery-error-border:rgba(248,113,113,0.3);--secpal-discovery-error-fg:#991b1b;--secpal-discovery-primary-bg:#18181b;--secpal-discovery-primary-border:rgba(9,9,11,0.92);--secpal-discovery-primary-fg:#fafafa;--secpal-discovery-primary-hover:rgba(255,255,255,0.08);--secpal-discovery-secondary-border:rgba(9,9,11,0.1);--secpal-discovery-secondary-hover:rgba(9,9,11,0.04);}",
      "#" + discoveryGateId + ",#" + discoveryGateId + " *{box-sizing:border-box;}",
      "#" + discoveryGateId + " a{color:inherit;}",
      "#" + discoveryGateId + " .secpal-discovery-shell{min-height:100dvh;display:flex;flex-direction:column;background:var(--secpal-discovery-bg);padding:1rem;}",
      "#" + discoveryGateId + " .secpal-discovery-frame{display:flex;flex:1 1 auto;flex-direction:column;width:min(100%,42rem);margin:0 auto;}",
      "#" + discoveryGateId + " .secpal-discovery-panel{display:flex;flex:1 1 auto;flex-direction:column;padding:2rem;}",
      "#" + discoveryGateId + " .secpal-discovery-spacer{flex:1 1 auto;min-height:2rem;}",
      "#" + discoveryGateId + " .secpal-discovery-spacer--top{display:block;}",
      "#" + discoveryGateId + " .secpal-discovery-header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;}",
      "#" + discoveryGateId + " .secpal-discovery-brand{display:flex;align-items:center;gap:0.75rem;min-width:0;}",
      "#" + discoveryGateId + " .secpal-discovery-logo{position:relative;display:flex;align-items:center;justify-content:center;width:3rem;height:3rem;flex:none;}",
      "#" + discoveryGateId + " .secpal-discovery-logo-image{display:block;width:3rem;height:3rem;object-fit:contain;}",
      "#" + discoveryGateId + " .secpal-discovery-logo-image--dark{display:none;}",
      "#" + discoveryGateId + " .secpal-discovery-brand-copy{min-width:0;}",
      "#" + discoveryGateId + " .secpal-discovery-brand-name{margin:0;font-size:1.875rem;line-height:1;font-weight:700;letter-spacing:-0.03em;color:inherit;}",
      "#" + discoveryGateId + " .secpal-discovery-locale{min-width:8rem;max-width:10rem;}",
      "#" + discoveryGateId + " .secpal-discovery-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}",
      "#" + discoveryGateId + " .secpal-discovery-control{position:relative;display:block;width:100%;}",
      "#" + discoveryGateId + " .secpal-discovery-control::before{content:'';position:absolute;inset:1px;border-radius:calc(0.5rem - 1px);background:var(--secpal-discovery-control-bg);box-shadow:var(--secpal-discovery-control-shadow);pointer-events:none;}",
      "#" + discoveryGateId + " .secpal-discovery-control::after{content:'';position:absolute;inset:0;border-radius:0.5rem;box-shadow:0 0 0 0 var(--secpal-discovery-control-ring);opacity:0;pointer-events:none;transition:opacity 0.15s ease;}",
      "#" + discoveryGateId + " .secpal-discovery-control:focus-within::after{opacity:1;box-shadow:0 0 0 2px var(--secpal-discovery-control-ring);}",
      "#" + discoveryGateId + " .secpal-discovery-select,#" + discoveryGateId + " .secpal-discovery-input{position:relative;display:block;width:100%;appearance:none;border-radius:0.5rem;border:1px solid var(--secpal-discovery-control-border);background:transparent;color:var(--secpal-discovery-fg);padding:0.6875rem 0.875rem;font:inherit;line-height:1.5;transition:border-color 0.15s ease,opacity 0.15s ease;}",
      "#" + discoveryGateId + " .secpal-discovery-select{padding-right:2.75rem;}",
      "#" + discoveryGateId + " .secpal-discovery-select:hover,#" + discoveryGateId + " .secpal-discovery-input:hover{border-color:var(--secpal-discovery-control-border-hover);}",
      "#" + discoveryGateId + " .secpal-discovery-select:focus,#" + discoveryGateId + " .secpal-discovery-input:focus{outline:none;}",
      "#" + discoveryGateId + " .secpal-discovery-input::placeholder{color:var(--secpal-discovery-subtle);}",
      "#" + discoveryGateId + " .secpal-discovery-input[aria-invalid='true']{border-color:#dc2626;}",
      "#" + discoveryGateId + " .secpal-discovery-select-chevron{pointer-events:none;position:absolute;inset-block:0;right:0;display:flex;align-items:center;padding-right:0.75rem;color:var(--secpal-discovery-subtle);}",
      "#" + discoveryGateId + " .secpal-discovery-select-chevron svg{display:block;width:1rem;height:1rem;stroke:currentColor;}",
      "#" + discoveryGateId + " .secpal-discovery-title{margin:2rem 0 0;font-size:1.5rem;line-height:1.2;font-weight:600;letter-spacing:-0.02em;color:inherit;}",
      "#" + discoveryGateId + " .secpal-discovery-description{margin:0.75rem 0 0;color:var(--secpal-discovery-muted);font-size:1rem;line-height:1.6;}",
      "#" + discoveryGateId + " .secpal-discovery-form{margin:2.5rem 0 0;display:flex;flex-direction:column;gap:2rem;}",
      "#" + discoveryGateId + " .secpal-discovery-note,#" + discoveryGateId + " .secpal-discovery-summary,#" + discoveryGateId + " .secpal-discovery-error{border-radius:0.5rem;padding:1rem;white-space:pre-wrap;}",
      "#" + discoveryGateId + " .secpal-discovery-note{border:1px solid var(--secpal-discovery-note-border);background:var(--secpal-discovery-note-bg);}",
      "#" + discoveryGateId + " .secpal-discovery-note-title,#" + discoveryGateId + " .secpal-discovery-summary-title{margin:0;font-size:0.95rem;line-height:1.5;font-weight:600;color:inherit;}",
      "#" + discoveryGateId + " .secpal-discovery-note-description,#" + discoveryGateId + " .secpal-discovery-summary-body{margin:0.35rem 0 0;color:var(--secpal-discovery-muted);font-size:0.95rem;line-height:1.6;}",
      "#" + discoveryGateId + " .secpal-discovery-summary-body{color:inherit;}",
      "#" + discoveryGateId + " .secpal-discovery-field{display:flex;flex-direction:column;}",
      "#" + discoveryGateId + " .secpal-discovery-label{display:block;font-size:1rem;line-height:1.5;font-weight:500;color:inherit;}",
      "#" + discoveryGateId + " .secpal-discovery-control-wrap{margin-top:0.75rem;}",
      "#" + discoveryGateId + " .secpal-discovery-actions{display:flex;flex-direction:column;gap:0.75rem;}",
      "#" + discoveryGateId + " .secpal-discovery-button{position:relative;isolation:isolate;display:inline-flex;align-items:center;justify-content:center;width:100%;gap:0.5rem;border-radius:0.5rem;border:1px solid transparent;padding:0.6875rem 0.875rem;font:inherit;font-weight:600;line-height:1.5;transition:border-color 0.15s ease,color 0.15s ease,opacity 0.15s ease;}",
      "#" + discoveryGateId + " .secpal-discovery-button::before{content:'';position:absolute;inset:0;z-index:-2;border-radius:calc(0.5rem - 1px);pointer-events:none;}",
      "#" + discoveryGateId + " .secpal-discovery-button::after{content:'';position:absolute;inset:0;z-index:-1;border-radius:calc(0.5rem - 1px);pointer-events:none;transition:background-color 0.15s ease;}",
      "#" + discoveryGateId + " .secpal-discovery-button:disabled{opacity:0.55;cursor:not-allowed;}",
      "#" + discoveryGateId + " .secpal-discovery-button--primary{background:var(--secpal-discovery-primary-border);color:var(--secpal-discovery-primary-fg);}",
      "#" + discoveryGateId + " .secpal-discovery-button--primary::before{background:var(--secpal-discovery-primary-bg);box-shadow:0 1px 2px rgba(15,23,42,0.08);}",
      "#" + discoveryGateId + " .secpal-discovery-button--primary:not(:disabled):hover::after{background:var(--secpal-discovery-primary-hover);}",
      "#" + discoveryGateId + " .secpal-discovery-button--secondary{border-color:var(--secpal-discovery-secondary-border);color:var(--secpal-discovery-fg);}",
      "#" + discoveryGateId + " .secpal-discovery-button--secondary::before{background:transparent;box-shadow:none;}",
      "#" + discoveryGateId + " .secpal-discovery-button--secondary:not(:disabled):hover::after{background:var(--secpal-discovery-secondary-hover);}",
      "#" + discoveryGateId + " .secpal-discovery-summary{display:none;border:1px solid var(--secpal-discovery-summary-border);background:var(--secpal-discovery-summary-bg);color:var(--secpal-discovery-summary-fg);}",
      "#" + discoveryGateId + " .secpal-discovery-error{display:none;border:1px solid var(--secpal-discovery-error-border);background:var(--secpal-discovery-error-bg);color:var(--secpal-discovery-error-fg);font-size:0.95rem;line-height:1.6;}",
      "#" + discoveryGateId + " .secpal-discovery-error p{margin:0;}",
      "#" + discoveryGateId + " .secpal-discovery-footer{padding-top:2rem;text-align:center;font-size:11px;line-height:1.5;}",
      "#" + discoveryGateId + " .secpal-discovery-footer-powered{display:inline-flex;align-items:center;justify-content:center;font-weight:600;color:var(--secpal-discovery-muted);text-decoration:none;}",
      "#" + discoveryGateId + " .secpal-discovery-footer-powered:hover{color:var(--secpal-discovery-fg);}",
      "#" + discoveryGateId + " .secpal-discovery-footer-meta{display:flex;align-items:center;justify-content:center;gap:0.75rem;flex-wrap:wrap;margin-top:0.5rem;}",
      "#" + discoveryGateId + " .secpal-discovery-footer-link{display:inline-flex;align-items:center;justify-content:center;color:var(--secpal-discovery-subtle);text-decoration:none;}",
      "#" + discoveryGateId + " .secpal-discovery-footer-link:hover{color:var(--secpal-discovery-fg);}",
      "#" + discoveryGateId + " .secpal-discovery-footer-separator{color:rgba(113,113,122,0.45);}",
      "@media (min-width: 1024px){#" + discoveryGateId + "{background:var(--secpal-discovery-bg-lg);}#" + discoveryGateId + " .secpal-discovery-shell{padding:2rem;}#" + discoveryGateId + " .secpal-discovery-panel{border-radius:0.5rem;background:var(--secpal-discovery-panel-bg);border:1px solid var(--secpal-discovery-panel-border);box-shadow:var(--secpal-discovery-panel-shadow);padding:3rem;}#" + discoveryGateId + " .secpal-discovery-spacer--top{display:none;}#" + discoveryGateId + " .secpal-discovery-title{font-size:1.875rem;}}",
      "@media (prefers-color-scheme: dark){#" + discoveryGateId + "{color-scheme:dark;background:#18181b;color:#f4f4f5;--secpal-discovery-bg:#18181b;--secpal-discovery-bg-lg:#09090b;--secpal-discovery-panel-bg:#18181b;--secpal-discovery-panel-border:rgba(255,255,255,0.1);--secpal-discovery-panel-shadow:0 1px 2px rgba(0,0,0,0.3),0 28px 80px rgba(0,0,0,0.45);--secpal-discovery-fg:#f4f4f5;--secpal-discovery-muted:#d4d4d8;--secpal-discovery-subtle:#a1a1aa;--secpal-discovery-control-bg:rgba(255,255,255,0.04);--secpal-discovery-control-border:rgba(255,255,255,0.12);--secpal-discovery-control-border-hover:rgba(255,255,255,0.22);--secpal-discovery-control-shadow:none;--secpal-discovery-note-bg:rgba(39,39,42,0.92);--secpal-discovery-note-border:rgba(255,255,255,0.1);--secpal-discovery-summary-bg:rgba(20,83,45,0.35);--secpal-discovery-summary-border:rgba(134,239,172,0.28);--secpal-discovery-summary-fg:#dcfce7;--secpal-discovery-error-bg:rgba(127,29,29,0.28);--secpal-discovery-error-border:rgba(248,113,113,0.25);--secpal-discovery-error-fg:#fecaca;--secpal-discovery-primary-bg:#fafafa;--secpal-discovery-primary-border:rgba(255,255,255,0.92);--secpal-discovery-primary-fg:#18181b;--secpal-discovery-primary-hover:rgba(24,24,27,0.08);--secpal-discovery-secondary-border:rgba(255,255,255,0.12);--secpal-discovery-secondary-hover:rgba(255,255,255,0.06);}#" + discoveryGateId + " .secpal-discovery-logo-image--light{display:none;}#" + discoveryGateId + " .secpal-discovery-logo-image--dark{display:block;}#" + discoveryGateId + " .secpal-discovery-control::before{display:none;}#" + discoveryGateId + " .secpal-discovery-footer-separator{color:rgba(161,161,170,0.4);}}",
    ].join("\\n");

    const parent = globalThis.document.head ?? globalThis.document.body;
    parent?.appendChild(style);

    return style;
  };

  applyDiscoveryLocale(runtimeState.discoveryLocale ?? detectDiscoveryLocale());

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
    new Error(translateDiscovery("errorBootstrapResponse"));

  const normalizeBootstrapApiBaseUrl = (value) => {
    let url;

    try {
      url = new URL(value);
    } catch {
      throw new Error(translateDiscovery("errorBootstrapInvalidApi"));
    }

    if (url.protocol !== "https:") {
      throw new Error(translateDiscovery("errorBootstrapInsecureApi"));
    }

    const pathname = url.pathname.replace(/\\/+$/, "");

    if (!pathname || pathname === "") {
      return url.origin;
    }

    if (pathname === "/v1") {
      return url.origin;
    }

    throw new Error(translateDiscovery("errorBootstrapIncompatibleApi"));
  };

  const normalizeDiscoveryOrigin = (value) => {
    let normalized = typeof value === "string" ? value.trim() : "";

    if (!normalized) {
      throw new Error(translateDiscovery("errorEnterSecureUrl"));
    }

    if (!/^[a-z][a-z0-9+.-]*:\\/\\//i.test(normalized)) {
      normalized = "https://" + normalized;
    }

    let url;

    try {
      url = new URL(normalized);
    } catch {
      throw new Error(translateDiscovery("errorEnterValidSecureUrl"));
    }

    if (url.protocol !== "https:") {
      throw new Error(translateDiscovery("errorInsecureUrl"));
    }

    const pathname = url.pathname.replace(/\\/+$/, "");

    if (url.username || url.password || pathname !== "" || url.search || url.hash) {
      throw new Error(translateDiscovery("errorEnterValidSecureUrl"));
    }

    return url.origin;
  };

  const getRuntimeInfo = async () => {
    const plugin = getPlugin();

    if (typeof plugin.getRuntimeInfo !== "function") {
      throw new Error(translateDiscovery("errorRuntimeInfoUnavailable"));
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
      throw new Error(translateDiscovery("errorRuntimeInfoUnavailable"));
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
      throw new Error(translateDiscovery("errorAndroidCompatibility"));
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

    if (response.status === 426) {
      return message || translateDiscovery("errorBootstrapIncompatibleApi");
    }

    if (code === "BOOTSTRAP_CONFIG_UNAVAILABLE") {
      return (
        message ||
        translateDiscovery("errorBootstrapUnavailable")
      );
    }

    if (code === "BOOTSTRAP_STATE_INVALID") {
      return (
        message ||
        translateDiscovery("errorBootstrapStateInvalid")
      );
    }

    return message || translateDiscovery("errorBootstrapResponse");
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
              runtimeState.pendingBootstrap = null;
              runtimeState.nativeConfigPromise = Promise.resolve();
              mountDiscoveryGate();
              console.warn("Failed to restore persisted SecPal bootstrap.", error);
            });
        } else {
          runtimeState.nativeConfigPromise = Promise.resolve();
        }
      } catch {
        clearPersistedBootstrap();
        runtimeState.configured = false;
        runtimeState.bootstrap = null;
        runtimeState.apiOrigin = null;
        runtimeState.pendingBootstrap = null;
        runtimeState.nativeConfigPromise = Promise.resolve();
        mountDiscoveryGate();
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

  const syncDiscoveryGateCopy = () => {
    if (!discoveryUi) {
      return;
    }

    discoveryUi.localeLabel.textContent = translateDiscovery("languageLabel");
    discoveryUi.localeSelect.setAttribute(
      "aria-label",
      translateDiscovery("languageLabel")
    );
    discoveryUi.title.textContent = translateDiscovery("title");
    discoveryUi.description.textContent = translateDiscovery("description");
    discoveryUi.noteTitle.textContent = translateDiscovery("noteTitle");
    discoveryUi.noteDescription.textContent = translateDiscovery("noteDescription");
    discoveryUi.inputLabel.textContent = translateDiscovery("inputLabel");
    discoveryUi.input.setAttribute(
      "placeholder",
      translateDiscovery("inputPlaceholder")
    );
    discoveryUi.footerPoweredLink.textContent = translateDiscovery("footerPoweredBy");
    discoveryUi.footerLicenseLink.textContent = translateDiscovery("footerLicense");
    discoveryUi.footerSourceLink.textContent = translateDiscovery("footerSource");
    discoveryUi.validateButton.textContent =
      runtimeState.discoveryBusyAction === "validate"
        ? translateDiscovery("validateBusy")
        : translateDiscovery("validate");
    discoveryUi.confirmButton.textContent =
      runtimeState.discoveryBusyAction === "confirm"
        ? translateDiscovery("confirmBusy")
        : translateDiscovery("confirm");

    if (runtimeState.pendingBootstrap) {
      discoveryUi.summary.style.display = "block";
      discoveryUi.summaryTitle.textContent = translateDiscovery("summaryTitle");
      discoveryUi.summaryBody.textContent = translateDiscovery("summaryTemplate", {
        instanceDisplayName: runtimeState.pendingBootstrap.instanceDisplayName,
        apiOrigin: runtimeState.pendingBootstrap.apiOrigin,
      });
    } else {
      discoveryUi.summary.style.display = "none";
      discoveryUi.summaryTitle.textContent = "";
      discoveryUi.summaryBody.textContent = "";
    }

    if (runtimeState.discoveryErrorMessage) {
      discoveryUi.error.style.display = "block";
      discoveryUi.error.textContent = runtimeState.discoveryErrorMessage;
    } else {
      discoveryUi.error.style.display = "none";
      discoveryUi.error.textContent = "";
    }

    discoveryUi.input.setAttribute(
      "aria-invalid",
      runtimeState.discoveryErrorMessage ? "true" : "false"
    );
    discoveryUi.validateButton.disabled = runtimeState.discoveryBusyAction !== null;
    discoveryUi.confirmButton.disabled =
      runtimeState.discoveryBusyAction !== null || !runtimeState.pendingBootstrap;
    discoveryUi.confirmButton.style.display = runtimeState.pendingBootstrap
      ? "inline-flex"
      : "none";
  };

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

    ensureDiscoveryStyles();

    const existing = globalThis.document.getElementById(discoveryGateId);
    if (existing && discoveryUi) {
      syncDiscoveryGateCopy();
      return discoveryUi;
    }

    const root = globalThis.document.createElement("section");
    root.id = discoveryGateId;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", discoveryTitleId);
    root.setAttribute("aria-describedby", discoveryDescriptionId);

    const shell = globalThis.document.createElement("main");
    shell.className = "secpal-discovery-shell";

    const frame = globalThis.document.createElement("div");
    frame.className = "secpal-discovery-frame";

    const panel = globalThis.document.createElement("div");
    panel.className = "secpal-discovery-panel";

    const topSpacer = globalThis.document.createElement("div");
    topSpacer.className = "secpal-discovery-spacer secpal-discovery-spacer--top";

    const bottomSpacer = globalThis.document.createElement("div");
    bottomSpacer.className = "secpal-discovery-spacer secpal-discovery-spacer--bottom";

    const header = globalThis.document.createElement("div");
    header.className = "secpal-discovery-header";

    const brand = globalThis.document.createElement("div");
    brand.className = "secpal-discovery-brand";

    const brandLogo = globalThis.document.createElement("div");
    brandLogo.className = "secpal-discovery-logo";
    brandLogo.setAttribute("role", "img");
    brandLogo.setAttribute("aria-label", "SecPal");

    const brandLogoLight = globalThis.document.createElement("img");
    brandLogoLight.id = discoveryLogoLightId;
    brandLogoLight.className =
      "secpal-discovery-logo-image secpal-discovery-logo-image--light";
    brandLogoLight.setAttribute("src", "/logo-light-48.png");
    brandLogoLight.setAttribute("alt", "");
    brandLogoLight.setAttribute("aria-hidden", "true");
    brandLogoLight.setAttribute("width", "48");
    brandLogoLight.setAttribute("height", "48");

    const brandLogoDark = globalThis.document.createElement("img");
    brandLogoDark.id = discoveryLogoDarkId;
    brandLogoDark.className =
      "secpal-discovery-logo-image secpal-discovery-logo-image--dark";
    brandLogoDark.setAttribute("src", "/logo-dark-48.png");
    brandLogoDark.setAttribute("alt", "");
    brandLogoDark.setAttribute("aria-hidden", "true");
    brandLogoDark.setAttribute("width", "48");
    brandLogoDark.setAttribute("height", "48");

    const brandCopy = globalThis.document.createElement("div");
    brandCopy.className = "secpal-discovery-brand-copy";

    const brandName = globalThis.document.createElement("p");
    brandName.className = "secpal-discovery-brand-name";
    brandName.textContent = "SecPal";

    const localeWrap = globalThis.document.createElement("div");
    localeWrap.className = "secpal-discovery-locale";

    const localeLabel = globalThis.document.createElement("label");
    localeLabel.className = "secpal-discovery-sr-only";
    localeLabel.setAttribute("for", discoveryLocaleId);

    const localeControl = globalThis.document.createElement("div");
    localeControl.className = "secpal-discovery-control";

    const localeSelect = globalThis.document.createElement("select");
    localeSelect.id = discoveryLocaleId;
    localeSelect.className = "secpal-discovery-select";

    for (const [localeCode, localeName] of Object.entries(discoveryLocales)) {
      const option = globalThis.document.createElement("option");
      option.value = localeCode;
      option.textContent = localeName;
      localeSelect.appendChild(option);
    }

    localeSelect.value = applyDiscoveryLocale(runtimeState.discoveryLocale);

  const localeChevron = globalThis.document.createElement("span");
  localeChevron.className = "secpal-discovery-select-chevron";
  localeChevron.setAttribute("aria-hidden", "true");

  const svgNamespace = "http://www.w3.org/2000/svg";
  const localeChevronSvg = globalThis.document.createElementNS(svgNamespace, "svg");
  localeChevronSvg.setAttribute("viewBox", "0 0 16 16");
  localeChevronSvg.setAttribute("fill", "none");

  const localeChevronPathDown = globalThis.document.createElementNS(svgNamespace, "path");
  localeChevronPathDown.setAttribute("d", "M5.75 10.75L8 13L10.25 10.75");
  localeChevronPathDown.setAttribute("stroke-width", "1.5");
  localeChevronPathDown.setAttribute("stroke-linecap", "round");
  localeChevronPathDown.setAttribute("stroke-linejoin", "round");

  const localeChevronPathUp = globalThis.document.createElementNS(svgNamespace, "path");
  localeChevronPathUp.setAttribute("d", "M10.25 5.25L8 3L5.75 5.25");
  localeChevronPathUp.setAttribute("stroke-width", "1.5");
  localeChevronPathUp.setAttribute("stroke-linecap", "round");
  localeChevronPathUp.setAttribute("stroke-linejoin", "round");

  localeChevronSvg.appendChild(localeChevronPathDown);
  localeChevronSvg.appendChild(localeChevronPathUp);
  localeChevron.appendChild(localeChevronSvg);

    const title = globalThis.document.createElement("h1");
    title.id = discoveryTitleId;
    title.className = "secpal-discovery-title";

    const description = globalThis.document.createElement("p");
    description.id = discoveryDescriptionId;
    description.className = "secpal-discovery-description";

  const form = globalThis.document.createElement("div");
  form.className = "secpal-discovery-form";

    const note = globalThis.document.createElement("div");
    note.className = "secpal-discovery-note";

    const noteTitle = globalThis.document.createElement("p");
    noteTitle.id = discoveryNoteTitleId;
    noteTitle.className = "secpal-discovery-note-title";

    const noteDescription = globalThis.document.createElement("p");
    noteDescription.id = discoveryNoteDescriptionId;
    noteDescription.className = "secpal-discovery-note-description";

    const field = globalThis.document.createElement("div");
    field.className = "secpal-discovery-field";

    const inputLabel = globalThis.document.createElement("label");
    inputLabel.className = "secpal-discovery-label";
    inputLabel.setAttribute("for", discoveryInputId);

    const inputControl = globalThis.document.createElement("div");
    inputControl.className = "secpal-discovery-control secpal-discovery-control-wrap";

    const input = globalThis.document.createElement("input");
    input.id = discoveryInputId;
    input.className = "secpal-discovery-input";
    input.setAttribute("type", "url");
    input.setAttribute("inputmode", "url");
    input.setAttribute("autocomplete", "url");
    input.setAttribute("enterkeyhint", "go");
    input.setAttribute("spellcheck", "false");

    const validateButton = globalThis.document.createElement("button");
    validateButton.id = discoveryValidateId;
    validateButton.className =
      "secpal-discovery-button secpal-discovery-button--primary";
    validateButton.setAttribute("type", "button");

    const summary = globalThis.document.createElement("div");
    summary.id = discoverySummaryId;
    summary.className = "secpal-discovery-summary";
    summary.setAttribute("aria-live", "polite");

    const summaryTitle = globalThis.document.createElement("p");
    summaryTitle.className = "secpal-discovery-summary-title";

    const summaryBody = globalThis.document.createElement("p");
    summaryBody.className = "secpal-discovery-summary-body";

    const error = globalThis.document.createElement("div");
    error.id = discoveryErrorId;
    error.className = "secpal-discovery-error";
    error.setAttribute("role", "alert");
    error.setAttribute("aria-live", "assertive");

    const confirmButton = globalThis.document.createElement("button");
    confirmButton.id = discoveryConfirmId;
    confirmButton.className =
      "secpal-discovery-button secpal-discovery-button--secondary";
    confirmButton.setAttribute("type", "button");
    confirmButton.disabled = true;
    confirmButton.style.display = "none";

    const actions = globalThis.document.createElement("div");
    actions.className = "secpal-discovery-actions";

    const footer = globalThis.document.createElement("footer");
    footer.className = "secpal-discovery-footer";

    const footerPoweredLink = globalThis.document.createElement("a");
    footerPoweredLink.id = discoveryFooterPoweredId;
    footerPoweredLink.className = "secpal-discovery-footer-powered";
    footerPoweredLink.setAttribute("href", "https://secpal.app");
    footerPoweredLink.setAttribute("target", "_blank");
    footerPoweredLink.setAttribute("rel", "noopener noreferrer");

    const footerMeta = globalThis.document.createElement("div");
    footerMeta.className = "secpal-discovery-footer-meta";

    const footerLicenseLink = globalThis.document.createElement("a");
    footerLicenseLink.id = discoveryFooterLicenseId;
    footerLicenseLink.className = "secpal-discovery-footer-link";
    footerLicenseLink.setAttribute(
      "href",
      "https://www.gnu.org/licenses/agpl-3.0.html"
    );
    footerLicenseLink.setAttribute("target", "_blank");
    footerLicenseLink.setAttribute("rel", "noopener noreferrer");

    const footerSeparator = globalThis.document.createElement("span");
    footerSeparator.className = "secpal-discovery-footer-separator";
    footerSeparator.setAttribute("aria-hidden", "true");
    footerSeparator.textContent = "|";

    const footerSourceLink = globalThis.document.createElement("a");
    footerSourceLink.id = discoveryFooterSourceId;
    footerSourceLink.className = "secpal-discovery-footer-link";
    footerSourceLink.setAttribute("href", "https://github.com/SecPal");
    footerSourceLink.setAttribute("target", "_blank");
    footerSourceLink.setAttribute("rel", "noopener noreferrer");

    brandLogo.appendChild(brandLogoLight);
    brandLogo.appendChild(brandLogoDark);
    brandCopy.appendChild(brandName);
    brand.appendChild(brandLogo);
    brand.appendChild(brandCopy);
    localeControl.appendChild(localeSelect);
    localeControl.appendChild(localeChevron);
    localeWrap.appendChild(localeLabel);
    localeWrap.appendChild(localeControl);
    header.appendChild(brand);
    header.appendChild(localeWrap);
    note.appendChild(noteTitle);
    note.appendChild(noteDescription);
    field.appendChild(inputLabel);
    inputControl.appendChild(input);
    field.appendChild(inputControl);
    summary.appendChild(summaryTitle);
    summary.appendChild(summaryBody);
    actions.appendChild(validateButton);
    actions.appendChild(summary);
    actions.appendChild(error);
    actions.appendChild(confirmButton);
    form.appendChild(note);
    form.appendChild(field);
    form.appendChild(actions);
    footerMeta.appendChild(footerLicenseLink);
    footerMeta.appendChild(footerSeparator);
    footerMeta.appendChild(footerSourceLink);
    footer.appendChild(footerPoweredLink);
    footer.appendChild(footerMeta);
    panel.appendChild(topSpacer);
    panel.appendChild(header);
    panel.appendChild(title);
    panel.appendChild(description);
    panel.appendChild(form);
    panel.appendChild(bottomSpacer);
    panel.appendChild(footer);
    frame.appendChild(panel);
    shell.appendChild(frame);
    root.appendChild(shell);
    globalThis.document.body.appendChild(root);

    discoveryUi = {
      root,
      localeLabel,
      localeSelect,
      title,
      description,
      noteTitle,
      noteDescription,
      inputLabel,
      input,
      validateButton,
      summary,
      summaryTitle,
      summaryBody,
      error,
      confirmButton,
      footerPoweredLink,
      footerLicenseLink,
      footerSourceLink,
    };

    localeSelect.addEventListener("change", () => {
      applyDiscoveryLocale(localeSelect.value);
      syncDiscoveryGateCopy();
    });

    validateButton.addEventListener("click", (event) => {
      event.preventDefault();
      void validateDiscoverySelection();
    });

    input.addEventListener("keydown", (event) => {
      if (event && event.key === "Enter") {
        event.preventDefault();
        void validateDiscoverySelection();
      }
    });

    confirmButton.addEventListener("click", (event) => {
      event.preventDefault();
      void confirmDiscoverySelection();
    });

    syncDiscoveryGateCopy();

    return discoveryUi;
  };

  const setDiscoveryBusy = (busy, action) => {
    const ui = renderDiscoveryGate();

    if (!ui) {
      return;
    }

    runtimeState.discoveryBusyAction = busy ? action ?? "validate" : null;
    ui.input.disabled = busy;
    syncDiscoveryGateCopy();
  };

  const setDiscoveryError = (message) => {
    const ui = renderDiscoveryGate();

    if (!ui) {
      return;
    }

    runtimeState.pendingBootstrap = null;
    runtimeState.discoveryErrorMessage = message;
    syncDiscoveryGateCopy();
  };

  const setDiscoverySummary = (bootstrap) => {
    const ui = renderDiscoveryGate();

    if (!ui) {
      return;
    }

    runtimeState.pendingBootstrap = bootstrap;
    runtimeState.discoveryErrorMessage = "";
    syncDiscoveryGateCopy();
  };

  const validateDiscoverySelection = async () => {
    const ui = renderDiscoveryGate();

    if (!ui) {
      return;
    }

    setDiscoveryBusy(true, "validate");
    runtimeState.discoveryErrorMessage = "";
    runtimeState.pendingBootstrap = null;
    syncDiscoveryGateCopy();

    let discoveryOrigin;
    try {
      discoveryOrigin = normalizeDiscoveryOrigin(ui.input.value);
    } catch (error) {
      setDiscoveryBusy(false);
      setDiscoveryError(toErrorMessage(error, translateDiscovery("errorEnterValidSecureUrl")));
      return;
    }

    let runtimeInfo;
    try {
      runtimeInfo = await getRuntimeInfo();
    } catch (error) {
      setDiscoveryBusy(false);
      setDiscoveryError(toErrorMessage(error, translateDiscovery("errorRuntimeInfoUnavailable")));
      return;
    }

    if (!originalFetch) {
      setDiscoveryBusy(false);
      setDiscoveryError(translateDiscovery("errorContactSelectedDeployment"));
      return;
    }

    let response;
    try {
      response = await originalFetch(
        new Request(buildBootstrapUrl(discoveryOrigin, runtimeInfo).toString(), {
          method: "GET",
          headers: new Headers({
            Accept: "application/json",
            "Accept-Language": runtimeState.discoveryLocale ?? "en",
          }),
        })
      );
    } catch {
      setDiscoveryBusy(false);
      setDiscoveryError(translateDiscovery("errorReachDeployment"));
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
      setDiscoveryError(toErrorMessage(error, translateDiscovery("errorBootstrapResponse")));
    } finally {
      setDiscoveryBusy(false);
    }
  };

  const confirmDiscoverySelection = async () => {
    const ui = renderDiscoveryGate();

    if (!ui || !runtimeState.pendingBootstrap) {
      return;
    }

    setDiscoveryBusy(true, "confirm");
    runtimeState.discoveryErrorMessage = "";
    syncDiscoveryGateCopy();

    try {
      await applyRuntimeBootstrap(runtimeState.pendingBootstrap);
      removeDiscoveryGate();
      if (globalThis.location && typeof globalThis.location.reload === "function") {
        globalThis.location.reload();
      }
    } catch {
      setDiscoveryBusy(false);
      setDiscoveryError(translateDiscovery("errorConfigureRuntime"));
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
      await ensureRuntimeConfigured();
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
