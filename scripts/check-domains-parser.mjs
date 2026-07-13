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
const unreachableCodeDiagnostic = 7027;
const unreachableRanges = new WeakMap();

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

function hasWithStatementAncestor(node) {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (ts.isWithStatement(ancestor)) {
      return true;
    }
  }
  return false;
}

function isDeferredClassFieldInitializer(node) {
  let child = node;
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (ts.isPropertyDeclaration(ancestor) && ancestor.initializer === child) {
      if (!(ts.getCombinedModifierFlags(ancestor) & ts.ModifierFlags.Static)) {
        return true;
      }
    }
    child = ancestor;
  }
  return false;
}

function isConditionallyEvaluated(node) {
  let child = node;
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (
      (ts.isIfStatement(ancestor) && ancestor.expression !== child) ||
      (ts.isConditionalExpression(ancestor) && ancestor.condition !== child) ||
      (ts.isBinaryExpression(ancestor) &&
        [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(ancestor.operatorToken.kind) &&
        ancestor.right === child) ||
      (ts.isWhileStatement(ancestor) && ancestor.statement === child) ||
      (ts.isForStatement(ancestor) &&
        (ancestor.statement === child || ancestor.incrementor === child)) ||
      ((ts.isForInStatement(ancestor) || ts.isForOfStatement(ancestor)) &&
        ancestor.statement === child) ||
      ts.isCaseClause(ancestor) ||
      (ts.isDefaultClause(ancestor) && ancestor.parent.clauses.length !== 1) ||
      ts.isCatchClause(ancestor) ||
      (ts.isParameter(ancestor) && ancestor.initializer === child) ||
      (ts.isBindingElement(ancestor) && ancestor.initializer === child)
    ) {
      return true;
    }
    if (ts.isFunctionLike(ancestor) || ts.isSourceFile(ancestor)) {
      return false;
    }
    child = ancestor;
  }
  return false;
}

function abruptCompletion(statement) {
  if (ts.isThrowStatement(statement)) {
    return { always: true, uncatchable: false };
  }
  if (
    ts.isReturnStatement(statement) ||
    ts.isBreakStatement(statement) ||
    ts.isContinueStatement(statement)
  ) {
    return { always: true, uncatchable: true };
  }
  if (ts.isBlock(statement)) {
    for (const nestedStatement of statement.statements) {
      const completion = abruptCompletion(nestedStatement);
      if (completion.always) {
        return completion;
      }
    }
  }
  if (ts.isIfStatement(statement) && statement.elseStatement) {
    const thenCompletion = abruptCompletion(statement.thenStatement);
    const elseCompletion = abruptCompletion(statement.elseStatement);
    return {
      always: thenCompletion.always && elseCompletion.always,
      uncatchable: thenCompletion.uncatchable && elseCompletion.uncatchable,
    };
  }
  if (ts.isTryStatement(statement)) {
    const finallyCompletion = statement.finallyBlock
      ? abruptCompletion(statement.finallyBlock)
      : { always: false, uncatchable: false };
    if (finallyCompletion.always) {
      return finallyCompletion;
    }
    const tryCompletion = abruptCompletion(statement.tryBlock);
    if (!tryCompletion.always || tryCompletion.uncatchable) {
      return tryCompletion;
    }
    if (!statement.catchClause) {
      return tryCompletion;
    }
    return abruptCompletion(statement.catchClause.block);
  }
  return { always: false, uncatchable: false };
}

function hasPrecedingAbruptCompletion(node) {
  let child = node;
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (
      ts.isBlock(ancestor) ||
      ts.isSourceFile(ancestor) ||
      ts.isCaseClause(ancestor) ||
      ts.isDefaultClause(ancestor)
    ) {
      const childIndex = ancestor.statements.indexOf(child);
      if (
        childIndex > 0 &&
        ancestor.statements
          .slice(0, childIndex)
          .some((statement) => abruptCompletion(statement).always)
      ) {
        return true;
      }
    }
    if (ts.isFunctionLike(ancestor) || ts.isSourceFile(ancestor)) {
      return false;
    }
    child = ancestor;
  }
  return false;
}

function isCompilerUnreachable(node) {
  const position = node.getStart(node.getSourceFile());
  return (unreachableRanges.get(node.getSourceFile()) ?? []).some(
    ({ start, end }) => position >= start && position < end
  );
}

