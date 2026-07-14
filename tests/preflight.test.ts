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

  it("recognizes only straight-line top-level storage keys", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-domain-policy-"));
    const parser = resolve(repoRoot, "scripts", "check-domains-parser.mjs");
    const focusedKey = (suffix: string) => "secpal" + `.focused-${suffix}`;
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
        `const suffix = "value";\nconst storageKey = \`${focusedKey("interpolated")}-\${suffix}\`;\nlocalStorage.setItem(storageKey, "1");`,
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
      [
        focusedKey("helper"),
        `const storageKey = "${focusedKey("helper")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();`,
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
      const reports = ({ file, key }: { file: string; key: string }) =>
        outputLines.some(
          (line) => line.startsWith(`${file}:`) && line.includes(key)
        );
      expect(result.status, result.stderr).toBe(0);
      expect(
        files.slice(0, accepted.length).filter(reports),
        result.stdout
      ).toEqual([]);
      expect(
        files.slice(accepted.length).filter((file) => !reports(file)),
        result.stdout
      ).toEqual([]);
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
