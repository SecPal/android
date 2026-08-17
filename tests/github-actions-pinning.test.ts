// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parse,
  parseDocument,
  type Document,
  type Node,
  type Pair,
  type YAMLMap,
} from "yaml";

const repoRoot = resolve(import.meta.dirname, "..");
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

interface UsesReference {
  reference: string | null;
  sourceLine: string;
  versionComment: string;
  occupiesOnePhysicalLine: boolean;
}

function sourceLineAt(source: string, position: number): string {
  const start = source.lastIndexOf("\n", position - 1) + 1;
  const newline = source.indexOf("\n", position);
  const end = newline === -1 ? source.length : newline;

  return source.slice(start, end).trim();
}

interface SourceToken {
  type: string;
  offset: number;
  source: string;
}

function inlineVersionComment(
  source: string,
  scalarEnd: number,
  ...tokenGroups: Array<readonly SourceToken[] | undefined>
): string {
  for (const tokens of tokenGroups) {
    const comment = tokens?.find(
      (token) =>
        token.type === "comment" &&
        !source.slice(scalarEnd, token.offset).includes("\n") &&
        !source.slice(scalarEnd, token.offset).includes("\r")
    );
    if (comment !== undefined) {
      return comment.source.slice(1).trim();
    }
  }

  return "";
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

function resolvedNode(value: unknown, document: Document): Node | null {
  if (!isNode(value)) {
    return null;
  }

  let node = value;
  const visitedAliases = new Set<Node>();
  while (isAlias(node)) {
    if (visitedAliases.has(node)) {
      return null;
    }
    visitedAliases.add(node);
    const resolved = node.resolve(document);
    if (resolved === undefined) {
      return null;
    }
    node = resolved;
  }

  return node;
}

function scalarValue(value: unknown, document: Document): string | null {
  const node = resolvedNode(value, document);

  return isScalar(node) && typeof node.value === "string" ? node.value : null;
}

function mappingPair(
  mapping: YAMLMap,
  key: string,
  document: Document
): Pair | undefined {
  return mapping.items.find(
    (candidate) => scalarValue(candidate.key, document) === key
  );
}

function nodeStart(value: unknown): number | undefined {
  return isNode(value) ? (value.range?.[0] ?? undefined) : undefined;
}

function usesReference(
  pair: Pair,
  mapping: YAMLMap,
  source: string,
  document: Document
): UsesReference {
  const valueNode = resolvedNode(pair.value, document);
  const displayPosition = nodeStart(pair.value) ?? nodeStart(pair.key) ?? 0;

  if (!isScalar(valueNode) || typeof valueNode.value !== "string") {
    return {
      reference: null,
      sourceLine: sourceLineAt(source, displayPosition),
      versionComment: "",
      occupiesOnePhysicalLine: false,
    };
  }

  const token = valueNode.srcToken;
  const scalarEnd =
    token !== undefined && "source" in token
      ? token.offset + token.source.length
      : (valueNode.range?.[1] ?? 0);
  const occupiesOnePhysicalLine =
    valueNode.type !== "BLOCK_FOLDED" &&
    valueNode.type !== "BLOCK_LITERAL" &&
    token !== undefined &&
    "source" in token &&
    !token.source.includes("\n") &&
    !token.source.includes("\r");
  const scalarEndTokens =
    token !== undefined && "end" in token ? token.end : undefined;
  const mappingToken = mapping.srcToken;
  const mappingEndTokens =
    !isAlias(pair.value) && mappingToken !== undefined && "end" in mappingToken
      ? mappingToken.end
      : undefined;

  return {
    reference: valueNode.value,
    sourceLine: sourceLineAt(source, displayPosition),
    versionComment: inlineVersionComment(
      source,
      scalarEnd,
      scalarEndTokens,
      mappingEndTokens
    ),
    occupiesOnePhysicalLine,
  };
}

function usesReferences(source: string): UsesReference[] {
  const document = parseDocument(source, { keepSourceTokens: true });
  if (document.errors.length > 0) {
    throw document.errors[0];
  }

  const root = resolvedNode(document.contents, document);
  if (!isMap(root)) {
    return [];
  }

  const references: UsesReference[] = [];

  function recordUses(mapping: YAMLMap): void {
    const pair = mappingPair(mapping, "uses", document);
    if (pair !== undefined) {
      references.push(usesReference(pair, mapping, source, document));
    }
  }

  function recordSteps(value: unknown, ancestors = new Set<Node>()): void {
    const node = resolvedNode(value, document);
    if (node === null || ancestors.has(node)) {
      return;
    }

    const nextAncestors = new Set(ancestors).add(node);
    if (isSeq(node)) {
      for (const item of node.items) {
        recordSteps(item, nextAncestors);
      }
    } else if (isMap(node)) {
      recordUses(node);
    }
  }

  const jobs = resolvedNode(
    mappingPair(root, "jobs", document)?.value,
    document
  );
  if (isMap(jobs)) {
    for (const job of jobs.items) {
      const jobDefinition = resolvedNode(job.value, document);
      if (!isMap(jobDefinition)) {
        continue;
      }

      recordUses(jobDefinition);
      recordSteps(mappingPair(jobDefinition, "steps", document)?.value);
    }
  }

  const runs = resolvedNode(
    mappingPair(root, "runs", document)?.value,
    document
  );
  if (isMap(runs)) {
    recordSteps(mappingPair(runs, "steps", document)?.value);
  }

  return references;
}

function unpinnedExternalUses(source: string): string[] {
  return usesReferences(source)
    .filter(
      ({ reference }) => reference === null || !reference.startsWith("./")
    )
    .filter(({ reference, versionComment, occupiesOnePhysicalLine }) => {
      const separator = reference?.lastIndexOf("@") ?? -1;
      const revision =
        separator === -1 || reference === null
          ? ""
          : reference.slice(separator + 1);

      return (
        !occupiesOnePhysicalLine ||
        !fullCommitSha.test(revision) ||
        !isDocumentedGitRef(versionComment)
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

function pinningSourceFiles(root = repoRoot): string[] {
  const workflowDirectory = resolve(root, ".github/workflows");
  const localActionDirectory = resolve(root, ".github/actions");
  const workflowFiles = readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => resolve(workflowDirectory, name));
  const rootActionManifests = ["action.yml", "action.yaml"]
    .map((name) => resolve(root, name))
    .filter(existsSync);
  const sourceFiles = [
    ...workflowFiles,
    ...rootActionManifests,
    ...actionManifestFiles(localActionDirectory),
  ];
  const discoveredFiles = new Set(sourceFiles);

  for (let index = 0; index < sourceFiles.length; index += 1) {
    const source = readFileSync(sourceFiles[index], "utf8");
    const localActionDirectories = usesReferences(source)
      .map(({ reference }) => reference)
      .filter(
        (reference): reference is string => reference?.startsWith("./") ?? false
      )
      .map((reference) => resolve(root, reference));

    for (const directory of localActionDirectories) {
      const pathFromRoot = relative(root, directory);
      if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)) {
        continue;
      }

      for (const filename of ["action.yml", "action.yaml"]
        .map((name) => resolve(directory, name))
        .filter(existsSync)) {
        if (!discoveredFiles.has(filename)) {
          discoveredFiles.add(filename);
          sourceFiles.push(filename);
        }
      }
    }
  }

  return sourceFiles;
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
  const hasDirectory = Object.hasOwn(updater, "directory");
  const hasDirectories = Object.hasOwn(updater, "directories");
  const directories = updater.directories;
  const coversRepositoryRoot =
    hasDirectory !== hasDirectories &&
    ((hasDirectory && updater.directory === "/") ||
      (hasDirectories &&
        Array.isArray(directories) &&
        directories.length === 1 &&
        directories[0] === "/"));

  return (
    updater["package-ecosystem"] === "github-actions" &&
    coversRepositoryRoot &&
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

  it("applies the workflow rules to action manifests in any directory", () => {
    const instructions = readFileSync(
      resolve(
        repoRoot,
        ".github/instructions/github-workflows.instructions.md"
      ),
      "utf8"
    );
    const frontmatter = parse(instructions.split("---")[1]) as {
      applyTo?: string;
    };
    const patterns = frontmatter.applyTo?.split(",") ?? [];

    expect(patterns).toEqual(
      expect.arrayContaining(["**/action.yml", "**/action.yaml"])
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

  it("checks referenced composite actions outside the conventional directory", () => {
    const temporaryRoot = mkdtempSync(
      resolve(tmpdir(), "secpal-action-pinning-")
    );

    try {
      const workflowPath = resolve(
        temporaryRoot,
        ".github/workflows/quality.yml"
      );
      const actionPath = resolve(
        temporaryRoot,
        "tools/build-action/action.yml"
      );
      const nestedActionPath = resolve(
        temporaryRoot,
        "packages/setup-action/action.yaml"
      );
      mkdirSync(resolve(workflowPath, ".."), { recursive: true });
      mkdirSync(resolve(actionPath, ".."), { recursive: true });
      mkdirSync(resolve(nestedActionPath, ".."), { recursive: true });
      writeFileSync(
        workflowPath,
        `jobs:
  test:
    steps:
      - uses: ./tools/build-action
`
      );
      writeFileSync(
        actionPath,
        `runs:
  using: composite
  steps:
    - uses: ./packages/setup-action
`
      );
      writeFileSync(
        nestedActionPath,
        `runs:
  using: composite
  steps:
    - uses: actions/checkout@v7 # v7
`
      );

      const sourceFiles = pinningSourceFiles(temporaryRoot);
      const violations = sourceFiles.flatMap((filename) =>
        unpinnedExternalUses(readFileSync(filename, "utf8")).map(
          (reference) => `${relative(temporaryRoot, filename)}: ${reference}`
        )
      );

      expect(violations).toEqual([
        "packages/setup-action/action.yaml: - uses: actions/checkout@v7 # v7",
      ]);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
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

  it("rejects version documentation on the following line", () => {
    const source = `
jobs:
  test:
    steps:
      - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
        # v7
`;

    expect(unpinnedExternalUses(source)).toHaveLength(1);
  });

  it("rejects an action reference split across physical lines", () => {
    const source = `
jobs:
  test:
    steps:
      - uses: "actions/checkout@aaaaaaaaaaaaaaaaaaaa\\
          aaaaaaaaaaaaaaaaaaaa" # v7
`;

    expect(unpinnedExternalUses(source)).toHaveLength(1);
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

  it("requires alias version documentation beside the anchored SHA", () => {
    const source = `
shared:
  ref: &checkout actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
jobs:
  test:
    steps:
      - uses: *checkout # v7
`;

    expect(unpinnedExternalUses(source)).toHaveLength(1);
  });

  it("accepts alias version documentation beside the anchored SHA", () => {
    const source = `
shared:
  ref: &checkout actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v7
jobs:
  test:
    steps:
      - uses: *checkout
`;

    expect(unpinnedExternalUses(source)).toEqual([]);
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

  it.each([">-", "|-"])(
    "rejects an action reference in a %s block scalar",
    (indicator) => {
      const source = `
jobs:
  test:
    steps:
      - uses: ${indicator} # v7
          actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`;

      expect(unpinnedExternalUses(source)).toHaveLength(1);
    }
  );

  it("rejects a block-scalar full SHA without version documentation", () => {
    const source = `
jobs:
  test:
    steps:
      - uses: >-
          actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`;

    expect(unpinnedExternalUses(source)).toHaveLength(1);
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

  it("accepts the plural root-directory Dependabot updater form", () => {
    const updater: Record<string, unknown> = {
      ...enabledGitHubActionsUpdater,
    };
    delete updater.directory;

    expect(
      isEnabledUnfilteredGitHubActionsUpdater({
        ...updater,
        directories: ["/"],
      })
    ).toBe(true);
  });

  it("rejects mutually exclusive Dependabot directory forms used together", () => {
    expect(
      isEnabledUnfilteredGitHubActionsUpdater({
        ...enabledGitHubActionsUpdater,
        directories: ["/"],
      })
    ).toBe(false);
  });

  it("rejects a plural Dependabot form that is not exactly the root", () => {
    const updater: Record<string, unknown> = {
      ...enabledGitHubActionsUpdater,
      directories: ["/", "/nested"],
    };
    delete updater.directory;

    expect(isEnabledUnfilteredGitHubActionsUpdater(updater)).toBe(false);
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
    const dependabot = parse(
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

  it("keeps GitHub Actions Dependabot groups semver-homogeneous", () => {
    const dependabot = parse(
      readFileSync(resolve(repoRoot, ".github/dependabot.yml"), "utf8")
    ) as {
      updates?: Array<{
        "package-ecosystem"?: unknown;
        groups?: Record<string, Record<string, unknown>>;
      }>;
    };
    const groups = dependabot.updates?.find(
      (candidate) => candidate["package-ecosystem"] === "github-actions"
    )?.groups;
    const sharedWorkflowPattern = "SecPal/.github/.github/workflows/*";

    expect(groups?.["shared-workflow-pins"]).toEqual({
      patterns: [sharedWorkflowPattern],
    });
    for (const updateType of ["patch", "minor", "major"]) {
      expect(groups?.[`github-actions-${updateType}`]).toEqual({
        patterns: ["*"],
        "exclude-patterns": [sharedWorkflowPattern],
        "update-types": [updateType],
      });
    }
  });

  it("runs Dependabot auto-merge from immutable target-branch code", () => {
    const workflow = parse(
      readFileSync(
        resolve(repoRoot, ".github/workflows/dependabot-auto-merge.yml"),
        "utf8"
      )
    ) as {
      on?: Record<string, unknown>;
      jobs?: Record<string, Record<string, unknown>>;
    };

    expect(workflow.on?.pull_request_target).toEqual({
      types: ["opened", "synchronize", "reopened", "ready_for_review"],
    });
    expect(workflow.on?.pull_request).toBeUndefined();
    expect(workflow.jobs?.["auto-merge"]?.uses).toMatch(
      /^SecPal\/\.github\/\.github\/workflows\/reusable-dependabot-auto-merge\.yml@[0-9a-f]{40}$/
    );
    expect(workflow.jobs?.["auto-merge"]?.steps).toBeUndefined();
  });
});
