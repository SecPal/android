// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EVENT_ALIAS,
  EVENT_MAPPING,
  EVENT_POP,
  EVENT_SCALAR,
  EVENT_SEQUENCE,
  SCALAR_STYLE_DOUBLE_QUOTED,
  SCALAR_STYLE_SINGLE_QUOTED,
  getScalarValue,
  load,
  parseEvents,
  type ScalarEvent,
} from "js-yaml";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const workflowDirectory = resolve(repoRoot, ".github/workflows");
const fullCommitSha = /^[0-9a-f]{40}$/;

interface MappingFrame {
  kind: "mapping";
  expectsKey: boolean;
  key?: string;
}

interface SequenceFrame {
  kind: "sequence";
}

type ContainerFrame = MappingFrame | SequenceFrame;

interface UsesReference {
  reference: string | null;
  sourceLine: string;
  versionComment: string;
}

function sourceLineAt(source: string, position: number): string {
  const start = source.lastIndexOf("\n", position - 1) + 1;
  const newline = source.indexOf("\n", position);
  const end = newline === -1 ? source.length : newline;

  return source.slice(start, end).trim();
}

function inlineCommentAfter(source: string, position: number): string {
  const newline = source.indexOf("\n", position);
  const end = newline === -1 ? source.length : newline;
  let singleQuoted = false;
  let doubleQuoted = false;

  for (let index = position; index < end; index += 1) {
    const character = source[index];

    if (singleQuoted) {
      if (character === "'" && source[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        singleQuoted = false;
      }
      continue;
    }

    if (doubleQuoted) {
      if (character === "\\") {
        index += 1;
      } else if (character === '"') {
        doubleQuoted = false;
      }
      continue;
    }

    if (character === "'") {
      singleQuoted = true;
    } else if (character === '"') {
      doubleQuoted = true;
    } else if (
      character === "#" &&
      (index === position || /\s/.test(source[index - 1] ?? ""))
    ) {
      return source.slice(index + 1, end).trim();
    }
  }

  return "";
}

function scalarEnd(source: string, event: ScalarEvent): number {
  if (
    (event.style === SCALAR_STYLE_SINGLE_QUOTED &&
      source[event.valueEnd] === "'") ||
    (event.style === SCALAR_STYLE_DOUBLE_QUOTED &&
      source[event.valueEnd] === '"')
  ) {
    return event.valueEnd + 1;
  }

  return event.valueEnd;
}

function usesReferences(source: string): UsesReference[] {
  const frames: ContainerFrame[] = [];
  const anchors = new Map<string, string>();
  const references: UsesReference[] = [];

  function consumeMappingValue(reference: string | null, position: number) {
    const frame = frames.at(-1);
    if (frame?.kind !== "mapping" || frame.expectsKey) {
      return;
    }

    const key = frame.key;
    frame.expectsKey = true;
    delete frame.key;

    if (key === "uses") {
      references.push({
        reference,
        sourceLine: sourceLineAt(source, position),
        versionComment: inlineCommentAfter(source, position),
      });
    }
  }

  for (const event of parseEvents(source, {})) {
    if (event.type === EVENT_MAPPING || event.type === EVENT_SEQUENCE) {
      consumeMappingValue(null, event.start);
      frames.push(
        event.type === EVENT_MAPPING
          ? { kind: "mapping", expectsKey: true }
          : { kind: "sequence" }
      );
    } else if (event.type === EVENT_SCALAR) {
      const value = getScalarValue(source, event);
      if (event.anchorStart >= 0) {
        anchors.set(source.slice(event.anchorStart, event.anchorEnd), value);
      }

      const frame = frames.at(-1);
      if (frame?.kind === "mapping" && frame.expectsKey) {
        frame.key = value;
        frame.expectsKey = false;
      } else {
        consumeMappingValue(value, scalarEnd(source, event));
      }
    } else if (event.type === EVENT_ALIAS) {
      const anchor = source.slice(event.anchorStart, event.anchorEnd);
      consumeMappingValue(anchors.get(anchor) ?? null, event.anchorEnd);
    } else if (event.type === EVENT_POP) {
      frames.pop();
    }
  }

  return references;
}

function unpinnedExternalUses(source: string): string[] {
  return usesReferences(source)
    .filter(
      ({ reference }) => reference === null || !reference.startsWith("./")
    )
    .filter(({ reference, versionComment }) => {
      const separator = reference?.lastIndexOf("@") ?? -1;
      const revision =
        separator === -1 || reference === null
          ? ""
          : reference.slice(separator + 1);

      return !fullCommitSha.test(revision) || versionComment.length === 0;
    })
    .map(({ sourceLine }) => sourceLine);
}

function hasEnabledGitHubActionsDependabot(source: string): boolean {
  const dependabot = load(source) as {
    updates?: Array<Record<string, unknown>>;
  };

  return (
    dependabot.updates?.some(
      (update) =>
        update["package-ecosystem"] === "github-actions" &&
        update.directory === "/" &&
        update["open-pull-requests-limit"] !== 0 &&
        (update["target-branch"] === undefined ||
          update["target-branch"] === "main")
    ) ?? false
  );
}

describe("GitHub Actions dependency pinning", () => {
  it.each([
    "AGENTS.md",
    ".github/copilot-instructions.md",
    ".github/instructions/github-workflows.instructions.md",
  ])("keeps the full-SHA policy in %s", (filename) => {
    const instructions = readFileSync(resolve(repoRoot, filename), "utf8");

    expect(instructions).toMatch(
      /Pin every external action and reusable workflow to a full, lowercase\s+40-character commit SHA\./
    );
    expect(instructions).toMatch(
      /Before finalizing a pin change, verify in the source repository that each SHA\s+resolves to the tag or branch documented beside it\./
    );
    expect(instructions).toMatch(
      /Keep the root `github-actions` Dependabot entry in `.github\/dependabot\.yml`\s+enabled/
    );
  });

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

  it.each([
    { reference: '- "uses": actions/checkout@v7 # v7', syntax: "a quoted key" },
    {
      reference: "- uses : actions/checkout@v7 # v7",
      syntax: "spacing before the colon",
    },
    {
      reference: "- { uses: actions/checkout@v7 } # v7",
      syntax: "a flow mapping",
    },
  ])("rejects a mutable reference written with $syntax", ({ reference }) => {
    expect(unpinnedExternalUses(reference)).toEqual([reference]);
  });

  it("rejects a full SHA without inline version documentation", () => {
    const reference =
      "uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    expect(unpinnedExternalUses(reference)).toEqual([reference]);
  });

  it("does not mistake a hash inside another flow value for documentation", () => {
    const reference =
      '- { uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, name: "# not version documentation" }';

    expect(unpinnedExternalUses(reference)).toEqual([reference]);
  });

  it("resolves scalar aliases instead of skipping indirect mutable references", () => {
    const source = `
steps:
  - uses: &checkout actions/checkout@v7 # v7
  - uses: *checkout # v7
`;

    expect(unpinnedExternalUses(source)).toEqual([
      "- uses: &checkout actions/checkout@v7 # v7",
      "- uses: *checkout # v7",
    ]);
  });

  it("accepts documented full SHAs and local actions", () => {
    expect(
      unpinnedExternalUses(`
steps:
  - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v7
  - uses: ./.github/actions/setup
`)
    ).toEqual([]);
  });

  it.each([
    '- "uses": actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v7',
    "- uses : actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v7",
    "- { uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa } # v7",
  ])("accepts a documented full SHA in valid YAML form %s", (reference) => {
    expect(unpinnedExternalUses(reference)).toEqual([]);
  });

  it("keeps Dependabot enabled for GitHub Actions at the repository root", () => {
    expect(
      hasEnabledGitHubActionsDependabot(
        readFileSync(resolve(repoRoot, ".github/dependabot.yml"), "utf8")
      )
    ).toBe(true);
  });

  it("treats a zero GitHub Actions pull-request limit as disabled", () => {
    expect(
      hasEnabledGitHubActionsDependabot(`
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    open-pull-requests-limit: 0
`)
    ).toBe(false);
  });

  it("does not accept GitHub Actions updates targeting another branch", () => {
    expect(
      hasEnabledGitHubActionsDependabot(`
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    target-branch: maintenance
`)
    ).toBe(false);
  });
});
