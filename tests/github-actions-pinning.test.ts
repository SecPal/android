// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
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
const localActionDirectory = resolve(repoRoot, ".github/actions");
const fullCommitSha = /^[0-9a-f]{40}$/;
const invalidGitRefCharacters = new Set(["~", "^", ":", "?", "*", "[", "\\"]);
const dependabotFilterFields = ["allow", "ignore", "exclude-paths"] as const;
const dependabotScheduleIntervals = new Set([
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "semiannually",
  "yearly",
  "cron",
]);
const enabledGitHubActionsUpdater = {
  "package-ecosystem": "github-actions",
  directory: "/",
  schedule: { interval: "daily" },
  "open-pull-requests-limit": 10,
  "target-branch": "main",
};

interface MappingFrame {
  kind: "mapping";
  expectsKey: boolean;
  key?: string;
  path: string[];
  anchor?: string;
}

interface SequenceFrame {
  kind: "sequence";
  path: string[];
  anchor?: string;
}

type ContainerFrame = MappingFrame | SequenceFrame;

interface UsesReference {
  reference: string | null;
  sourceLine: string;
  versionComment: string;
}

interface AnchoredUsesReference extends UsesReference {
  relativePath: string[];
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

function isDocumentedGitRef(value: string): boolean {
  const components = value.split("/");

  return (
    value.length > 0 &&
    value !== "@" &&
    !value.includes("..") &&
    !value.includes("@{") &&
    !value.endsWith(".") &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint <= 0x20 ||
        codePoint === 0x7f ||
        invalidGitRefCharacters.has(character)
      );
    }) &&
    components.every(
      (component) =>
        component.length > 0 &&
        !component.startsWith(".") &&
        !component.endsWith(".lock")
    )
  );
}

function usesReferences(source: string): UsesReference[] {
  const frames: ContainerFrame[] = [];
  const scalarAnchors = new Map<string, string>();
  const containerAnchors = new Map<string, AnchoredUsesReference[]>();
  const references: UsesReference[] = [];

  function isActionReferencePath(path: string[]): boolean {
    return (
      (path.length === 2 && path[0] === "jobs") ||
      (path.length === 3 && path[0] === "jobs" && path[2] === "steps") ||
      (path.length === 2 && path[0] === "runs" && path[1] === "steps")
    );
  }

  function nestedContainerPath(): string[] {
    const frame = frames.at(-1);
    if (frame === undefined || frame.kind === "sequence") {
      return frame?.path ?? [];
    }

    return frame.expectsKey || frame.key === undefined
      ? frame.path
      : [...frame.path, frame.key];
  }

  function recordUsesReference(reference: UsesReference, path: string[]): void {
    if (isActionReferencePath(path)) {
      references.push(reference);
    }

    for (const frame of frames) {
      if (
        frame.anchor === undefined ||
        frame.path.length > path.length ||
        !frame.path.every((part, index) => path[index] === part)
      ) {
        continue;
      }

      containerAnchors.get(frame.anchor)?.push({
        ...reference,
        relativePath: path.slice(frame.path.length),
      });
    }
  }

  function consumeMappingValue(reference: string | null, position: number) {
    const frame = frames.at(-1);
    if (frame?.kind !== "mapping" || frame.expectsKey) {
      return;
    }

    const key = frame.key;
    frame.expectsKey = true;
    delete frame.key;

    if (key === "uses") {
      recordUsesReference(
        {
          reference,
          sourceLine: sourceLineAt(source, position),
          versionComment: inlineCommentAfter(source, position),
        },
        frame.path
      );
    }
  }

  for (const event of parseEvents(source, {})) {
    if (event.type === EVENT_MAPPING || event.type === EVENT_SEQUENCE) {
      const path = nestedContainerPath();
      const anchor =
        event.anchorStart >= 0
          ? source.slice(event.anchorStart, event.anchorEnd)
          : undefined;
      consumeMappingValue(null, event.start);
      if (anchor !== undefined) {
        containerAnchors.set(anchor, []);
      }
      frames.push(
        event.type === EVENT_MAPPING
          ? { kind: "mapping", expectsKey: true, path, anchor }
          : { kind: "sequence", path, anchor }
      );
    } else if (event.type === EVENT_SCALAR) {
      const value = getScalarValue(source, event);
      if (event.anchorStart >= 0) {
        scalarAnchors.set(
          source.slice(event.anchorStart, event.anchorEnd),
          value
        );
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
      const value = scalarAnchors.get(anchor);
      const frame = frames.at(-1);
      if (frame?.kind === "mapping" && frame.expectsKey) {
        frame.key = value;
        frame.expectsKey = false;
      } else {
        const targetPath = nestedContainerPath();
        for (const anchoredReference of [
          ...(containerAnchors.get(anchor) ?? []),
        ]) {
          const { relativePath, ...reference } = anchoredReference;
          recordUsesReference(reference, [...targetPath, ...relativePath]);
        }
        consumeMappingValue(value ?? null, event.anchorEnd);
      }
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

      return (
        !fullCommitSha.test(revision) || !isDocumentedGitRef(versionComment)
      );
    })
    .map(({ sourceLine }) => sourceLine);
}

function workflowWithStep(reference: string): string {
  const step = reference.trimStart().startsWith("-")
    ? reference
    : `- ${reference}`;

  return `
jobs:
  test:
    steps:
      ${step}
`;
}

function actionManifestFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      return actionManifestFiles(path);
    }

    return entry.isFile() && /^action\.ya?ml$/.test(entry.name) ? [path] : [];
  });
}

