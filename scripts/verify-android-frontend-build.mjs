#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND LicenseRef-SecPal-Attribution

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parse } from "parse5";
import ts from "typescript";
import { isDirectNodeExecution } from "./inject-native-auth-bridge.mjs";

const bridgeScriptId = "secpal-native-auth-bridge-bootstrap";
const controlledScriptSourcePattern =
  /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/u;

function getAttribute(node, name) {
  return node.attrs?.find((attribute) => attribute.name === name)?.value;
}

function getCspDirectives(csp, directiveName) {
  return csp
    .split(";")
    .map((directive) => directive.trim().split(/\s+/u))
    .filter(
      ([name]) =>
        name.length > 0 && name.toLowerCase() === directiveName.toLowerCase()
    );
}

function isExactCspDirective(directives, expectedSources) {
  return (
    directives.length === 1 &&
    directives[0].length === expectedSources.length + 1 &&
    expectedSources.every(
      (expectedSource, index) => directives[0][index + 1] === expectedSource
    )
  );
}

function isStaticallyTrue(node) {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (ts.isParenthesizedExpression(node)) {
    return isStaticallyTrue(node.expression);
  }
  return (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isNumericLiteral(node.operand) &&
    node.operand.text === "0"
  );
}

const appSurfaceValues = new Set([
  "web",
  "android-mock",
  "android-native",
  "ios-mock",
  "ios-native",
]);

function isKnownSurfaceResolver(declaration, sourceFile) {
  if (declaration.parameters.length < 2) return false;
  const source = declaration.getText(sourceFile);
  return (
    source.includes("Invalid VITE_APP_SURFACE value") &&
    source.includes(
      "is not allowed in production builds. Use a native or web surface."
    )
  );
}

function isTopLevelSurfaceFlagInitializer(callExpression, sourceFile) {
  const comparison = callExpression.parent;
  if (
    !ts.isBinaryExpression(comparison) ||
    comparison.left !== callExpression ||
    comparison.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
    !ts.isStringLiteralLike(comparison.right) ||
    !appSurfaceValues.has(comparison.right.text)
  ) {
    return false;
  }
  const declaration = comparison.parent;
  return (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer === comparison &&
    ts.isVariableDeclarationList(declaration.parent) &&
    ts.isVariableStatement(declaration.parent.parent) &&
    declaration.parent.parent.parent === sourceFile
  );
}

function assertAndroidNativeModule(moduleSource, sourceLabel) {
  const sourceFile = ts.createSourceFile(
    sourceLabel,
    moduleSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const functionDeclarations = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functionDeclarations.set(statement.name.text, statement);
    }
  }
  let hasAndroidNativeSurfaceSelection = false;
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.arguments.length >= 2 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === "android-native" &&
      isStaticallyTrue(node.arguments[1]) &&
      isTopLevelSurfaceFlagInitializer(node, sourceFile)
    ) {
      const resolver = functionDeclarations.get(node.expression.text);
      if (resolver && isKnownSurfaceResolver(resolver, sourceFile)) {
        hasAndroidNativeSurfaceSelection = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (
    sourceFile.parseDiagnostics.length > 0 ||
    !hasAndroidNativeSurfaceSelection
  ) {
    throw new Error(
      `${sourceLabel} does not prove the production android-native frontend surface.`
    );
  }
}

function resolvePackagedScript(assetRoot, sourcePath, sourceLabel) {
  const sourceSegments = sourcePath.slice(1).split("/");
  if (
    !controlledScriptSourcePattern.test(sourcePath) ||
    sourceSegments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      `${sourceLabel} must reference a controlled root-relative packaged script.`
    );
  }
  const scriptPath = join(assetRoot, ...sourcePath.slice(1).split("/"));
  if (!lstatSync(scriptPath).isFile()) {
    throw new Error(`${sourceLabel} referenced script is not a regular file.`);
  }
  const realAssetRoot = realpathSync(assetRoot);
  const realScriptPath = realpathSync(scriptPath);
  const relativeScriptPath = relative(realAssetRoot, realScriptPath);
  if (
    !relativeScriptPath ||
    relativeScriptPath === ".." ||
    relativeScriptPath.startsWith(`..${sep}`)
  ) {
    throw new Error(`${sourceLabel} referenced script escapes the build root.`);
  }
  return realScriptPath;
}

