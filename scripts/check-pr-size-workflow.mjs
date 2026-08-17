#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const workflowPath = process.argv[2]
  ? new URL(process.argv[2], `file://${process.cwd()}/`)
  : new URL("../.github/workflows/pr-size.yml", import.meta.url);
let workflowPathDisplay = workflowPath.href;

let workflow;
try {
  workflowPathDisplay = fileURLToPath(workflowPath);
  workflow = yaml.load(readFileSync(workflowPath, "utf8"), {
    schema: yaml.JSON_SCHEMA,
  });
} catch (error) {
  fail(`could not parse ${workflowPathDisplay}: ${error}`);
}

const expectedPermissions = {
  contents: "read",
};
const expectedCallerPrefix =
  "SecPal/.github/.github/workflows/reusable-pr-size.yml@";

if (!workflow?.permissions || typeof workflow.permissions !== "object") {
  fail(".github/workflows/pr-size.yml must define top-level permissions.");
}

if (
  Object.keys(workflow.permissions).length !==
  Object.keys(expectedPermissions).length
) {
  fail(
    ".github/workflows/pr-size.yml must define exactly the required permissions."
  );
}

for (const [scope, access] of Object.entries(expectedPermissions)) {
  if (workflow.permissions[scope] !== access) {
    fail(
      `.github/workflows/pr-size.yml permissions.${scope} must be ${access}.`
    );
  }
}

for (const [jobName, job] of Object.entries(workflow?.jobs ?? {})) {
  if (job && typeof job === "object" && Object.hasOwn(job, "permissions")) {
    fail(
      `.github/workflows/pr-size.yml jobs.${jobName} must not override permissions.`
    );
  }
}

const caller = workflow?.jobs?.["pr-size"]?.uses;
const callerRef =
  typeof caller === "string" && caller.startsWith(expectedCallerPrefix)
    ? caller.slice(expectedCallerPrefix.length)
    : "";

if (!/^[0-9a-f]{40}$/.test(callerRef)) {
  fail(
    `.github/workflows/pr-size.yml jobs.pr-size.uses must reference ${expectedCallerPrefix}<full-commit-sha>.`
  );
}

console.log("PR-size workflow permission guard OK.");
