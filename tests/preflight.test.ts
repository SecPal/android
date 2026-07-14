/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const domainCheckerEnvironment = {
  ...process.env,
  SECPAL_NODE_MODULES_ROOT: repoRoot,
};

describe("preflight", () => {
  it("ignores only Fastlane's generated mixed-style documentation", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-fastlane-readme-"));
    const fastlaneDirectory = join(tempRoot, "fastlane");
    const generatedReadme = join(fastlaneDirectory, "README.md");
    const maintainedReadme = join(tempRoot, "README.md");
    const mixedHeadings = [
      "fastlane documentation",
      "----",
      "",
      "# Available Actions",
      "",
      "## Android",
      "",
      "### build_signed_apk",
      "",
      "Build the signed Android APK.",
      "",
    ].join("\n");

    try {
      mkdirSync(fastlaneDirectory);
      writeFileSync(generatedReadme, mixedHeadings);

      const generatedResult = spawnSync(
        resolve(repoRoot, "node_modules", ".bin", "markdownlint"),
        [
          "--config",
          resolve(repoRoot, ".markdownlint.json"),
          "**/*.md",
          "--ignore",
          "fastlane/README.md",
        ],
        { cwd: tempRoot, encoding: "utf8" }
      );

      expect(
        generatedResult.status,
        `${generatedResult.stdout}${generatedResult.stderr}`
      ).toBe(0);

      writeFileSync(maintainedReadme, mixedHeadings);

      const maintainedResult = spawnSync(
        resolve(repoRoot, "node_modules", ".bin", "markdownlint"),
        [
          "--config",
          resolve(repoRoot, ".markdownlint.json"),
          "**/*.md",
          "--ignore",
          "fastlane/README.md",
        ],
        { cwd: tempRoot, encoding: "utf8" }
      );

      expect(maintainedResult.status).toBe(1);
      expect(`${maintainedResult.stdout}${maintainedResult.stderr}`).toContain(
        "MD003/heading-style"
      );

      const preflight = readFileSync(
        resolve(repoRoot, "scripts", "preflight.sh"),
        "utf8"
      );
      expect(preflight).toContain("--ignore fastlane/README.md");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("resolves formatter hooks only from the installed lockfile dependencies", () => {
    const config = readFileSync(
      resolve(repoRoot, ".pre-commit-config.yaml"),
      "utf8"
    );

    expect(config).toContain(
      "entry: ./scripts/run-lockfile-tool.sh prettier --write"
    );
    expect(config).toContain(
      "./scripts/run-lockfile-tool.sh markdownlint --config"
    );
    expect(config).toContain("--ignore fastlane/README.md");
    expect(config).not.toContain("mirrors-prettier");
    expect(config).not.toContain("npx");
  });

  it("installs locked Node dependencies before invoking local formatter binaries", () => {
    const script = readFileSync(
      resolve(repoRoot, "scripts", "preflight.sh"),
      "utf8"
    );

    const dependencyInstallIndex = script.indexOf("npm ci");
    const localFormatterIndex = script.indexOf("./node_modules/.bin/prettier");

    expect(dependencyInstallIndex).toBeGreaterThan(-1);
    expect(localFormatterIndex).toBeGreaterThan(-1);
    expect(dependencyInstallIndex).toBeLessThan(localFormatterIndex);
  });

  it("lints only YAML files tracked by Git", () => {
    const script = readFileSync(
      resolve(repoRoot, "scripts", "preflight.sh"),
      "utf8"
    );

    expect(script).toContain("git ls-files -z -- '*.yml' '*.yaml'");
    expect(script).not.toContain(
      "-type f \\( -name '*.yml' -o -name '*.yaml' \\)"
    );
  });

  it("omits tracked YAML files deleted from the worktree", () => {
    const script = readFileSync(
      resolve(repoRoot, "scripts", "preflight.sh"),
      "utf8"
    );
    const functionMatch = script.match(
      /get_tracked_yaml_files\(\) \{[\s\S]*?^\}/m
    );

    expect(functionMatch).not.toBeNull();

    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-preflight-yaml-"));

    try {
      spawnSync("git", ["init", "--quiet"], { cwd: tempRoot });
      writeFileSync(join(tempRoot, "kept.yaml"), "key: value\n");
      writeFileSync(join(tempRoot, "deleted.yaml"), "key: value\n");
      spawnSync("git", ["add", "kept.yaml", "deleted.yaml"], {
        cwd: tempRoot,
      });
      unlinkSync(join(tempRoot, "deleted.yaml"));

      const result = spawnSync(
        "bash",
        ["-c", `${functionMatch?.[0]}\nget_tracked_yaml_files`],
        { cwd: tempRoot, encoding: "utf8" }
      );

      expect(result.status).toBe(0);
      expect(result.stdout.split("\0").filter(Boolean)).toEqual(["kept.yaml"]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("bootstraps missing hook dependencies before executing the local binary", () => {
    const hookRunner = readFileSync(
      resolve(repoRoot, "scripts", "run-lockfile-tool.sh"),
      "utf8"
    );

    expect(hookRunner.indexOf("npm ci")).toBeGreaterThan(-1);
    expect(
      hookRunner.indexOf('exec "./node_modules/.bin/$tool"')
    ).toBeGreaterThan(hookRunner.indexOf("npm ci"));
    expect(hookRunner).toContain(
      "package-lock.json -nt node_modules/.package-lock.json"
    );
  });

  it("allows SecPal storage keys while rejecting unapproved SecPal hostnames", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-domain-policy-"));
    const checker = join(tempRoot, "check-domains.sh");
    const storageKey = "secpal" + ".asset-load-recovery";
    const deprecatedHost = ["api", "secpal", "app"].join(".");

    try {
      copyFileSync(resolve(repoRoot, "scripts", "check-domains.sh"), checker);
      copyFileSync(
        resolve(repoRoot, "scripts", "check-domains-parser.mjs"),
        join(tempRoot, "check-domains-parser.mjs")
      );
      writeFileSync(
        join(tempRoot, "theme-color.js"),
        `localStorage.setItem("${storageKey}", "1");\n`
      );

      const storageKeyResult = spawnSync("bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });

      expect(storageKeyResult.status).toBe(0);

      writeFileSync(
        join(tempRoot, "storage-variants.js"),
        [
          `sessionStorage.getItem('${storageKey}');`,
          `localStorage.removeItem("${storageKey}");`,
          `localStorage.setItem("${"secpal" + ".first-key"}", "1"); sessionStorage.setItem("${"secpal" + ".second-key"}", "1");`,
          `window.localStorage.setItem("${"secpal" + ".window-key"}", "1");`,
          `globalThis.sessionStorage.getItem("${"secpal" + ".global-key"}");`,
        ].join("\n")
      );

      const storageVariantsResult = spawnSync("bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });

      expect(storageVariantsResult.status).toBe(0);

      writeFileSync(
        join(tempRoot, "multiline-storage-key.js"),
        ["localStorage.setItem(", `  "${storageKey}",`, '  "1"', ");"].join(
          "\n"
        )
      );

      const multilineStorageResult = spawnSync("bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });

      expect(multilineStorageResult.status).toBe(0);

      const customStorageHostname = "secpal" + ".invalid-host";
      writeFileSync(
        join(tempRoot, "custom-storage-helper.js"),
        [
          `notlocalStorage.setItem("${customStorageHostname}", "1");`,
          `storage.localStorage.setItem("${customStorageHostname}", "1");`,
        ].join("\n")
      );

      const customStorageHelperResult = spawnSync("bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });

      expect(customStorageHelperResult.status).toBe(1);
      expect(customStorageHelperResult.stdout).toContain(customStorageHostname);

      unlinkSync(join(tempRoot, "custom-storage-helper.js"));

      writeFileSync(
        join(tempRoot, "shadowed-storage-globals.js"),
        [
          "const localStorage = fakeStorage;",
          `localStorage.setItem("${storageKey}", "1");`,
          "function persist(window) {",
          `  window.localStorage.setItem("${storageKey}", "1");`,
          "}",
        ].join("\n")
      );

      const shadowedStorageGlobalsResult = spawnSync("bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });

      expect(shadowedStorageGlobalsResult.status).toBe(1);
      expect(shadowedStorageGlobalsResult.stdout).toContain(storageKey);

      unlinkSync(join(tempRoot, "shadowed-storage-globals.js"));

      const nestedDirectory = join(tempRoot, "nested");
      mkdirSync(nestedDirectory);
      writeFileSync(
        join(nestedDirectory, "check-domains-parser.mjs"),
        `const endpoint = "https://${customStorageHostname}/api";\n`
      );

      const moduleSourceResult = spawnSync("bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });

      expect(moduleSourceResult.status).toBe(1);
      expect(moduleSourceResult.stdout).toContain(customStorageHostname);

      rmSync(nestedDirectory, { recursive: true, force: true });

      writeFileSync(
        join(tempRoot, "deprecated-module.mjs"),
        `const endpoint = "https://${deprecatedHost}/api";\n`
      );

      const deprecatedModuleResult = spawnSync("bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });

      expect(deprecatedModuleResult.status).toBe(1);
      expect(deprecatedModuleResult.stdout).toContain(deprecatedHost);

      unlinkSync(join(tempRoot, "deprecated-module.mjs"));

      const forbiddenStorageHostname = "secpal" + ".invalid-host.com";
      writeFileSync(
        join(tempRoot, "domain-like-storage-key.js"),
        `localStorage.setItem("${forbiddenStorageHostname}", "1");\n`
      );

      const storageHostnameResult = spawnSync("bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });

      expect(storageHostnameResult.status).toBe(1);
      expect(storageHostnameResult.stdout).toContain(forbiddenStorageHostname);

      unlinkSync(join(tempRoot, "domain-like-storage-key.js"));

      const concatenatedStorageHostname = "secpal" + ".invalid-host";
      writeFileSync(
        join(tempRoot, "concatenated-storage-key.js"),
        `localStorage.setItem("${concatenatedStorageHostname}" + ".com", "1");\n`
      );

      const concatenatedStorageHostnameResult = spawnSync("bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });

      expect(concatenatedStorageHostnameResult.status).toBe(1);
      expect(concatenatedStorageHostnameResult.stdout).toContain(
        concatenatedStorageHostname
      );

      unlinkSync(join(tempRoot, "concatenated-storage-key.js"));

      const forbiddenHostname = "secpal" + ".invalid";
      writeFileSync(
        join(tempRoot, "unapproved-host.js"),
        `const endpoint = "https://${forbiddenHostname}/api";\n`
      );

      const hostnameResult = spawnSync("bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });

      expect(hostnameResult.status).toBe(1);
      expect(hostnameResult.stdout).toContain(forbiddenHostname);

      unlinkSync(join(tempRoot, "unapproved-host.js"));

      const hyphenatedForbiddenHostname = "secpal" + ".invalid-host";
      writeFileSync(
        join(tempRoot, "unapproved-hyphenated-host.js"),
        `const endpoint = "https://${hyphenatedForbiddenHostname}/api";\n`
      );

      const hyphenatedHostnameResult = spawnSync("bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });

      expect(hyphenatedHostnameResult.status).toBe(1);
      expect(hyphenatedHostnameResult.stdout).toContain(
        hyphenatedForbiddenHostname
      );

      unlinkSync(join(tempRoot, "unapproved-hyphenated-host.js"));

      const checkerHostname = "secpal" + ".checker-host.com";
      const checkerSource = readFileSync(checker, "utf8");
      writeFileSync(
        checker,
        `${checkerSource}\n# https://${checkerHostname}/api\n`
      );

      const checkerSourceResult = spawnSync("bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });

      expect(checkerSourceResult.status).toBe(1);
      expect(checkerSourceResult.stdout).toContain(checkerHostname);
      writeFileSync(checker, checkerSource);

      const parserHostname = "secpal" + ".parser-host.com";
      const parser = join(tempRoot, "check-domains-parser.mjs");
      writeFileSync(
        parser,
        `${readFileSync(parser, "utf8")}\n// https://${parserHostname}/api\n`
      );

      const parserSourceResult = spawnSync("bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });

      expect(parserSourceResult.status).toBe(1);
      expect(parserSourceResult.stdout).toContain(parserHostname);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("recognizes only proven straight-line storage keys", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-domain-policy-"));
    const parser = resolve(repoRoot, "scripts", "check-domains-parser.mjs");
    const focusedKey = (suffix: string) => "secpal" + `.focused-${suffix}`;
    const acceptedCase = (suffix: string, source: string) =>
      [focusedKey(suffix), source, "ts"] as const;
    const rejectedCase = (suffix: string, source: string) =>
      [focusedKey(suffix), source] as const;
    const simpleHelperSource = (suffix: string, calls: string) =>
      `const storageKey = "${focusedKey(suffix)}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\n${calls}`;
    const simpleHelperCase = (suffix: string, calls = "persist();") =>
      acceptedCase(suffix, simpleHelperSource(suffix, calls));
    const rejectedHelperCase = (suffix: string, calls: string) =>
      rejectedCase(suffix, simpleHelperSource(suffix, calls));
    const helperChain = (storageKey: string, helperCalls: number) =>
      [
        `const storageKey = "${storageKey}";`,
        'function helper0() { localStorage.setItem(storageKey, "1"); }',
        ...Array.from(
          { length: helperCalls - 1 },
          (_, index) => `function helper${index + 1}() { helper${index}(); }`
        ),
        `helper${helperCalls - 1}();`,
      ].join("\n");
    const accepted = [
      [
        focusedKey("const-direct"),
        `const storageKey = "${focusedKey("const-direct")}";\nlocalStorage.setItem(storageKey, "1");`,
        "js",
      ],
      [
        focusedKey("let-typed"),
        `let storageKey: string = "${focusedKey("let-typed")}";\nwindow.localStorage.getItem(storageKey);`,
        "ts",
      ],
      [
        focusedKey("var-template"),
        `var storageKey = \`${focusedKey("var-template")}\`;\nsessionStorage.removeItem(storageKey);`,
        "cjs",
      ],
      [
        focusedKey("asserted"),
        `const storageKey = "${focusedKey("asserted")}" as const;\nlocalStorage.setItem(storageKey as string, "1");`,
        "ts",
      ],
      [
        focusedKey("type-only"),
        `const storageKey = "${focusedKey("type-only")}";\ntype StorageKey = typeof storageKey;\ntype StorageMap = { [storageKey]: string };\nlocalStorage.setItem(storageKey, "1");`,
        "ts",
      ],
      [
        focusedKey("literal-type"),
        `const storageKey: "${focusedKey("literal-type")}" = "${focusedKey("literal-type")}";\nlocalStorage.setItem(storageKey, "1");`,
        "ts",
      ],
      [
        focusedKey("literal-assertion"),
        `const storageKey = "${focusedKey("literal-assertion")}" as "${focusedKey("literal-assertion")}";\nlocalStorage.setItem(storageKey as "${focusedKey("literal-assertion")}", "1");`,
        "ts",
      ],
      [
        focusedKey("literal-call-assertion"),
        `localStorage.setItem("${focusedKey("literal-call-assertion")}" as "${focusedKey("literal-call-assertion")}", "1");`,
        "ts",
      ],
      [
        focusedKey("template-literal-type"),
        `const storageKey: \`${focusedKey("template-literal-type")}\` = \`${focusedKey("template-literal-type")}\`;\nlocalStorage.setItem(storageKey, "1");`,
        "ts",
      ],
      [
        focusedKey("literal-global"),
        `globalThis.sessionStorage["getItem"]("${focusedKey("literal-global")}");`,
        "mjs",
      ],
      [
        focusedKey("directive-prefix"),
        `"use strict";\nlocalStorage.setItem("${focusedKey("directive-prefix")}", "1");`,
        "js",
      ],
      [
        focusedKey("type-import"),
        `import type { StorageKey } from "./types";\nlocalStorage.setItem("${focusedKey("type-import")}", "1");`,
        "ts",
      ],
      [
        focusedKey("type-export"),
        `export type { StorageKey } from "./types";\nlocalStorage.setItem("${focusedKey("type-export")}", "1");`,
        "ts",
      ],
      [
        focusedKey("type-import-after"),
        `localStorage.setItem("${focusedKey("type-import-after")}", "1");\nimport type { StorageKey } from "./types";`,
        "ts",
      ],
      [
        focusedKey("type-export-after"),
        `localStorage.setItem("${focusedKey("type-export-after")}", "1");\nexport type { StorageKey } from "./types";`,
        "ts",
      ],
      [
        focusedKey("type-only-key-export"),
        `const storageKey = "${focusedKey("type-only-key-export")}";\nexport type { storageKey };\nlocalStorage.setItem(storageKey, "1");`,
        "ts",
      ],
      [
        focusedKey("unrelated-storage"),
        `localStorage.setItem("theme", "dark");\nlocalStorage.setItem("${focusedKey("unrelated-storage")}", "1");`,
        "js",
      ],
      [
        focusedKey("unrelated-storage-after"),
        `localStorage.setItem("${focusedKey("unrelated-storage-after")}", "1");\nlocalStorage.setItem("theme", "dark");`,
        "js",
      ],
      [
        focusedKey("nested-unrelated-storage"),
        `function readTheme() { return localStorage.getItem("theme"); }\nlocalStorage.setItem("${focusedKey("nested-unrelated-storage")}", "1");`,
        "js",
      ],
      [
        focusedKey("later-global-alias"),
        `localStorage.setItem("${focusedKey("later-global-alias")}", "1");\nconst browser = window;`,
        "js",
      ],
      [
        focusedKey("dormant-global-alias"),
        `function aliasBrowser() { const browser = window; return browser; }\nlocalStorage.setItem("${focusedKey("dormant-global-alias")}", "1");`,
        "js",
      ],
      [
        focusedKey("empty-class"),
        `class Helper {}\nlocalStorage.setItem("${focusedKey("empty-class")}", "1");`,
        "js",
      ],
      [
        focusedKey("passive-class"),
        `class Helper { value = window; method() { return window; } static method() { return globalThis; } }\nlocalStorage.setItem("${focusedKey("passive-class")}", "1");`,
        "js",
      ],
      [
        focusedKey("passive-static-class"),
        `class Helper { static value = "ready"; static ["named"] = 1; }\nlocalStorage.setItem("${focusedKey("passive-static-class")}", "1");`,
        "js",
      ],
      [
        focusedKey("implements-class"),
        `class Helper implements Contract {}\nlocalStorage.setItem("${focusedKey("implements-class")}", "1");`,
        "ts",
      ],
      [
        focusedKey("later-local-export"),
        `localStorage.setItem("${focusedKey("later-local-export")}", "1");\nconst value = "value";\nexport { value };`,
        "ts",
      ],
      [
        focusedKey("earlier-local-export"),
        `const value = "value";\nexport { value };\nlocalStorage.setItem("${focusedKey("earlier-local-export")}", "1");`,
        "ts",
      ],
      [
        focusedKey("uninitialized-prefix"),
        `let cached;\nlocalStorage.setItem("${focusedKey("uninitialized-prefix")}", "1");`,
        "js",
      ],
      [
        focusedKey("sequential-uses"),
        `const storageKey = "${focusedKey("sequential-uses")}";\nlocalStorage.getItem(storageKey);\nlocalStorage.removeItem(storageKey);`,
        "ts",
      ],
      [
        focusedKey("ambient"),
        `declare const localStorage: Storage;\nconst storageKey = "${focusedKey("ambient")}";\nlocalStorage.setItem(storageKey, "1");`,
        "ts",
      ],
      [
        focusedKey("iife"),
        `(() => {\n  const storageKey = "${focusedKey("iife")}";\n  localStorage.setItem(storageKey, "1");\n})();`,
        "ts",
      ],
      [
        focusedKey("iife-prefix"),
        `const ready = true;\n(() => {\n  "use strict";\n  localStorage.setItem("${focusedKey("iife-prefix")}", "1");\n})();`,
        "ts",
      ],
      [
        focusedKey("sequential-iife"),
        `(() => { localStorage.setItem("theme", "dark"); })();\n(() => { localStorage.setItem("${focusedKey("sequential-iife")}", "1"); })();`,
        "ts",
      ],
      [
        focusedKey("iife-then-direct"),
        `(() => { localStorage.setItem("theme", "dark"); })();\nlocalStorage.setItem("${focusedKey("iife-then-direct")}", "1");`,
        "ts",
      ],
      [
        focusedKey("concise-iife"),
        `(() => localStorage.setItem("${focusedKey("concise-iife")}", "1"))();`,
        "ts",
      ],
      [
        focusedKey("function-iife"),
        `(function () { localStorage.setItem("${focusedKey("function-iife")}", "1"); })();`,
        "ts",
      ],
      [
        focusedKey("nested-iife"),
        `(() => { (() => { localStorage.setItem("${focusedKey("nested-iife")}", "1"); })(); })();`,
        "ts",
      ],
      [
        focusedKey("nested-concise-iife"),
        `(() => (() => localStorage.setItem("${focusedKey("nested-concise-iife")}", "1"))())();`,
        "ts",
      ],
      [
        focusedKey("async-iife-before-suspension"),
        `(async () => { localStorage.setItem("${focusedKey("async-iife-before-suspension")}", "1"); })();`,
        "ts",
      ],
      simpleHelperCase("helper-call"),
      acceptedCase(
        "nested-helper-call",
        `const storageKey = "${focusedKey("nested-helper-call")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nfunction initialize() { persist(); }\ninitialize();`
      ),
      acceptedCase(
        "scoped-helper-call",
        `(() => { const storageKey = "${focusedKey("scoped-helper-call")}"; function persist() { localStorage.setItem(storageKey, "1"); } persist(); })();`
      ),
      acceptedCase(
        "helper-before-key",
        `function persist() { localStorage.setItem(storageKey, "1"); }\nconst storageKey = "${focusedKey("helper-before-key")}";\npersist();`
      ),
      acceptedCase(
        "overloaded-helper",
        `const storageKey = "${focusedKey("overloaded-helper")}";\nfunction persist(): void;\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();`
      ),
      simpleHelperCase(
        "type-only-helper",
        "type Persist = typeof persist;\npersist();"
      ),
      acceptedCase(
        "sequential-helper-calls",
        `const storageKey = "${focusedKey("sequential-helper-calls")}";\nfunction persistFirst() { localStorage.setItem(storageKey, "1"); }\nfunction persistSecond() { localStorage.setItem(storageKey, "1"); }\npersistFirst();\npersistSecond();`
      ),
      simpleHelperCase("repeated-helper-call", "persist();\npersist();"),
      acceptedCase(
        "candidate-before-literal",
        `const storageKey = "${focusedKey("candidate-before-literal-first")}";\nlocalStorage.setItem(storageKey, "1");\nlocalStorage.setItem("${focusedKey("candidate-before-literal")}", "1");`
      ),
      ...(["a", "b"] as const).map((suffix) =>
        acceptedCase(
          `execution-order-${suffix}`,
          `const bKey = "${focusedKey("execution-order-b")}";\nconst aKey = "${focusedKey("execution-order-a")}";\nlocalStorage.setItem(aKey, "1");\nlocalStorage.setItem(bKey, "1");`
        )
      ),
      acceptedCase(
        "dormant-helper-call",
        `const storageKey = "${focusedKey("dormant-helper-call")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nfunction unused() { persist(); }\npersist();`
      ),
      acceptedCase(
        "sibling-helper-limit",
        `const storageKey = "${focusedKey("sibling-helper-limit")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\n${Array.from({ length: 8 }, () => "persist();").join("\n")}`
      ),
      acceptedCase(
        "aggregate-helper-limit",
        `const storageKey = "${focusedKey("aggregate-helper-limit")}";\nfunction persistFirst() { localStorage.setItem(storageKey, "1"); }\nfunction persistSecond() { localStorage.setItem(storageKey, "1"); }\n${Array.from({ length: 4 }, () => "persistFirst();").join("\n")}\n${Array.from({ length: 4 }, () => "persistSecond();").join("\n")}`
      ),
      acceptedCase(
        "helper-call-limit",
        helperChain(focusedKey("helper-call-limit"), 8)
      ),
    ] as const;
    const rejected = [
      [
        focusedKey("concatenated"),
        `const storageKey = "${focusedKey("concatenated")}" + ".com";\nlocalStorage.setItem(storageKey, "1");`,
      ],
      [
        focusedKey("continued"),
        `const storageKey = "${focusedKey("continued")}"\n  + ".com";\nlocalStorage.setItem(storageKey, "1");`,
      ],
      [
        focusedKey("dual-use"),
        `const storageKey = "${focusedKey("dual-use")}";\nlocalStorage.setItem(storageKey, "1");\nfetch(storageKey);`,
      ],
      [
        focusedKey("interpolated"),
        `const suffix = "value";\nconst storageKey = \`${focusedKey("interpolated")}\${suffix}\`;\nlocalStorage.setItem(storageKey, "1");`,
      ],
      [
        focusedKey("nested-template"),
        [
          `const storageKey = "${focusedKey("nested-template")}";`,
          "const text = `${`${storageKey}`}`;",
          'localStorage.setItem(storageKey, "1");',
        ].join("\n"),
      ],
      [
        focusedKey("line-comment"),
        `// const storageKey = "${focusedKey("line-comment")}";\nlocalStorage.setItem(storageKey, "1");`,
      ],
      [
        focusedKey("block-comment"),
        `/* const storageKey = "${focusedKey("block-comment")}"; */\nlocalStorage.setItem(storageKey, "1");`,
      ],
      [
        focusedKey("regex-code"),
        `const source = /${focusedKey("regex-code")}/;\nlocalStorage.setItem(storageKey, "1");`,
      ],
      [
        focusedKey("string-code"),
        `const source = 'const storageKey = "${focusedKey("string-code")}"';\nlocalStorage.setItem(storageKey, "1");`,
      ],
      [
        focusedKey("shadowed"),
        `const localStorage = fakeStorage;\nconst storageKey = "${focusedKey("shadowed")}";\nlocalStorage.setItem(storageKey, "1");`,
      ],
      [
        focusedKey("exported"),
        `export const storageKey = "${focusedKey("exported")}";\nlocalStorage.setItem(storageKey, "1");`,
      ],
      [
        focusedKey("named-export"),
        `const storageKey = "${focusedKey("named-export")}";\nlocalStorage.setItem(storageKey, "1");\nexport { storageKey };`,
      ],
      [
        focusedKey("default-export"),
        `const storageKey = "${focusedKey("default-export")}";\nlocalStorage.setItem(storageKey, "1");\nexport default storageKey;`,
      ],
      [
        focusedKey("multi-declaration"),
        `const storageKey = "${focusedKey("multi-declaration")}", other = "value";\nlocalStorage.setItem(storageKey, "1");`,
      ],
      rejectedHelperCase("helper", "setTimeout(persist);"),
      [
        focusedKey("async-helper"),
        `const storageKey = "${focusedKey("async-helper")}";\nasync function persist() { localStorage.setItem(storageKey, "1"); }\npersist();`,
      ],
      [
        focusedKey("parameterized-helper"),
        `const storageKey = "${focusedKey("parameterized-helper")}";\nfunction persist(value) { localStorage.setItem(storageKey, "1"); }\npersist();`,
      ],
      [
        focusedKey("generator-helper"),
        `const storageKey = "${focusedKey("generator-helper")}";\nfunction* persist() { localStorage.setItem(storageKey, "1"); }\npersist();`,
      ],
      [
        focusedKey("exported-helper"),
        `const storageKey = "${focusedKey("exported-helper")}";\nexport function persist() { localStorage.setItem(storageKey, "1"); }\npersist();`,
      ],
      [
        focusedKey("named-export-helper"),
        `const storageKey = "${focusedKey("named-export-helper")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nexport { persist };\npersist();`,
      ],
      [
        focusedKey("duplicate-helper"),
        `const storageKey = "${focusedKey("duplicate-helper")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nfunction persist() {}\npersist();`,
      ],
      [
        focusedKey("later-safe-key"),
        `localStorage.setItem(firstKey, "1");\nconst firstKey = "${focusedKey("earlier-bad-key")}";\nconst secondKey = "${focusedKey("later-safe-key")}";\nlocalStorage.setItem(secondKey, "1");`,
      ],
      rejectedHelperCase("optional-helper", "persist?.();"),
      rejectedHelperCase(
        "reassigned-helper",
        "persist = replacement;\npersist();"
      ),
      [
        focusedKey("helper-call-limit-exceeded"),
        helperChain(focusedKey("helper-call-limit-exceeded"), 9),
      ],
      [
        focusedKey("helper-trailing-effect"),
        `const storageKey = "${focusedKey("helper-trailing-effect")}";\nfunction persistFirst() { localStorage.setItem(storageKey, "1"); initialize(); }\nfunction persistSecond() { localStorage.setItem(storageKey, "1"); }\npersistFirst();\npersistSecond();`,
      ],
      [
        focusedKey("unproven-helper-prefix-key"),
        `const themeKey = "theme";\nfunction persistTheme() { localStorage.setItem(themeKey, "1"); }\npersistTheme();\nlocalStorage.setItem("${focusedKey("unproven-helper-prefix-key")}", "1");`,
      ],
      rejectedHelperCase(
        "sibling-helper-limit",
        Array.from({ length: 9 }, () => "persist();").join("\n")
      ),
      [
        focusedKey("iife-helper-limit-exceeded"),
        `const storageKey = "${focusedKey("iife-helper-limit-exceeded")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nfunction wrapper() { (() => { persist(); })(); }\n${Array.from({ length: 8 }, () => "wrapper();").join("\n")}`,
      ],
      [
        focusedKey("aggregate-helper-limit-exceeded"),
        `const storageKey = "${focusedKey("aggregate-helper-limit-exceeded")}";\nfunction persistFirst() { localStorage.setItem(storageKey, "1"); }\nfunction persistSecond() { localStorage.setItem(storageKey, "1"); }\n${Array.from({ length: 5 }, () => "persistFirst();").join("\n")}\n${Array.from({ length: 5 }, () => "persistSecond();").join("\n")}`,
      ],
      rejectedHelperCase(
        "dormant-only-helper",
        "function unused() { persist(); }"
      ),
      [
        focusedKey("live-parameterized-wrapper"),
        `const storageKey = "${focusedKey("live-parameterized-wrapper")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nfunction wrapper(value) { persist(); }\npersist();\nwrapper();`,
      ],
      [
        focusedKey("live-method-wrapper"),
        `class Wrapper { run() { persist(); } }\nconst storageKey = "${focusedKey("live-method-wrapper")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();\nnew Wrapper().run();`,
      ],
      [
        focusedKey("helper-before-var-initializer"),
        `persist();\nvar storageKey = "${focusedKey("helper-before-var-initializer")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }`,
      ],
      [
        focusedKey("helper-before-const-initializer"),
        `persist();\nconst storageKey = "${focusedKey("helper-before-const-initializer")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }`,
      ],
      [
        focusedKey("scoped-helper-before-initializer"),
        `(() => { persist(); var storageKey = "${focusedKey("scoped-helper-before-initializer")}"; function persist() { localStorage.setItem(storageKey, "1"); } })();`,
      ],
      [
        focusedKey("conditional"),
        `const storageKey = "${focusedKey("conditional")}";\nif (enabled) localStorage.setItem(storageKey, "1");`,
      ],
      [
        focusedKey("before-declaration"),
        `localStorage.setItem(storageKey, "1");\nconst storageKey = "${focusedKey("before-declaration")}";`,
      ],
      [
        focusedKey("value-call"),
        `const storageKey = "${focusedKey("value-call")}";\nlocalStorage.setItem(storageKey, value());`,
      ],
      [
        focusedKey("extra-argument"),
        `const storageKey = "${focusedKey("extra-argument")}";\nlocalStorage.setItem(storageKey, "1", "extra");`,
      ],
      [
        focusedKey("runtime-type-import"),
        `import { type StorageKey } from "./types";\nlocalStorage.setItem("${focusedKey("runtime-type-import")}", "1");`,
      ],
      [
        focusedKey("runtime-type-export"),
        `export { type StorageKey } from "./types";\nlocalStorage.setItem("${focusedKey("runtime-type-export")}", "1");`,
      ],
      [
        focusedKey("nonpassive-storage-prefix"),
        `localStorage.setItem("theme", readTheme());\nlocalStorage.setItem("${focusedKey("nonpassive-storage-prefix")}", "1");`,
      ],
      [
        focusedKey("mismatched-literal-type"),
        `const storageKey: "${focusedKey("mismatched-literal-type")}" = "${focusedKey("different-runtime-key")}";\nlocalStorage.setItem(storageKey, "1");`,
      ],
      [
        focusedKey("earlier-global-alias"),
        `const browser = window;\nlocalStorage.setItem("${focusedKey("earlier-global-alias")}", "1");`,
      ],
      [
        focusedKey("runtime-import-after"),
        `localStorage.setItem("${focusedKey("runtime-import-after")}", "1");\nimport "./setup.js";`,
      ],
      [
        focusedKey("runtime-reexport-after"),
        `localStorage.setItem("${focusedKey("runtime-reexport-after")}", "1");\nexport { setup } from "./setup.js";`,
      ],
      [
        focusedKey("class-extends"),
        `class Helper extends Base {}\nlocalStorage.setItem("${focusedKey("class-extends")}", "1");`,
      ],
      [
        focusedKey("class-computed-name"),
        `class Helper { [propertyName()]() {} }\nlocalStorage.setItem("${focusedKey("class-computed-name")}", "1");`,
      ],
      [
        focusedKey("class-static-block"),
        `class Helper { static { setup(); } }\nlocalStorage.setItem("${focusedKey("class-static-block")}", "1");`,
      ],
      [
        focusedKey("class-static-initializer"),
        `class Helper { static value = setup(); }\nlocalStorage.setItem("${focusedKey("class-static-initializer")}", "1");`,
      ],
      [
        focusedKey("class-decorator"),
        `@decorate\nclass Helper {}\nlocalStorage.setItem("${focusedKey("class-decorator")}", "1");`,
      ],
      [
        focusedKey("class-member-decorator"),
        `class Helper { @decorate method() {} }\nlocalStorage.setItem("${focusedKey("class-member-decorator")}", "1");`,
      ],
      [
        focusedKey("unresolved-local-export"),
        `export { missing };\nlocalStorage.setItem("${focusedKey("unresolved-local-export")}", "1");`,
      ],
      [
        focusedKey("iife-outer-prefix"),
        `initialize();\n(() => { localStorage.setItem("${focusedKey("iife-outer-prefix")}", "1"); })();`,
      ],
      [
        focusedKey("iife-inner-prefix"),
        `(() => { initialize(); localStorage.setItem("${focusedKey("iife-inner-prefix")}", "1"); })();`,
      ],
      [
        focusedKey("async-suspension"),
        `(async () => { await ready; localStorage.setItem("${focusedKey("async-suspension")}", "1"); })();`,
      ],
      [
        focusedKey("nested-async-suspension"),
        `(async () => { await ready; (() => { localStorage.setItem("${focusedKey("nested-async-suspension")}", "1"); })(); })();`,
      ],
      [
        focusedKey("iife-trailing-effect"),
        `(() => { localStorage.setItem("theme", "dark"); initialize(); })();\nlocalStorage.setItem("${focusedKey("iife-trailing-effect")}", "1");`,
      ],
      [
        focusedKey("iife-trailing-suspension"),
        `(async () => { localStorage.setItem("theme", "dark"); await ready; })();\nlocalStorage.setItem("${focusedKey("iife-trailing-suspension")}", "1");`,
      ],
      [
        focusedKey("optional-iife"),
        `(() => { localStorage.setItem("${focusedKey("optional-iife")}", "1"); })?.();`,
      ],
      [
        focusedKey("parameterized-iife"),
        `((value = initialize()) => { localStorage.setItem("${focusedKey("parameterized-iife")}", "1"); })();`,
      ],
      [
        focusedKey("generator-iife"),
        `(function* () { localStorage.setItem("${focusedKey("generator-iife")}", "1"); })();`,
      ],
      [
        focusedKey("deferred"),
        `setTimeout(() => { localStorage.setItem("${focusedKey("deferred")}", "1"); });`,
      ],
    ] as const;

    try {
      const files = [
        ...accepted.map(([key, source, extension], index) => {
          const file = join(tempRoot, `accepted-${index}.${extension}`);
          writeFileSync(file, source);
          return { file, key };
        }),
        ...rejected.map(([key, source], index) => {
          const file = join(tempRoot, `rejected-${index}.ts`);
          writeFileSync(file, source);
          return { file, key };
        }),
      ];
      const result = spawnSync(
        process.execPath,
        [parser, ...files.map(({ file }) => file)],
        { encoding: "utf8", env: domainCheckerEnvironment }
      );
      const outputLines = result.stdout.split("\n");
      const reports = ({ file, key }: { file: string; key: string }) => {
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const exactKey = new RegExp(
          `(?:^|[^A-Za-z0-9.-])${escapedKey}(?:$|[^A-Za-z0-9.-])`
        );
        return outputLines.some(
          (line) => line.startsWith(`${file}:`) && exactKey.test(line)
        );
      };
      expect(result.status, result.stderr).toBe(0);
      expect(
        {
          reportedAccepted: files.slice(0, accepted.length).filter(reports),
          unreportedRejected: files
            .slice(accepted.length)
            .filter((file) => !reports(file)),
        },
        result.stdout
      ).toEqual({ reportedAccepted: [], unreportedRejected: [] });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects indirect execution proof contexts", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-domain-policy-"));
    const parser = resolve(repoRoot, "scripts", "check-domains-parser.mjs");
    const storageKey = (suffix: string) => "secpal" + `.strict-${suffix}`;
    const cases = [
      `switch (value) { case 1: throw new Error(); }\nlocalStorage.setItem("${storageKey("switch-exit")}", "1");`,
      `import "./setup.js";\nlocalStorage.setItem("${storageKey("import-exit")}", "1");`,
      `using storageKey = "${storageKey("using-exit")}";\nlocalStorage.setItem(storageKey, "1");`,
      `for (; enabled;) { throw new Error(); }\nlocalStorage.setItem("${storageKey("for-exit")}", "1");`,
      `const w = window;\nw.localStorage = replacement;\nconst key = "${storageKey("global-alias")}";\nwindow.localStorage.setItem(key, "1");`,
      `globalThis["local" + "Storage"].setItem = replacement;\nlocalStorage.setItem("${storageKey("computed-global")}", "1");`,
      `const key = "${storageKey("constructor-exit")}";\nclass Helper { constructor() { if (enabled) throw new Error(); } persist() { localStorage.setItem(key, "1"); } }\nnew Helper().persist();`,
      `function mutate(store) { store.setItem = replacement; }\nmutate(localStorage);\nconst key = "${storageKey("parameter-alias")}";\nlocalStorage.setItem(key, "1");`,
      `class Storage { static { if (enabled) throw new Error(); } static { localStorage.setItem("${storageKey("static-block")}", "1"); } }`,
      `const { eval: evil } = globalThis;\nevil("localStorage.setItem = replacement");\nconst key = "${storageKey("dynamic-alias")}";\nlocalStorage.setItem(key, "1");`,
      `function block() { while (enabled) {} }\nblock();\nlocalStorage.setItem("${storageKey("while-block")}", "1");`,
    ] as const;

    try {
      const files = cases.map((source, index) => {
        const file = join(tempRoot, `indirect-${index}.ts`);
        writeFileSync(file, source);
        return file;
      });
      const result = spawnSync(process.execPath, [parser, ...files], {
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(
        [
          storageKey("switch-exit"),
          storageKey("import-exit"),
          storageKey("using-exit"),
          storageKey("for-exit"),
          storageKey("global-alias"),
          storageKey("computed-global"),
          storageKey("constructor-exit"),
          storageKey("parameter-alias"),
          storageKey("static-block"),
          storageKey("dynamic-alias"),
          storageKey("while-block"),
        ].filter((key) => !result.stdout.includes(key)),
        result.stdout
      ).toEqual([]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
  it("fails closed when the domain checker cannot run its parser", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-domain-policy-"));
    const checker = join(tempRoot, "check-domains.sh");
    const toolsDirectory = join(tempRoot, "without-node-bin");

    try {
      copyFileSync(resolve(repoRoot, "scripts", "check-domains.sh"), checker);
      copyFileSync(
        resolve(repoRoot, "scripts", "check-domains-parser.mjs"),
        join(tempRoot, "check-domains-parser.mjs")
      );
      mkdirSync(toolsDirectory);
      for (const command of ["find", "grep"]) {
        symlinkSync(`/usr/bin/${command}`, join(toolsDirectory, command));
      }

      const result = spawnSync("/bin/bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: { ...process.env, PATH: toolsDirectory },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Node.js is required");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when the domain parser exits with an error", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-domain-policy-"));
    const checker = join(tempRoot, "check-domains.sh");
    const toolsDirectory = join(tempRoot, "failing-node-bin");

    try {
      copyFileSync(resolve(repoRoot, "scripts", "check-domains.sh"), checker);
      copyFileSync(
        resolve(repoRoot, "scripts", "check-domains-parser.mjs"),
        join(tempRoot, "check-domains-parser.mjs")
      );
      mkdirSync(toolsDirectory);
      const nodeShim = join(toolsDirectory, "node");
      writeFileSync(nodeShim, "#!/bin/sh\nexit 2\n");
      chmodSync(nodeShim, 0o755);

      const result = spawnSync("/bin/bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: {
          ...domainCheckerEnvironment,
          PATH: `${toolsDirectory}:${process.env.PATH}`,
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Failed to parse domain usage.");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("explains how to restore the TypeScript parser dependency", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-domain-policy-"));
    const checker = join(tempRoot, "check-domains.sh");
    const emptyModuleRoot = join(tempRoot, "without-node-modules");
    const storageKey = "secpal" + ".asset-load-recovery";

    try {
      copyFileSync(resolve(repoRoot, "scripts", "check-domains.sh"), checker);
      copyFileSync(
        resolve(repoRoot, "scripts", "check-domains-parser.mjs"),
        join(tempRoot, "check-domains-parser.mjs")
      );
      mkdirSync(emptyModuleRoot);
      writeFileSync(join(emptyModuleRoot, "package.json"), "{}\n");
      writeFileSync(
        join(tempRoot, "storage-key.ts"),
        `localStorage.setItem("${storageKey}", "1");\n`
      );

      const result = spawnSync("bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          SECPAL_NODE_MODULES_ROOT: emptyModuleRoot,
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "TypeScript is required to validate domain usage; run npm ci."
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not filter violations by unrelated line content", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-domain-policy-"));
    const checker = join(tempRoot, "check-domains.sh");
    const forbiddenHostnames = [
      "secpal" + ".filename-mask.com",
      "secpal" + ".label-mask.com",
      "secpal" + ".list-mask.com",
    ];

    try {
      copyFileSync(resolve(repoRoot, "scripts", "check-domains.sh"), checker);
      copyFileSync(
        resolve(repoRoot, "scripts", "check-domains-parser.mjs"),
        join(tempRoot, "check-domains-parser.mjs")
      );
      writeFileSync(
        join(tempRoot, "unapproved-host.js"),
        [
          `const first = "https://${forbiddenHostnames[0]}/api"; // check-domains.sh`,
          `const second = "https://${forbiddenHostnames[1]}/api"; // Forbidden:`,
          `const third = "https://${forbiddenHostnames[2]}/api"; // - "${["secpal", "policy-example"].join(".")}"`,
        ].join("\n")
      );

      const result = spawnSync("/bin/bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });

      expect(result.status).toBe(1);
      for (const forbiddenHostname of forbiddenHostnames) {
        expect(result.stdout).toContain(forbiddenHostname);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not depend on platform-specific xargs behavior", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-domain-policy-"));
    const checker = join(tempRoot, "check-domains.sh");
    const toolsDirectory = join(tempRoot, "failing-xargs-bin");

    try {
      copyFileSync(resolve(repoRoot, "scripts", "check-domains.sh"), checker);
      copyFileSync(
        resolve(repoRoot, "scripts", "check-domains-parser.mjs"),
        join(tempRoot, "check-domains-parser.mjs")
      );
      mkdirSync(toolsDirectory);
      const xargsShim = join(toolsDirectory, "xargs");
      writeFileSync(xargsShim, "#!/bin/sh\nexit 2\n");
      chmodSync(xargsShim, 0o755);

      const result = spawnSync("/bin/bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: {
          ...domainCheckerEnvironment,
          PATH: `${toolsDirectory}:${process.env.PATH}`,
        },
      });

      expect(result.status).toBe(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
