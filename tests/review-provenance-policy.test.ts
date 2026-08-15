/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function expectCanonicalLicensingContract(content: string) {
  const normalizedContent = content.replace(/\s+/g, " ");

  expect(normalizedContent).toContain(
    "Use `AGPL-3.0-or-later` for SecPal-owned material intentionally covered by the AGPL."
  );
  expect(normalizedContent).toContain(
    "Never add or restore `LicenseRef-SecPal-Attribution` after the licensing rollout."
  );
  expect(normalizedContent).toContain(
    "Preserve deliberately different licenses, including `CC0-1.0`, `MIT`, `Apache-2.0`, third-party and generated-file licenses, and unrelated custom license references. Do not rewrite third-party copyright or license metadata."
  );
  expect(normalizedContent).not.toContain(
    "AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution"
  );
  expect(normalizedContent).not.toContain(
    "existing repository-declared licenses preserved elsewhere until explicitly migrated"
  );
}

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

  it.each([
    "AGENTS.md",
    ".github/copilot-instructions.md",
    ".github/instructions/org-shared.instructions.md",
    "CONTRIBUTING.md",
  ])(
    "keeps the project-wide licensing contract canonical in %s",
    (filename) => {
      const instructions = readFileSync(resolve(repoRoot, filename), "utf8");

      expectCanonicalLicensingContract(instructions);
    }
  );

  it("rejects obsolete licensing phrases with wrapped whitespace", () => {
    const instructions = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");
    const wrappedObsoletePolicy = `${instructions}\nAGPL-3.0-or-later AND\nLicenseRef-SecPal-Attribution`;

    expect(() =>
      expectCanonicalLicensingContract(wrappedObsoletePolicy)
    ).toThrow();
  });
});