function hasProvenExecutionAt(node) {
  return (
    !hasWithStatementAncestor(node) &&
    !isConditionallyEvaluated(node) &&
    !hasPrecedingAbruptCompletion(node) &&
    !isCompilerUnreachable(node)
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
    hasWithStatementAncestor(node) ||
    isDeferredClassFieldInitializer(node) ||
    (!ts.isPropertyAccessExpression(node.expression) &&
      !ts.isElementAccessExpression(node.expression))
  ) {
    return undefined;
  }

  const method = staticPropertyName(node.expression);
  if (!["getItem", "setItem", "removeItem"].includes(method)) {
    return undefined;
  }
  if (
    method === "setItem" &&
    (node.arguments.length < 2 || ts.isSpreadElement(node.arguments[1]))
  ) {
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

function isDirectEvalCall(node, checker) {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const callee = unwrapExpression(node.expression);
  return (
    ts.isIdentifier(callee) &&
    callee.text === "eval" &&
    isUnshadowedGlobal(checker, callee)
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

function containingFunctionLike(node) {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (ts.isFunctionLike(ancestor)) {
      return ancestor;
    }
  }
  return undefined;
}

function executionScope(node) {
  for (let current = node; current; current = current.parent) {
    if (ts.isFunctionLike(current) || ts.isSourceFile(current)) {
      return current;
    }
  }
  return undefined;
}

function addInitializationRequirement(requirements, node, position) {
  const scope = executionScope(node);
  if (!scope) {
    return requirements;
  }
  const updated = new Map(requirements);
  updated.set(scope, Math.max(updated.get(scope) ?? -1, position));
  return updated;
}

function satisfyInitializationRequirement(requirements, node) {
  const scope = executionScope(node);
  const requiredPosition = scope ? requirements.get(scope) : undefined;
  if (requiredPosition === undefined) {
    return requirements;
  }
  if (node.getStart() <= requiredPosition) {
    return undefined;
  }
  const remaining = new Map(requirements);
  remaining.delete(scope);
  return remaining;
}

function functionBinding(functionLike, checker) {
  if (ts.isFunctionDeclaration(functionLike) && functionLike.name) {
    return { identifier: functionLike.name, initializationEnd: undefined };
  }

  let expression = functionLike;
  while (
    isTransparentExpressionWrapper(expression.parent) &&
    expression.parent.expression === expression
  ) {
    expression = expression.parent;
  }
  const declaration = expression.parent;
  return ts.isVariableDeclaration(declaration) &&
    declaration.initializer === expression &&
    ts.isIdentifier(declaration.name) &&
    checker.getSymbolAtLocation(declaration.name)
    ? {
        identifier: declaration.name,
        initialization: declaration.initializer,
        initializationEnd: declaration.initializer.getEnd(),
      }
    : undefined;
}

function directCallExpression(expression) {
  while (
    isTransparentExpressionWrapper(expression.parent) &&
    expression.parent.expression === expression
  ) {
    expression = expression.parent;
  }
  return ts.isCallExpression(expression.parent) &&
    expression.parent.expression === expression
    ? expression.parent
    : undefined;
}

function isDirectCall(identifier) {
  return (
    hasProvenExecutionAt(identifier) &&
    Boolean(directCallExpression(identifier))
  );
}

function functionExecutionIsReachable(
  functionLike,
  initializationRequirements,
  identifiers,
  checker,
  visiting = new Set()
) {
  if (functionLike.asteriskToken || isConditionallyEvaluated(functionLike)) {
    return false;
  }
  const immediateInvocation =
    ts.isArrowFunction(functionLike) || ts.isFunctionExpression(functionLike)
      ? directCallExpression(functionLike)
      : undefined;
  if (immediateInvocation) {
    if (!hasProvenExecutionAt(immediateInvocation)) {
      return false;
    }
    const caller = containingFunctionLike(immediateInvocation);
    const remainingRequirements = satisfyInitializationRequirement(
      initializationRequirements,
      immediateInvocation
    );
    if (!remainingRequirements) {
      return false;
    }
    return caller
      ? functionExecutionIsReachable(
          caller,
          remainingRequirements,
          identifiers,
          checker,
          visiting
        )
      : remainingRequirements.size === 0;
  }
  const binding = functionBinding(functionLike, checker);
  if (
    !binding ||
    (binding.initialization && !hasProvenExecutionAt(binding.initialization))
  ) {
    return false;
  }
  const symbol = checker.getSymbolAtLocation(binding.identifier);
  if (!symbol || visiting.has(symbol)) {
    return false;
  }
  const requiredAtCall =
    binding.initializationEnd === undefined
      ? initializationRequirements
      : addInitializationRequirement(
          initializationRequirements,
          binding.identifier,
          binding.initializationEnd
        );
  const nextVisiting = new Set(visiting).add(symbol);
  const references = identifiers.filter(
    (identifier) =>
      identifier !== binding.identifier &&
      !isTypeOnlyReference(identifier) &&
      symbolAtIdentifier(checker, identifier) === symbol
  );
  return (
    references.length > 0 &&
    references.every((identifier) => {
      if (!isDirectCall(identifier)) {
        return false;
      }
      const remainingRequirements = satisfyInitializationRequirement(
        requiredAtCall,
        identifier
      );
      if (!remainingRequirements) {
        return false;
      }
      const caller = containingFunctionLike(identifier);
      return caller
        ? functionExecutionIsReachable(
            caller,
            remainingRequirements,
            identifiers,
            checker,
            nextVisiting
          )
        : remainingRequirements.size === 0;
    })
  );
}

function isReachableStorageUse(
  storageUse,
  initializationRequirements,
  identifiers,
  checker
) {
  if (!hasProvenExecutionAt(storageUse)) {
    return false;
  }
  const remainingRequirements = satisfyInitializationRequirement(
    initializationRequirements,
    storageUse
  );
  if (!remainingRequirements) {
    return false;
  }
  const containingFunction = containingFunctionLike(storageUse);
  return containingFunction
    ? functionExecutionIsReachable(
        containingFunction,
        remainingRequirements,
        identifiers,
        checker
      )
    : remainingRequirements.size === 0;
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
  let hasDirectEval = false;

  function visit(node) {
    hasDirectEval ||= isDirectEvalCall(node, checker);
    const argument = storageArgument(node, checker);
    if (argument) {
      const unwrappedArgument = unwrapExpression(argument);
      if (ts.isIdentifier(unwrappedArgument)) {
        storageUses.add(unwrappedArgument);
      } else {
        const literal = storageKeyLiteral(unwrappedArgument);
        if (literal) {
          directLiterals.push({ literal, storageUse: node });
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
        hasProvenExecutionAt(node.initializer) &&
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

  if (hasDirectEval) {
    return [];
  }

  const exemptions = directLiterals
    .filter(({ storageUse }) =>
      isReachableStorageUse(storageUse, new Map(), identifiers, checker)
    )
    .map(({ literal }) => literal);
  for (const candidate of candidates) {
    const references = identifiers.filter(
      (identifier) =>
        identifier !== candidate.declaration.name &&
        !isTypeOnlyReference(identifier) &&
        symbolAtIdentifier(checker, identifier) === candidate.symbol
    );
    const initializationRequirements = addInitializationRequirement(
      new Map(),
      candidate.declaration,
      candidate.declaration.initializer.getEnd()
    );
    const onlyReachableStorageUses =
      references.length > 0 &&
      references.every(
        (identifier) =>
          storageUses.has(identifier) &&
          isReachableStorageUse(
            identifier,
            initializationRequirements,
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

const files = process.argv.slice(2);
const sourceFiles = files.filter((file) =>
  sourceExtensionPattern.test(extname(file))
);
const program = ts.createProgram(sourceFiles, {
  allowJs: true,
  allowUnreachableCode: false,
  checkJs: true,
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  moduleDetection: ts.ModuleDetectionKind.Force,
  noLib: true,
  noResolve: true,
  target: ts.ScriptTarget.Latest,
});
const checker = program.getTypeChecker();
for (const sourceFile of program.getSourceFiles()) {
  unreachableRanges.set(
    sourceFile,
    program
      .getSemanticDiagnostics(sourceFile)
      .filter(
        (diagnostic) =>
          diagnostic.code === unreachableCodeDiagnostic &&
          diagnostic.start !== undefined &&
          diagnostic.length !== undefined
      )
      .map((diagnostic) => ({
        end: diagnostic.start + diagnostic.length,
        start: diagnostic.start,
      }))
  );
}

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
