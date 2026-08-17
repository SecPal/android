/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { CapacitorConfig } from "@capacitor/cli";
import { join } from "node:path";

const frontendDirectory = process.env.SECPAL_ANDROID_FRONTEND_DIR;

const config: CapacitorConfig = {
  // Android package/application identifier only; not a deployable web domain.
  appId: "app.secpal",
  appName: "SecPal",
  webDir: frontendDirectory
    ? join(frontendDirectory, "dist")
    : "../frontend/dist",
  android: {
    minWebViewVersion: 83,
    useLegacyBridge: false,
  },
  cordova: {
    accessOrigins: ["https://api.secpal.dev", "https://app.secpal.dev"],
  },
  server: {
    hostname: "app.secpal.dev",
    androidScheme: "https",
  },
};

export default config;
