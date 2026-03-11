/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: CC0-1.0
 */

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      reporter: ["text", "lcov", "clover"],
    },
  },
});
