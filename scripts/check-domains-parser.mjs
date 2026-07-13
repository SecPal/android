#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = resolve(fileURLToPath(import.meta.url));
const scriptDirectory = dirname(scriptPath);
const moduleRoot = process.env.SECPAL_NODE_MODULES_ROOT
  ? resolve(process.env.SECPAL_NODE_MODULES_ROOT)
  : resolve(scriptDirectory, "..");
const require = createRequire(join(moduleRoot, "package.json"));
const ts = require("typescript");

const storageKeyPattern = /^secpal\.[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/;
const sourceExtensionPattern = /^\.(?:[cm]?[jt]sx?)$/;

function isUnshadowedGlobal(checker, identifier) {
  const symbol = checker.getSymbolAtLocation(identifier);
  return !symbol?.declarations?.some(
    (declaration) => declaration.getSourceFile() === identifier.getSourceFile()
  );
}

function storageArgument(node, checker) {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression)
  ) {
    return undefined;
  }

  const method = node.expression.name.text;
  if (!["getItem", "setItem", "removeItem"].includes(method)) {
    return undefined;
  }

  const receiver = node.expression.expression;
  const directStorage =
    ts.isIdentifier(receiver) &&
    ["localStorage", "sessionStorage"].includes(receiver.text) &&
    isUnshadowedGlobal(checker, receiver);
  const globalStorage =
    ts.isPropertyAccessExpression(receiver) &&
    ts.isIdentifier(receiver.expression) &&
    ["window", "globalThis"].includes(receiver.expression.text) &&
    ["localStorage", "sessionStorage"].includes(receiver.name.text) &&
    isUnshadowedGlobal(checker, receiver.expression);

  return directStorage || globalStorage ? node.arguments[0] : undefined;
}

function storageKeyLiteral(initializer) {
  let expression = initializer;
  while (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    expression = expression.expression;
  }
  return ts.isStringLiteral(expression) &&
    storageKeyPattern.test(expression.text)
    ? expression
    : undefined;
}

function isExportedDeclaration(declaration) {
  const statement = declaration.parent.parent;
  return (
    ts.isVariableStatement(statement) &&
    Boolean(ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export)
  );
}

function isReexportedSymbol(sourceFile, checker, symbol) {
  let exported = false;

  function visit(node) {
    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      exported ||= node.exportClause.elements.some(
        (specifier) =>
          checker.getExportSpecifierLocalTargetSymbol(specifier) === symbol
      );
    }
    if (!exported) {
      ts.forEachChild(node, visit);
    }
  }

  visit(sourceFile);
  return exported;
}

function symbolAtIdentifier(checker, identifier) {
  if (
    ts.isShorthandPropertyAssignment(identifier.parent) &&
    identifier.parent.name === identifier
  ) {
    return checker.getShorthandAssignmentValueSymbol(identifier.parent);
  }
  return checker.getSymbolAtLocation(identifier);
}

function parserExemptions(file, program, checker) {
  const sourceFile = program.getSourceFile(file);
  if (!sourceFile || sourceFile.parseDiagnostics.length > 0) {
    return [];
  }

  const storageUses = new Set();
  const directLiterals = [];
  const candidates = [];
  const identifiers = [];

  function visit(node) {
    const argument = storageArgument(node, checker);
    if (argument) {
      if (ts.isIdentifier(argument)) {
        storageUses.add(argument);
      } else if (
        ts.isStringLiteral(argument) &&
        storageKeyPattern.test(argument.text)
      ) {
        directLiterals.push(argument);
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      !isExportedDeclaration(node)
    ) {
      const symbol = checker.getSymbolAtLocation(node.name);
      const initializer = storageKeyLiteral(node.initializer);
      if (
        symbol &&
        initializer &&
        !isReexportedSymbol(sourceFile, checker, symbol)
      ) {
        candidates.push({
          declaration: node,
          initializer,
          symbol,
        });
      }
    }

    if (ts.isIdentifier(node)) {
      identifiers.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  const exemptions = [...directLiterals];
  for (const candidate of candidates) {
    const references = identifiers.filter(
      (identifier) =>
        identifier !== candidate.declaration.name &&
        symbolAtIdentifier(checker, identifier) === candidate.symbol
    );
    const declarationStart = candidate.declaration.name.getStart(sourceFile);
    const onlyReachableStorageUses =
      references.length > 0 &&
      references.every(
        (identifier) =>
          storageUses.has(identifier) &&
          identifier.getStart(sourceFile) > declarationStart
      );
    if (onlyReachableStorageUses) {
      exemptions.push(candidate.initializer);
    }
  }

  return exemptions.map((node) => ({
    end: node.getEnd(),
    start: node.getStart(sourceFile),
  }));
}

function replaceNonSourceStorageKeys(source) {
  return source.replace(
    /(?<![A-Za-z0-9_$.])(?:(?:window|globalThis)\.)?(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*(["'])secpal\.[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\1(?=\s*(?:,|\)))/g,
    (match) =>
      match.replace(
        /secpal\.[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/,
        "__secpal_storage_identifier__"
      )
  );
}

const files = process.argv
  .slice(2)
  .filter((file) => resolve(file) !== scriptPath);
const sourceFiles = files.filter((file) =>
  sourceExtensionPattern.test(extname(file))
);
const program = ts.createProgram(sourceFiles, {
  allowJs: true,
  checkJs: true,
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  moduleDetection: ts.ModuleDetectionKind.Force,
  noLib: true,
  noResolve: true,
  target: ts.ScriptTarget.Latest,
});
const checker = program.getTypeChecker();

for (const file of files) {
  let source = readFileSync(file, "utf8");
  if (sourceExtensionPattern.test(extname(file))) {
    for (const exemption of parserExemptions(file, program, checker).sort(
      (left, right) => right.start - left.start
    )) {
      source =
        source.slice(0, exemption.start) +
        "__secpal_storage_identifier__" +
        source.slice(exemption.end);
    }
  } else {
    source = replaceNonSourceStorageKeys(source);
  }

  source.split("\n").forEach((line, index) => {
    if (/secpal\.[A-Za-z0-9.-]{1,100}/.test(line)) {
      process.stdout.write(`${file}:${index + 1}:${line}\n`);
    }
  });
}
