/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function extractSection(markdown: string, heading: string) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.indexOf(`## ${heading}`);

  if (start === -1) {
    return null;
  }

  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("## ")
  );
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("review provenance policy", () => {
  it("does not accept a nested heading as the required section", () => {
    expect(
      extractSection(
        "## General review rules\n\n### Code Review Rules\n\n- Nested only\n",
        "Code Review Rules"
      )
    ).toBeNull();
  });

  it.each([
    "AGENTS.md",
    ".github/copilot-instructions.md",
    ".github/instructions/org-shared.instructions.md",
  ])("requires exact PR commit provenance in %s", (filename) => {
    const instructions = readFileSync(resolve(repoRoot, filename), "utf8");
    const policy = extractSection(instructions, "Code Review Rules");

    expect(policy, `Missing Code Review Rules in ${filename}`).not.toBeNull();
    expect(policy ?? "").toContain(
      "Before emitting a commit-provenance finding, first obtain the reviewed pull request's commit set and resolve the referenced full 40-character commit SHA from that set. Never construct or expand a full SHA from an abbreviated review header. A missing or non-member commit cannot produce a blocking provenance finding or any author, committer, or signature claim."
    );
    expect(policy ?? "").toContain(
      "Resolve author, committer, and signature state only from that exact member commit object. Do not infer commit metadata from the PR head, patch contents, contributor identity, or an unrelated local object."
    );
    expect(policy ?? "").toContain(
      "Deduplicate provenance evidence by exact commit SHA and violated invariant before assigning priority. Repeated evidence must produce one finding."
    );
  });
});
