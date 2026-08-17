// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

(function () {
  var locale;

  function getBrowserLocale() {
    try {
      return navigator.language.split("-")[0] === "de" ? "de" : "en";
    } catch {
      return "en";
    }
  }

  try {
    var storedLocale = window.localStorage.getItem("secpal-locale");
    if (storedLocale === "de" || storedLocale === "en") {
      locale = storedLocale;
    } else {
      locale = getBrowserLocale();
    }
  } catch {
    locale = getBrowserLocale();
  }

  document.documentElement.lang = locale;
})();
