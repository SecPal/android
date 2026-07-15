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

type SpawnResult = ReturnType<typeof spawnSync>;

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const domainCheckerEnvironment = {
  ...process.env,
  SECPAL_NODE_MODULES_ROOT: repoRoot,
};

function outputReportsExactValue(
  outputLines: string[],
  file: string,
  value: string
) {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactValue = new RegExp(
    `(?:^|[^A-Za-z0-9.-])${escapedValue}(?:$|[^A-Za-z0-9.-])`
  );
  return outputLines.some(
    (line) => line.startsWith(`${file}:`) && exactValue.test(line)
  );
}

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
      const runDomainFixtures = (fixtures: [string, string][]) => {
        const files = fixtures.map(([fileName, contents]) => {
          const file = join(tempRoot, fileName);
          writeFileSync(file, contents);
          return file;
        });
        const result = spawnSync("bash", [checker], {
          cwd: tempRoot,
          encoding: "utf8",
          env: domainCheckerEnvironment,
        });
        files.forEach((file) => unlinkSync(file));
        return result;
      };
      const runDomainFixture = (fileName: string, contents: string) =>
        runDomainFixtures([[fileName, contents]]);
      const bad = (result: SpawnResult, hostnames: string[]) => {
        expect(result.status).toBe(1);
        for (const hostname of hostnames) {
          expect(result.stdout).toContain(hostname);
        }
      };
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

      const shadowedHtmlStorageHostname = "secpal" + ".invalid-host";
      const shadowedHtmlStorageResult = runDomainFixture(
        "shadowed-storage.html",
        [
          "<script>",
          "const localStorage = fakeStorage;",
          `localStorage.setItem("${shadowedHtmlStorageHostname}", "1");`,
          "</script>",
        ].join("\n")
      );

      bad(shadowedHtmlStorageResult, [shadowedHtmlStorageHostname]);
      const crossScriptStorageHostname = "secpal" + ".cross-script-shadow";
      const dataTypeStorageHostname = "secpal" + ".data-type-shadow";
      const attributeValueStorageHostname =
        "secpal" + ".attribute-value-shadow";
      const encodedTypeStorageHostname = "secpal" + ".encoded-type-shadow";
      const scannerHostnames =
        "quote unicode tab-module abrupt-comment bang-comment equals-name double-escaped bang-escaped empty-type html-href srcdoc svg-cdata html-xlink svg-src srcdoc-encoded svg-entity foreign-html-href svg-comment svg-markup"
          .split(" ")
          .map((suffix) => "secpal" + `.scanner-${suffix}`);
      const htmlScriptBoundariesResult = runDomainFixture(
        "html-script-boundaries.html",
        [
          `<script type="module&Tab;">globalThis.localStorage.setItem("${scannerHostnames[2]}","1")</script>`,
          "<script>const globalThis=null</script>",
          `<p>İ</p><script>const sessionStorage=null;sessionStorage.setItem("${scannerHostnames[1]}","1")</script>`,
          `<script data-note=foo">const window=null;window.localStorage.setItem("${scannerHostnames[0]}","1")</script>`,
          `<!--><script>const localStorage=null;localStorage.setItem("${scannerHostnames[3]}","1")</script><!--x--!><script>const sessionStorage=null;sessionStorage.setItem("${scannerHostnames[4]}","1")</script>`,
          `<div ="><script>const localStorage=null;localStorage.setItem("${scannerHostnames[5]}","1")</script>`,
          `<script><!--\n/*<script>*/\n/*</script>*/\nconst localStorage=null;localStorage.setItem("${scannerHostnames[6]}","1")\n</script>`,
          `<script><!--\n--!>\n/*<script>*/\n/*</script>*/\nconst sessionStorage=null;sessionStorage.setItem("${scannerHostnames[7]}","1")\n</script>`,
          `<script type="&Tab;">const window=null;window.localStorage.setItem("${scannerHostnames[8]}","1")</script>`,
          `<script href="ignored.js">const localStorage=null;localStorage.setItem("${scannerHostnames[9]}","1")</script>`,
          `<iframe srcdoc="<script>const sessionStorage=null;sessionStorage.setItem('${scannerHostnames[10]}','1')</script>"></iframe>`,
          `<svg><script><![CDATA[const globalThis=null;globalThis.localStorage.setItem("${scannerHostnames[11]}","1")]]></script></svg>`,
          `<script xlink:href="ignored.js">const window=null;window.localStorage.setItem("${scannerHostnames[12]}","1")</script>`,
          `<svg><script src="ignored.js">const localStorage=null;localStorage.setItem("${scannerHostnames[13]}","1")</script></svg>`,
          `<iframe srcdoc="&lt;script>const window=null;window.localStorage.setItem(&quot;secpal&#46;scanner-srcdoc-encoded&quot;,&quot;1&quot;)&lt;/script>"></iframe>`,
          `<svg><script>const sessionStorage=null;sessionStorage.setItem(&quot;secpal&#46;scanner-svg-entity&quot;,&quot;1&quot;)</script></svg>`,
          `<svg><foreignObject><script href="ignored.js">const globalThis=null;globalThis.sessionStorage.setItem("${scannerHostnames[16]}","1")</script></foreignObject></svg>`,
          `<svg><script>localStorage.setItem("${storageKey}","1");<!-- ${scannerHostnames[17]} --></script></svg>`,
          `<svg><script><g data-host="${scannerHostnames[18]}"></g></script></svg>`,
          "<script>const localStorage = fakeStorage;</script>",
          "<script>",
          `const key = "${crossScriptStorageHostname}";`,
          'localStorage.setItem(key, "1");',
          "</script>",
          '<script data-type="application/json">',
          "const sessionStorage = fakeStorage;",
          `sessionStorage.setItem("${dataTypeStorageHostname}", "1");`,
          "</script>",
          `<script data-note='type="application/json"'>`,
          "const window = fakeWindow;",
          `window.localStorage.setItem("${attributeValueStorageHostname}", "1");`,
          "</script>",
          '<script type="text&#x2f;javascript">',
          "const globalThis = fakeGlobal;",
          `globalThis.sessionStorage.setItem("${encodedTypeStorageHostname}", "1");`,
          "</script>",
        ].join("\n")
      );

      bad(htmlScriptBoundariesResult, [
        crossScriptStorageHostname,
        dataTypeStorageHostname,
        attributeValueStorageHostname,
        encodedTypeStorageHostname,
        ...scannerHostnames,
      ]);

      const moduleBeforeDeferResult = runDomainFixture(
        "module-before-defer.html",
        `<script type="module">localStorage.setItem("${storageKey}","1")</script><script defer src="later.js"></script><script type="module" src="later.mjs"></script>`
      );
      expect(moduleBeforeDeferResult.status).toBe(0);

      const validModuleModesResult = runDomainFixtures([
        [
          "module-before-nomodule.html",
          `<script type="module">localStorage.setItem("${storageKey}","1")</script><script nomodule src="legacy.js"></script>`,
        ],
        [
          "module-after-inline-nomodule.html",
          `<script nomodule>const localStorage = null;</script><script type="module">localStorage.setItem("${storageKey}","1")</script>`,
        ],
        [
          "standalone-async-module.html",
          `<script type="module" async>localStorage.setItem("${storageKey}","1")</script>`,
        ],
        [
          "nomodule-after-async-module.html",
          `<script type="module" async>Storage.prototype.setItem = replacement;</script><script nomodule>localStorage.setItem("${storageKey}","1")</script>`,
        ],
        [
          "module-grammar.html",
          `<script type="module">localStorage.setItem("${storageKey}","1"); await 0; import.meta; export {};</script>`,
        ],
      ]);
      expect(validModuleModesResult.status, validModuleModesResult.stdout).toBe(
        0
      );

      const prefixHostnames =
        "svg-href svg-xlink mutated-storage-key external-script-key"
          .split(" ")
          .map((suffix) => "secpal" + `.${suffix}`);
      for (const [index, attribute] of ["href", "xlink:href"].entries()) {
        const result = runDomainFixture(
          `svg-${index}.html`,
          `<svg><script ${attribute}="setup.js"></script></svg><script>localStorage.setItem("${prefixHostnames[index]}","1")</script>`
        );
        bad(result, [prefixHostnames[index]]);
      }
      const htmlScriptPrefixHazardsResult = runDomainFixture(
        "html-script-prefix-hazards.html",
        [
          "<script>Storage.prototype.setItem = replacement;</script>",
          `<script>localStorage.setItem("${prefixHostnames[2]}", "1");</script>`,
          '<script src="setup.js"></script>',
          `<script>sessionStorage.setItem("${prefixHostnames[3]}", "1");</script>`,
        ].join("\n")
      );

      bad(htmlScriptPrefixHazardsResult, prefixHostnames.slice(2));

      const laterHelperHostname = "secpal" + ".later-helper";
      const laterHelperResult = runDomainFixture(
        "later-html-helper.html",
        [
          "<script>",
          "setup();",
          `localStorage.setItem("${laterHelperHostname}", "1");`,
          "</script>",
          "<script>function setup() {}</script>",
        ].join("\n")
      );

      bad(laterHelperResult, [laterHelperHostname]);

      const moduleBarrierHostnames = "defer-before blocking-after async-after"
        .split(" ")
        .map((suffix) => "secpal" + `.module-${suffix}`);
      const moduleBarriersResult = runDomainFixtures([
        [
          "defer-before.html",
          `<script defer src="before.js"></script><script type="module">localStorage.setItem("${moduleBarrierHostnames[0]}","1")</script>`,
        ],
        [
          "blocking-after.html",
          `<script type="module">localStorage.setItem("${moduleBarrierHostnames[1]}","1")</script><script src="after.js"></script>`,
        ],
        [
          "async-after.html",
          `<script type="module">localStorage.setItem("${moduleBarrierHostnames[2]}","1")</script><script async src="after.js"></script>`,
        ],
      ]);
      bad(moduleBarriersResult, moduleBarrierHostnames);

      const moduleDependencyHostnames =
        "import-after export-after async-import-after"
          .split(" ")
          .map((suffix) => "secpal" + `.module-${suffix}`);
      const moduleDependenciesResult = runDomainFixtures([
        [
          "module-import-after.html",
          `<script type="module">localStorage.setItem("${moduleDependencyHostnames[0]}","1"); import "./mutate-storage.js";</script>`,
        ],
        [
          "module-export-after.html",
          `<script type="module">sessionStorage.setItem("${moduleDependencyHostnames[1]}","1"); export * from "./mutate-storage.js";</script>`,
        ],
        [
          "async-module-import-after.html",
          `<script type="module" async>localStorage.setItem("${moduleDependencyHostnames[2]}","1"); import "./mutate-storage.js";</script>`,
        ],
      ]);
      bad(moduleDependenciesResult, moduleDependencyHostnames);

      const deferredModuleStorageHostname =
        "secpal" + ".deferred-module-shadow";
      const asyncModuleStorageHostname = "secpal" + ".async-module-order";
      const shadowedAsyncModuleHostname = "secpal" + ".async-module-shadow";
      const shadowedNoModuleHostname = "secpal" + ".nomodule-shadow";
      const deferredModuleStorageResult = runDomainFixture(
        "deferred-module-shadow.html",
        [
          '<script type="module">',
          `localStorage.setItem("${deferredModuleStorageHostname}", "1");`,
          "</script>",
          "<script>const localStorage = null;</script>",
          "<script type=module async>Storage.prototype.setItem=replacement</script>",
          `<script>sessionStorage.setItem("${asyncModuleStorageHostname}","1")</script>`,
          `<script type=module async>const localStorage=null;localStorage.setItem("${shadowedAsyncModuleHostname}","1")</script>`,
          `<script nomodule>const sessionStorage=null;sessionStorage.setItem("${shadowedNoModuleHostname}","1")</script>`,
        ].join("\n")
      );

      bad(deferredModuleStorageResult, [
        deferredModuleStorageHostname,
        asyncModuleStorageHostname,
        shadowedAsyncModuleHostname,
        shadowedNoModuleHostname,
      ]);

      const validHtmlStorageResult = runDomainFixtures([
        [
          "shared-html-storage-key.html",
          [
            `<script>const storageKey = "${storageKey}";</script>`,
            '<script>localStorage.setItem(storageKey, "1");</script>',
          ].join("\n"),
        ],
        [
          "previous-html-helper.html",
          [
            "<script>function setup() {}</script>",
            `<script>setup();localStorage.setItem("${storageKey}", "1");</script>`,
          ].join("\n"),
        ],
        [
          "same-html-helper.html",
          `<script>setup();function setup() {}localStorage.setItem("${storageKey}", "1");</script>`,
        ],
        [
          "html-script-scope-isolation.html",
          [
            `<script>localStorage.setItem("${storageKey}", "1");</script>`,
            "<script>const localStorage = null;</script>",
            '<script type="module">const sessionStorage = null;</script>',
            `<script>sessionStorage.setItem("${storageKey}", "1");</script>`,
          ].join("\n"),
        ],
        [
          "separate-html-shadow.html",
          "<script>const sessionStorage = fakeStorage;</script>\n",
        ],
        [
          "separate-html-storage.html",
          `<script>sessionStorage.setItem("${storageKey}", "1");</script>\n`,
        ],
        [
          "quoted-script-attribute.html",
          `<!-- <script> --><div data-note="<script>"></div><script data-note="1 > 0">localStorage.setItem("${storageKey}", "1");</script><svg><script>sessionStorage.setItem("${storageKey}","1")</script></svg>\n`,
        ],
        [
          "multiple-storage-keys.html",
          ["first-key", "second-key", "third-key"]
            .map(
              (suffix) =>
                `<script>localStorage.setItem("secpal.${suffix}", "1");</script>`
            )
            .join("\n"),
        ],
        [
          "inert-html-storage.html",
          `<template><script>const localStorage=null;localStorage.setItem("${storageKey}","1")</script></template><textarea><script>const sessionStorage=null;sessionStorage.setItem("${storageKey}","1")</script></textarea>`,
        ],
        [
          "decoded-html-storage.html",
          `<iframe srcdoc="&lt;script>localStorage.setItem(&quot;secpal&#46;asset-load-recovery&quot;,&quot;1&quot;)&lt;/script>"></iframe><svg><script>sessionStorage.setItem(&quot;secpal&#46;asset-load-recovery&quot;,&quot;1&quot;);<![CDATA[const key="${storageKey}";localStorage.setItem(key,"1")]]></script></svg>`,
        ],
      ]);

      expect(validHtmlStorageResult.status, validHtmlStorageResult.stdout).toBe(
        0
      );

      const legacyJavascriptStorageResult = runDomainFixture(
        "legacy-javascript-storage.html",
        [
          '<script type="application/x-javascript">',
          "const localStorage = fakeStorage;",
          `localStorage.setItem("${shadowedHtmlStorageHostname}", "1");`,
          "</script>",
        ].join("\n")
      );

      bad(legacyJavascriptStorageResult, [shadowedHtmlStorageHostname]);

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
    // prettier-ignore
    const assetLoadRecoveryStorageKey = "secpal" + ".asset-load-recovery", invalidVariableStorageKey = "secpal" + ".invalid-host.com", rejectedStorageCase = (suffix: string, ...body: string[]) => rejectedCase(suffix, [`const storageKey = "${focusedKey(suffix)}";`, ...body].join("\n")), onceListener = 'window.addEventListener("ready", readLater, { once: true });', rejectedDeferredTryHelperCase = (suffix: string, options: Record<string, string> = {}) => rejectedCase(suffix, `${options.prefix ?? ""}${options.prefix ? "\n" : ""}const storageKey = "${focusedKey(suffix)}";\n${options.declaration ?? "function readLater()"} { ${options.helperPrefix ?? ""}try { ${options.tryBody ?? "localStorage.getItem(storageKey);"} } catch {} }${(options.references ?? onceListener) && `\n${options.references ?? onceListener}`}`);
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
    const passiveHelperPrefix = (storageKey: string, helperCalls: number) =>
      [
        'function persist() { localStorage.setItem("theme", "dark"); }',
        ...Array.from({ length: helperCalls }, () => "persist();"),
        `localStorage.setItem("${storageKey}", "1");`,
      ].join("\n");
    const passiveHelperChainPrefix = (
      storageKey: string,
      helperCalls: number
    ) =>
      [
        'function helper0() { localStorage.setItem("theme", "dark"); }',
        ...Array.from(
          { length: helperCalls - 1 },
          (_, index) => `function helper${index + 1}() { helper${index}(); }`
        ),
        `helper${helperCalls - 1}();`,
        `localStorage.setItem("${storageKey}", "1");`,
      ].join("\n");
    const aggregatePassiveHelperPrefix = (
      storageKey: string,
      callsPerHelper: readonly [number, number]
    ) =>
      [
        'function persistFirst() { localStorage.setItem("theme", "dark"); }',
        'function persistSecond() { localStorage.setItem("locale", "en"); }',
        ...Array.from({ length: callsPerHelper[0] }, () => "persistFirst();"),
        ...Array.from({ length: callsPerHelper[1] }, () => "persistSecond();"),
        `localStorage.setItem("${storageKey}", "1");`,
      ].join("\n");
    const repeatedWrapperCalls = (storageKey: string, wrapperCalls: number) =>
      [
        `const storageKey = "${storageKey}";`,
        'function persist() { localStorage.setItem(storageKey, "1"); }',
        "function wrapper() { persist(); }",
        ...Array.from({ length: wrapperCalls }, () => "wrapper();"),
      ].join("\n");
    const mixedPrefixWrapperCalls = (storageKey: string, prefixCalls: number) =>
      [
        `const storageKey = "${storageKey}";`,
        'function persistTheme() { localStorage.setItem("theme", "dark"); }',
        'function persist() { localStorage.setItem(storageKey, "1"); }',
        "function wrapper() { persist(); }",
        ...Array.from({ length: prefixCalls }, () => "persistTheme();"),
        "wrapper();",
        "wrapper();",
      ].join("\n");
    const passiveWrapperPrefix = (storageKey: string, wrapperCalls: number) =>
      [
        'function persist() { localStorage.setItem("theme", "dark"); }',
        "function wrapper() { persist(); }",
        ...Array.from({ length: wrapperCalls }, () => "wrapper();"),
        `localStorage.setItem("${storageKey}", "1");`,
      ].join("\n");
    const accepted = [
      // prettier-ignore
      [assetLoadRecoveryStorageKey, `(function () { var assetLoadRecoveryStorageKey = "${assetLoadRecoveryStorageKey}"; var appBootstrapReadyEvent = "app-bootstrap-ready"; const themeColorMeta = document.querySelector('meta[name="theme-color"]'); function hasPendingAssetLoadRecovery() { try { return window.sessionStorage.getItem(assetLoadRecoveryStorageKey) === "pending"; } catch { return false; } } const pageStartedWithPendingAssetLoadRecovery = hasPendingAssetLoadRecovery(); function clearAssetLoadRecoveryFlag() { if (!pageStartedWithPendingAssetLoadRecovery) return; try { window.sessionStorage.removeItem(assetLoadRecoveryStorageKey); } catch {} } window.addEventListener(appBootstrapReadyEvent, clearAssetLoadRecoveryFlag, { once: true }); function markPendingAssetLoadRecovery() { try { window.sessionStorage.setItem(assetLoadRecoveryStorageKey, "pending"); return true; } catch { return false; } } function recoverFromStaleHashedAsset() { if (hasPendingAssetLoadRecovery()) return; if (!markPendingAssetLoadRecovery()) return; } window.addEventListener("error", function () { recoverFromStaleHashedAsset(); }, true); if (themeColorMeta) {} })();`, "js"],
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
        focusedKey("type-erased-assertion"),
        `const storageKey = "${focusedKey("type-erased-assertion")}";\ntype StorageRecord = { key: typeof storageKey };\nlocalStorage.setItem(storageKey as StorageRecord["key"], "1");`,
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
        focusedKey("iife-outer-theme-helper"),
        `function persistTheme() { localStorage.setItem("theme", "dark"); }
(() => { persistTheme(); localStorage.setItem("${focusedKey("iife-outer-theme-helper")}", "1"); })();`,
        "ts",
      ],
      [
        focusedKey("iife-outer-approved-domain-helper"),
        `function persistApprovedDomains() { localStorage.setItem("secpal.app", "homepage"); localStorage.setItem("secpal.dev", "development"); }
(() => { persistApprovedDomains(); localStorage.setItem("${focusedKey("iife-outer-approved-domain-helper")}", "1"); })();`,
        "ts",
      ],
      [
        focusedKey("iife-outer-approved-domain-url-helper"),
        `function persistApprovedDomains() { localStorage.setItem("https://secpal.app", "homepage"); localStorage.setItem("apk.secpal.app", "artifact"); localStorage.setItem("https://api.secpal.dev/v1", "api"); localStorage.setItem(".api.secpal.dev", "cookie-domain"); localStorage.setItem("*.staging.secpal.dev", "wildcard"); }
(() => { persistApprovedDomains(); localStorage.setItem("${focusedKey("iife-outer-approved-domain-url-helper")}", "1"); })();`,
        "ts",
      ],
      [
        focusedKey("iife-outer-approved-domain-nested-iife-helper"),
        `function persistApprovedDomains() { (() => { localStorage.setItem("https://secpal.app", "homepage"); })(); }
(() => { persistApprovedDomains(); localStorage.setItem("${focusedKey("iife-outer-approved-domain-nested-iife-helper")}", "1"); })();`,
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
      acceptedCase(
        "helper-through-iife",
        `const storageKey = "${focusedKey("helper-through-iife")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\n(() => { persist(); })();`
      ),
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
        "self-referencing-dormant-function",
        `const storageKey = "${focusedKey("self-referencing-dormant-function")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nfunction unused() { void unused; persist(); }\npersist();`
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
        "trailing-helper-calls",
        `const storageKey = "${focusedKey("trailing-helper-calls")}";\nfunction saveTheme() { localStorage.setItem("theme", "dark"); }\nfunction persist() { localStorage.setItem(storageKey, "1"); ${Array.from({ length: 9 }, () => "saveTheme();").join(" ")} }\npersist();`
      ),
      acceptedCase(
        "multiple-target-helper-limit",
        `const storageKey = "${focusedKey("multiple-target-helper-limit")}";\nfunction saveTheme() { localStorage.setItem("theme", "dark"); }\nfunction persist() { localStorage.setItem(storageKey, "1"); ${Array.from({ length: 7 }, () => "saveTheme();").join(" ")} localStorage.removeItem(storageKey); }\npersist();`
      ),
      acceptedCase(
        "helper-call-limit",
        helperChain(focusedKey("helper-call-limit"), 8)
      ),
      acceptedCase(
        "prefix-helper-call-limit",
        passiveHelperPrefix(focusedKey("prefix-helper-call-limit"), 8)
      ),
      acceptedCase(
        "prefix-helper-chain-limit",
        passiveHelperChainPrefix(focusedKey("prefix-helper-chain-limit"), 8)
      ),
      acceptedCase(
        "aggregate-prefix-helper-limit",
        aggregatePassiveHelperPrefix(
          focusedKey("aggregate-prefix-helper-limit"),
          [4, 4]
        )
      ),
      acceptedCase(
        "iife-prefix-helper-limit",
        `(() => {\n${passiveHelperPrefix(focusedKey("iife-prefix-helper-limit"), 8)}\n})();`
      ),
      acceptedCase(
        "dormant-method-helper-call",
        `class Wrapper { run() { persist(); } }\nconst storageKey = "${focusedKey("dormant-method-helper-call")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();`
      ),
      acceptedCase(
        "dormant-getter-helper-call",
        `class Wrapper { get value() { persist(); return "ready"; } }\nconst storageKey = "${focusedKey("dormant-getter-helper-call")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();`
      ),
      acceptedCase(
        "dormant-constructor-helper-call",
        `class Wrapper { constructor() { persist(); } }\nconst storageKey = "${focusedKey("dormant-constructor-helper-call")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();`
      ),
      acceptedCase(
        "self-referencing-dormant-constructor",
        `class Wrapper { constructor() { void Wrapper; persist(); } }\nconst storageKey = "${focusedKey("self-referencing-dormant-constructor")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();`
      ),
      acceptedCase(
        "self-referencing-dormant-class",
        `class Wrapper { inspect() { return Wrapper; } save() { persist(); } }\nconst storageKey = "${focusedKey("self-referencing-dormant-class")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();`
      ),
      acceptedCase(
        "dormant-instance-field-helper-call",
        `class Wrapper { value = persist(); }\nconst storageKey = "${focusedKey("dormant-instance-field-helper-call")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();`
      ),
      acceptedCase(
        "nested-dormant-computed-field",
        `function unused() { class Wrapper { [persist()] = "ready"; } }\nconst storageKey = "${focusedKey("nested-dormant-computed-field")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();`
      ),
      acceptedCase(
        "direct-before-helper-reference",
        `const storageKey = "${focusedKey("direct-before-helper-reference")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nlocalStorage.setItem(storageKey, "1");\npersist();`
      ),
      acceptedCase(
        "dormant-arrow-helper-call",
        `const storageKey = "${focusedKey("dormant-arrow-helper-call")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();\nconst unused = () => { persist(); };`
      ),
      acceptedCase(
        "self-referencing-dormant-arrow",
        `const storageKey = "${focusedKey("self-referencing-dormant-arrow")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();\nconst unused = () => { void unused; persist(); };`
      ),
      acceptedCase(
        "dormant-expression-helper-call",
        `const storageKey = "${focusedKey("dormant-expression-helper-call")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();\nconst unused = function () { persist(); };`
      ),
      acceptedCase(
        "repeated-wrapper-helper-call",
        repeatedWrapperCalls(focusedKey("repeated-wrapper-helper-call"), 2)
      ),
      acceptedCase(
        "wrapper-helper-call-limit",
        repeatedWrapperCalls(focusedKey("wrapper-helper-call-limit"), 4)
      ),
      acceptedCase(
        "single-wrapper-helper-limit",
        `const storageKey = "${focusedKey("single-wrapper-helper-limit")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nfunction wrapper() { ${Array.from({ length: 7 }, () => "persist();").join(" ")} }\nwrapper();`
      ),
      acceptedCase(
        "repeated-multi-call-wrapper-limit",
        `const storageKey = "${focusedKey("repeated-multi-call-wrapper-limit")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nfunction wrapper() { persist(); persist(); persist(); }\nwrapper();\nwrapper();`
      ),
      acceptedCase(
        "mixed-wrapper-helper-call-limit",
        mixedPrefixWrapperCalls(
          focusedKey("mixed-wrapper-helper-call-limit"),
          4
        )
      ),
      acceptedCase(
        "passive-wrapper-prefix-limit",
        passiveWrapperPrefix(focusedKey("passive-wrapper-prefix-limit"), 4)
      ),
      acceptedCase(
        "multiple-helper-reference-fixpoint",
        `const storageKey = "${focusedKey("multiple-helper-reference-fixpoint")}";\nfunction persistFirst() { localStorage.setItem(storageKey, "1"); }\nfunction persistSecond() { localStorage.setItem(storageKey, "1"); }\nlocalStorage.setItem(storageKey, "1");\npersistSecond();\npersistFirst();`
      ),
      acceptedCase(
        "try-browser-api-suffix",
        `const storageKey = "${focusedKey("try-browser-api-suffix")}";\nfunction readLater() { try { localStorage.getItem(storageKey); } catch {} }\n${onceListener}\nconst element = document.querySelector("meta");\nif (element) { element.setAttribute("content", "ready"); }\nconst mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");\nmediaQuery.addEventListener("change", function () {});\nmediaQuery.addListener(function () {});\n/ready/.test("ready");\nnew URL("https://secpal.app");`
      ),
      acceptedCase(
        "dormant-arrow-before-helper-call",
        `const storageKey = "${focusedKey("dormant-arrow-before-helper-call")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nconst unused = () => { persist(); };\npersist();`
      ),
      acceptedCase(
        "type-only-dormant-arrow",
        `const storageKey = "${focusedKey("type-only-dormant-arrow")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nconst unused = () => { persist(); };\ntype Unused = typeof unused;\npersist();`
      ),
      acceptedCase(
        "dormant-concise-arrow",
        `const storageKey = "${focusedKey("dormant-concise-arrow")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nconst unused = () => persist();\npersist();`
      ),
      acceptedCase(
        "nested-dormant-closure",
        `const storageKey = "${focusedKey("nested-dormant-closure")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nconst unused = () => { const nested = () => persist(); nested(); };\npersist();`
      ),
      acceptedCase(
        "class-used-only-by-dormant-function",
        `function unused() { new Wrapper().run(); }\nclass Wrapper { run() { persist(); } }\nconst storageKey = "${focusedKey("class-used-only-by-dormant-function")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();`
      ),
    ] as const;
    const rejected = [
      rejectedDeferredTryHelperCase("try-declared-registration-suffix", {
        references: `function initialize() { mutate(); }\n${onceListener}\ninitialize();`,
      }),
      rejectedDeferredTryHelperCase("try-nested-registration-suffix", {
        references: `${onceListener}\nif (enabled) { initialize(); }`,
      }),
      rejectedDeferredTryHelperCase("try-constructed-registration-suffix", {
        references: `${onceListener}\nnew Initialize();`,
      }),
      rejectedDeferredTryHelperCase("try-tagged-registration-suffix", {
        references: `${onceListener}\ninitialize\`now\`;`,
      }),
      rejectedDeferredTryHelperCase("try-property-registration-suffix", {
        references: `${onceListener}\nstate.initialize();`,
      }),
      rejectedDeferredTryHelperCase("try-property-callback-guard", {
        prefix: "function initialize() { state.mutate(); return false; }",
        references: `function run() { if (readLater()) {} }\nwindow.addEventListener("ready", function () { if (initialize()) return; run(); }, true);`,
      }),
      rejectedCase(
        "try-aggregate-listener-limit",
        `const storageKey = "${focusedKey("try-aggregate-listener-limit")}";\nfunction readFirst() { try { localStorage.getItem(storageKey); } catch {} }\nfunction readSecond() { try { localStorage.removeItem(storageKey); } catch {} }\n${[...Array.from({ length: 5 }, () => 'window.addEventListener("first", readFirst, { once: true });'), ...Array.from({ length: 5 }, () => 'window.addEventListener("second", readSecond, { once: true });')].join("\n")}`
      ),
      ...[
        "addEventListener",
        "addListener",
        "matchMedia",
        "setAttribute",
        "test",
      ].map((method) =>
        rejectedDeferredTryHelperCase(`try-spoofed-${method}-suffix`, {
          references: `${onceListener}\nstate.${method}();`,
        })
      ),
      rejectedDeferredTryHelperCase("try-spoofed-method-guard", {
        prefix: "function initialize() { state.setAttribute(); return false; }",
        references: `function run() { if (readLater()) {} }\nwindow.addEventListener("ready", function () { if (initialize()) return; run(); }, true);`,
      }),
      ...[
        ["element", "Element", 'state.setAttribute("content", "ready");'],
        [
          "media-event",
          "MediaQueryList",
          'state.addEventListener("change", function () {});',
        ],
        [
          "media-listener",
          "MediaQueryList",
          "state.addListener(function () {});",
        ],
        ["media-match", "Window", 'state.matchMedia("screen");'],
        ["regexp", "RegExp", 'state.test("ready");'],
      ].map(([suffix, type, effect]) =>
        rejectedDeferredTryHelperCase(`try-typed-spoof-${suffix}`, {
          references: `${onceListener}\nconst state = {} as ${type};\n${effect}`,
        })
      ),
      rejectedDeferredTryHelperCase("try-mutated-browser-method", {
        prefix:
          "const mediaQuery = window.matchMedia('screen'); mediaQuery.addListener = replacement;",
        references: `${onceListener}\nmediaQuery.addListener(function () {});`,
      }),
      rejectedDeferredTryHelperCase("try-dynamic-import-suffix", {
        references: `${onceListener}\nimport("./mutate-storage.js");`,
      }),
      rejectedDeferredTryHelperCase("try-global-void-suffix", {
        references: `${onceListener}\nvoid recoveryProbe;`,
      }),
      rejectedDeferredTryHelperCase("try-later-active-listener", {
        references: `${onceListener}\nwindow.addEventListener("error", function () { initialize(); }, { once: true });`,
      }),
      rejectedCase(
        "try-later-named-storage-reset",
        `const storageKey = "${focusedKey("try-later-named-storage-reset")}";\nfunction readLater() { try { localStorage.getItem(storageKey); } catch {} }\nfunction clearLater() { try { localStorage.removeItem(storageKey); } catch {} }\n${onceListener}\nwindow.addEventListener("error", clearLater, { once: true });`
      ),
      rejectedCase(
        "try-later-default-storage-reset",
        `const storageKey = "${focusedKey("try-later-default-storage-reset")}";\nfunction readLater() { try { localStorage.getItem(storageKey); } catch {} }\nfunction clearLater() { try { localStorage.removeItem("theme"); } catch {} }\nfunction initialize(value = clearLater()) {}\n${onceListener}\nwindow.addEventListener("error", function () { initialize(); }, { once: true });`
      ),
      rejectedCase(
        "try-direct-guard-storage-reset",
        `const storageKey = "${focusedKey("try-direct-guard-storage-reset")}";\nfunction hasPending() { try { return localStorage.getItem(storageKey); } catch { return false; } }\nfunction clearPending() { try { localStorage.removeItem(storageKey); } catch {} }\nfunction run() { if (hasPending()) return; clearPending(); }\nwindow.addEventListener("ready", function () { run(); }, true);`
      ),
      rejectedCase(
        "try-unrelated-repeated-listener-guard",
        `function readTheme() { try { return localStorage.getItem("theme"); } catch { return false; } }\nconst storageKey = "${focusedKey("try-unrelated-repeated-listener-guard")}";\nfunction markPending() { try { localStorage.setItem(storageKey, "pending"); return true; } catch { return false; } }\nfunction run() { if (readTheme()) return; if (!markPending()) return; }\nwindow.addEventListener("ready", function () { run(); }, true);`
      ),
      rejectedCase(
        "try-empty-repeated-listener-guard",
        `function shouldSkip() { try { return false; } catch { return false; } }\nconst storageKey = "${focusedKey("try-empty-repeated-listener-guard")}";\nfunction markPending() { try { localStorage.setItem(storageKey, "pending"); return true; } catch { return false; } }\nfunction run() { if (shouldSkip()) return; if (!markPending()) return; }\nwindow.addEventListener("ready", function () { run(); }, true);`
      ),
      rejectedDeferredTryHelperCase("try-assignment-registration-suffix", {
        references: `${onceListener}\nstate.value = replacement;`,
      }),
      rejectedDeferredTryHelperCase("try-update-registration-suffix", {
        references: `${onceListener}\nstate.value++;`,
      }),
      rejectedDeferredTryHelperCase("try-assignment-guard", {
        prefix:
          "function initialize() { state.value = replacement; return false; }",
        references: `function run() { if (readLater()) {} }\nwindow.addEventListener("ready", function () { if (initialize()) return; run(); }, true);`,
      }),
      ...[
        "Object.assign(state, replacement);",
        "Reflect.set(state, 'value', replacement);",
      ].map((effect, index) =>
        rejectedDeferredTryHelperCase(`try-mutating-ambient-suffix-${index}`, {
          references: `${onceListener}\n${effect}`,
        })
      ),
      ...[
        ["default", "value = initialize()", "undefined"],
        ["destructured", "{ value }", "state"],
      ].map(([suffix, parameter, argument]) =>
        rejectedDeferredTryHelperCase(`try-${suffix}-guard-parameter`, {
          prefix: `function validate(${parameter}) { return false; }`,
          references: `function run() { if (readLater()) {} }\nwindow.addEventListener("ready", function () { if (validate(${argument})) return; run(); }, true);`,
        })
      ),
      // prettier-ignore
      ...[...[rejectedStorageCase("deferred-concise-arrow-variable", 'setTimeout(() => localStorage.setItem(storageKey, "1"), 0);'), rejectedStorageCase("try-receiver-method-mutation", 'try { localStorage.setItem = replacement; localStorage.setItem(storageKey, "1"); } catch {}'), rejectedStorageCase("try-deferred-receiver-escape", "function readNow() { try { localStorage.getItem(storageKey); } catch {} }", "function readLater() { try { localStorage.getItem(storageKey); } catch {} }", "readNow();", "const escapedStorage = localStorage;", "setTimeout(readLater, 0);"), rejectedStorageCase("try-deferred-callback", 'try { setTimeout(() => localStorage.setItem(storageKey, "1"), 0); } catch {}'), rejectedCase("try-deferred-function", `let readStorage;\nconst storageKey = "${focusedKey("try-deferred-function")}";\ntry { readStorage = function () { localStorage.getItem(storageKey); }; } catch {}\nreadStorage();`), rejectedStorageCase("short-circuit-variable", 'enabled && localStorage.setItem(storageKey, "1");'), rejectedCase("try-use-before-declaration", `try { localStorage.setItem(storageKey, "1"); } catch {}\nvar storageKey = "${focusedKey("try-use-before-declaration")}";`), rejectedStorageCase("try-helper-call-limit", 'function persist() { try { localStorage.setItem(storageKey, "1"); } catch {} }', Array.from({ length: 9 }, () => "persist();").join("\n")), rejectedCase("try-helper-before-key", `readNow();\nconst storageKey = "${focusedKey("try-helper-before-key")}";\nfunction readNow() { try { localStorage.getItem(storageKey); } catch {} }`), rejectedDeferredTryHelperCase("try-storage-prototype", { prefix: "Storage.prototype.getItem = replacement;" }), rejectedDeferredTryHelperCase("try-dynamic-execution", { prefix: 'Function("localStorage.getItem = replacement")();' })], ...[["pre-key-prefix", onceListener, "initialize();"], ["computed-dynamic-execution", `${onceListener}\nglobalThis["Function"]("localStorage.clear()")();`], ["active-event-name", "window.addEventListener(initialize(), readLater, { once: true });"], ["post-key-prefix", `initialize();\n${onceListener}`], ["post-key-variable-prefix", `const initialized = initialize();\n${onceListener}`], ["local-post-key-variable-prefix", `function initialize() { mutate(); try { localStorage.getItem("theme"); } catch {} }\nconst initialized = initialize();\n${onceListener}`], ["catch-post-key-variable-prefix", `function initialize() { try { localStorage.getItem("theme"); } catch { mutate(); } }\nconst initialized = initialize();\n${onceListener}`], ["exported-wrapper", "export function run() { readLater(); }"], ["loop-guard", "while (enabled) { if (readLater()) {} }"], ["exported-listener-wrapper", `export function setup() { ${onceListener} }`], ["caller-prefix", 'function run() { initialize(); if (readLater()) {} }\nwindow.addEventListener("ready", function () { run(); }, true);'], ["callback-prefix", 'function run() { if (readLater()) {} }\nwindow.addEventListener("ready", function () { initialize(); run(); }, true);'], ["callback-guard-prefix", 'function run() { if (readLater()) {} }\nwindow.addEventListener("ready", function () { if (initialize()) return; run(); }, true);'], ["declared-callback-guard-prefix", 'function initialize() { mutate(); return false; }\nfunction run() { if (readLater()) {} }\nwindow.addEventListener("ready", function () { if (initialize()) return; run(); }, true);'], ["helper-argument-prefix", `function readTheme() { try { localStorage.getItem("theme"); } catch {} }\nconst theme = readTheme(initialize());\n${onceListener}`], ["destructured-helper-prefix", `function readTheme() { try { localStorage.getItem("theme"); } catch {} }\nconst { theme } = readTheme();\n${onceListener}`], ["listener-limit", Array.from({ length: 9 }, () => onceListener).join("\n")], ["repeated-listener", 'window.addEventListener("ready", readLater, true);'], ["registration-suffix", `${onceListener}\ninitialize();`], ["active-prior-listener", `window.addEventListener("ready", () => initialize(), { once: true });\n${onceListener}`], ["finally-prefix-helper", `function readTheme() { try { localStorage.getItem("theme"); } finally { initialize(); } }\nconst theme = readTheme();\n${onceListener}`], ["query-argument-prefix", `const theme = document.querySelector(initialize());\n${onceListener}`], ["callback-default-prefix", 'function run() { if (readLater()) {} }\nwindow.addEventListener("ready", function (event = initialize()) { run(); }, { once: true });']].map(([suffix, references, prefix]) => rejectedDeferredTryHelperCase(`try-${suffix}`, { references, prefix: prefix ?? "" })), rejectedCase("try-return-prefix", `const storageKey = "${focusedKey("try-return-prefix")}";\nfunction readNow() { try { return localStorage.getItem("theme"); localStorage.getItem(storageKey); } catch {} }\nreadNow();`), ...([ ["exported", "export function"], ["async", "async function"], ["generator", "function*"] ] as const).map(([suffix, declaration]) => rejectedDeferredTryHelperCase(`try-${suffix}-helper`, { declaration: `${declaration} readLater()` })), ...[rejectedDeferredTryHelperCase("try-parameterized-helper", { declaration: "function readLater(value)" }), rejectedDeferredTryHelperCase("try-helper-prefix", { helperPrefix: "initialize(); " }), rejectedDeferredTryHelperCase("try-dormant-helper", { references: "" }), rejectedDeferredTryHelperCase("try-reassigned-helper", { references: `readLater = replacement;\n${onceListener}` }), rejectedDeferredTryHelperCase("try-recursive-helper", { tryBody: "localStorage.getItem(storageKey); readLater();" }), rejectedDeferredTryHelperCase("try-timer-helper", { references: "setTimeout(readLater, 0);" }), rejectedDeferredTryHelperCase("try-loop-helper", { references: "while (enabled) { readLater(); }" }), rejectedDeferredTryHelperCase("try-repeated-event-helper", { references: 'window.addEventListener("ready", readLater);' })], [invalidVariableStorageKey, `var storageKey = "${invalidVariableStorageKey}";\ntry { window.sessionStorage.getItem(storageKey); } catch {}`]],
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
      rejectedCase(
        "prefix-helper-call-limit-exceeded",
        passiveHelperPrefix(focusedKey("prefix-helper-call-limit-exceeded"), 9)
      ),
      rejectedCase(
        "prefix-helper-chain-limit-exceeded",
        passiveHelperChainPrefix(
          focusedKey("prefix-helper-chain-limit-exceeded"),
          9
        )
      ),
      rejectedCase(
        "aggregate-prefix-helper-limit-exceeded",
        aggregatePassiveHelperPrefix(
          focusedKey("aggregate-prefix-helper-limit-exceeded"),
          [4, 5]
        )
      ),
      rejectedCase(
        "iife-prefix-helper-limit-exceeded",
        `(() => {\n${passiveHelperPrefix(focusedKey("iife-prefix-helper-limit-exceeded"), 9)}\n})();`
      ),
      rejectedCase(
        "wrapper-helper-call-limit-exceeded",
        repeatedWrapperCalls(
          focusedKey("wrapper-helper-call-limit-exceeded"),
          5
        )
      ),
      [
        focusedKey("single-wrapper-helper-limit-exceeded"),
        `const storageKey = "${focusedKey("single-wrapper-helper-limit-exceeded")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nfunction wrapper() { ${Array.from({ length: 8 }, () => "persist();").join(" ")} }\nwrapper();`,
      ],
      [
        focusedKey("repeated-multi-call-wrapper-limit-exceeded"),
        `const storageKey = "${focusedKey("repeated-multi-call-wrapper-limit-exceeded")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nfunction wrapper() { persist(); persist(); persist(); persist(); }\nwrapper();\nwrapper();`,
      ],
      rejectedCase(
        "mixed-wrapper-helper-call-limit-exceeded",
        mixedPrefixWrapperCalls(
          focusedKey("mixed-wrapper-helper-call-limit-exceeded"),
          5
        )
      ),
      rejectedCase(
        "passive-wrapper-prefix-limit-exceeded",
        passiveWrapperPrefix(
          focusedKey("passive-wrapper-prefix-limit-exceeded"),
          5
        )
      ),
      [
        focusedKey("multiple-target-helper-limit-exceeded"),
        `const storageKey = "${focusedKey("multiple-target-helper-limit-exceeded")}";\nfunction saveTheme() { localStorage.setItem("theme", "dark"); }\nfunction persist() { localStorage.setItem(storageKey, "1"); ${Array.from({ length: 8 }, () => "saveTheme();").join(" ")} localStorage.removeItem(storageKey); }\npersist();`,
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
        focusedKey("live-getter-wrapper"),
        `class Wrapper { get value() { persist(); return "ready"; } }\nconst storageKey = "${focusedKey("live-getter-wrapper")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();\nnew Wrapper().value;`,
      ],
      [
        focusedKey("live-constructor-wrapper"),
        `class Wrapper { constructor() { persist(); } }\nconst storageKey = "${focusedKey("live-constructor-wrapper")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();\nnew Wrapper();`,
      ],
      [
        focusedKey("computed-method-helper-call"),
        `const storageKey = "${focusedKey("computed-method-helper-call")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();\nclass Wrapper { [persist()]() {} }`,
      ],
      [
        focusedKey("computed-name-with-dormant-constructor"),
        `const storageKey = "${focusedKey("computed-name-with-dormant-constructor")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();\nclass Wrapper { [persist()]() {} constructor() { persist(); } }`,
      ],
      [
        focusedKey("computed-field-helper-call"),
        `const storageKey = "${focusedKey("computed-field-helper-call")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();\nclass Wrapper { [persist()] = "ready"; }`,
      ],
      [
        focusedKey("static-field-helper-call"),
        `const storageKey = "${focusedKey("static-field-helper-call")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();\nclass Wrapper { static value = persist(); }`,
      ],
      [
        focusedKey("static-block-helper-call"),
        `const storageKey = "${focusedKey("static-block-helper-call")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();\nclass Wrapper { static { persist(); } }`,
      ],
      [
        focusedKey("exported-method-wrapper"),
        `export class Wrapper { run() { persist(); } }\nconst storageKey = "${focusedKey("exported-method-wrapper")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\npersist();`,
      ],
      [
        focusedKey("live-arrow-wrapper"),
        `const storageKey = "${focusedKey("live-arrow-wrapper")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nconst wrapper = () => { persist(); };\npersist();\nwrapper();`,
      ],
      [
        focusedKey("exported-arrow-wrapper"),
        `const storageKey = "${focusedKey("exported-arrow-wrapper")}";\nfunction persist() { localStorage.setItem(storageKey, "1"); }\nexport const wrapper = () => { persist(); };\npersist();`,
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
        focusedKey("helper-conditional"),
        `const storageKey = "${focusedKey("helper-conditional")}";\nfunction persist() { if (enabled) localStorage.setItem(storageKey, "1"); }\npersist();`,
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
      rejectedCase(
        "iife-outer-helper-storage-hazard",
        `function persistTheme() { localStorage.setItem("${"secpal" + ".unapproved-host.com"}", "dark"); }
(() => { persistTheme(); localStorage.setItem("${focusedKey("iife-outer-helper-storage-hazard")}", "1"); })();`
      ),
      rejectedCase(
        "iife-outer-helper-url-storage-hazard",
        `function persistTheme() { localStorage.setItem("https://${"secpal" + ".unapproved-host.com"}", "dark"); }
(() => { persistTheme(); localStorage.setItem("${focusedKey("iife-outer-helper-url-storage-hazard")}", "1"); })();`
      ),
      rejectedCase(
        "iife-outer-helper-subdomain-storage-hazard",
        `function persistTheme() { localStorage.setItem("prefix.${"secpal" + ".unapproved-host.com"}", "dark"); }
(() => { persistTheme(); localStorage.setItem("${focusedKey("iife-outer-helper-subdomain-storage-hazard")}", "1"); })();`
      ),
      rejectedCase(
        "iife-outer-helper-nested-iife-storage-hazard",
        `function persistTheme() { (() => { localStorage.setItem("${"secpal" + ".unapproved-host.com"}", "dark"); })(); }
(() => { persistTheme(); localStorage.setItem("${focusedKey("iife-outer-helper-nested-iife-storage-hazard")}", "1"); })();`
      ),
      [
        focusedKey("async-suspension"),
        `(async () => { await ready; localStorage.setItem("${focusedKey("async-suspension")}", "1"); })();`,
      ],
      [
        focusedKey("promise-deferred"),
        `Promise.resolve().then(() => { localStorage.setItem("${focusedKey("promise-deferred")}", "1"); });`,
      ],
      [
        focusedKey("microtask-deferred"),
        `queueMicrotask(() => { localStorage.setItem("${focusedKey("microtask-deferred")}", "1"); });`,
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
      [
        focusedKey("global-alias-receiver"),
        `const browser = globalThis;\nconst storageKey = "${focusedKey("global-alias-receiver")}";\nbrowser.localStorage.setItem(storageKey, "1");`,
      ],
      [
        focusedKey("aliased-receiver-mutation"),
        `const browser = window;\nbrowser.localStorage.setItem = replacement;\nconst storageKey = "${focusedKey("aliased-receiver-mutation")}";\nlocalStorage.setItem(storageKey, "1");`,
      ],
      [
        focusedKey("receiver-method-mutation"),
        `localStorage.setItem = replacement;\nconst storageKey = "${focusedKey("receiver-method-mutation")}";\nlocalStorage.setItem(storageKey, "1");`,
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
        outputReportsExactValue(outputLines, file, key);
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

  it("semantically validates browser-storage keys in executable HTML attributes", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-domain-policy-"));
    const parser = resolve(repoRoot, "scripts", "check-domains-parser.mjs");
    const file = join(tempRoot, "storage-attributes.html");
    const hazardFile = join(tempRoot, "storage-attribute-hazards.html");
    const storageKey = (suffix: string) => "secpal" + `.${suffix}`;
    const shadowedEventKey = storageKey("invalid-event-handler");
    const shadowedEscapedKey = storageKey("invalid-escaped-event-handler");
    const shadowedUrlKey = storageKey("invalid-javascript-url");
    const shadowedNormalizedUrlKey = storageKey("invalid-normalized-url");
    const shadowedXlinkUrlKey = storageKey("invalid-xlink-javascript-url");
    const inertSpacedSchemeKey = storageKey("invalid-inert-spaced-scheme");
    const scriptHazardEventKey = storageKey("invalid-script-hazard-event");
    const scriptElementEventKey = storageKey("invalid-script-element-event");
    const validEventKey = storageKey("valid-event-handler");
    const validNamedWhitespaceKey = storageKey("valid-named-whitespace");
    const validSemicolonlessNumericKey = storageKey(
      "valid-semicolonless-numeric"
    );
    const validUrlKey = storageKey("valid-javascript-url");
    const validEscapedUrlKey = storageKey("valid-escaped-javascript-url");
    const validPercentEncodedUrlKey = storageKey("valid-percent-encoded-url");

    try {
      writeFileSync(
        file,
        [
          `<button onclick="const localStorage = fakeStorage; localStorage.setItem(&quot;${shadowedEventKey}&quot;, &quot;1&quot;)">Save</button>`,
          `<button onclick="const localStorage = fakeStorage; localStorage.setItem(&quot;${shadowedEscapedKey.replace(".", "&period;")}&quot;, &quot;1&quot;)">Save</button>`,
          `<a href="javascript:const sessionStorage = fakeStorage; sessionStorage.setItem(&quot;${shadowedUrlKey}&quot;, &quot;1&quot;)">Open</a>`,
          `<a href="java&#x0a;script:const localStorage = fakeStorage; localStorage.setItem('${shadowedNormalizedUrlKey}', '1')">Open</a>`,
          `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:const sessionStorage = fakeStorage; sessionStorage.setItem(&quot;${shadowedXlinkUrlKey}&quot;, &quot;1&quot;)">Open</a></svg>`,
          `<a href="javascript :localStorage.setItem('${inertSpacedSchemeKey}', '1')">Open</a>`,
          `<button onclick="localStorage.setItem(&#x22;${validEventKey}&#x22;, &#x22;1&#x22;)">Save</button>`,
          `<button onclick="&nbsp;localStorage.setItem(&quot;${validNamedWhitespaceKey}&quot;, &quot;1&quot;)">Save</button>`,
          `<button onclick="localStorage.setItem(&#34${validSemicolonlessNumericKey}&#34, &#34;1&#34)">Save</button>`,
          `<a href="javascript:sessionStorage.setItem(&#34;${validUrlKey}&#34;, &#34;1&#34;)">Open</a>`,
          `<a href="java&#x73;cript&colon;localStorage.setItem(&quot;${validEscapedUrlKey}&quot;, &quot;1&quot;)">Open</a>`,
          `<a href="javascript:localStorage.setItem(%22${validPercentEncodedUrlKey}%22,%221%22)">Open</a>`,
        ].join("\n")
      );
      writeFileSync(
        hazardFile,
        [
          `<script>Storage.prototype.setItem = replacement</script><button onclick="localStorage.setItem(&quot;${scriptHazardEventKey}&quot;, &quot;1&quot;)">Save</button>`,
          `<script src="missing.js" onerror="const localStorage = fakeStorage; localStorage.setItem(&quot;${scriptElementEventKey}&quot;, &quot;1&quot;)"></script>`,
        ].join("\n")
      );

      const result = spawnSync(process.execPath, [parser, file, hazardFile], {
        encoding: "utf8",
        env: domainCheckerEnvironment,
      });
      const outputLines = result.stdout.split("\n");

      expect(result.status, result.stderr).toBe(0);
      expect(outputReportsExactValue(outputLines, file, shadowedEventKey)).toBe(
        true
      );
      expect(
        outputReportsExactValue(outputLines, file, shadowedEscapedKey)
      ).toBe(true);
      expect(outputReportsExactValue(outputLines, file, shadowedUrlKey)).toBe(
        true
      );
      expect(
        outputReportsExactValue(outputLines, file, shadowedNormalizedUrlKey)
      ).toBe(true);
      expect(
        outputReportsExactValue(outputLines, file, shadowedXlinkUrlKey)
      ).toBe(true);
      expect(
        outputReportsExactValue(outputLines, file, inertSpacedSchemeKey)
      ).toBe(true);
      expect(
        outputReportsExactValue(outputLines, hazardFile, scriptHazardEventKey)
      ).toBe(true);
      expect(
        outputReportsExactValue(outputLines, hazardFile, scriptElementEventKey)
      ).toBe(true);
      expect(outputReportsExactValue(outputLines, file, validEventKey)).toBe(
        false
      );
      expect(
        outputReportsExactValue(outputLines, file, validNamedWhitespaceKey)
      ).toBe(false);
      expect(
        outputReportsExactValue(outputLines, file, validSemicolonlessNumericKey)
      ).toBe(false);
      expect(outputReportsExactValue(outputLines, file, validUrlKey)).toBe(
        false
      );
      expect(
        outputReportsExactValue(outputLines, file, validEscapedUrlKey)
      ).toBe(false);
      expect(
        outputReportsExactValue(outputLines, file, validPercentEncodedUrlKey)
      ).toBe(false);
      expect(outputLines.some((line) => line.startsWith(`${file}:1:`))).toBe(
        true
      );
      expect(outputLines.some((line) => line.startsWith(`${file}:2:`))).toBe(
        true
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects unsafe storage-key exemption proof contexts", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "secpal-domain-policy-"));
    const parser = resolve(repoRoot, "scripts", "check-domains-parser.mjs");
    const storageKey = (suffix: string) => "secpal" + `.strict-${suffix}`;
    const receiverEscapeCases = (
      ["localStorage", "sessionStorage"] as const
    ).flatMap((storage) =>
      (["getItem", "removeItem", "setItem"] as const).flatMap((method) => {
        const valueArgument = method === "setItem" ? ', "1"' : "";
        return (["method", "receiver"] as const).map((escape) => {
          const key = storageKey(`escaped-${escape}-${storage}-${method}`);
          const escapedValue =
            escape === "method" ? `${storage}.${method}` : storage;
          return {
            key,
            source: `const escaped = ${escapedValue};\nconst key = "${key}";\n${storage}.${method}(key${valueArgument});`,
          };
        });
      })
    );
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
      `const browser = window;\nbrowser.localStorage = replacement;\nconst key = "${storageKey("browser-alias")}";\nlocalStorage.setItem(key, "1");`,
      `Storage.prototype.setItem = replacement;\nconst key = "${storageKey("storage-prototype")}";\nlocalStorage.setItem(key, "1");`,
      `const StorageConstructor = Storage;\nStorageConstructor.prototype.removeItem = replacement;\nconst key = "${storageKey("storage-constructor-alias")}";\nsessionStorage.removeItem(key);`,
      `Function("localStorage.setItem = replacement")();\nconst key = "${storageKey("function-constructor")}";\nlocalStorage.setItem(key, "1");`,
      ...receiverEscapeCases.map(({ source }) => source),
      `function block() { while (enabled) {} }\nblock();\nlocalStorage.setItem("${storageKey("while-block")}", "1");`,
    ] as const;
    const expectedKeys = [
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
      storageKey("browser-alias"),
      storageKey("storage-prototype"),
      storageKey("storage-constructor-alias"),
      storageKey("function-constructor"),
      ...receiverEscapeCases.map(({ key }) => key),
      storageKey("while-block"),
    ];

    try {
      expect(expectedKeys).toHaveLength(cases.length);
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
      const outputLines = result.stdout.split("\n");
      expect(
        expectedKeys.filter(
          (key, index) =>
            !outputReportsExactValue(outputLines, files[index], key)
        ),
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

  it("explains how to restore the domain parser dependencies", () => {
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
        "TypeScript and parse5 are required to validate domain usage; run npm ci."
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
