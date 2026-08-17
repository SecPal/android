// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

(function () {
  var assetLoadRecoveryStorageKey = "secpal.asset-load-recovery";
  var appBootstrapReadyEvent = "app-bootstrap-ready";
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');

  function hasPendingAssetLoadRecovery() {
    try {
      return (
        window.sessionStorage.getItem(assetLoadRecoveryStorageKey) === "pending"
      );
    } catch {
      return false;
    }
  }

  const pageStartedWithPendingAssetLoadRecovery = hasPendingAssetLoadRecovery();

  function clearAssetLoadRecoveryFlag() {
    if (!pageStartedWithPendingAssetLoadRecovery) {
      return;
    }

    try {
      window.sessionStorage.removeItem(assetLoadRecoveryStorageKey);
    } catch {
      // Ignore storage access failures; recovery remains best-effort.
    }
  }

  window.addEventListener(appBootstrapReadyEvent, clearAssetLoadRecoveryFlag, {
    once: true,
  });

  function markPendingAssetLoadRecovery() {
    try {
      window.sessionStorage.setItem(assetLoadRecoveryStorageKey, "pending");
      return true;
    } catch {
      // Ignore storage access failures; recovery remains best-effort.
      return false;
    }
  }

  function isRecoverableBootstrapAssetError(event) {
    const target = event && event.target;
    let assetUrl;

    if (target instanceof HTMLScriptElement && target.src) {
      assetUrl = target.src;
    } else if (target instanceof HTMLLinkElement && target.href) {
      assetUrl = target.href;
    } else {
      return false;
    }

    let targetUrl;
    try {
      targetUrl = new URL(assetUrl, window.location.href);
    } catch {
      return false;
    }

    return (
      targetUrl.origin === window.location.origin &&
      /\/assets\/.+\.(?:css|js)$/.test(targetUrl.pathname)
    );
  }

  async function unregisterServiceWorkers() {
    if (
      !("serviceWorker" in navigator) ||
      typeof navigator.serviceWorker.getRegistrations !== "function"
    ) {
      return;
    }

    const registrations = await navigator.serviceWorker.getRegistrations();

    await Promise.all(
      registrations.map((registration) => registration.unregister())
    );
  }

  async function clearRelevantCaches() {
    if (!window.caches || typeof window.caches.keys !== "function") {
      return;
    }

    const cacheNames = await window.caches.keys();
    const cacheNameAllowlist = [
      "html-shell",
      "static-assets",
      "workbox-precache",
      "workbox-runtime",
    ];

    await Promise.all(
      cacheNames
        .filter((cacheName) =>
          cacheNameAllowlist.some(
            (allowedName) =>
              cacheName === allowedName ||
              cacheName.indexOf(allowedName + "-") === 0
          )
        )
        .map((cacheName) => window.caches.delete(cacheName))
    );
  }

  function recoverFromStaleHashedAsset() {
    if (hasPendingAssetLoadRecovery()) {
      return;
    }

    if (!markPendingAssetLoadRecovery()) {
      return;
    }

    Promise.all([
      unregisterServiceWorkers().catch(function () {}),
      clearRelevantCaches().catch(function () {}),
    ]).finally(function () {
      window.location.reload();
    });
  }

  window.addEventListener(
    "error",
    function (event) {
      if (!isRecoverableBootstrapAssetError(event)) {
        return;
      }

      recoverFromStaleHashedAsset();
    },
    true
  );

  if (themeColorMeta) {
    const updateThemeColor = function (isDark) {
      themeColorMeta.setAttribute("content", isDark ? "#18181b" : "#ffffff");
    };

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = function (event) {
      updateThemeColor(event.matches);
    };

    updateThemeColor(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return;
    }

    if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(handleChange);
    }
  }
})();
