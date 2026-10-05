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
  [
    sourceRoot,
    resolve(sourceRoot, "../../../../../../management/java/app/secpal"),
  ].flatMap((root) =>
    readdirSync(root, { recursive: true })
      .filter(
        (path): path is string =>
          typeof path === "string" && path.endsWith(".java")
      )
      .map((path): [string, string] => [
        path,
        readFileSync(resolve(root, path), "utf8"),
      ])
  )
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
  const serviceCall = String.raw`getSystemService\s*\(\s*(?:DevicePolicyManager\s*\.\s*class|(?:Context\s*\.\s*)?DEVICE_POLICY_SERVICE)\s*\)`;
  // Infer service-backed handles and their aliases without depending on an explicit type.
  for (const assignment of state.matchAll(
    new RegExp(String.raw`\b(\w+)\s*=\s*[^;]*?\b${serviceCall}`, "g")
  )) {
    managerNames.add(assignment[1]);
  }
  const aliases = Array.from(state.matchAll(/\b(\w+)\s*=\s*(\w+)\s*;/g));
  let previousSize = -1;
  while (previousSize !== managerNames.size) {
    previousSize = managerNames.size;
    for (const alias of aliases) {
      if (managerNames.has(alias[2])) managerNames.add(alias[1]);
    }
  }
  const methods = new Set(
    Array.from(
      state.matchAll(
        new RegExp(
          String.raw`\b${serviceCall}\s*(?:\)\s*)*\.\s*(\w+)\s*\(`,
          "g"
        )
      ),
      (match) => match[1]
    )
  );
  for (const name of managerNames) {
    const calls = new RegExp(`\\b${name}\\s*\\.\\s*(\\w+)\\s*\\(`, "g");
    for (const call of state.matchAll(calls)) methods.add(call[1]);
  }
  for (const method of methods) {
    if (!permittedQueries.includes(method)) {
      violations.push(`EnterprisePolicyState.java: ${method}`);
    }
  }
  return violations;
}

describe("Android DPC structural security boundary", () => {
  it("keeps enforcement out of Work consumers and shared policy derivation", () => {
    expect(boundaryViolations(sources)).toEqual([]);
    const dpcRoot = sourceRoot.replace("/app/src/", "/dpc/src/");
    const enforcer = readFileSync(
      resolve(dpcRoot, "DpcPolicyEnforcer.java"),
      "utf8"
    );
    const code = enforcer.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    expect(code).not.toMatch(
      /\b(?:Activity|MainActivity|DedicatedDeviceHomeActivity|WebViewCompatibilityActivity|EnterprisePolicyClient|SystemNavigationController|SecPalEnterprisePlugin)\b/
    );
    const application = readFileSync(
      resolve(dpcRoot, "DpcPolicyApplication.java"),
      "utf8"
    );
    expect(application.match(/Intent\.ACTION_\w+/g)).toEqual([
      "Intent.ACTION_APPLICATION_RESTRICTIONS_CHANGED",
      "Intent.ACTION_PACKAGE_ADDED",
      "Intent.ACTION_PACKAGE_REMOVED",
    ]);
    const receiver = readFileSync(
      resolve(dpcRoot, "SecPalDeviceAdminReceiver.java"),
      "utf8"
    );
    expect(receiver).not.toMatch(
      /EnterprisePolicyClient|EnterprisePolicyState|EnterpriseManagedState/
    );
  });

  it.each([
    [
      "a chained service call",
      "context.getSystemService(DevicePolicyManager.class).setLockTaskPackages(admin, packages);",
    ],
    [
      "implicitly typed aliases",
      "var manager = context.getSystemService(DevicePolicyManager.class); var alias = manager; alias.setLockTaskPackages(admin, packages);",
    ],
  ])("rejects privileged mutation through %s", (_syntax, statement) => {
    const mutated = new Map(sources);
    const state = mutated.get("EnterprisePolicyState.java") ?? "";
    mutated.set(
      "EnterprisePolicyState.java",
      state.replace(
        /\n}\s*$/,
        `\n static void mutation(Context context, android.content.ComponentName admin, String[] packages) { ${statement} }\n}\n`
      )
    );
    expect(boundaryViolations(mutated)).toContain(
      "EnterprisePolicyState.java: setLockTaskPackages"
    );
    mutated.set(
      "EnterprisePolicyState.java",
      (mutated.get("EnterprisePolicyState.java") ?? "").replace(
        "setLockTaskPackages(admin, packages)",
        "isDeviceOwnerApp(context.getPackageName())"
      )
    );
    expect(boundaryViolations(mutated)).toEqual([]);
  });

  it("rejects mutation in shared state and privilege leaks through a helper", () => {
    const mutated = new Map(sources);
    mutated.set(
      "EnterprisePolicyState.java",
      `${mutated.get("EnterprisePolicyState.java")}\n manager.setLockTaskPackages(admin, packages);`
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
