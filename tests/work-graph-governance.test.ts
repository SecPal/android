/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const instructionPaths = [
  "AGENTS.md",
  ".github/copilot-instructions.md",
  ".github/instructions/org-shared.instructions.md",
];
const instructions = instructionPaths.map((path) => ({
  path,
  content: readFileSync(resolve(repoRoot, path), "utf8"),
}));

describe("work-graph governance", () => {
  it.each(instructions)(
    "delegates generic graph semantics in $path",
    ({ content }) => {
      const normalized = content.replace(/\s+/g, " ");

      expect(normalized).toContain(
        "SecPal/.github/docs/work-graph-contract.md"
      );
      expect(normalized).toMatch(
        /GitHub-native.{0,180}(?:authority|authoritative)/i
      );
      expect(normalized).toMatch(/body.{0,180}(?:mirror|authority)/i);
      expect(normalized).toMatch(
        /blocked.{0,180}non-leaf.{0,180}not executable/i
      );
      expect(normalized).toMatch(/one reviewable delivery contract/i);
      expect(normalized).toMatch(/one primary (?:delivery )?pull request/i);
    }
  );

  it.each(instructions)(
    "does not restore local graph or unbounded governance in $path",
    ({ content }) => {
      expect(content).not.toMatch(
        /work (?:will|needs to) span more than one PR/i
      );
      expect(content).not.toMatch(/more than one PR[^\n]*epic/i);
      expect(content).not.toMatch(/every real out-of-scope finding/i);
      expect(content).not.toMatch(/immediate GitHub issue creation/i);
      expect(content).not.toMatch(/(?:review|self-review)[^\n]*zero issues/i);
      expect(content).not.toMatch(/^\s*[-*]\s*\*\*(?:READY|NEXT)\*\*\s*[—:-]/m);
    }
  );

  it.each(instructions)(
    "keeps replanning, finite review, and proportional evidence in $path",
    ({ content }) => {
      const normalized = content.replace(/\s+/g, " ");

      expect(normalized).toMatch(
        /missing prerequisite.{0,220}native dependency/i
      );
      expect(normalized).toMatch(
        /new responsibility.{0,220}(?:sibling|child)/i
      );
      expect(normalized).toMatch(/multiple contracts.{0,220}sub-epic/i);
      expect(normalized).toMatch(/proven.{0,220}material.{0,220}actionable/i);
      expect(normalized).toMatch(/bounded full review/i);
      expect(normalized).toMatch(/delta-only verification/i);
      expect(normalized).toMatch(/behavior-preserving refactor/i);
      expect(normalized).toMatch(/smallest non-redundant evidence set/i);
    }
  );

  it("preserves Android security and lifecycle review boundaries", () => {
    const baseline = instructions[0].content;

    for (const invariant of [
      /Device Owner/,
      /WebView/,
      /bearer[- ]token/,
      /runtime\/tenant/,
      /FCM/,
      /artifact integrity/,
      /signing and version identity/,
      /fail[- ]closed/,
    ]) {
      expect(baseline).toMatch(invariant);
    }
  });
});
