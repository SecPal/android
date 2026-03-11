/*
 * SPDX-FileCopyrightText: 2026 SecPal
 * SPDX-License-Identifier: CC0-1.0
 */

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "coverage",
      "dist/**",
      "android/.gradle/**",
      "android/**/build/**",
      "android/app/src/main/assets/**",
    ],
  },
  {
    files: ["**/*.{ts,js}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
      },
    },
  }
);