export function verifyAndroidFrontendBuild(indexHtmlPath) {
  const resolvedIndexHtmlPath = resolve(indexHtmlPath);
  const assetRoot = dirname(resolvedIndexHtmlPath);
  const html = readFileSync(resolvedIndexHtmlPath, "utf8");
  const pending = [parse(html, { sourceCodeLocationInfo: true })];
  const scripts = [];
  const cspPolicies = [];

  while (pending.length > 0) {
    const node = pending.pop();
    if (
      node.tagName === "meta" &&
      getAttribute(node, "http-equiv")?.toLowerCase() ===
        "content-security-policy"
    ) {
      cspPolicies.push(getAttribute(node, "content") ?? "");
    }
    if (node.tagName === "script") scripts.push(node);
    pending.push(...(node.childNodes ?? []));
  }

  if (cspPolicies.length !== 1) {
    throw new Error(
      `${resolvedIndexHtmlPath} must contain exactly one Content Security Policy.`
    );
  }
  const csp = cspPolicies[0];
  const scriptSourceDirectives = getCspDirectives(csp, "script-src");
  const scriptElementDirectives = getCspDirectives(csp, "script-src-elem");
  const scriptAttributeDirectives = getCspDirectives(csp, "script-src-attr");
  if (
    !isExactCspDirective(scriptSourceDirectives, ["'self'"]) ||
    (scriptElementDirectives.length > 0 &&
      !isExactCspDirective(scriptElementDirectives, ["'self'"])) ||
    (scriptAttributeDirectives.length > 0 &&
      !isExactCspDirective(scriptAttributeDirectives, ["'none'"])) ||
    /(?:'unsafe-inline'|'unsafe-eval')/iu.test(csp)
  ) {
    throw new Error(
      `${resolvedIndexHtmlPath} must retain script-src 'self' without unsafe script execution.`
    );
  }

  const orderedScripts = scripts.reverse();
  const bridgeScripts = orderedScripts.filter(
    (script) => getAttribute(script, "id") === bridgeScriptId
  );
  if (bridgeScripts.length !== 1) {
    throw new Error(
      `${resolvedIndexHtmlPath} must contain exactly one native auth bridge script.`
    );
  }

  let moduleEntryPath;
  for (const script of orderedScripts) {
    const location = script.sourceCodeLocation;
    if (!location?.startTag || !location.endTag) {
      throw new Error(
        `${resolvedIndexHtmlPath} contains an unterminated script.`
      );
    }
    if (
      html.slice(location.startTag.endOffset, location.endTag.startOffset) !==
      ""
    ) {
      throw new Error(
        `${resolvedIndexHtmlPath} executable scripts must not contain inline content.`
      );
    }
    const sourcePath = getAttribute(script, "src");
    if (!sourcePath) {
      throw new Error(
        `${resolvedIndexHtmlPath} executable scripts must define src.`
      );
    }
    const scriptPath = resolvePackagedScript(
      assetRoot,
      sourcePath,
      resolvedIndexHtmlPath
    );
    if (getAttribute(script, "type")?.toLowerCase() === "module") {
      if (moduleEntryPath) {
        throw new Error(
          `${resolvedIndexHtmlPath} must contain exactly one module entry.`
        );
      }
      moduleEntryPath = scriptPath;
    }
  }

  const bridgeIndex = orderedScripts.indexOf(bridgeScripts[0]);
  const moduleIndex = orderedScripts.findIndex(
    (script) => getAttribute(script, "type")?.toLowerCase() === "module"
  );
  if (!moduleEntryPath || bridgeIndex < 0 || bridgeIndex >= moduleIndex) {
    throw new Error(
      `${resolvedIndexHtmlPath} native auth bridge must precede the module entry.`
    );
  }
  assertAndroidNativeModule(
    readFileSync(moduleEntryPath, "utf8"),
    moduleEntryPath
  );
}

if (isDirectNodeExecution(import.meta.url)) {
  try {
    const indexHtmlPath = process.argv[2];
    if (!indexHtmlPath) {
      throw new Error(
        "Usage: node scripts/verify-android-frontend-build.mjs <dist-index-html>"
      );
    }
    verifyAndroidFrontendBuild(indexHtmlPath);
    console.log("ANDROID_FRONTEND_BUILD_OK");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
