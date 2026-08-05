// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const workflowDirectory = resolve(repoRoot, ".github/workflows");
const fullCommitSha = /^[0-9a-f]{40}$/;

function unpinnedExternalUses(source: string): string[] {
  return source
    .split("\n")
    .map((line) =>
      line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)\s*(?:#\s*(.+))?$/)
    )
    .filter((match): match is RegExpMatchArray => match !== null)
    .filter((match) => !match[1].startsWith("./"))
    .filter((match) => {
      const separator = match[1].lastIndexOf("@");
      const revision = separator === -1 ? "" : match[1].slice(separator + 1);
      const versionComment = match[2]?.trim() ?? "";

      return !fullCommitSha.test(revision) || versionComment.length === 0;
    })
    .map((match) => match[0].trim());
}

describe("GitHub Actions dependency pinning", () => {
  it("pins every external action and reusable workflow to a documented full SHA", () => {
    const violations = readdirSync(workflowDirectory)
      .filter((name) => /\.ya?ml$/.test(name))
      .flatMap((name) => {
        const source = readFileSync(resolve(workflowDirectory, name), "utf8");
        return unpinnedExternalUses(source).map(
          (reference) => `${name}: ${reference}`
        );
      });

    expect(violations).toEqual([]);
  });

  it.each([
    "uses: actions/checkout@v7 # v7",
    "uses: actions/checkout@abcdef0 # v7",
    "uses: SecPal/.github/.github/workflows/reusable-reuse.yml@main # main",
  ])("rejects mutable or abbreviated reference %s", (reference) => {
    expect(unpinnedExternalUses(reference)).toEqual([reference]);
  });

  it("rejects a full SHA without inline version documentation", () => {
    const reference =
      "uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    expect(unpinnedExternalUses(reference)).toEqual([reference]);
  });

  it("accepts documented full SHAs and local actions", () => {
    expect(
      unpinnedExternalUses(`
uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v7
- uses: ./.github/actions/setup
`)
    ).toEqual([]);
  });

  it("keeps Dependabot enabled for GitHub Actions at the repository root", () => {
    const dependabot = load(
      readFileSync(resolve(repoRoot, ".github/dependabot.yml"), "utf8")
    ) as { updates?: Array<Record<string, unknown>> };

    expect(dependabot.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          "package-ecosystem": "github-actions",
          directory: "/",
        }),
      ])
    );
  });
});
