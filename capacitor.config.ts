/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.secpal.app.mobile",
  appName: "SecPal",
  webDir: "../frontend/dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
