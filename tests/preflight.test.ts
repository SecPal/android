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

  it("recognizes storage-key declarations only in reachable executable scopes", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-domain-policy-"));
    const checker = join(tempRoot, "check-domains.sh");
    const storageKey = "secpal" + ".asset-load-recovery";
    const invalidHost = "secpal" + ".invalid-host.com";

    const check = (source: string, extension = "ts") => {
      for (const existingExtension of ["cjs", "js", "ts"]) {
        rmSync(join(tempRoot, `storage-key.${existingExtension}`), {
          force: true,
        });
      }
      writeFileSync(join(tempRoot, `storage-key.${extension}`), source);
      return spawnSync("bash", [checker], {
        cwd: tempRoot,
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });
    };
    const expectPass = (source: string) => expect(check(source).status).toBe(0);
    try {
      copyFileSync(resolve(repoRoot, "scripts", "check-domains.sh"), checker);
      copyFileSync(
        resolve(repoRoot, "scripts", "check-domains-parser.mjs"),
        join(tempRoot, "check-domains-parser.mjs")
      );
      expectPass(
        `const storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expectPass(
        `let storageKey: string = "${storageKey}";\nwindow.localStorage.getItem(storageKey);\n`
      );
      expectPass(
        `const storageKey = "${storageKey}" as const;\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expectPass(
        `const storageKey = \`${storageKey}\`;\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expectPass(`localStorage.setItem("${storageKey}" as const, "1");\n`);
      expectPass(`localStorage.setItem(\`${storageKey}\`, "1");\n`);
      expectPass(`localStorage["setItem"]("${storageKey}", "1");\n`);
      expectPass(`window["localStorage"]["getItem"]("${storageKey}");\n`);
      expectPass(`globalThis.sessionStorage["removeItem"]("${storageKey}");\n`);
      expectPass(
        `declare const localStorage: Storage;\nlocalStorage.setItem("${storageKey}", "1");\n`
      );
      expectPass(
        `declare const window: Window;\nwindow.localStorage.getItem("${storageKey}");\n`
      );
      for (const source of [
        `const localStorage = fakeStorage;\nlocalStorage["setItem"]("${storageKey}", "1");\n`,
        `function persist(window) {\n  window["localStorage"]["setItem"]("${storageKey}", "1");\n}\n`,
        `const method = "setItem";\nlocalStorage[method]("${storageKey}", "1");\n`,
      ]) {
        const result = check(source);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain(storageKey);
      }
      for (const argument of [
        "storageKey as string",
        "storageKey!",
        "(storageKey)",
      ]) {
        expectPass(
          `const storageKey = "${storageKey}";\nlocalStorage.setItem(${argument}, "1");\n`
        );
      }
      expectPass(
        `const storageKey = "${storageKey}";\ntype StorageKey = typeof storageKey;\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\ntype StorageMap = { [storageKey]: string };\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expectPass(
        `function persist() { localStorage.setItem(storageKey, "1"); }\nconst storageKey = "${storageKey}";\npersist();\n`
      );
      expectPass(
        `function persist() { localStorage.setItem(storageKey, "1"); }\nconst storageKey = "${storageKey}";\n(persist as () => void)();\n`
      );
      expectPass(
        `function persist() { localStorage.setItem(storageKey, "1"); }\nconst storageKey = "${storageKey}";\ntype Persist = typeof persist;\npersist();\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nconst persist = () => localStorage.setItem(storageKey, "1");\npersist();\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nconst persist = function () { localStorage.setItem(storageKey, "1"); };\npersist();\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nconst helper = { persist() { localStorage.setItem(storageKey, "1"); } };\nhelper.persist();\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nclass Helper { static persist() { localStorage.setItem(storageKey, "1"); } }\nHelper.persist();\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nclass Helper { persist() { localStorage.setItem(storageKey, "1"); } }\nnew Helper().persist();\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nclass Helper { persist() { localStorage.setItem(storageKey, "1"); } }\nconst helper = new Helper();\nhelper.persist();\n`
      );
      expectPass("localStorage.getItem();\nsessionStorage.removeItem();\n");
      expectPass(
        `const storageKey = "${storageKey}";\nasync function persist() { localStorage.setItem(storageKey, "1"); await pending; }\npersist();\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nasync function persist() { if (false) await pending; localStorage.setItem(storageKey, "1"); }\npersist();\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\nlocalStorage.setItem = replacement;\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nif (false) localStorage.setItem = replacement;\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expectPass(
        `localStorage.setItem = replacement;\nconst storageKey = "${storageKey}";\nsessionStorage.setItem(storageKey, "1");\n`
      );
      expectPass(
        `function mutateStorage() { localStorage.setItem = replacement; }\nconst storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expectPass(
        `function mutateStorage() { localStorage.setItem = replacement; }\nconst storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\nmutateStorage();\n`
      );
      expectPass(
        `function mutateStorage() { localStorage.setItem = replacement; }\nconst storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\nregister(mutateStorage);\n`
      );
      expectPass(
        `function mutateStorage() { localStorage.setItem = replacement; }\nif (false) register(mutateStorage);\nconst storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expectPass(
        `if (false) (() => { localStorage.setItem = replacement; })();\nconst storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expectPass(
        `const constructor = { assign() {} };\nconstructor.assign();\nconst storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expectPass(
        `async function value() { throw new Error(); }\nconst storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, value());\n`
      );
      expectPass(
        `let callable: Function;\nconst storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\nconsumeType(callable);\n`
      );
      expectPass(
        `function* value() { throw new Error(); }\nconst storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, value());\n`
      );
      expectPass(
        `function persist() { localStorage.setItem(storageKey, "1"); }\nfunction save() { persist(); }\nconst storageKey = "${storageKey}";\nsave();\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\npersist();\nfunction persist() { localStorage.setItem(storageKey, "1"); }\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nclass Storage { static value = localStorage.setItem(storageKey, "1"); }\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nclass Storage { static { localStorage.setItem(storageKey, "1"); } }\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nclass Storage { [localStorage.setItem(storageKey, "1")] = true; }\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nclass Storage { [localStorage.setItem(storageKey, "1")]() {} }\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nconst storage = { [localStorage.setItem(storageKey, "1")]() {} };\nconsume(storage);\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nif (localStorage.getItem(storageKey)) consume();\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\ndo { localStorage.setItem(storageKey, "1"); } while (false);\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nlocalStorage.getItem(storageKey) && consume();\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nswitch (0) { default: localStorage.setItem(storageKey, "1"); }\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nswitch (0) { default: break; }\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nswitch (0) { case 1: throw new Error(); }\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expectPass(
        `switch (0) { default: localStorage.setItem("${storageKey}", "1"); }\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\n(() => localStorage.setItem(storageKey, "1"))();\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\n(function () { localStorage.setItem(storageKey, "1"); })();\n`
      );
      expectPass(`(() => localStorage.setItem("${storageKey}", "1"))();\n`);
      expectPass(
        `function persist() { (() => localStorage.setItem(storageKey, "1"))(); }\nconst storageKey = "${storageKey}";\npersist();\n`
      );
      expectPass(
        `(() => { const storageKey = "${storageKey}"; localStorage.setItem(storageKey, "1"); })();\n`
      );
      expectPass(
        `persist();\nfunction persist() { const storageKey = "${storageKey}"; localStorage.setItem(storageKey, "1"); }\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\ntry { throw new Error(); } catch {}\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\ntry { throw new Error(); return; } catch {}\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nclass Storage { static { try { throw new Error(); } catch {} } static { localStorage.setItem(storageKey, "1"); } }\n`
      );
      expectPass(
        `const storageKey = "${storageKey}";\nconst value = \`${"${"}\`${"${"}localStorage.getItem(storageKey)${"}"}\`${"}"}\`;\n`
      );

      const continuedInitializer = check(
        `const storageKey = "${storageKey}" + ".com";\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expect(continuedInitializer.status).toBe(1);
      expect(continuedInitializer.stdout).toContain(storageKey);

      const dualUse = check(
        `const storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\nfetch(storageKey);\n`
      );
      expect(dualUse.status).toBe(1);
      expect(dualUse.stdout).toContain(storageKey);

      const unusedArrowHelper = check(
        `const storageKey = "${storageKey}";\nconst persist = () => localStorage.setItem(storageKey, "1");\n`
      );
      expect(unusedArrowHelper.status).toBe(1);
      expect(unusedArrowHelper.stdout).toContain(storageKey);

      const unusedFunctionExpressionHelper = check(
        `const storageKey = "${storageKey}";\nconst persist = function () { localStorage.setItem(storageKey, "1"); };\n`
      );
      expect(unusedFunctionExpressionHelper.status).toBe(1);
      expect(unusedFunctionExpressionHelper.stdout).toContain(storageKey);

      const divisionDualUse = check(
        `const storageKey = "${storageKey}";\nconst ratio = numerator / storageKey / denominator;\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expect(divisionDualUse.status).toBe(1);
      expect(divisionDualUse.stdout).toContain(storageKey);

      const regexLiteral = check(
        `if (enabled) /localStorage.setItem("${storageKey}")/.test(value);\n`
      );
      expect(regexLiteral.status).toBe(1);
      expect(regexLiteral.stdout).toContain(storageKey);

      const templateDualUse = check(
        [
          `const storageKey = "${storageKey}";`,
          'const text = `${"}" + storageKey}`;',
          'localStorage.setItem(storageKey, "1");',
        ].join("\n")
      );
      expect(templateDualUse.status).toBe(1);
      expect(templateDualUse.stdout).toContain(storageKey);

      const extendsDualUse = check(
        `const storageKey = "${storageKey}";\nclass StorageKey extends storageKey {}\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expect(extendsDualUse.status).toBe(1);
      expect(extendsDualUse.stdout).toContain(storageKey);

      expectPass(
        `const storageKey = "${storageKey}";\nclass StorageKey implements storageKey {}\nlocalStorage.setItem(storageKey, "1");\n`
      );

      expect(
        check(
          'const value = `${(() => { const braces = "}}"; return localStorage.getItem("' +
            storageKey +
            '"); })()}`;\n'
        ).status
      ).toBe(0);

      const hoistedVarDualUse = check(
        `function sendKey() { fetch(storageKey); }\nvar storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\nsendKey();\n`
      );
      expect(hoistedVarDualUse.status).toBe(1);
      expect(hoistedVarDualUse.stdout).toContain(storageKey);

      const varUseBeforeInitialization = check(
        `localStorage.setItem(storageKey, "1");\nvar storageKey = "${storageKey}";\n`
      );
      expect(varUseBeforeInitialization.status).toBe(1);
      expect(varUseBeforeInitialization.stdout).toContain(storageKey);

      const exportedStorageKey = check(
        `export const storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expect(exportedStorageKey.status).toBe(1);
      expect(exportedStorageKey.stdout).toContain(storageKey);

      const reexportedStorageKey = check(
        `const storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\nexport { storageKey };\n`
      );
      expect(reexportedStorageKey.status).toBe(1);
      expect(reexportedStorageKey.stdout).toContain(storageKey);

      const defaultExportedStorageKey = check(
        `const storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\nexport default storageKey;\n`
      );
      expect(defaultExportedStorageKey.status).toBe(1);
      expect(defaultExportedStorageKey.stdout).toContain(storageKey);

      const conditionallyInitializedVar = check(
        `if (enabled) {\n  var storageKey = "${storageKey}";\n}\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expect(conditionallyInitializedVar.status).toBe(1);
      expect(conditionallyInitializedVar.stdout).toContain(storageKey);

      expect(
        check(
          `const storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\nconst metadata = { storageKey: "unrelated" };\nconst value = object.storageKey;\n`
        ).status
      ).toBe(0);

      const unreachableUse = check(
        `{\n  const storageKey = "${storageKey}";\n}\nlocalStorage.setItem(storageKey, "1");\n`
      );
      expect(unreachableUse.status).toBe(1);
      expect(unreachableUse.stdout).toContain(storageKey);

      const useBeforeDeclaration = check(
        `localStorage.setItem(storageKey, "1");\nconst storageKey = "${storageKey}";\n`
      );
      expect(useBeforeDeclaration.status).toBe(1);
      expect(useBeforeDeclaration.stdout).toContain(storageKey);

      for (const [source, extension] of [
        [
          `const storageKey = "${storageKey}";\npersist();\nconst persist = () => localStorage.setItem(storageKey, "1");\n`,
          "cjs",
        ],
        [
          `with ({ localStorage: fakeStorage }) { localStorage.setItem("${storageKey}", "1"); }\n`,
          "cjs",
        ],
        [
          `const storageKey = "${storageKey}";\nclass Storage { value = localStorage.setItem(storageKey, "1"); }\n`,
          "js",
        ],
        [
          `eval("var localStorage = fakeStorage;");\nlocalStorage.setItem("${storageKey}", "1");\n`,
          "cjs",
        ],
        [
          `const storageKey = "${storageKey}";\nclass Outer { value = class { static value = localStorage.setItem(storageKey, "1"); }; }\n`,
          "js",
        ],
        [
          `if (false) { function persist() { localStorage.setItem(storageKey, "1"); } }\nconst storageKey = "${storageKey}";\npersist();\n`,
          "cjs",
        ],
      ] as const) {
        const result = check(source, extension);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain(storageKey);
      }

      for (const source of [
        `function persist() { localStorage.setItem(storageKey, "1"); }\npersist();\nconst storageKey = "${storageKey}";\n`,
        `persist();\nconst storageKey = "${storageKey}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\n`,
        `before();\nvar storageKey = "${storageKey}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nfunction before() { persist(); }\n`,
        `function* persist() { localStorage.setItem(storageKey, "1"); }\nconst storageKey = "${storageKey}";\npersist();\n`,
        `const storageKey = "${storageKey}";\nif (false) localStorage.setItem(storageKey, "1");\n`,
        `function persist() { if (false) localStorage.setItem(storageKey, "1"); }\nconst storageKey = "${storageKey}";\npersist();\n`,
        `function persist() { localStorage.setItem(storageKey, "1"); }\nconst storageKey = "${storageKey}";\nfalse && persist();\n`,
        `function persist() { localStorage.setItem(storageKey, "1"); }\nconst storageKey = "${storageKey}";\nwith ({ persist: fakePersist }) { persist(); }\n`,
        `function persist(value = localStorage.setItem(storageKey, "1")) {}\nconst storageKey = "${storageKey}";\npersist("provided");\n`,
        `const storageKey = "${storageKey}";\nconst { value = localStorage.setItem(storageKey, "1") } = { value: true };\n`,
        `const storageKey = "${storageKey}";\nwhile (false) { localStorage.setItem(storageKey, "1"); }\n`,
        `const storageKey = "${storageKey}";\nswitch (0) { case 1: localStorage.setItem(storageKey, "1"); }\n`,
        `const storageKey = "${storageKey}";\ntry { throw new Error(); } catch { localStorage.setItem(storageKey, "1"); }\n`,
        `if (false) localStorage.setItem("${storageKey}", "1");\n`,
        `function persist() { localStorage.setItem("${storageKey}", "1"); }\n`,
        `const storageKey = "${storageKey}";\nthrow new Error();\nlocalStorage.setItem(storageKey, "1");\n`,
        `throw new Error();\nlocalStorage.setItem("${storageKey}", "1");\n`,
        `function persist() { return; localStorage.setItem(storageKey, "1"); }\nconst storageKey = "${storageKey}";\npersist();\n`,
        `function outer() { persist(); const storageKey = "${storageKey}"; function persist() { localStorage.setItem(storageKey, "1"); } }\nouter();\n`,
        `function persist() { try { return; } catch {} localStorage.setItem(storageKey, "1"); }\nconst storageKey = "${storageKey}";\npersist();\n`,
        `{ throw new Error(); unreachable(); }\nlocalStorage.setItem("${storageKey}", "1");\n`,
        `const storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey);\n`,
        `localStorage.setItem("${storageKey}");\n`,
        `try { throw new Error(); var storageKey = "${storageKey}"; } catch {}\nlocalStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\ntry { throw new Error(); var persist = () => localStorage.setItem(storageKey, "1"); } catch {}\npersist();\n`,
        `try { throw new Error(); var persist = () => localStorage.setItem("${storageKey}", "1"); } catch {}\npersist();\n`,
        `const storageKey = "${storageKey}";\nclass Storage { static { throw new Error(); } static { localStorage.setItem(storageKey, "1"); } }\n`,
        `class Storage { static { throw new Error(); } static { localStorage.setItem("${storageKey}", "1"); } }\n`,
        `const storageKey = "${storageKey}";\nswitch (0) { default: throw new Error(); }\nlocalStorage.setItem(storageKey, "1");\n`,
        `switch (0) { default: throw new Error(); }\nlocalStorage.setItem("${storageKey}", "1");\n`,
        `const storageKey = "${storageKey}";\ndo { throw new Error(); } while (false);\nlocalStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\nwhile (true) { throw new Error(); }\nlocalStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\nfor (;;) { throw new Error(); }\nlocalStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\nconst helper = { persist() { localStorage.setItem(storageKey, "1"); } };\n`,
        `const storageKey = "${storageKey}";\nconst helper = { persist() { localStorage.setItem(storageKey, "1"); } };\nhelper.persist = replacement;\nhelper.persist();\n`,
        `const storageKey = "${storageKey}";\nconst helper = { persist() { localStorage.setItem(storageKey, "1"); } };\nObject.defineProperty(helper, "persist", { value: replacement });\nhelper.persist();\n`,
        `const storageKey = "${storageKey}";\nconst helper = { persist() { localStorage.setItem(storageKey, "1"); } };\nlet other: typeof helper;\nother.persist();\n`,
        `const storageKey = "${storageKey}";\nclass Helper { static persist() { localStorage.setItem(storageKey, "1"); } }\nlet Other: typeof Helper;\nOther.persist();\n`,
        `const storageKey = "${storageKey}";\nclass Helper { persist() { localStorage.setItem(storageKey, "1"); } }\nlet other: Helper;\nother.persist();\n`,
        `const storageKey = "${storageKey}";\nclass Helper { constructor() { return { persist() {} }; } persist() { localStorage.setItem(storageKey, "1"); } }\nnew Helper().persist();\n`,
        `const storageKey = "${storageKey}";\nconst Helper = class { constructor() { return { persist() {} }; } persist() { localStorage.setItem(storageKey, "1"); } };\nnew Helper().persist();\n`,
        `const storageKey = "${storageKey}";\nclass Base { constructor() { return { persist() {} }; } }\nclass Helper extends Base { persist() { localStorage.setItem(storageKey, "1"); } }\nnew Helper().persist();\n`,
        `const storageKey = "${storageKey}";\nclass Helper { constructor() { Object.defineProperty(this, "persist", { value() {} }); } persist() { localStorage.setItem(storageKey, "1"); } }\nnew Helper().persist();\n`,
        `const storageKey = "${storageKey}";\nclass Helper { ["persist"] = () => {}; persist() { localStorage.setItem(storageKey, "1"); } }\nnew Helper().persist();\n`,
        `const storageKey = "${storageKey}";\nlocalStorage.setItem = replacement;\nlocalStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\nwindow.localStorage.setItem = replacement;\nwindow.localStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\nStorage.prototype.setItem = replacement;\nlocalStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\nObject.defineProperty(window, "localStorage", { value: replacement });\nwindow.localStorage.setItem(storageKey, "1");\n`,
        `function mutateStorage() { sessionStorage.setItem = replacement; }\nconst storageKey = "${storageKey}";\nmutateStorage();\nsessionStorage.setItem(storageKey, "1");\n`,
        `function mutateStorage() { localStorage.setItem = replacement; }\nconst storageKey = "${storageKey}";\nregister(mutateStorage);\nlocalStorage.setItem(storageKey, "1");\n`,
        `let enabled = false;\nenabled &&= localStorage.setItem("${storageKey}", "1");\n`,
        `maybe?.(localStorage.setItem("${storageKey}", "1"));\n`,
        `const storageKey = "${storageKey}";\nasync function persist() { await new Promise(() => {}); localStorage.setItem(storageKey, "1"); }\npersist();\n`,
        `async function persist() { await new Promise(() => {}); localStorage.setItem("${storageKey}", "1"); }\npersist();\n`,
        `const storageKey = "${storageKey}";\nawait pending;\nlocalStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\nconst method = "setItem";\nlocalStorage[method] = replacement;\nlocalStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\nfunction persist() { localStorage.setItem = replacement; localStorage.setItem(storageKey, "1"); }\npersist();\n`,
        `const storageKey = "${storageKey}";\nObject.defineProperty(localStorage, "setItem", { value: replacement });\nlocalStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\nObject["defineProperty"](localStorage, "setItem", { value: replacement });\nlocalStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\nglobalThis.Object.defineProperty(localStorage, "setItem", { value: replacement });\nlocalStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\nReflect.set(sessionStorage, "setItem", replacement);\nsessionStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\nwindow.Reflect.set(sessionStorage, "setItem", replacement);\nsessionStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\n(0, eval)("localStorage.setItem = replacement");\nlocalStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\nglobalThis.eval("localStorage.setItem = replacement");\nlocalStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\nFunction("localStorage.setItem = replacement")();\nlocalStorage.setItem(storageKey, "1");\n`,
        `const storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, (() => { throw new Error(); })());\n`,
        `localStorage.setItem("${storageKey}", (() => { throw new Error(); })());\n`,
        `function fail() { throw new Error(); }\nconst storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, fail());\n`,
        `const storageKey = "${storageKey}";\nasync function persist() { for await (const value of pending) consume(value); localStorage.setItem(storageKey, "1"); }\npersist();\n`,
        `const storageKey = "${storageKey}";\nasync function persist() { localStorage.setItem(storageKey, await pending); }\npersist();\n`,
      ]) {
        const result = check(source);
        expect(result.status, source).toBe(1);
        expect(result.stdout).toContain(storageKey);
      }

      const shadowedIdentifier = check(
        `const storageKey = "${storageKey}";\n{\n  const storageKey = "${invalidHost}";\n  localStorage.setItem(storageKey, "1");\n}\n`
      );
      expect(shadowedIdentifier.status).toBe(1);
      expect(shadowedIdentifier.stdout).toContain(invalidHost);

      const shadowedStorageKey = check(
        `const storageKey = "${storageKey}";\n{\n  const storageKey = "${storageKey}";\n  localStorage.setItem(storageKey, "1");\n}\n`
      );
      expect(shadowedStorageKey.status).toBe(1);
      expect(shadowedStorageKey.stdout).toContain(storageKey);

      for (const source of [
        `// const storageKey = "${storageKey}";\nlocalStorage.setItem(storageKey, "1");\n`,
        `/* const storageKey = "${storageKey}"; */\nlocalStorage.setItem(storageKey, "1");\n`,
        `// localStorage.setItem("${storageKey}", "1");\n`,
        `const storageKey = /${invalidHost}/;\nlocalStorage.setItem(storageKey, "1");\n`,
        `const storageKey = \`${"secpal" + ".asset-load-"}${"${suffix}"}\`;\nlocalStorage.setItem(storageKey, "1");\n`,
      ]) {
        expect(check(source).status).toBe(1);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 180_000);

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
