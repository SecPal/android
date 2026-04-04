/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Android package/application identifier only; not a deployable web domain.
  appId: "app.secpal",
  appName: "SecPal",
  webDir: "../frontend/dist",
  cordova: {
    accessOrigins: ["https://api.secpal.dev", "https://app.secpal.dev"],
  },
  server: {
    hostname: "app.secpal.dev",
    androidScheme: "https",
  },
};

export default config;