function pinningSourceFiles(): string[] {
  const workflowFiles = readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => resolve(workflowDirectory, name));
  const rootActionManifests = ["action.yml", "action.yaml"]
    .map((name) => resolve(repoRoot, name))
    .filter(existsSync);

  return [
    ...workflowFiles,
    ...rootActionManifests,
    ...actionManifestFiles(localActionDirectory),
  ];
}

function isEnabledUnfilteredGitHubActionsUpdater(
  updater: Record<string, unknown>
): boolean {
  const schedule = updater.schedule;
  const scheduleRecord =
    typeof schedule === "object" && schedule !== null
      ? (schedule as Record<string, unknown>)
      : undefined;
  const interval = scheduleRecord?.interval;
  const pullRequestLimit = updater["open-pull-requests-limit"];
  const targetBranch = updater["target-branch"];

  return (
    updater["package-ecosystem"] === "github-actions" &&
    updater.directory === "/" &&
    typeof interval === "string" &&
    dependabotScheduleIntervals.has(interval) &&
    (interval !== "cron" ||
      (typeof scheduleRecord?.cronjob === "string" &&
        scheduleRecord.cronjob.trim().length > 0)) &&
    (pullRequestLimit === undefined ||
      (typeof pullRequestLimit === "number" &&
        Number.isInteger(pullRequestLimit) &&
        pullRequestLimit > 0)) &&
    (targetBranch === undefined || targetBranch === "main") &&
    dependabotFilterFields.every((field) => !Object.hasOwn(updater, field))
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
      /Before pinning a cross-repository reusable workflow, verify that its selected\s+commit also pins every nested external action to a full commit SHA\./
    );
    expect(instructions).toMatch(
      /Keep the root `github-actions` Dependabot entry in `.github\/dependabot\.yml`\s+enabled/
    );
  });

  it("pins every external action and reusable workflow to a documented full SHA", () => {
    const violations = pinningSourceFiles().flatMap((filename) => {
      const source = readFileSync(filename, "utf8");
      return unpinnedExternalUses(source).map(
        (reference) => `${relative(repoRoot, filename)}: ${reference}`
      );
    });

    expect(violations).toEqual([]);
  });

  it.each([
    "uses: actions/checkout@v7 # v7",
    "uses: actions/checkout@abcdef0 # v7",
    "uses: SecPal/.github/.github/workflows/reusable-reuse.yml@main # main",
  ])("rejects mutable or abbreviated reference %s", (reference) => {
    expect(unpinnedExternalUses(workflowWithStep(reference))).toHaveLength(1);
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
    expect(unpinnedExternalUses(workflowWithStep(reference))).toHaveLength(1);
  });

  it("rejects a full SHA without inline version documentation", () => {
    const reference =
      "uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    expect(unpinnedExternalUses(workflowWithStep(reference))).toHaveLength(1);
  });

  it.each([
    "",
    "release candidate",
    "feature..branch",
    "/main",
    "main/",
    "feature/.hidden",
    "release.",
    "release.lock",
    "release@{1}",
    "@",
    "release~1",
    "release:1",
    "release\\1",
  ])("rejects invalid inline version documentation %s", (versionComment) => {
    const reference = `uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # ${versionComment}`;

    expect(unpinnedExternalUses(workflowWithStep(reference))).toHaveLength(1);
  });

  it.each([
    "main",
    "release-1.x",
    "stable",
    "feature/security-fixes",
    "v1.2.3.4",
  ])("accepts the documented Git tag or branch %s", (versionComment) => {
    const reference = `uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # ${versionComment}`;

    expect(unpinnedExternalUses(workflowWithStep(reference))).toEqual([]);
  });

  it("does not mistake a hash inside another flow value for documentation", () => {
    const reference =
      '- { uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, name: "# not version documentation" }';

    expect(unpinnedExternalUses(workflowWithStep(reference))).toHaveLength(1);
  });

  it("resolves scalar aliases instead of skipping indirect mutable references", () => {
    const source = `
jobs:
  test:
    steps:
      - uses: &checkout actions/checkout@v7 # v7
      - uses: *checkout # v7
`;

    expect(unpinnedExternalUses(source)).toEqual([
      "- uses: &checkout actions/checkout@v7 # v7",
      "- uses: *checkout # v7",
    ]);
  });

  it("resolves mapping aliases used as complete action steps", () => {
    const source = `
jobs:
  test:
    strategy:
      matrix:
        include:
          - step: &checkout-step
              uses: actions/checkout@v7 # v7
    steps:
      - *checkout-step
`;

    expect(unpinnedExternalUses(source)).toHaveLength(1);
  });

  it("replays anchored caller jobs and action-step lists", () => {
    const source = `
jobs:
  reusable-template: &reusable-job
    uses: SecPal/.github/.github/workflows/example.yml@main # main
  reusable-copy: *reusable-job
  build:
    steps: &build-steps
      - uses: actions/checkout@v7 # v7
  build-copy:
    steps: *build-steps
`;

    expect(unpinnedExternalUses(source)).toHaveLength(4);
  });

  it("ignores nested uses inputs when an anchored step is reused", () => {
    const source = `
jobs:
  test:
    steps:
      - &example-step
        uses: actions/example@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v1
        with:
          uses: application-defined-input
      - *example-step
`;

    expect(unpinnedExternalUses(source)).toEqual([]);
  });

  it("resolves mapping-key aliases before inspecting action references", () => {
    const source = `
shared-key: &uses-key uses
jobs:
  test:
    steps:
      - ? *uses-key
        : actions/checkout@v7 # v7
`;

    expect(unpinnedExternalUses(source)).toEqual([
      ": actions/checkout@v7 # v7",
    ]);
  });

  it("ignores action inputs named uses", () => {
    const source = `
jobs:
  test:
    steps:
      - uses: actions/example@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v1
        with:
          uses: application-defined-input
`;

    expect(unpinnedExternalUses(source)).toEqual([]);
  });

  it("rejects mutable references in composite action steps", () => {
    const source = `
runs:
  using: composite
  steps:
    - uses: actions/checkout@v7 # v7
`;

    expect(unpinnedExternalUses(source)).toHaveLength(1);
  });

  it("checks caller jobs without treating their inputs as references", () => {
    const mutableCaller = `
jobs:
  caller:
    uses: SecPal/.github/.github/workflows/example.yml@main # main
`;
    const pinnedCaller = `
jobs:
  caller:
    uses: SecPal/.github/.github/workflows/example.yml@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # main
    with:
      uses: application-defined-input
`;

    expect(unpinnedExternalUses(mutableCaller)).toHaveLength(1);
    expect(unpinnedExternalUses(pinnedCaller)).toEqual([]);
  });

  it("accepts documented full SHAs and local actions", () => {
    expect(
      unpinnedExternalUses(`
jobs:
  test:
    steps:
      - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v7
      - uses: actions/example@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v1.2.3
      - uses: SecPal/.github/.github/workflows/example.yml@cccccccccccccccccccccccccccccccccccccccc # main
      - uses: ./.github/actions/setup
`)
    ).toEqual([]);
  });

  it.each([
    '- "uses": actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v7',
    "- uses : actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v7",
    "- { uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa } # v7",
  ])("accepts a documented full SHA in valid YAML form %s", (reference) => {
    expect(unpinnedExternalUses(workflowWithStep(reference))).toEqual([]);
  });

  it("allows optional non-filtering Dependabot updater fields", () => {
    expect(
      isEnabledUnfilteredGitHubActionsUpdater({
        ...enabledGitHubActionsUpdater,
        schedule: { interval: "weekly" },
        "open-pull-requests-limit": 5,
        reviewers: ["security-reviewer"],
        assignees: ["dependency-maintainer"],
      })
    ).toBe(true);
  });

  it.each(dependabotFilterFields)(
    "rejects the Dependabot filtering field %s",
    (field) => {
      expect(
        isEnabledUnfilteredGitHubActionsUpdater({
          ...enabledGitHubActionsUpdater,
          [field]: [],
        })
      ).toBe(false);
    }
  );

  it.each([
    { schedule: { interval: "never" } },
    { schedule: { interval: "cron" } },
    { "open-pull-requests-limit": 0 },
  ])("rejects a disabled Dependabot updater %#", (override) => {
    expect(
      isEnabledUnfilteredGitHubActionsUpdater({
        ...enabledGitHubActionsUpdater,
        ...override,
      })
    ).toBe(false);
  });

  it("keeps Dependabot enabled for GitHub Actions at the repository root", () => {
    const dependabot = load(
      readFileSync(resolve(repoRoot, ".github/dependabot.yml"), "utf8")
    ) as {
      version?: unknown;
      updates?: Array<Record<string, unknown>>;
    };
    const updaters = dependabot.updates?.filter(
      (candidate) => candidate["package-ecosystem"] === "github-actions"
    );
    const updater = updaters?.[0];

    expect(dependabot.version).toBe(2);
    expect(updaters).toHaveLength(1);
    expect(isEnabledUnfilteredGitHubActionsUpdater(updater ?? {})).toBe(true);
  });
});
