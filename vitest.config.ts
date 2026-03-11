/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: CC0-1.0
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "clover"],
    },
  },
});
