#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
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
const browserStorageKinds = new Set(["localStorage", "sessionStorage"]);
const storageMethods = new Map([
  ["getItem", 1],
  ["removeItem", 1],
  ["setItem", 2],
]);

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

function staticStringValue(expression) {
  expression = unwrapExpression(expression);
  return ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text
    : undefined;
}

function staticPropertyName(expression) {
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return ts.isElementAccessExpression(expression) &&
    expression.argumentExpression
    ? staticStringValue(expression.argumentExpression)
    : undefined;
}

function storageKeyLiteral(expression) {
  expression = unwrapExpression(expression);
  return (ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)) &&
    storageKeyPattern.test(expression.text)
    ? expression
    : undefined;
}

function passiveExpression(expression, checker) {
  expression = unwrapExpression(expression);
  return (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression) ||
    ts.isNumericLiteral(expression) ||
    ts.isBigIntLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(expression) &&
      expression.text === "undefined" &&
      isUnshadowedGlobal(checker, expression))
  );
}

function browserStorageReceiver(expression, checker) {
  expression = unwrapExpression(expression);
  if (
    ts.isIdentifier(expression) &&
    browserStorageKinds.has(expression.text) &&
    isUnshadowedGlobal(checker, expression)
  ) {
    return { identifier: expression, kind: expression.text };
  }
  if (
    (ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)) &&
    ts.isIdentifier(expression.expression) &&
    ["window", "globalThis"].includes(expression.expression.text) &&
    isUnshadowedGlobal(checker, expression.expression)
  ) {
    const kind = staticPropertyName(expression);
    return browserStorageKinds.has(kind)
      ? { identifier: expression.expression, kind }
      : undefined;
  }
  return undefined;
}

function containingExpressionStatement(expression) {
  let outer = expression;
  while (
    isTransparentExpressionWrapper(outer.parent) &&
    outer.parent.expression === outer
  ) {
    outer = outer.parent;
  }
  return ts.isExpressionStatement(outer.parent) &&
    outer.parent.expression === outer &&
    (ts.isSourceFile(outer.parent.parent) || ts.isBlock(outer.parent.parent))
    ? outer.parent
    : undefined;
}

function immediateInvocation(functionExpression) {
  if (
    (!ts.isArrowFunction(functionExpression) &&
      !ts.isFunctionExpression(functionExpression)) ||
    functionExpression.asteriskToken ||
    functionExpression.parameters.length !== 0
  ) {
    return undefined;
  }

  let invocation = functionExpression;
  while (
    isTransparentExpressionWrapper(invocation.parent) &&
    invocation.parent.expression === invocation
  ) {
    invocation = invocation.parent;
  }
  return ts.isCallExpression(invocation.parent) &&
    invocation.parent.expression === invocation &&
    !ts.isOptionalChain(invocation.parent) &&
    invocation.parent.arguments.length === 0
    ? invocation.parent
    : undefined;
}

function immediateFunctionExpression(expression) {
  const invocation = unwrapExpression(expression);
  if (!ts.isCallExpression(invocation)) {
    return undefined;
  }
  const functionExpression = unwrapExpression(invocation.expression);
  return immediateInvocation(functionExpression) === invocation
    ? functionExpression
    : undefined;
}

function containingExecutionStatement(expression) {
  const statement = containingExpressionStatement(expression);
  if (statement) {
    return statement;
  }

  let body = expression;
  while (
    isTransparentExpressionWrapper(body.parent) &&
    body.parent.expression === body
  ) {
    body = body.parent;
  }
  const functionExpression = body.parent;
  if (
    !ts.isArrowFunction(functionExpression) ||
    functionExpression.body !== body ||
    ts.isBlock(functionExpression.body)
  ) {
    return undefined;
  }
  const invocation = immediateInvocation(functionExpression);
  return invocation ? containingExecutionStatement(invocation) : undefined;
}

