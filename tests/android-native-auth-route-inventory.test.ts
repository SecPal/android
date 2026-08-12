/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const packagedAssetsDirectory = resolve(
  repoRoot,
  "android/app/src/main/assets/public/assets"
);
const packagedJavascript = existsSync(packagedAssetsDirectory)
  ? readdirSync(packagedAssetsDirectory)
      .filter((name) => name.endsWith(".js"))
      .sort()
      .map((name) =>
        readFileSync(resolve(packagedAssetsDirectory, name), "utf8")
      )
      .join("\n")
  : null;
const nativePolicy = readFileSync(
  resolve(
    repoRoot,
    "android/app/src/main/java/app/secpal/NativeAuthRequestPolicy.java"
  ),
  "utf8"
);
const protectedRouteFamilies = [
  "/v1/activity-logs",
  "/v1/addresses/de/",
  "/v1/auth/email/verification-notification",
  "/v1/customer-establishments",
  "/v1/customers",
  "/v1/employees",
  "/v1/lookups/",
  "/v1/me/mfa",
  "/v1/me/notification-installations/",
  "/v1/me/passkeys",
  "/v1/onboarding/",
  "/v1/onboarding-review/employees/",
  "/v1/organizational-units",
  "/v1/sites",
];

describe("Android native-auth route inventory", () => {
  it("keeps every reviewed protected route family represented in the native policy", () => {
    for (const routeFamily of protectedRouteFamilies) {
      expect(nativePolicy, routeFamily).toContain(routeFamily);
    }
  });

  it("keeps removed Android provisioning requests out of the native policy", () => {
    expect(nativePolicy).not.toContain("/v1/android-enrollment-sessions");
  });

  it("does not retain route families that have no packaged Android caller", () => {
    const unprovenNativeRoutes = [
      '"PATCH", "/v1/me/language"',
      '"GET", "/v1/me/organizational-scopes"',
      '"POST", "/v1/qualifications"',
      '"POST", "/v1/employees/" + ID + "/qualifications"',
      '"POST", "/v1/sites/" + ID + "/cost-centers"',
      '"POST", "/v1/customers/" + ID + "/assignments"',
      '"POST", "/v1/employees/" + ID + "/documents"',
      '"GET", "/v1/onboarding/steps"',
      '"POST", "/v1/onboarding-review/submissions/"',
      '"GET", "/v1/android-enrollment-sessions"',
    ];

    for (const route of unprovenNativeRoutes) {
      expect(nativePolicy).not.toContain(route);
    }
  });
});

describe.skipIf(packagedJavascript === null)(
  "generated Android frontend route parity",
  () => {
    const generatedJavascript = packagedJavascript ?? "";

    it("contains every protected route family represented in the native policy", () => {
      for (const routeFamily of protectedRouteFamilies) {
        expect(generatedJavascript, routeFamily).toContain(routeFamily);
      }
    });

    it("keeps removed Android provisioning requests out of the packaged app", () => {
      expect(generatedJavascript).not.toContain(
        "/v1/android-enrollment-sessions"
      );
    });
  }
);
