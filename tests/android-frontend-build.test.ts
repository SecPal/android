/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Node-executable project helper.
import { verifyAndroidFrontendBuild } from "../scripts/verify-android-frontend-build.mjs";
import { inspectHtmlScripts } from "./html-script-test-helper";

const temporaryRoots: string[] = [];
const repositoryRoot = resolve(import.meta.dirname, "..");
const validAndroidNativeModuleSource = `
function resolveAppSurface(configuredSurface, isProduction) {
  const surface = configuredSurface || "web";
  if (surface === "invalid") {
    throw new Error("Invalid VITE_APP_SURFACE value");
  }
  if (isProduction && surface === "android-mock") {
    throw new Error("is not allowed in production builds. Use a native or web surface.");
  }
  return surface;
}
const isAndroidMockSurface =
  resolveAppSurface("android-native", true) === "android-mock";
`;

function createAsset(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createFrontendFixture({
  csp = "script-src 'self'",
  moduleSource = validAndroidNativeModuleSource,
}: {
  csp?: string;
  moduleSource?: string;
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), "android-frontend-build-"));
  temporaryRoots.push(root);
  createAsset(join(root, "bridge.js"), "// bridge\n");
  createAsset(join(root, "assets/index.js"), moduleSource);
  createAsset(
    join(root, "index.html"),
    `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><script id="secpal-native-auth-bridge-bootstrap" src="/bridge.js"></script ><script type="module" src="/assets/index.js"></script ></head><body></body></html>`
  );
  return join(root, "index.html");
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Android frontend build verification", () => {
  it("accepts strict CSP, external local scripts, and android-native output", () => {
    expect(() =>
      verifyAndroidFrontendBuild(createFrontendFixture())
    ).not.toThrow();
  });

  it("accepts equivalent strict script element and attribute directives", () => {
    expect(() =>
      verifyAndroidFrontendBuild(
        createFrontendFixture({
          csp: "script-src 'self'; script-src-elem 'self'; script-src-attr 'none'",
        })
      )
    ).not.toThrow();
  });

  it("rejects output that does not prove the android-native surface", () => {
    const indexHtmlPath = createFrontendFixture({
      moduleSource: 'resolveAppSurface("web", true);',
    });
    expect(() => verifyAndroidFrontendBuild(indexHtmlPath)).toThrow(
      /does not prove the production android-native frontend surface/iu
    );
  });

  it("rejects an unrelated call that only repeats the surface arguments", () => {
    const indexHtmlPath = createFrontendFixture({
      moduleSource: `
function marker(surface, production) {
  return surface === "android-native" && production;
}
marker("android-native", true);
`,
    });
    expect(() => verifyAndroidFrontendBuild(indexHtmlPath)).toThrow(
      /does not prove the production android-native frontend surface/iu
    );
  });

  it.each([
    ["unsafe inline CSP", "script-src 'self' 'unsafe-inline'"],
    ["unsafe eval CSP", "script-src 'self' 'unsafe-eval'"],
    ["a remote script origin", "script-src 'self' https://scripts.invalid"],
    ["duplicate script directives", "script-src 'self'; script-src https:"],
    [
      "a remote script element override",
      "script-src 'self'; script-src-elem https:",
    ],
    [
      "duplicate script element overrides",
      "script-src 'self'; script-src-elem 'self'; script-src-elem https:",
    ],
    [
      "an inline script attribute override",
      "script-src 'self'; script-src-attr 'unsafe-inline'",
    ],
  ])("rejects %s", (_name, csp) => {
    expect(() =>
      verifyAndroidFrontendBuild(createFrontendFixture({ csp }))
    ).toThrow(/without unsafe script execution/iu);
  });

  it("rejects normalized traversal even when it remains inside the build root", () => {
    const indexHtmlPath = createFrontendFixture();
    writeFileSync(
      indexHtmlPath,
      readFileSync(indexHtmlPath, "utf8").replace(
        'src="/bridge.js"',
        'src="/assets/../bridge.js"'
      )
    );

    expect(() => verifyAndroidFrontendBuild(indexHtmlPath)).toThrow(
      /controlled root-relative packaged script/iu
    );
  });

  it("validates tracked Android HTML without generated checkout artifacts", () => {
    const sourceIndexPath = join(
      repositoryRoot,
      "android/app/src/main/assets/public/index.html"
    );
    const html = readFileSync(sourceIndexPath, "utf8");
    const root = mkdtempSync(join(tmpdir(), "android-packaged-html-"));
    temporaryRoots.push(root);
    createAsset(join(root, "index.html"), html);
    for (const script of inspectHtmlScripts(html)) {
      const source = script.attributes.get("src");
      expect(source).toMatch(/^\//u);
      const content =
        script.attributes.get("id") === "secpal-native-auth-bridge-bootstrap"
          ? readFileSync(
              join(dirname(sourceIndexPath), source!.slice(1)),
              "utf8"
            )
          : script.attributes.get("type") === "module"
            ? validAndroidNativeModuleSource
            : "// representative packaged external script\n";
      createAsset(join(root, source!.slice(1)), content);
    }

    expect(() =>
      verifyAndroidFrontendBuild(join(root, "index.html"))
    ).not.toThrow();
  });
});
