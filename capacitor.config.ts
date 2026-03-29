/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Android package/application identifier only; not a deployable web domain.
  appId: "app.secpal.app",
  appName: "SecPal",
  webDir: "../frontend/dist",
  server: {
    hostname: "app.secpal.dev",
    androidScheme: "https",
  },
};

export default config;