function storageCallAccess(node, checker) {
  if (
    !ts.isCallExpression(node) ||
    (!ts.isPropertyAccessExpression(node.expression) &&
      !ts.isElementAccessExpression(node.expression))
  ) {
    return undefined;
  }
  const method = staticPropertyName(node.expression);
  if (!storageMethods.has(method)) {
    return undefined;
  }
  const receiver = browserStorageReceiver(node.expression.expression, checker);
  return receiver ? { method, node, receiver } : undefined;
}

function syntacticStorageCall(access, checker) {
  if (!access || ts.isOptionalChain(access.node)) {
    return undefined;
  }
  const argumentCount = storageMethods.get(access.method);
  if (
    access.node.arguments.length !== argumentCount ||
    access.node.arguments.some(ts.isSpreadElement) ||
    (access.method === "setItem" &&
      !passiveExpression(access.node.arguments[1], checker))
  ) {
    return undefined;
  }
  const statement = containingExecutionStatement(access.node);
  const key = unwrapExpression(access.node.arguments[0]);
  if (
    !statement ||
    (!ts.isIdentifier(key) && !passiveExpression(key, checker))
  ) {
    return undefined;
  }
  return { ...access, key, statement };
}

function isTypeOnlyReference(identifier) {
  for (let node = identifier.parent; node; node = node.parent) {
    if (ts.isPartOfTypeOnlyImportOrExportDeclaration(node)) {
      return true;
    }
    if (
      ts.isTypeReferenceNode(node) ||
      ts.isTypeQueryNode(node) ||
      ts.isJSDocTypeExpression(node)
    ) {
      return true;
    }
    if (ts.isComputedPropertyName(node)) {
      const container = node.parent.parent;
      return (
        ts.isTypeLiteralNode(container) || ts.isInterfaceDeclaration(container)
      );
    }
    if (ts.isStatement(node) || ts.isSourceFile(node)) {
      return false;
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

function identifierReferencesSymbol(checker, identifier, symbol) {
  const reference = symbolAtIdentifier(checker, identifier);
  return (
    reference === symbol ||
    Boolean(
      reference?.declarations?.some((declaration) =>
        symbol.declarations?.includes(declaration)
      )
    )
  );
}

function passiveVariableStatement(statement, checker) {
  return (
    !(statement.declarationList.flags & ts.NodeFlags.Using) &&
    statement.declarationList.declarations.every(
      (declaration) =>
        ts.isIdentifier(declaration.name) &&
        (!declaration.initializer ||
          passiveExpression(declaration.initializer, checker))
    )
  );
}

function hasDecorators(node) {
  return ts.canHaveDecorators(node) && Boolean(ts.getDecorators(node)?.length);
}

function hasStaticModifier(node) {
  return Boolean(
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword
    )
  );
}

function passiveClassMember(member, checker) {
  if (
    ts.isClassStaticBlockDeclaration(member) ||
    hasDecorators(member) ||
    (member.name &&
      ts.isComputedPropertyName(member.name) &&
      !passiveExpression(member.name.expression, checker)) ||
    member.parameters?.some(hasDecorators)
  ) {
    return false;
  }
  if (ts.isPropertyDeclaration(member)) {
    return !(
      hasStaticModifier(member) &&
      member.initializer &&
      !passiveExpression(member.initializer, checker)
    );
  }
  return (
    ts.isConstructorDeclaration(member) ||
    ts.isMethodDeclaration(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member) ||
    ts.isIndexSignatureDeclaration(member) ||
    ts.isSemicolonClassElement(member)
  );
}

function passiveClassDeclaration(statement, checker) {
  return (
    !hasDecorators(statement) &&
    !statement.heritageClauses?.some(
      (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword
    ) &&
    statement.members.every((member) => passiveClassMember(member, checker))
  );
}

function isErasedTypeOnlyStatement(statement) {
  if (ts.isImportDeclaration(statement)) {
    return statement.importClause?.isTypeOnly === true;
  }
  if (ts.isImportEqualsDeclaration(statement)) {
    return statement.isTypeOnly;
  }
  if (!ts.isExportDeclaration(statement)) {
    return false;
  }
  return (
    statement.isTypeOnly ||
    (!statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.every((specifier) =>
        Boolean(specifier.isTypeOnly)
      ))
  );
}

function hasHoistedRuntimeDependency(sourceFile) {
  return sourceFile.statements.some(
    (statement) =>
      (ts.isImportDeclaration(statement) ||
        (ts.isExportDeclaration(statement) && statement.moduleSpecifier)) &&
      !isErasedTypeOnlyStatement(statement)
  );
}

function resolvedLocalExport(statement, checker) {
  return (
    ts.isExportDeclaration(statement) &&
    !statement.moduleSpecifier &&
    statement.exportClause &&
    ts.isNamedExports(statement.exportClause) &&
    statement.exportClause.elements.every(
      (specifier) =>
        specifier.isTypeOnly ||
        Boolean(checker.getExportSpecifierLocalTargetSymbol(specifier))
    )
  );
}

function safePrecedingStatement(
  statement,
  callsByStatement,
  safeStorageKeyUses,
  checker
) {
  if (
    isAmbientDeclaration(statement) ||
    ts.isEmptyStatement(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    isErasedTypeOnlyStatement(statement) ||
    resolvedLocalExport(statement, checker)
  ) {
    return true;
  }
  if (ts.isFunctionDeclaration(statement)) {
    return !hasDecorators(statement);
  }
  if (ts.isClassDeclaration(statement)) {
    return passiveClassDeclaration(statement, checker);
  }
  if (ts.isVariableStatement(statement)) {
    return passiveVariableStatement(statement, checker);
  }
  if (
    ts.isExpressionStatement(statement) &&
    passiveExpression(statement.expression, checker)
  ) {
    return true;
  }
  const call = callsByStatement.get(statement);
  if (
    call &&
    (passiveExpression(call.key, checker) || safeStorageKeyUses.has(call.key))
  ) {
    return true;
  }

  if (!ts.isExpressionStatement(statement)) {
    return false;
  }
  const functionExpression = immediateFunctionExpression(statement.expression);
  if (!functionExpression) {
    return false;
  }
  return ts.isBlock(functionExpression.body)
    ? functionExpression.body.statements.every((bodyStatement) =>
        safePrecedingStatement(
          bodyStatement,
          callsByStatement,
          safeStorageKeyUses,
          checker
        )
      )
    : passiveExpression(functionExpression.body, checker);
}

function hasStraightLinePrefix(
  call,
  callsByStatement,
  safeStorageKeyUses,
  checker
) {
  const container = call.statement.parent;
  const statements = container.statements;
  const index = statements.indexOf(call.statement);
  if (
    index < 0 ||
    !statements
      .slice(0, index)
      .every((statement) =>
        safePrecedingStatement(
          statement,
          callsByStatement,
          safeStorageKeyUses,
          checker
        )
      )
  ) {
    return false;
  }
  if (ts.isSourceFile(container)) {
    return true;
  }

  const functionExpression = container.parent;
  if (!ts.isBlock(container)) {
    return false;
  }
  const invocation = immediateInvocation(functionExpression);
  if (!invocation) {
    return false;
  }
  const entry = containingExecutionStatement(invocation);
  return Boolean(
    entry &&
    hasStraightLinePrefix(
      { statement: entry },
      callsByStatement,
      safeStorageKeyUses,
      checker
    )
  );
}

function declarationIsExported(declaration) {
  const statement = declaration.parent.parent;
  return (
    ts.isVariableStatement(statement) &&
    Boolean(ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export)
  );
}

function symbolIsRuntimeExported(sourceFile, checker, symbol) {
  return sourceFile.statements.some(
    (statement) =>
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some(
        (specifier) =>
          !specifier.isTypeOnly &&
          checker.getExportSpecifierLocalTargetSymbol(specifier) === symbol
      )
  );
}

function matchingTypeLiterals(root, value) {
  const matches = [];
  function visit(node) {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === value &&
      ts.isLiteralTypeNode(node.parent)
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return matches;
}

function exemptionNodes(records) {
  const nodes = new Set();
  for (const record of records) {
    nodes.add(record.literal);
    for (const root of record.typeRoots) {
      for (const typeLiteral of matchingTypeLiterals(
        root,
        record.literal.text
      )) {
        nodes.add(typeLiteral);
      }
    }
  }
  return [...nodes];
}

function parserExemptions(file, program, checker) {
  const sourceFile = program.getSourceFile(file);
  if (
    !sourceFile ||
    sourceFile.parseDiagnostics.length > 0 ||
    hasHoistedRuntimeDependency(sourceFile)
  ) {
    return [];
  }

  const identifiers = [];
  const calls = [];
  const variableStatements = [];
  function visit(node) {
    if (ts.isIdentifier(node)) {
      identifiers.push(node);
    }
    if (ts.isVariableStatement(node)) {
      variableStatements.push(node);
    }
    const access = storageCallAccess(node, checker);
    const call = syntacticStorageCall(access, checker);
    if (call) {
      calls.push(call);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const callsByStatement = new Map(calls.map((call) => [call.statement, call]));
  const storageUses = new Map(
    calls
      .filter((call) => ts.isIdentifier(call.key))
      .map((call) => [call.key, call])
  );
  const candidates = [];

  for (const statement of variableStatements) {
    if (
      !ts.isVariableStatement(statement) ||
      statement.declarationList.flags & ts.NodeFlags.Using ||
      statement.declarationList.declarations.length !== 1
    ) {
      continue;
    }
    const declaration = statement.declarationList.declarations[0];
    if (
      !ts.isIdentifier(declaration.name) ||
      !declaration.initializer ||
      declarationIsExported(declaration)
    ) {
      continue;
    }
    const initializer = storageKeyLiteral(declaration.initializer);
    const symbol = checker.getSymbolAtLocation(declaration.name);
    if (
      !initializer ||
      !symbol ||
      symbolIsRuntimeExported(sourceFile, checker, symbol)
    ) {
      continue;
    }
    const references = identifiers.filter(
      (identifier) =>
        identifier !== declaration.name &&
        !isTypeOnlyReference(identifier) &&
        identifierReferencesSymbol(checker, identifier, symbol)
    );
    if (
      references.length > 0 &&
      references.every(
        (identifier) =>
          identifier.getStart() > initializer.getEnd() &&
          storageUses.has(identifier)
      )
    ) {
      candidates.push({ declaration, initializer, references });
    }
  }

  const safeStorageKeyUses = new Set(
    candidates.flatMap((candidate) => candidate.references)
  );
  const directCallRecords = calls
    .filter(
      (call) =>
        storageKeyLiteral(call.key) &&
        hasStraightLinePrefix(
          call,
          callsByStatement,
          safeStorageKeyUses,
          checker
        )
    )
    .map((call) => ({
      literal: storageKeyLiteral(call.key),
      typeRoots: [call.node],
    }));
  const candidateRecords = [];

  for (const candidate of candidates) {
    if (
      candidate.references.every((identifier) => {
        const call = storageUses.get(identifier);
        return hasStraightLinePrefix(
          call,
          callsByStatement,
          safeStorageKeyUses,
          checker
        );
      })
    ) {
      candidateRecords.push({
        literal: candidate.initializer,
        typeRoots: [
          candidate.declaration,
          ...candidate.references.map(
            (identifier) => storageUses.get(identifier).node
          ),
        ],
      });
    }
  }

  return exemptionNodes([...directCallRecords, ...candidateRecords]).map(
    (node) => ({
      end: node.getEnd(),
      start: node.getStart(sourceFile),
    })
  );
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

const files = process.argv.slice(2);
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
