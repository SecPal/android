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
let ts;
try {
  ts = require("typescript");
} catch (error) {
  if (error?.code === "MODULE_NOT_FOUND") {
    process.stderr.write(
      "TypeScript is required to validate domain usage; run npm ci.\n"
    );
    process.exit(1);
  }
  throw error;
}

const storageKeyPattern = /^secpal\.[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/;
const sourceExtensionPattern = /^\.(?:[cm]?[jt]sx?)$/;

function isAmbientDeclaration(declaration) {
  if (declaration.getSourceFile().isDeclarationFile) {
    return true;
  }
  for (
    let node = declaration;
    node && !ts.isSourceFile(node);
    node = node.parent
  ) {
    if (
      node.flags & ts.NodeFlags.Ambient ||
      ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Ambient
    ) {
      return true;
    }
  }
  return false;
}

function isUnshadowedGlobal(checker, identifier) {
  const symbol = checker.getSymbolAtLocation(identifier);
  return !symbol?.declarations?.some(
    (declaration) =>
      declaration.getSourceFile() === identifier.getSourceFile() &&
      !isAmbientDeclaration(declaration)
  );
}

function staticPropertyName(expression) {
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression
  ) {
    const argument = unwrapExpression(expression.argumentExpression);
    if (
      ts.isStringLiteral(argument) ||
      ts.isNoSubstitutionTemplateLiteral(argument)
    ) {
      return argument.text;
    }
  }
  return undefined;
}

function storageArgument(node, checker) {
  if (
    !ts.isCallExpression(node) ||
    (!ts.isPropertyAccessExpression(node.expression) &&
      !ts.isElementAccessExpression(node.expression))
  ) {
    return undefined;
  }

  const method = staticPropertyName(node.expression);
  if (!["getItem", "setItem", "removeItem"].includes(method)) {
    return undefined;
  }

  const receiver = node.expression.expression;
  const directStorage =
    ts.isIdentifier(receiver) &&
    ["localStorage", "sessionStorage"].includes(receiver.text) &&
    isUnshadowedGlobal(checker, receiver);
  const globalStorage =
    (ts.isPropertyAccessExpression(receiver) ||
      ts.isElementAccessExpression(receiver)) &&
    ts.isIdentifier(receiver.expression) &&
    ["window", "globalThis"].includes(receiver.expression.text) &&
    ["localStorage", "sessionStorage"].includes(
      staticPropertyName(receiver) ?? ""
    ) &&
    isUnshadowedGlobal(checker, receiver.expression);

  return directStorage || globalStorage ? node.arguments[0] : undefined;
}

function isTransparentExpressionWrapper(node) {
  return (
    node &&
    (ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node))
  );
}

function unwrapExpression(expression) {
  while (isTransparentExpressionWrapper(expression)) {
    expression = expression.expression;
  }
  return expression;
}

function storageKeyLiteral(initializer) {
  const expression = unwrapExpression(initializer);
  return (ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)) &&
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

function isTypeOnlyReference(identifier) {
  for (let node = identifier.parent; node; node = node.parent) {
    if (ts.isTypeQueryNode(node) || ts.isJSDocTypeExpression(node)) {
      return true;
    }
    if (ts.isComputedPropertyName(node)) {
      const container = node.parent.parent;
      return (
        ts.isTypeLiteralNode(container) || ts.isInterfaceDeclaration(container)
      );
    }
  }
  return false;
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

function containingFunctionDeclaration(identifier) {
  for (let node = identifier.parent; node; node = node.parent) {
    if (ts.isFunctionDeclaration(node)) {
      return node;
    }
    if (ts.isFunctionLike(node)) {
      return undefined;
    }
  }
  return undefined;
}

function functionIsCalledAfterDeclaration(
  declaration,
  declarationStart,
  identifiers,
  checker,
  visiting = new Set()
) {
  if (!declaration.name) {
    return false;
  }
  const symbol = checker.getSymbolAtLocation(declaration.name);
  if (!symbol || visiting.has(symbol)) {
    return false;
  }
  const nextVisiting = new Set(visiting).add(symbol);
  const references = identifiers.filter(
    (identifier) =>
      identifier !== declaration.name &&
      symbolAtIdentifier(checker, identifier) === symbol
  );
  const isDirectCall = (identifier) => {
    let expression = identifier;
    while (
      isTransparentExpressionWrapper(expression.parent) &&
      expression.parent.expression === expression
    ) {
      expression = expression.parent;
    }
    return (
      ts.isCallExpression(expression.parent) &&
      expression.parent.expression === expression
    );
  };
  return (
    references.length > 0 &&
    references.every((identifier) => {
      if (!isDirectCall(identifier)) {
        return false;
      }
      const caller = containingFunctionDeclaration(identifier);
      return caller
        ? functionIsCalledAfterDeclaration(
            caller,
            declarationStart,
            identifiers,
            checker,
            nextVisiting
          )
        : identifier.getStart() > declarationStart;
    })
  );
}

function isReachableStorageUse(
  identifier,
  declarationStart,
  identifiers,
  checker
) {
  const containingFunction = containingFunctionDeclaration(identifier);
  return containingFunction
    ? functionIsCalledAfterDeclaration(
        containingFunction,
        declarationStart,
        identifiers,
        checker
      )
    : identifier.getStart() > declarationStart;
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
      const unwrappedArgument = unwrapExpression(argument);
      if (ts.isIdentifier(unwrappedArgument)) {
        storageUses.add(unwrappedArgument);
      } else {
        const literal = storageKeyLiteral(unwrappedArgument);
        if (literal) {
          directLiterals.push(literal);
        }
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
        !isTypeOnlyReference(identifier) &&
        symbolAtIdentifier(checker, identifier) === candidate.symbol
    );
    const declarationStart = candidate.declaration.name.getStart(sourceFile);
    const onlyReachableStorageUses =
      references.length > 0 &&
      references.every(
        (identifier) =>
          storageUses.has(identifier) &&
          isReachableStorageUse(
            identifier,
            declarationStart,
            identifiers,
            checker
          )
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
