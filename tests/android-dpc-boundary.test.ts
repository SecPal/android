/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
  "android/app/src/main/java/app/secpal"
);
const sources = new Map(
  readdirSync(sourceRoot, { recursive: true })
    .filter(
      (path): path is string =>
        typeof path === "string" && path.endsWith(".java")
    )
    .map((path) => [path, readFileSync(resolve(sourceRoot, path), "utf8")])
);

// Structural evidence: privileged policy writes have one owner, and no helper
// may give a Work consumer a transitive dependency on that owner.
function boundaryViolations(candidate: Map<string, string>): string[] {
  const violations: string[] = [];
  for (const [path, source] of candidate) {
    if (
      path !== "DpcPolicyEnforcer.java" &&
      path !== "EnterprisePolicyState.java"
    ) {
      if (/DevicePolicyManager|DEVICE_POLICY_SERVICE/.test(source)) {
        violations.push(`${path}: privileged platform access`);
      }
    }
    if (
      ![
        "DpcPolicyEnforcer.java",
        "DpcPolicyApplication.java",
        "SecPalDeviceAdminReceiver.java",
      ].includes(path) &&
      /\b(?:DpcPolicyEnforcer|DpcPolicyApplication)\b/.test(source)
    ) {
      violations.push(`${path}: enforcement dependency`);
    }
  }
  const state = candidate.get("EnterprisePolicyState.java") ?? "";
  // This is a closed read-only platform boundary, not an extensible mutation facade.
  const permittedQueries = [
    "isDeviceOwnerApp",
    "isProfileOwnerApp",
    "isLockTaskPermitted",
  ];
  const managerNames = new Set(
    Array.from(
      state.matchAll(/\bDevicePolicyManager\s+(\w+)/g),
      (match) => match[1]
    )
  );
  for (const name of managerNames) {
    const calls = new RegExp(`\\b${name}\\s*\\.\\s*(\\w+)\\s*\\(`, "g");
    for (const call of state.matchAll(calls)) {
      if (!permittedQueries.includes(call[1])) {
        violations.push(`EnterprisePolicyState.java: ${call[1]}`);
      }
    }
  }
  return violations;
}

describe("Android DPC structural security boundary", () => {
  it("keeps enforcement out of Work consumers and shared policy derivation", () => {
    expect(boundaryViolations(sources)).toEqual([]);
    const enforcer = sources.get("DpcPolicyEnforcer.java") ?? "";
    // Named component targets may cross the boundary; Work implementation must not.
    const code = enforcer.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    expect(code).not.toMatch(
      /\b(?:Activity|MainActivity|DedicatedDeviceHomeActivity|WebViewCompatibilityActivity|EnterprisePolicyClient|SystemNavigationController|SecPalEnterprisePlugin)\b/
    );
    const application = sources.get("DpcPolicyApplication.java") ?? "";
    // These are protected by Android's system broadcast boundary.
    expect(application.match(/Intent\.ACTION_\w+/g)).toEqual([
      "Intent.ACTION_APPLICATION_RESTRICTIONS_CHANGED",
      "Intent.ACTION_PACKAGE_ADDED",
      "Intent.ACTION_PACKAGE_REMOVED",
    ]);
    const receiver = sources.get("SecPalDeviceAdminReceiver.java") ?? "";
    expect(receiver).not.toMatch(
      /EnterprisePolicyClient|EnterprisePolicyState|EnterpriseManagedState/
    );
  });

  it("rejects mutation in shared state and privilege leaks through a helper", () => {
    const mutated = new Map(sources);
    mutated.set(
      "EnterprisePolicyState.java",
      `${mutated.get("EnterprisePolicyState.java")}\n devicePolicyManager.setLockTaskPackages(admin, packages);`
    );
    mutated.set(
      "WorkPolicyHelper.java",
      "DpcPolicyEnforcer.syncPolicy(context);"
    );
    expect(boundaryViolations(mutated)).toEqual([
      "WorkPolicyHelper.java: enforcement dependency",
      "EnterprisePolicyState.java: setLockTaskPackages",
    ]);
  });
});
