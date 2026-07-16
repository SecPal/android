#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 SecPal Contributors
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const moduleRoot = process.env.SECPAL_NODE_MODULES_ROOT
  ? resolve(process.env.SECPAL_NODE_MODULES_ROOT)
  : resolve(scriptDirectory, "..");
const require = createRequire(join(moduleRoot, "package.json"));

let parseHtml;
let ts;
let DecodingMode;
let EntityDecoder;
let htmlDecodeTree;
try {
  ts = require("typescript");
  ({ parse: parseHtml } = await import(
    pathToFileURL(require.resolve("parse5")).href
  ));
  ({ DecodingMode, EntityDecoder, htmlDecodeTree } = await import(
    pathToFileURL(require.resolve("entities/decode")).href
  ));
} catch (error) {
  if (["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"].includes(error?.code)) {
    process.stderr.write(
      "TypeScript and parse5 are required to validate domain usage; run npm ci.\n"
    );
    process.exit(1);
  }
  throw error;
}

const storageKeyPattern = /^secpal\.[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/;
const secpalDomainPattern = /secpal\.[A-Za-z0-9.-]{1,100}/;
const approvedSecPalDomainPattern =
  /(?<![A-Za-z0-9.-])(?:(?:changelog|apk)\.secpal\.app|secpal\.app|(?:\*\.|\.)?(?:[A-Za-z0-9-]+\.)*secpal\.dev)(?=$|[^A-Za-z0-9._-]|\.[^A-Za-z0-9_-]|\.$)/g;
const sourceExtensionPattern = /^\.(?:[cm]?[jt]sx?)$/;
const htmlExtensionPattern = /^\.html?$/;
const syntheticHtmlScopes = new Map();
const helperProofCallLimit = 8;
const browserStorageKinds = new Set(["localStorage", "sessionStorage"]);
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const svgNamespace = "http://www.w3.org/2000/svg";
const javascriptMimeTypes = new Set(
  [
    "application/ecmascript application/javascript application/x-ecmascript application/x-javascript",
    "text/ecmascript text/javascript text/jscript text/livescript text/x-ecmascript text/x-javascript",
    ...Array.from({ length: 6 }, (_, index) => `text/javascript1.${index}`),
  ].flatMap((types) => types.split(" "))
);
const storageMethods = new Map([
  ["getItem", 1],
  ["removeItem", 1],
  ["setItem", 2],
]);
const equalityOperators = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
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
  const sourceFile = identifier.getSourceFile();
  const scopes = syntheticHtmlScopes.get(sourceFile.fileName);
  const identifierScope = scopes?.find(
    (scope) =>
      identifier.getStart(sourceFile) >= scope.syntheticStart &&
      identifier.getEnd() <= scope.syntheticEnd
  );
  return !symbol?.declarations?.some((declaration) => {
    if (
      declaration.getSourceFile() !== sourceFile ||
      isAmbientDeclaration(declaration)
    ) {
      return false;
    }
    const declarationScope = scopes?.find(
      (scope) =>
        declaration.getStart(sourceFile) >= scope.syntheticStart &&
        declaration.getEnd() <= scope.syntheticEnd
    );
    return !(
      identifierScope &&
      declarationScope &&
      declarationScope.executionIndex > identifierScope.executionIndex
    );
  });
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

function passiveLiteralExpression(expression) {
  expression = unwrapExpression(expression);
  return (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression) ||
    ts.isNumericLiteral(expression) ||
    ts.isBigIntLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword
  );
}

function passiveExpression(expression, checker) {
  expression = unwrapExpression(expression);
  return (
    passiveLiteralExpression(expression) ||
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
  while (true) {
    const parent = outer.parent;
    if (isTransparentExpressionWrapper(parent) && parent.expression === outer) {
      outer = parent;
      continue;
    }
    if (
      ts.isBinaryExpression(parent) &&
      equalityOperators.has(parent.operatorToken.kind)
    ) {
      const other = parent.left === outer ? parent.right : parent.left;
      if (passiveLiteralExpression(other)) {
        outer = parent;
        continue;
      }
    }
    break;
  }
  return ts.isExpressionStatement(outer.parent) &&
    outer.parent.expression === outer &&
    (ts.isSourceFile(outer.parent.parent) || ts.isBlock(outer.parent.parent))
    ? outer.parent
    : ts.isReturnStatement(outer.parent) &&
        outer.parent.expression === outer &&
        ts.isBlock(outer.parent.parent)
      ? outer.parent
      : ts.isVariableDeclaration(outer.parent) &&
          outer.parent.initializer === outer &&
          outer.parent.parent.declarations.length === 1 &&
          ts.isVariableStatement(outer.parent.parent.parent) &&
          (ts.isSourceFile(outer.parent.parent.parent.parent) ||
            ts.isBlock(outer.parent.parent.parent.parent))
        ? outer.parent.parent.parent
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

function directFunctionInvocation(identifier) {
  let expression = identifier;
  while (
    isTransparentExpressionWrapper(expression.parent) &&
    expression.parent.expression === expression
  ) {
    expression = expression.parent;
  }
  if (
    !ts.isCallExpression(expression.parent) ||
    expression.parent.expression !== expression ||
    ts.isOptionalChain(expression.parent) ||
    expression.parent.arguments.length !== 0
  ) {
    return undefined;
  }
  const statement = containingExecutionStatement(expression.parent);
  return statement ? { node: expression.parent, statement } : undefined;
}

function isFunctionDeclarationName(identifier) {
  return (
    ts.isFunctionDeclaration(identifier.parent) &&
    identifier.parent.name === identifier
  );
}

function isSingleFunctionImplementation(symbol, declaration) {
  const implementations = symbol.declarations?.filter(
    (candidate) => ts.isFunctionDeclaration(candidate) && candidate.body
  );
  return implementations?.length === 1 && implementations[0] === declaration;
}

function eligibleHelperSymbol(declaration, sourceFile, checker) {
  if (
    !declaration.name ||
    declaration.asteriskToken ||
    declaration.modifiers?.some(
      (modifier) =>
        modifier.kind === ts.SyntaxKind.AsyncKeyword ||
        modifier.kind === ts.SyntaxKind.ExportKeyword ||
        modifier.kind === ts.SyntaxKind.DefaultKeyword
    ) ||
    declaration.parameters.length !== 0 ||
    hasDecorators(declaration)
  ) {
    return undefined;
  }
  const symbol = checker.getSymbolAtLocation(declaration.name);
  return symbol &&
    isSingleFunctionImplementation(symbol, declaration) &&
    !symbolIsRuntimeExported(sourceFile, checker, symbol)
    ? symbol
    : undefined;
}

function isClassCallableDeclaration(node) {
  return (
    ts.isConstructorDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function isDeferredClassMember(node) {
  return (
    isClassCallableDeclaration(node) ||
    (ts.isPropertyDeclaration(node) && !hasStaticModifier(node))
  );
}

function boundFunctionDeclaration(expression) {
  let initializer = expression;
  while (
    isTransparentExpressionWrapper(initializer.parent) &&
    initializer.parent.expression === initializer
  ) {
    initializer = initializer.parent;
  }
  return ts.isVariableDeclaration(initializer.parent) &&
    initializer.parent.initializer === initializer
    ? initializer.parent
    : undefined;
}

function isDescendantOf(node, ancestor) {
  for (let current = node; current; current = current.parent) {
    if (current === ancestor) {
      return true;
    }
  }
  return false;
}

function isInsideDormantExecution(node, dormantExecutionRegions) {
  for (let owner = node.parent; owner; owner = owner.parent) {
    if (!dormantExecutionRegions.has(owner)) {
      continue;
    }
    if (ts.isPropertyDeclaration(owner)) {
      if (owner.initializer && isDescendantOf(node, owner.initializer)) {
        return true;
      }
      continue;
    }
    if (
      isClassCallableDeclaration(owner) &&
      owner.name &&
      ts.isComputedPropertyName(owner.name) &&
      isDescendantOf(node, owner.name)
    ) {
      continue;
    }
    return true;
  }
  return false;
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

function syntheticHtmlScope(node) {
  const sourceFile = node.getSourceFile();
  return syntheticHtmlScopes
    .get(sourceFile.fileName)
    ?.find(
      (scope) =>
        node.getStart(sourceFile) >= scope.syntheticStart &&
        node.getEnd() <= scope.syntheticEnd
    );
}

function declarationIsAvailableAtReference(reference, declaration) {
  if (
    declaration.getSourceFile() !== reference.getSourceFile() ||
    isAmbientDeclaration(declaration)
  ) {
    return true;
  }
  const referenceScope = syntheticHtmlScope(reference);
  const declarationScope = syntheticHtmlScope(declaration);
  return !(
    referenceScope &&
    declarationScope &&
    declarationScope.executionIndex > referenceScope.executionIndex
  );
}

function identifierReferencesSymbol(checker, identifier, symbol) {
  const reference = symbolAtIdentifier(checker, identifier);
  if (!reference) {
    return false;
  }
  const declarations =
    reference === symbol
      ? symbol.declarations
      : reference.declarations?.filter((declaration) =>
          symbol.declarations?.includes(declaration)
        );
  return (
    declarations?.some((declaration) =>
      declarationIsAvailableAtReference(identifier, declaration)
    ) ?? reference === symbol
  );
}

function passiveVariableStatement(statement, checker, dormantExecutionRegions) {
  return (
    !(statement.declarationList.flags & ts.NodeFlags.Using) &&
    statement.declarationList.declarations.every(
      (declaration) =>
        ts.isIdentifier(declaration.name) &&
        (!declaration.initializer ||
          passiveExpression(declaration.initializer, checker) ||
          dormantExecutionRegions?.has(
            unwrapExpression(declaration.initializer)
          ))
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
  let dependency = false;
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) ||
        (ts.isExportDeclaration(node) && node.moduleSpecifier)) &&
      !isErasedTypeOnlyStatement(node)
    ) {
      dependency = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return dependency;
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
  checker,
  proofContext,
  proofState
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
  if (ts.isReturnStatement(statement)) {
    return false;
  }
  if (ts.isFunctionDeclaration(statement)) {
    return !hasDecorators(statement);
  }
  if (ts.isClassDeclaration(statement)) {
    return passiveClassDeclaration(statement, checker);
  }
  if (ts.isVariableStatement(statement)) {
    return passiveVariableStatement(
      statement,
      checker,
      proofContext.dormantExecutionRegions
    );
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
    (proofState.validatingHelperInvocations.size > 0
      ? safeHelperStorageKey(call, proofContext)
      : passiveExpression(call.key, checker) ||
        safeStorageKeyUses.has(call.key))
  ) {
    return true;
  }

  if (safeHelperInvocation(statement, proofContext, proofState)) {
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
          checker,
          proofContext,
          proofState
        )
      )
    : passiveExpression(functionExpression.body, checker);
}

function safeHelperInvocation(statement, proofContext, proofState) {
  const declaration =
    proofContext.helperDeclarationsByInvocation.get(statement);
  if (
    !declaration?.body ||
    proofState.validatingHelperInvocations.has(statement)
  ) {
    return false;
  }
  proofState.validatingHelperInvocations.add(statement);
  try {
    return declaration.body.statements.every((bodyStatement) =>
      safePrecedingStatement(
        bodyStatement,
        proofContext.callsByStatement,
        proofContext.safeStorageKeyUses,
        proofContext.checker,
        proofContext,
        proofState
      )
    );
  } finally {
    proofState.validatingHelperInvocations.delete(statement);
  }
}

function safeHelperStorageKey(call, proofContext) {
  const key = staticStringValue(call.key);
  return (
    proofContext.safeStorageKeyUses.has(call.key) ||
    (passiveExpression(call.key, proofContext.checker) &&
      (!key ||
        !secpalDomainPattern.test(
          key.replace(approvedSecPalDomainPattern, "")
        ) ||
        storageKeyLiteral(call.key)))
  );
}

function helperInvocationIsReachable(invocation, proofContext, visiting) {
  const container = invocation.statement.parent;
  if (ts.isSourceFile(container)) {
    return true;
  }
  if (!ts.isBlock(container)) {
    return false;
  }
  const owner = container.parent;
  if (proofContext.dormantExecutionRegions.has(owner)) {
    return false;
  }
  if (
    (ts.isFunctionDeclaration(owner) || isClassCallableDeclaration(owner)) &&
    owner.body === container
  ) {
    if (!ts.isFunctionDeclaration(owner)) {
      return true;
    }
    if (visiting.has(owner)) {
      return false;
    }
    const ownerInvocations = proofContext.helperInvocations.get(owner);
    if (!ownerInvocations) {
      return true;
    }
    return ownerInvocations.some((ownerInvocation) =>
      helperInvocationIsReachable(
        ownerInvocation,
        proofContext,
        new Set(visiting).add(owner)
      )
    );
  }
  const immediate = immediateInvocation(owner);
  const entry = immediate && containingExecutionStatement(immediate);
  return entry
    ? helperInvocationIsReachable({ statement: entry }, proofContext, visiting)
    : true;
}

function containingNamedHelperOwner(statement) {
  let executionStatement = statement;
  while (ts.isBlock(executionStatement.parent)) {
    const owner = executionStatement.parent.parent;
    if (ts.isFunctionDeclaration(owner)) {
      return owner;
    }
    if (
      ts.isTryStatement(owner) &&
      owner.tryBlock === executionStatement.parent
    ) {
      executionStatement = owner;
      continue;
    }
    const immediate = immediateInvocation(owner);
    const entry = immediate && containingExecutionStatement(immediate);
    if (!entry) {
      return undefined;
    }
    executionStatement = entry;
  }
  return undefined;
}

function rootHelperInvocationPaths(declaration, proofContext, visiting) {
  if (visiting.has(declaration)) {
    return [];
  }
  const nextVisiting = new Set(visiting).add(declaration);
  const paths = [];
  for (const invocation of proofContext.helperInvocations.get(declaration) ??
    []) {
    if (!helperInvocationIsReachable(invocation, proofContext, new Set())) {
      continue;
    }
    const caller = containingNamedHelperOwner(invocation.statement);
    if (caller) {
      for (const callerPath of rootHelperInvocationPaths(
        caller,
        proofContext,
        nextVisiting
      )) {
        paths.push([...callerPath, invocation.statement]);
      }
    } else {
      paths.push([invocation.statement]);
    }
  }
  return paths;
}

function proofTargetExecutions(call, proofContext) {
  const owner = containingNamedHelperOwner(call.statement);
  return owner
    ? rootHelperInvocationPaths(owner, proofContext, new Set()).map((path) => ({
        steps: [...path, call.statement],
      }))
    : [{ steps: [call.statement] }];
}

function helperExecutionCountThroughTargets(
  sourceFile,
  targetExecutions,
  proofContext
) {
  if (targetExecutions.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const targetsByRoot = new Map();
  for (const targetExecution of targetExecutions) {
    const root = targetExecution.steps[0];
    const rootedTargets = targetsByRoot.get(root) ?? [];
    rootedTargets.push(targetExecution);
    targetsByRoot.set(root, rootedTargets);
  }
  const remainingTargets = new Set(targetExecutions);
  const nextStepIndexes = new Map(
    targetExecutions.map((targetExecution) => [targetExecution, 0])
  );
  let helperCalls = 0;
  const targetsComplete = (targets) =>
    targets.length > 0 &&
    targets.every((target) => !remainingTargets.has(target));
  function scan(statements, enclosingTargets = []) {
    for (const statement of statements) {
      for (const target of enclosingTargets) {
        const nextStepIndex = nextStepIndexes.get(target);
        if (target.steps[nextStepIndex] === statement) {
          nextStepIndexes.set(target, nextStepIndex + 1);
          if (nextStepIndex + 1 === target.steps.length) {
            remainingTargets.delete(target);
          }
        }
      }
      const rootedTargets = targetsByRoot.get(statement) ?? [];
      for (const target of rootedTargets) {
        nextStepIndexes.set(target, 1);
        if (target.steps.length === 1) {
          remainingTargets.delete(target);
        }
      }
      if (targetsComplete(enclosingTargets)) {
        return;
      }
      const nestedTargets = [...enclosingTargets, ...rootedTargets];
      const declaration =
        proofContext.helperDeclarationsByInvocation.get(statement);
      if (declaration?.body) {
        helperCalls += 1;
        if (helperCalls > helperProofCallLimit) {
          return;
        }
        scan(declaration.body.statements, nestedTargets);
      } else if (ts.isTryStatement(statement)) {
        scan(statement.tryBlock.statements, nestedTargets);
      } else {
        const functionExpression =
          ts.isExpressionStatement(statement) &&
          immediateFunctionExpression(statement.expression);
        if (functionExpression && ts.isBlock(functionExpression.body)) {
          scan(functionExpression.body.statements, nestedTargets);
        }
      }
      if (
        helperCalls > helperProofCallLimit ||
        remainingTargets.size === 0 ||
        targetsComplete(enclosingTargets)
      ) {
        return;
      }
    }
  }
  scan(sourceFile.statements);
  return helperCalls > helperProofCallLimit
    ? helperCalls
    : remainingTargets.size === 0
      ? helperCalls
      : Number.POSITIVE_INFINITY;
}
function hasStraightLinePrefix(
  call,
  callsByStatement,
  safeStorageKeyUses,
  checker,
  proofContext,
  requiredPrecedingStatement,
  proofState = {
    validatingHelperInvocations: new Set(),
  },
  remainingHelperDepth = helperProofCallLimit
) {
  const container = call.statement.parent;
  const statements = container.statements;
  const index = statements.indexOf(call.statement);
  let unresolvedPrecedingStatement = requiredPrecedingStatement;
  if (requiredPrecedingStatement?.parent === container) {
    const precedingIndex = statements.indexOf(requiredPrecedingStatement);
    if (precedingIndex < 0 || precedingIndex >= index) {
      return false;
    }
    unresolvedPrecedingStatement = undefined;
  }
  if (
    index < 0 ||
    !statements
      .slice(0, index)
      .every((statement) =>
        safePrecedingStatement(
          statement,
          callsByStatement,
          safeStorageKeyUses,
          checker,
          proofContext,
          proofState
        )
      )
  ) {
    return false;
  }
  if (ts.isSourceFile(container)) {
    return !unresolvedPrecedingStatement;
  }

  const tryStatement = container.parent;
  if (ts.isTryStatement(tryStatement) && tryStatement.tryBlock === container) {
    return hasStraightLinePrefix(
      { statement: tryStatement },
      callsByStatement,
      safeStorageKeyUses,
      checker,
      proofContext,
      unresolvedPrecedingStatement,
      proofState,
      remainingHelperDepth
    );
  }

  const functionExpression = container.parent;
  if (
    ts.isFunctionDeclaration(functionExpression) &&
    functionExpression.body === container
  ) {
    const invocations = proofContext.helperInvocations.get(functionExpression);
    const reachableInvocations = invocations?.filter((invocation) =>
      helperInvocationIsReachable(invocation, proofContext, new Set())
    );
    return (
      remainingHelperDepth > 0 &&
      reachableInvocations?.length > 0 &&
      reachableInvocations.every((invocation) =>
        hasStraightLinePrefix(
          invocation,
          callsByStatement,
          safeStorageKeyUses,
          checker,
          proofContext,
          unresolvedPrecedingStatement,
          proofState,
          remainingHelperDepth - 1
        )
      )
    );
  }
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
      checker,
      proofContext,
      unresolvedPrecedingStatement,
      proofState,
      remainingHelperDepth
    )
  );
}

function deferredTryProof(
  call,
  checker,
  proofContext,
  requiredPrecedingStatement
) {
  if (proofContext.hasUnsafeBrowserStorageUse) {
    return undefined;
  }
  const tryBlock = call.statement.parent;
  const tryStatement = ts.isBlock(tryBlock) ? tryBlock.parent : undefined;
  const owner =
    tryStatement &&
    ts.isTryStatement(tryStatement) &&
    tryStatement.tryBlock === tryBlock
      ? containingNamedHelperOwner(tryStatement)
      : undefined;
  if (
    !owner ||
    !proofContext.eligibleHelperDeclarations.has(owner) ||
    owner.parent !== requiredPrecedingStatement.parent
  ) {
    return undefined;
  }
  const safePrefix = (statement) =>
    safePrecedingStatement(
      statement,
      proofContext.callsByStatement,
      proofContext.safeStorageKeyUses,
      checker,
      proofContext,
      { validatingHelperInvocations: new Set() }
    ) || passiveDeferredExitGuard(statement, checker);
  const callIndex = tryBlock.statements.indexOf(call.statement);
  const tryIndex = owner.body.statements.indexOf(tryStatement);
  const scope = owner.parent.statements;
  const declarationIndex = scope.indexOf(requiredPrecedingStatement);
  const ownerIndex = scope.indexOf(owner);
  if (
    callIndex < 0 ||
    tryIndex < 0 ||
    declarationIndex < 0 ||
    declarationIndex >= ownerIndex ||
    !scope.slice(0, declarationIndex).every(safePrefix) ||
    !tryBlock.statements.slice(0, callIndex).every(safePrefix) ||
    !owner.body.statements.slice(0, tryIndex).every(safePrefix)
  ) {
    return undefined;
  }
  const symbol = checker.getSymbolAtLocation(owner.name);
  const references = proofContext.identifiers.filter(
    (identifier) =>
      identifier !== owner.name &&
      !isFunctionDeclarationName(identifier) &&
      !isTypeOnlyReference(identifier) &&
      !isInsideDormantExecution(
        identifier,
        proofContext.dormantExecutionRegions
      ) &&
      identifierReferencesSymbol(checker, identifier, symbol)
  );
  const proven =
    references.length > 0 &&
    references.length <= helperProofCallLimit &&
    references.every((identifier) => {
      const statement = deferredHelperReferenceStatement(
        identifier,
        owner,
        checker
      );
      return (
        identifier.getStart() > requiredPrecedingStatement.getEnd() &&
        statement &&
        hasBoundedDeferredExecution(
          statement,
          owner,
          requiredPrecedingStatement,
          checker,
          proofContext,
          new Set()
        )
      );
    });
  return proven ? { referenceCount: references.length } : undefined;
}

const isInside = (node, root) => node.pos >= root.pos && node.end <= root.end;

function isOnceOnlyListenerOptions(options) {
  options = unwrapExpression(options);
  const property = ts.isObjectLiteralExpression(options)
    ? options.properties[0]
    : undefined;
  return Boolean(
    options.properties?.length === 1 &&
    property &&
    ts.isPropertyAssignment(property) &&
    property.name.text === "once" &&
    property.initializer.kind === ts.SyntaxKind.TrueKeyword
  );
}

function directGuardStatement(invocation, owner) {
  if (isInside(invocation, owner)) {
    return undefined;
  }
  let expression = invocation;
  while (true) {
    const parent = expression.parent;
    if (isTransparentExpressionWrapper(parent)) {
      expression = parent;
      continue;
    }
    if (
      ts.isPrefixUnaryExpression(parent) &&
      parent.operator === ts.SyntaxKind.ExclamationToken &&
      parent.operand === expression
    ) {
      expression = parent;
      continue;
    }
    return ts.isIfStatement(parent) && parent.expression === expression
      ? parent
      : undefined;
  }
}

const passiveEventType = (expression) =>
  staticStringValue(unwrapExpression(expression)) !== undefined ||
  ts.isIdentifier(unwrapExpression(expression));

function safeEventListener(invocation, callback, checker, onceOnly) {
  invocation = unwrapExpression(invocation);
  const actualCallback = callback ?? invocation.arguments?.[1];
  if (
    !ts.isCallExpression(invocation) ||
    ts.isOptionalChain(invocation) ||
    invocation.arguments.length !== 3 ||
    (callback && invocation.arguments[1] !== callback) ||
    (!ts.isIdentifier(actualCallback) &&
      !ts.isFunctionExpression(actualCallback) &&
      !ts.isArrowFunction(actualCallback)) ||
    actualCallback.parameters?.some(
      (parameter) =>
        parameter.initializer ||
        parameter.dotDotDotToken ||
        !ts.isIdentifier(parameter.name)
    ) ||
    !passiveEventType(invocation.arguments[0]) ||
    (onceOnly
      ? !isOnceOnlyListenerOptions(invocation.arguments[2])
      : !passiveExpression(invocation.arguments[2], checker) &&
        !isOnceOnlyListenerOptions(invocation.arguments[2])) ||
    (!ts.isPropertyAccessExpression(invocation.expression) &&
      !ts.isElementAccessExpression(invocation.expression)) ||
    staticPropertyName(invocation.expression) !== "addEventListener"
  ) {
    return false;
  }
  const receiver = invocation.expression.expression;
  return (
    ts.isIdentifier(receiver) &&
    ["window", "globalThis"].includes(receiver.text) &&
    isUnshadowedGlobal(checker, receiver)
  );
}

function deferredHelperReferenceStatement(identifier, owner, checker) {
  let expression = identifier;
  while (
    isTransparentExpressionWrapper(expression.parent) &&
    expression.parent.expression === expression
  ) {
    expression = expression.parent;
  }
  const invocation = expression.parent;
  if (
    ts.isCallExpression(invocation) &&
    invocation.expression === expression &&
    !ts.isOptionalChain(invocation) &&
    invocation.arguments.length === 0
  ) {
    const directInvocation = directFunctionInvocation(identifier);
    return directInvocation && !isInside(directInvocation.node, owner)
      ? directInvocation.statement
      : directGuardStatement(invocation, owner);
  }
  return safeEventListener(invocation, expression, checker, true)
    ? containingExpressionStatement(invocation)
    : undefined;
}

function deferredExitGuard(statement) {
  const exit =
    ts.isIfStatement(statement) && !statement.elseStatement
      ? statement.thenStatement
      : undefined;
  return Boolean(
    (exit && ts.isReturnStatement(exit) && !exit.expression) ||
    (exit &&
      ts.isBlock(exit) &&
      exit.statements.length === 1 &&
      ts.isReturnStatement(exit.statements[0]) &&
      !exit.statements[0].expression)
  );
}

function safeDeferredTryStatement(statement, checker, proofContext) {
  const catchStatements = ts.isTryStatement(statement)
    ? statement.catchClause?.block.statements
    : undefined;
  const safeReturn = (candidate) =>
    ts.isReturnStatement(candidate) &&
    candidate.expression &&
    passiveExpression(candidate.expression, checker);
  return Boolean(
    ts.isTryStatement(statement) &&
    !statement.finallyBlock &&
    statement.tryBlock.statements.length > 0 &&
    statement.tryBlock.statements.every(
      (candidate) =>
        proofContext.callsByStatement.has(candidate) || safeReturn(candidate)
    ) &&
    (!catchStatements || catchStatements.every(safeReturn))
  );
}

function safeDeferredHelperDeclaration(declaration, checker, proofContext) {
  return (
    proofContext.eligibleHelperDeclarations.has(declaration) &&
    declaration.body?.statements.length === 1 &&
    safeDeferredTryStatement(
      declaration.body.statements[0],
      checker,
      proofContext
    )
  );
}

function deferredExitGuardCondition(statement) {
  if (!deferredExitGuard(statement)) {
    return undefined;
  }
  let condition = unwrapExpression(statement.expression);
  if (
    ts.isPrefixUnaryExpression(condition) &&
    condition.operator === ts.SyntaxKind.ExclamationToken
  ) {
    condition = unwrapExpression(condition.operand);
  }
  return condition;
}

function deferredExitGuardCall(statement, checker) {
  const condition = deferredExitGuardCondition(statement);
  if (
    !condition ||
    !ts.isCallExpression(condition) ||
    !ts.isIdentifier(condition.expression)
  ) {
    return undefined;
  }
  const symbol = checker.getSymbolAtLocation(condition.expression);
  const declaration =
    symbol?.declarations?.length === 1 ? symbol.declarations[0] : undefined;
  return { condition, declaration, symbol };
}

function safeDeferredExitGuard(statement, checker, proofContext) {
  if (passiveDeferredExitGuard(statement, checker)) {
    return true;
  }
  const guard = deferredExitGuardCall(statement, checker);
  return (
    guard &&
    ((guard.condition.arguments.length === 0 &&
      guard.symbol?.declarations?.some((candidate) =>
        safeDeferredHelperDeclaration(candidate, checker, proofContext)
      )) ||
      (guard.declaration &&
        ts.isFunctionDeclaration(guard.declaration) &&
        guard.declaration.body &&
        guard.declaration.parameters.length ===
          guard.condition.arguments.length &&
        guard.declaration.parameters.every(
          (parameter) =>
            ts.isIdentifier(parameter.name) &&
            !parameter.initializer &&
            !parameter.dotDotDotToken
        ) &&
        guard.condition.arguments.every(
          (argument) => !hasUnprovenDeferredEffect(argument, checker)
        ) &&
        !hasUnprovenDeferredEffect(
          guard.declaration.body,
          checker,
          new Set([guard.declaration])
        )))
  );
}

function storageKeySymbol(statement, checker) {
  const declaration = ts.isVariableStatement(statement)
    ? statement.declarationList.declarations[0]
    : undefined;
  return ts.isIdentifier(declaration?.name)
    ? checker.getSymbolAtLocation(declaration.name)
    : undefined;
}

function readOnlyDeferredExitGuard(
  statement,
  checker,
  proofContext,
  requiredPrecedingStatement
) {
  const guard = deferredExitGuardCall(statement, checker);
  const keySymbol = storageKeySymbol(requiredPrecedingStatement, checker);
  return Boolean(
    keySymbol &&
    guard?.condition.arguments.length === 0 &&
    guard.symbol?.declarations?.some((declaration) => {
      if (!safeDeferredHelperDeclaration(declaration, checker, proofContext)) {
        return false;
      }
      const storageCalls = declaration.body.statements[0].tryBlock.statements
        .map((candidate) => proofContext.callsByStatement.get(candidate))
        .filter(Boolean);
      return (
        storageCalls.length > 0 &&
        storageCalls.every(
          (call) =>
            call.method === "getItem" &&
            ts.isIdentifier(call.key) &&
            identifierReferencesSymbol(checker, call.key, keySymbol)
        )
      );
    })
  );
}

function passiveDeferredExitGuard(statement, checker) {
  const condition = deferredExitGuardCondition(statement);
  const symbol =
    condition?.kind === ts.SyntaxKind.Identifier
      ? checker.getSymbolAtLocation(condition)
      : undefined;
  return (
    deferredExitGuard(statement) &&
    symbol?.declarations?.some(ts.isVariableDeclaration)
  );
}

function safeDeferredVariableStatement(statement, checker, proofContext) {
  const declaration =
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.length === 1
      ? statement.declarationList.declarations[0]
      : undefined;
  const initializer = unwrapExpression(declaration?.initializer);
  if (!initializer || !ts.isCallExpression(initializer)) {
    return false;
  }
  const callee = initializer.expression;
  const symbol = ts.isIdentifier(callee)
    ? checker.getSymbolAtLocation(callee)
    : undefined;
  return Boolean(
    ts.isIdentifier(declaration.name) &&
    ((initializer.arguments.length === 0 &&
      symbol?.declarations?.some((candidate) =>
        safeDeferredHelperDeclaration(candidate, checker, proofContext)
      )) ||
      (initializer.arguments.length === 1 &&
        passiveExpression(initializer.arguments[0], checker) &&
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "querySelector" &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "document" &&
        isUnshadowedGlobal(checker, callee.expression)))
  );
}

function safeDeferredListenerCallback(
  statement,
  checker,
  proofContext,
  requiredPrecedingStatement,
  position
) {
  const invocation = unwrapExpression(statement.expression);
  const callback = ts.isCallExpression(invocation)
    ? unwrapExpression(invocation.arguments[1])
    : undefined;
  const symbol = ts.isIdentifier(callback)
    ? checker.getSymbolAtLocation(callback)
    : undefined;
  const keySymbol = storageKeySymbol(requiredPrecedingStatement, checker);
  const declaration =
    symbol?.declarations?.length === 1 ? symbol.declarations[0] : undefined;
  const callbackBody =
    ts.isFunctionExpression(callback) || ts.isArrowFunction(callback)
      ? callback.body
      : declaration &&
          proofContext.eligibleHelperDeclarations.has(declaration) &&
          ts.isFunctionDeclaration(declaration)
        ? declaration.body
        : undefined;
  return Boolean(
    (position === "prefix" &&
      symbol?.declarations?.some(
        (candidate) =>
          proofContext.eligibleHelperDeclarations.has(candidate) &&
          candidate.body?.statements.every(
            (statement) =>
              passiveDeferredExitGuard(statement, checker) ||
              safeDeferredTryStatement(statement, checker, proofContext)
          )
      )) ||
    (keySymbol &&
      callbackBody &&
      !hasDeferredStorageHazard(callbackBody, checker, keySymbol, true))
  );
}

function safeDeferredScopeStatement(
  statement,
  checker,
  proofContext,
  listenerCallbackPosition,
  requiredPrecedingStatement
) {
  return (
    ts.isFunctionDeclaration(statement) ||
    safePrecedingStatement(
      statement,
      proofContext.callsByStatement,
      proofContext.safeStorageKeyUses,
      checker,
      proofContext,
      { validatingHelperInvocations: new Set() }
    ) ||
    safeDeferredVariableStatement(statement, checker, proofContext) ||
    (ts.isExpressionStatement(statement) &&
      safeEventListener(statement.expression, undefined, checker, false) &&
      (!listenerCallbackPosition ||
        safeDeferredListenerCallback(
          statement,
          checker,
          proofContext,
          requiredPrecedingStatement,
          listenerCallbackPosition
        )))
  );
}

function isLocalEffectTarget(target, checker, scopeRoot) {
  target = unwrapExpression(target);
  const declarations = ts.isIdentifier(target)
    ? checker.getSymbolAtLocation(target)?.declarations
    : undefined;
  return Boolean(
    declarations?.length &&
    declarations.every(
      (declaration) =>
        declaration.getSourceFile() === scopeRoot.getSourceFile() &&
        isInside(declaration, scopeRoot)
    )
  );
}

function hasUnprovenDeferredEffect(
  node,
  checker,
  visiting = new Set(),
  scopeRoot = node
) {
  const functionBody = (candidate) => {
    const callable =
      ts.isFunctionDeclaration(candidate) ||
      ts.isFunctionExpression(candidate) ||
      ts.isArrowFunction(candidate)
        ? candidate
        : ts.isVariableDeclaration(candidate)
          ? unwrapExpression(candidate.initializer)
          : undefined;
    if (
      !callable ||
      (!ts.isFunctionDeclaration(callable) &&
        !ts.isFunctionExpression(callable) &&
        !ts.isArrowFunction(callable)) ||
      visiting.has(candidate)
    ) {
      return undefined;
    }
    const next = new Set(visiting).add(candidate);
    return (
      callable.parameters.some(
        (parameter) =>
          parameter.initializer &&
          hasUnprovenDeferredEffect(
            parameter.initializer,
            checker,
            next,
            callable.body
          )
      ) ||
      hasUnprovenDeferredEffect(callable.body, checker, next, callable.body)
    );
  };
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  ) {
    return false;
  }
  if (
    ts.isTaggedTemplateExpression(node) ||
    ts.isAwaitExpression(node) ||
    ts.isYieldExpression(node) ||
    ts.isDeleteExpression(node) ||
    ts.isVoidExpression(node)
  ) {
    return true;
  }
  if (
    ts.isBinaryExpression(node) &&
    ts.isAssignmentOperator(node.operatorToken.kind)
  ) {
    return (
      !isLocalEffectTarget(node.left, checker, scopeRoot) ||
      hasUnprovenDeferredEffect(node.right, checker, visiting, scopeRoot)
    );
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(
      node.operator
    )
  ) {
    return !isLocalEffectTarget(node.operand, checker, scopeRoot);
  }
  if (ts.isNewExpression(node)) {
    return (
      !isTrustedBrowserInvocation(node, checker) ||
      Boolean(
        node.arguments?.some((argument) =>
          hasUnprovenDeferredEffect(argument, checker, visiting, scopeRoot)
        )
      )
    );
  }
  if (ts.isCallExpression(node)) {
    const callee = unwrapExpression(node.expression);
    if (callee.kind === ts.SyntaxKind.ImportKeyword) {
      return true;
    }
    if (
      node.arguments.some((argument) =>
        hasUnprovenDeferredEffect(argument, checker, visiting, scopeRoot)
      )
    ) {
      return true;
    }
    if (ts.isIdentifier(callee)) {
      const declarations = checker.getSymbolAtLocation(callee)?.declarations;
      return (
        declarations?.length !== 1 || functionBody(declarations[0]) !== false
      );
    }
    if (ts.isFunctionExpression(callee) || ts.isArrowFunction(callee)) {
      return functionBody(callee) !== false;
    }
    if (
      (ts.isPropertyAccessExpression(callee) ||
        ts.isElementAccessExpression(callee)) &&
      !isTrustedBrowserInvocation(node, checker)
    ) {
      return true;
    }
    return hasUnprovenDeferredEffect(callee, checker, visiting, scopeRoot);
  }
  let unsafe = false;
  ts.forEachChild(node, (child) => {
    unsafe ||= hasUnprovenDeferredEffect(child, checker, visiting, scopeRoot);
  });
  return unsafe;
}

function hasDeferredStorageHazard(
  node,
  checker,
  keySymbol,
  allowSameKeySet,
  visiting = new Set(),
  scopeRoot = node
) {
  const scan = (candidate, candidateScope = scopeRoot) =>
    hasDeferredStorageHazard(
      candidate,
      checker,
      keySymbol,
      allowSameKeySet,
      visiting,
      candidateScope
    );
  const scanArgument = (argument) => {
    argument = unwrapExpression(argument);
    return ts.isFunctionExpression(argument) || ts.isArrowFunction(argument)
      ? scan(argument.body, argument.body)
      : scan(argument);
  };
  const scanCallable = (candidate) => {
    const callable = ts.isVariableDeclaration(candidate)
      ? unwrapExpression(candidate.initializer)
      : candidate;
    if (
      (!ts.isFunctionDeclaration(callable) &&
        !ts.isFunctionExpression(callable) &&
        !ts.isArrowFunction(callable)) ||
      !callable.body ||
      visiting.has(candidate)
    ) {
      return true;
    }
    visiting.add(candidate);
    const hazard =
      callable.parameters.some(
        (parameter) =>
          parameter.initializer && scan(parameter.initializer, callable.body)
      ) || scan(callable.body, callable.body);
    visiting.delete(candidate);
    return hazard;
  };
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  ) {
    return false;
  }
  if (
    ts.isTaggedTemplateExpression(node) ||
    ts.isDeleteExpression(node) ||
    ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(
        node.operator
      ) &&
      !isLocalEffectTarget(node.operand, checker, scopeRoot))
  ) {
    return true;
  }
  if (
    ts.isBinaryExpression(node) &&
    ts.isAssignmentOperator(node.operatorToken.kind)
  ) {
    return (
      !isLocalEffectTarget(node.left, checker, scopeRoot) || scan(node.right)
    );
  }
  if (ts.isNewExpression(node)) {
    return (
      !isTrustedBrowserInvocation(node, checker) ||
      Boolean(node.arguments?.some(scanArgument))
    );
  }
  if (ts.isCallExpression(node)) {
    const callee = unwrapExpression(node.expression);
    if (
      callee.kind === ts.SyntaxKind.ImportKeyword ||
      node.arguments.some(scanArgument)
    ) {
      return true;
    }
    const storageCall = syntacticStorageCall(
      storageCallAccess(node, checker),
      checker
    );
    if (storageCall) {
      return !(
        storageCall.method === "getItem" ||
        (allowSameKeySet &&
          storageCall.method === "setItem" &&
          ts.isIdentifier(storageCall.key) &&
          identifierReferencesSymbol(checker, storageCall.key, keySymbol))
      );
    }
    if (ts.isIdentifier(callee)) {
      const declaration = checker.getSymbolAtLocation(callee)?.declarations;
      const callable = declaration?.length === 1 ? declaration[0] : undefined;
      if (
        !callable ||
        (!ts.isFunctionDeclaration(callable) &&
          !ts.isVariableDeclaration(callable))
      ) {
        return true;
      }
      return scanCallable(callable);
    }
    if (ts.isFunctionExpression(callee) || ts.isArrowFunction(callee)) {
      return scanCallable(callee);
    }
  }
  let hazard = false;
  ts.forEachChild(node, (child) => {
    hazard ||= scan(child);
  });
  return hazard;
}

function isMutationTarget(target) {
  while (isTransparentExpressionWrapper(target.parent)) {
    target = target.parent;
  }
  const parent = target.parent;
  return (
    (ts.isBinaryExpression(parent) &&
      parent.left === target &&
      ts.isAssignmentOperator(parent.operatorToken.kind)) ||
    ((ts.isPrefixUnaryExpression(parent) ||
      ts.isPostfixUnaryExpression(parent)) &&
      parent.operand === target) ||
    (ts.isDeleteExpression(parent) && parent.expression === target)
  );
}

function stableBrowserBindingInitializer(receiver, checker) {
  if (!ts.isIdentifier(receiver)) {
    return undefined;
  }
  const symbol = checker.getSymbolAtLocation(receiver);
  const declaration =
    symbol?.declarations?.length === 1 ? symbol.declarations[0] : undefined;
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    !declaration.initializer ||
    !(declaration.parent.flags & ts.NodeFlags.Const)
  ) {
    return undefined;
  }
  let stable = true;
  const visit = (node) => {
    if (
      stable &&
      ts.isIdentifier(node) &&
      node !== declaration.name &&
      identifierReferencesSymbol(checker, node, symbol)
    ) {
      let use = node;
      while (isTransparentExpressionWrapper(use.parent)) {
        use = use.parent;
      }
      const access = use.parent;
      if (
        (ts.isPropertyAccessExpression(access) ||
          ts.isElementAccessExpression(access)) &&
        access.expression === use
      ) {
        stable = !isMutationTarget(access);
      } else {
        while (
          ts.isPrefixUnaryExpression(use.parent) &&
          use.parent.operator === ts.SyntaxKind.ExclamationToken
        ) {
          use = use.parent;
        }
        stable = ts.isIfStatement(use.parent) && use.parent.expression === use;
      }
    }
    if (stable) {
      ts.forEachChild(node, visit);
    }
  };
  visit(receiver.getSourceFile());
  return stable ? unwrapExpression(declaration.initializer) : undefined;
}

function hasTrustedBrowserOrigin(initializer, globalName, method, checker) {
  if (!initializer || !ts.isCallExpression(initializer)) {
    return false;
  }
  const callee = unwrapExpression(initializer.expression);
  if (
    (ts.isPropertyAccessExpression(callee) ||
      ts.isElementAccessExpression(callee)) &&
    staticPropertyName(callee) === method
  ) {
    const receiver = unwrapExpression(callee.expression);
    return (
      ts.isIdentifier(receiver) &&
      receiver.text === globalName &&
      isUnshadowedGlobal(checker, receiver)
    );
  }
  return false;
}

function isTrustedBrowserInvocation(invocation, checker) {
  if (ts.isNewExpression(invocation)) {
    return (
      ts.isIdentifier(invocation.expression) &&
      invocation.expression.text === "URL" &&
      isUnshadowedGlobal(checker, invocation.expression)
    );
  }
  const callee = unwrapExpression(invocation.expression);
  if (
    !ts.isPropertyAccessExpression(callee) &&
    !ts.isElementAccessExpression(callee)
  ) {
    return false;
  }
  const method = staticPropertyName(callee);
  const receiver = unwrapExpression(callee.expression);
  if (method === "matchMedia") {
    return hasTrustedBrowserOrigin(invocation, "window", "matchMedia", checker);
  }
  if (method === "test") {
    return receiver.kind === ts.SyntaxKind.RegularExpressionLiteral;
  }
  const initializer = stableBrowserBindingInitializer(receiver, checker);
  if (method === "setAttribute") {
    return hasTrustedBrowserOrigin(
      initializer,
      "document",
      "querySelector",
      checker
    );
  }
  return (
    ["addEventListener", "addListener"].includes(method) &&
    hasTrustedBrowserOrigin(initializer, "window", "matchMedia", checker)
  );
}

function hasBoundedDeferredExecution(
  statement,
  storageOwner,
  requiredPrecedingStatement,
  checker,
  proofContext,
  visiting,
  guarded = false
) {
  const container = statement.parent;
  if (!ts.isSourceFile(container) && !ts.isBlock(container)) {
    return false;
  }
  const owner = container.parent;
  const bounded = (entry) =>
    entry &&
    hasBoundedDeferredExecution(
      entry,
      storageOwner,
      requiredPrecedingStatement,
      checker,
      proofContext,
      visiting,
      guarded
    );
  const statementIndex = container.statements.indexOf(statement);
  const requiredIndex = container.statements.indexOf(
    requiredPrecedingStatement
  );
  const prefixStart = requiredIndex >= 0 ? requiredIndex + 1 : 0;
  const prefix = container.statements.slice(prefixStart, statementIndex);
  if (
    statementIndex < prefixStart ||
    !prefix.every(
      (candidate) =>
        safeDeferredScopeStatement(
          candidate,
          checker,
          proofContext,
          "prefix",
          requiredPrecedingStatement
        ) || safeDeferredExitGuard(candidate, checker, proofContext)
    )
  ) {
    return false;
  }
  const registration =
    ts.isExpressionStatement(statement) &&
    safeEventListener(statement.expression, undefined, checker, false);
  if (
    registration &&
    !container.statements
      .slice(statementIndex + 1)
      .every(
        (candidate) =>
          safeDeferredScopeStatement(
            candidate,
            checker,
            proofContext,
            "suffix",
            requiredPrecedingStatement
          ) || !hasUnprovenDeferredEffect(candidate, checker)
      )
  ) {
    return false;
  }
  const keySymbol = storageKeySymbol(requiredPrecedingStatement, checker);
  if (
    !registration &&
    deferredExitGuardCall(statement, checker) &&
    keySymbol &&
    container.statements
      .slice(statementIndex + 1)
      .some((candidate) =>
        hasDeferredStorageHazard(candidate, checker, keySymbol, true)
      )
  ) {
    return false;
  }
  guarded ||= prefix.some((candidate) =>
    readOnlyDeferredExitGuard(
      candidate,
      checker,
      proofContext,
      requiredPrecedingStatement
    )
  );
  guarded ||= readOnlyDeferredExitGuard(
    statement,
    checker,
    proofContext,
    requiredPrecedingStatement
  );
  if (ts.isSourceFile(container)) {
    return true;
  }
  if (ts.isFunctionDeclaration(owner)) {
    if (
      owner === storageOwner ||
      visiting.has(owner) ||
      !proofContext.eligibleHelperDeclarations.has(owner)
    ) {
      return false;
    }
    visiting.add(owner);
    const invocations = proofContext.helperInvocations.get(owner);
    const result =
      invocations?.length > 0 &&
      invocations.every((invocation) => bounded(invocation.statement));
    visiting.delete(owner);
    return result;
  }
  const immediate = immediateInvocation(owner);
  if (immediate) {
    return Boolean(bounded(containingExecutionStatement(immediate)));
  }
  let callback = owner;
  while (
    isTransparentExpressionWrapper(callback.parent) &&
    callback.parent.expression === callback
  ) {
    callback = callback.parent;
  }
  const listener = callback.parent;
  const entry =
    safeEventListener(listener, callback, checker, true) ||
    (guarded && safeEventListener(listener, callback, checker, false))
      ? containingExpressionStatement(listener)
      : undefined;
  return Boolean(bounded(entry));
}

function hasUnsafeBrowserStorageUse(sourceFile, calls, checker) {
  const safeReceivers = new Set(
    calls.map((call) => call.node.expression.expression)
  );
  let unsafe = false;
  function visit(node) {
    if (unsafe || safeReceivers.has(node)) {
      return;
    }
    if (ts.isExpression(node) && browserStorageReceiver(node, checker)) {
      unsafe = true;
      return;
    }
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      ["window", "globalThis"].includes(node.expression.text) &&
      isUnshadowedGlobal(checker, node.expression) &&
      (staticPropertyName(node) === undefined ||
        ["Storage", "Function", "eval"].includes(staticPropertyName(node)))
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isIdentifier(node) &&
      ["Storage", "Function", "eval"].includes(node.text) &&
      !isTypeOnlyReference(node) &&
      isUnshadowedGlobal(checker, node)
    ) {
      unsafe = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return unsafe;
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

function collectDormantExecutionRegions(
  sourceFile,
  checker,
  identifiers,
  functionDeclarations,
  deferredClassMembers,
  boundFunctionExpressions
) {
  const dormantExecutionRegions = new Set();
  const hasLiveReference = (
    symbol,
    declarationName,
    skipFunctionNames,
    executionRegions = dormantExecutionRegions
  ) =>
    identifiers.some(
      (identifier) =>
        identifier !== declarationName &&
        (!skipFunctionNames || !isFunctionDeclarationName(identifier)) &&
        !isTypeOnlyReference(identifier) &&
        !isInsideDormantExecution(identifier, executionRegions) &&
        identifierReferencesSymbol(checker, identifier, symbol)
    );
  const deferredMembersByClass = new Map();
  for (const member of deferredClassMembers) {
    const classDeclaration = member.parent;
    if (!ts.isClassDeclaration(classDeclaration)) {
      continue;
    }
    const members = deferredMembersByClass.get(classDeclaration) ?? [];
    members.push(member);
    deferredMembersByClass.set(classDeclaration, members);
  }
  let foundDormantRegion;
  do {
    foundDormantRegion = false;
    for (const declaration of functionDeclarations) {
      if (
        dormantExecutionRegions.has(declaration) ||
        !declaration.name ||
        hasDecorators(declaration) ||
        declaration.parameters.some(hasDecorators) ||
        declaration.modifiers?.some(
          (modifier) =>
            modifier.kind === ts.SyntaxKind.ExportKeyword ||
            modifier.kind === ts.SyntaxKind.DefaultKeyword
        )
      ) {
        continue;
      }
      const symbol = checker.getSymbolAtLocation(declaration.name);
      const candidateRegions = new Set([
        ...dormantExecutionRegions,
        declaration,
      ]);
      if (
        symbol &&
        !symbolIsRuntimeExported(sourceFile, checker, symbol) &&
        !hasLiveReference(symbol, declaration.name, true, candidateRegions)
      ) {
        dormantExecutionRegions.add(declaration);
        foundDormantRegion = true;
      }
    }
    for (const [classDeclaration, members] of deferredMembersByClass) {
      if (
        !classDeclaration.name ||
        hasDecorators(classDeclaration) ||
        classDeclaration.modifiers?.some(
          (modifier) =>
            modifier.kind === ts.SyntaxKind.ExportKeyword ||
            modifier.kind === ts.SyntaxKind.DefaultKeyword
        )
      ) {
        continue;
      }
      const eligibleMembers = members.filter(
        (member) =>
          !hasDecorators(member) && !member.parameters?.some(hasDecorators)
      );
      if (
        eligibleMembers.length === 0 ||
        eligibleMembers.every((member) => dormantExecutionRegions.has(member))
      ) {
        continue;
      }
      const symbol = checker.getSymbolAtLocation(classDeclaration.name);
      const candidateRegions = new Set([
        ...dormantExecutionRegions,
        ...eligibleMembers,
      ]);
      if (
        symbol &&
        !symbolIsRuntimeExported(sourceFile, checker, symbol) &&
        !hasLiveReference(
          symbol,
          classDeclaration.name,
          false,
          candidateRegions
        )
      ) {
        for (const member of eligibleMembers) {
          if (!dormantExecutionRegions.has(member)) {
            dormantExecutionRegions.add(member);
            foundDormantRegion = true;
          }
        }
      }
    }
    for (const expression of boundFunctionExpressions) {
      if (dormantExecutionRegions.has(expression)) {
        continue;
      }
      const declaration = boundFunctionDeclaration(expression);
      if (
        !declaration ||
        !ts.isIdentifier(declaration.name) ||
        declarationIsExported(declaration)
      ) {
        continue;
      }
      const symbol = checker.getSymbolAtLocation(declaration.name);
      const candidateRegions = new Set([
        ...dormantExecutionRegions,
        expression,
      ]);
      if (
        symbol &&
        !symbolIsRuntimeExported(sourceFile, checker, symbol) &&
        !hasLiveReference(symbol, declaration.name, false, candidateRegions)
      ) {
        dormantExecutionRegions.add(expression);
        foundDormantRegion = true;
      }
    }
  } while (foundDormantRegion);
  return dormantExecutionRegions;
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
  const boundFunctionExpressions = [];
  const calls = [];
  const deferredClassMembers = [];
  const functionDeclarations = [];
  const variableStatements = [];
  function visit(node) {
    if (ts.isIdentifier(node)) {
      identifiers.push(node);
    }
    if (ts.isVariableStatement(node)) {
      variableStatements.push(node);
    }
    if (ts.isFunctionDeclaration(node)) {
      functionDeclarations.push(node);
    }
    if (isDeferredClassMember(node)) {
      deferredClassMembers.push(node);
    }
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      boundFunctionDeclaration(node)
    ) {
      boundFunctionExpressions.push(node);
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
  const dormantExecutionRegions = collectDormantExecutionRegions(
    sourceFile,
    checker,
    identifiers,
    functionDeclarations,
    deferredClassMembers,
    boundFunctionExpressions
  );
  const helperInvocations = new Map();
  const eligibleHelperDeclarations = new Set();
  for (const declaration of functionDeclarations) {
    const symbol = eligibleHelperSymbol(declaration, sourceFile, checker);
    if (!symbol) {
      continue;
    }
    eligibleHelperDeclarations.add(declaration);
    const invocations = identifiers
      .filter(
        (identifier) =>
          identifier !== declaration.name &&
          !isFunctionDeclarationName(identifier) &&
          !isTypeOnlyReference(identifier) &&
          !isInsideDormantExecution(identifier, dormantExecutionRegions) &&
          identifierReferencesSymbol(checker, identifier, symbol)
      )
      .map(directFunctionInvocation);
    if (invocations.length > 0 && invocations.every(Boolean)) {
      helperInvocations.set(declaration, invocations);
    }
  }
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
      references.every((identifier) => storageUses.has(identifier))
    ) {
      candidates.push({ declaration, initializer, references });
    }
  }

  const safeStorageKeyUses = new Set();
  const helperDeclarationsByInvocation = new Map(
    [...helperInvocations].flatMap(([declaration, invocations]) =>
      invocations.map((invocation) => [invocation.statement, declaration])
    )
  );
  const proofContext = {
    callsByStatement,
    checker,
    dormantExecutionRegions,
    eligibleHelperDeclarations,
    hasUnsafeBrowserStorageUse: hasUnsafeBrowserStorageUse(
      sourceFile,
      calls,
      checker
    ),
    helperDeclarationsByInvocation,
    helperInvocations,
    identifiers,
    safeStorageKeyUses,
  };
  const candidateRecords = [];
  const pendingCandidates = new Set(candidates);
  let provedCandidate;
  do {
    provedCandidate = false;
    for (const candidate of pendingCandidates) {
      const deferredTryProofs = candidate.references.map((identifier) =>
        deferredTryProof(
          storageUses.get(identifier),
          checker,
          proofContext,
          candidate.declaration.parent.parent
        )
      );
      const allReferencesHaveSafeDeferredTryPrefixes =
        deferredTryProofs.every(Boolean) &&
        deferredTryProofs.reduce(
          (sum, proof) => sum + proof.referenceCount,
          0
        ) <= helperProofCallLimit;
      const targetExecutions = [];
      for (const identifier of candidate.references) {
        targetExecutions.push(
          ...proofTargetExecutions(storageUses.get(identifier), proofContext)
        );
      }
      const helperExecutionCount = helperExecutionCountThroughTargets(
        sourceFile,
        targetExecutions,
        proofContext
      );
      if (
        helperExecutionCount > helperProofCallLimit &&
        !(
          helperExecutionCount === Number.POSITIVE_INFINITY &&
          allReferencesHaveSafeDeferredTryPrefixes
        )
      ) {
        pendingCandidates.delete(candidate);
        continue;
      }
      const provenReferences = [];
      const pendingReferences = new Set(candidate.references);
      let provedReference;
      do {
        provedReference = false;
        for (const identifier of pendingReferences) {
          safeStorageKeyUses.add(identifier);
          const call = storageUses.get(identifier);
          if (
            hasStraightLinePrefix(
              call,
              callsByStatement,
              safeStorageKeyUses,
              checker,
              proofContext,
              candidate.declaration.parent.parent
            ) ||
            deferredTryProof(
              call,
              checker,
              proofContext,
              candidate.declaration.parent.parent
            )
          ) {
            pendingReferences.delete(identifier);
            provenReferences.push(identifier);
            provedReference = true;
          } else {
            safeStorageKeyUses.delete(identifier);
          }
        }
      } while (provedReference && pendingReferences.size > 0);
      if (pendingReferences.size === 0) {
        candidateRecords.push({
          literal: candidate.initializer,
          typeRoots: [
            candidate.declaration,
            ...candidate.references.map(
              (identifier) => storageUses.get(identifier).node
            ),
          ],
        });
        pendingCandidates.delete(candidate);
        provedCandidate = true;
      } else {
        for (const identifier of provenReferences) {
          safeStorageKeyUses.delete(identifier);
        }
      }
    }
  } while (provedCandidate);

  const directCallRecords = calls
    .filter(
      (call) =>
        storageKeyLiteral(call.key) &&
        helperExecutionCountThroughTargets(
          sourceFile,
          proofTargetExecutions(call, proofContext),
          proofContext
        ) <= helperProofCallLimit &&
        hasStraightLinePrefix(
          call,
          callsByStatement,
          safeStorageKeyUses,
          checker,
          proofContext
        )
    )
    .map((call) => ({
      literal: storageKeyLiteral(call.key),
      typeRoots: [call.node],
    }));

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

function replaceExemptions(source, exemptions) {
  for (const exemption of exemptions.sort(
    (left, right) => right.start - left.start
  )) {
    source =
      source.slice(0, exemption.start) +
      "__secpal_storage_identifier__" +
      source.slice(exemption.end);
  }
  return source;
}

function executableScriptType(rawType) {
  const type = (rawType ?? "").split(";", 1)[0].trim().toLowerCase();
  const module = type === "module";
  return {
    executable:
      module ||
      type === "" ||
      javascriptMimeTypes.has(type) ||
      type.includes("&"),
    module,
  };
}

function htmlAttributes(node) {
  return new Map(
    node.attrs.map(({ name, prefix, value }) => [
      prefix ? `${prefix}:${name}` : name,
      value,
    ])
  );
}

function htmlAttributeValueRange(source, location) {
  if (!location) return undefined;
  const attribute = source.slice(location.startOffset, location.endOffset);
  const equals = attribute.indexOf("=");
  if (equals === -1) return undefined;
  let start = equals + 1;
  while (/\s/.test(attribute[start] ?? "")) start += 1;
  const quote = attribute[start];
  if (quote === '"' || quote === "'") {
    start += 1;
    const end = attribute.lastIndexOf(quote);
    return {
      end: location.startOffset + (end > start ? end : attribute.length),
      start: location.startOffset + start,
    };
  }
  return { end: location.endOffset, start: location.startOffset + start };
}

function decodeHtmlCharacterReferences(value) {
  let decoded = "";
  for (let index = 0; index < value.length;) {
    if (value[index] !== "&") {
      decoded += value[index];
      index += 1;
      continue;
    }

    const decodedReference = [];
    const decoder = new EntityDecoder(htmlDecodeTree, (codePoint) =>
      decodedReference.push(codePoint)
    );
    decoder.startEntity(DecodingMode.Attribute);
    let consumed = decoder.write(value, index + 1);
    if (consumed === -1) consumed = decoder.end();
    if (decodedReference.length === 0 || consumed <= 0) {
      decoded += value[index];
      index += 1;
      continue;
    }
    for (const codePoint of decodedReference) {
      const character = String.fromCodePoint(codePoint);
      decoded += character;
    }
    index += consumed;
  }
  return decoded;
}

function javascriptUrlBody(value) {
  const normalized = value.replace(/[\t\n\r]/g, "");
  const scheme = normalized.match(/^[\u0000-\u0020]*javascript:/i);
  if (!scheme) return undefined;
  const body = normalized.slice(scheme[0].length);
  try {
    return decodeURIComponent(body);
  } catch {
    return body;
  }
}

function executableHtmlAttributes(node, source) {
  const location = node.sourceCodeLocation;
  if (!location?.attrs) return [];
  const attributes = [];
  for (const { name, prefix } of node.attrs) {
    const attributeName = prefix ? `${prefix}:${name}` : name;
    const attributeLocation = location.attrs[attributeName];
    const valueLocation = htmlAttributeValueRange(source, attributeLocation);
    const eventHandler = attributeName.startsWith("on");
    const urlAttribute = [
      "href",
      "xlink:href",
      "src",
      "action",
      "formaction",
    ].includes(attributeName);
    if (!valueLocation || (!eventHandler && !urlAttribute)) continue;
    const decoded = decodeHtmlCharacterReferences(
      source.slice(valueLocation.start, valueLocation.end)
    );
    const decodedUrlBody = eventHandler
      ? undefined
      : javascriptUrlBody(decoded);
    attributes.push({
      analyzable: eventHandler || decodedUrlBody !== undefined,
      decoded: eventHandler ? decoded : (decodedUrlBody ?? decoded),
      line: attributeLocation.startLine,
      sourceEnd: valueLocation.end,
      sourceStart: valueLocation.start,
    });
  }
  return attributes;
}

function executableHtmlScript(node, source) {
  const location = node.sourceCodeLocation;
  if (
    node.tagName !== "script" ||
    ![htmlNamespace, svgNamespace].includes(node.namespaceURI) ||
    !location?.startTag
  ) {
    return undefined;
  }
  const attributes = htmlAttributes(node);
  const type = executableScriptType(attributes.get("type"));
  if (!type.executable) {
    return undefined;
  }
  const start = location.startTag.endOffset;
  const end = location.endTag?.startOffset ?? location.endOffset;
  const svg = node.namespaceURI === svgNamespace;
  const textChildren = node.childNodes.filter(
    (child) => child.nodeName === "#text"
  );
  return {
    async: !svg && attributes.has("async"),
    content: svg
      ? textChildren.map((child) => child.value).join("")
      : source.slice(start, end),
    defer: !svg && attributes.has("defer"),
    external: svg
      ? attributes.has("href") || attributes.has("xlink:href")
      : attributes.has("src"),
    line: location.startTag.endLine,
    module: type.module,
    noModule: !svg && !type.module && attributes.has("nomodule"),
    ranges: svg
      ? textChildren
          .filter((child) => child.sourceCodeLocation)
          .map(({ sourceCodeLocation: child }) => ({
            end: child.endOffset,
            start: child.startOffset,
          }))
      : [{ end, start }],
  };
}

function parsedHtmlDocument(source) {
  const attributes = [];
  const scripts = [];
  const embeddedDocuments = [];
  const excludedRanges = [];
  const root = parseHtml(source, {
    scriptingEnabled: true,
    sourceCodeLocationInfo: true,
  });
  const visit = (node) => {
    if (node.namespaceURI === htmlNamespace && node.tagName === "iframe") {
      const attributes = htmlAttributes(node);
      const location = node.sourceCodeLocation?.attrs?.srcdoc;
      if (attributes.has("srcdoc") && location) {
        const srcdoc = attributes.get("srcdoc");
        embeddedDocuments.push({ line: location.startLine, source: srcdoc });
        excludedRanges.push({
          end: location.endOffset,
          start: location.startOffset,
        });
      }
    }
    for (const attribute of executableHtmlAttributes(node, source)) {
      attributes.push(attribute);
      excludedRanges.push({
        end: attribute.sourceEnd,
        start: attribute.sourceStart,
      });
    }
    const script = executableHtmlScript(node, source);
    if (script) {
      scripts.push(script);
      if (!script.external) {
        excludedRanges.push(...script.ranges);
      }
      return;
    }
    for (const child of node.childNodes ?? []) {
      visit(child);
    }
  };
  visit(root);
  return { attributes, embeddedDocuments, excludedRanges, scripts };
}

function syntheticHtmlSource(entries) {
  const mappings = [];
  let synthetic = "";
  for (const entry of entries) {
    synthetic += entry.module ? "(() => {\n" : "";
    const syntheticStart = synthetic.length;
    synthetic += entry.script.content;
    mappings.push({
      executionIndex: mappings.length,
      script: entry.script,
      syntheticEnd: synthetic.length,
      syntheticStart,
    });
    synthetic += entry.module ? "\n})();\n" : "\n;\n";
  }
  return { mappings, synthetic };
}

function mappedHtmlExemptions(document, entries, analysisIndex) {
  const { mappings, synthetic } = syntheticHtmlSource(entries);
  const file = `${document}.secpal-html-analysis-${analysisIndex}.js`;
  const sources = new Map([[file, synthetic]]);
  syntheticHtmlScopes.set(file, mappings);
  const program = makeProgram([], sources, ts.ModuleDetectionKind.Legacy);
  const mapped = [];
  const exemptions = parserExemptions(file, program, program.getTypeChecker());
  for (const item of exemptions) {
    const mapping = mappings.find(
      ({ syntheticEnd, syntheticStart }) =>
        item.start >= syntheticStart && item.end <= syntheticEnd
    );
    if (mapping) {
      mapped.push({
        end: item.end - mapping.syntheticStart,
        script: mapping.script,
        start: item.start - mapping.syntheticStart,
      });
    }
  }
  return mapped;
}

function sanitizedHtmlScripts(document, scripts) {
  const exemptions = new Map(scripts.map((script) => [script, new Map()]));
  let analysisIndex = 0;
  const addAnalysis = (entries, targetScript) => {
    const mapped = mappedHtmlExemptions(document, entries, analysisIndex);
    for (const exemption of mapped) {
      if (targetScript && exemption.script !== targetScript) {
        continue;
      }
      const ranges = exemptions.get(exemption.script);
      ranges.set(`${exemption.start}:${exemption.end}`, exemption);
    }
    analysisIndex += 1;
  };

  const analyzeClassicScripts = (legacyOnly) => {
    const entries = [];
    let prefixBlocked = false;
    for (const script of scripts) {
      if (script.module) {
        if (!legacyOnly && script.async) {
          prefixBlocked = true;
        }
        continue;
      }
      if (script.external) {
        if (script.async || !script.defer) {
          prefixBlocked = true;
        }
        continue;
      }
      entries.push({ module: false, script });
      if (!prefixBlocked && (!legacyOnly || script.noModule)) {
        addAnalysis(entries, legacyOnly ? script : undefined);
      }
    }
    return entries;
  };

  const classicEntries = analyzeClassicScripts(false);
  analyzeClassicScripts(true);

  const modulePrefix = classicEntries.filter(({ script }) => !script.noModule);
  let modulePrefixBlocked = scripts.some(
    (script) =>
      !script.noModule &&
      ((script.async && (script.external || script.module)) ||
        (script.external && !script.module && !script.defer))
  );
  for (const script of scripts) {
    if (
      !script.noModule &&
      script.external &&
      (script.module || script.defer)
    ) {
      modulePrefixBlocked = true;
      continue;
    }
    if (script.module && !script.async) {
      modulePrefix.push({ module: true, script });
      if (!modulePrefixBlocked) {
        addAnalysis(modulePrefix);
      }
    }
  }

  for (const script of scripts) {
    if (
      script.module &&
      script.async &&
      !script.external &&
      scripts.every((candidate) => candidate === script || candidate.noModule)
    ) {
      addAnalysis([{ module: true, script }]);
    }
  }

  return scripts
    .filter((script) => !script.external)
    .map((script) => ({
      ...script,
      content: replaceExemptions(script.content, [
        ...exemptions.get(script).values(),
      ]),
    }));
}

function sanitizedHtmlAttribute(document, attribute, scripts, analysisIndex) {
  if (
    !attribute.analyzable ||
    scripts.some((script) => script.external || script.async)
  ) {
    return attribute.decoded;
  }
  const prefix = "(()=>{\n";
  const file = `${document}.secpal-html-attribute-${analysisIndex}.js`;
  const scriptPrefix = syntheticHtmlSource(
    scripts.map((script) => ({ module: script.module, script }))
  ).synthetic;
  const attributeStart = scriptPrefix.length + prefix.length;
  const program = makeProgram(
    [],
    new Map([[file, `${scriptPrefix}${prefix}${attribute.decoded}\n})();`]]),
    ts.ModuleDetectionKind.Legacy
  );
  const exemptions = parserExemptions(file, program, program.getTypeChecker())
    .map(({ end, start }) => ({
      end: end - attributeStart,
      start: start - attributeStart,
    }))
    .filter(({ end, start }) => start >= 0 && end <= attribute.decoded.length);
  return replaceExemptions(attribute.decoded, exemptions);
}

function replaceStorageKeysOutsideRanges(source, ranges) {
  let result = "";
  let start = 0;
  for (const range of ranges.sort((left, right) => left.start - right.start)) {
    result += replaceNonSourceStorageKeys(source.slice(start, range.start));
    result += source.slice(range.start, range.end).replace(/[^\n]/g, "");
    start = range.end;
  }
  return result + replaceNonSourceStorageKeys(source.slice(start));
}

function htmlAnalysisSources(source, document) {
  const outputs = [];
  const pending = [{ document, lineOffset: 0, source }];
  let embeddedIndex = 0;
  for (const current of pending) {
    const parsed = parsedHtmlDocument(current.source);
    outputs.push({
      lineOffset: current.lineOffset,
      source: replaceStorageKeysOutsideRanges(
        current.source,
        parsed.excludedRanges
      ),
    });
    const scripts = sanitizedHtmlScripts(current.document, parsed.scripts);
    for (const script of scripts) {
      outputs.push({
        lineOffset: current.lineOffset + script.line - 1,
        source: script.content,
      });
    }
    for (const [index, attribute] of parsed.attributes.entries()) {
      outputs.push({
        lineOffset: current.lineOffset + attribute.line - 1,
        source: sanitizedHtmlAttribute(
          current.document,
          attribute,
          parsed.scripts,
          index
        ),
      });
    }
    for (const embedded of parsed.embeddedDocuments) {
      pending.push({
        document: `${document}.secpal-srcdoc-${embeddedIndex}`,
        lineOffset: current.lineOffset + embedded.line - 1,
        source: embedded.source,
      });
      embeddedIndex += 1;
    }
  }
  return outputs;
}

function makeProgram(
  sourceFiles,
  virtualSources,
  moduleDetection = ts.ModuleDetectionKind.Force
) {
  const options = {
    allowJs: true,
    checkJs: true,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleDetection,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  };
  const host = ts.createCompilerHost(options, true);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (file) => virtualSources.has(file) || fileExists(file);
  host.readFile = (file) => virtualSources.get(file) ?? readFile(file);
  host.getSourceFile = (file, languageVersion) => {
    const source = virtualSources.get(file);
    return source === undefined
      ? getSourceFile(file, languageVersion)
      : ts.createSourceFile(
          file,
          source,
          languageVersion,
          true,
          ts.ScriptKind.JS
        );
  };
  return ts.createProgram(
    [...sourceFiles, ...virtualSources.keys()],
    options,
    host
  );
}

const files = process.argv.slice(2);
const sourceFiles = files.filter((file) =>
  sourceExtensionPattern.test(extname(file))
);
const htmlSources = new Map();
for (const file of files) {
  if (!htmlExtensionPattern.test(extname(file))) {
    continue;
  }
  const source = readFileSync(file, "utf8");
  htmlSources.set(file, htmlAnalysisSources(source, resolve(file)));
}
const program = makeProgram(sourceFiles, new Map());
const checker = program.getTypeChecker();

for (const file of files) {
  let source = readFileSync(file, "utf8");
  let analyzedSources;
  if (sourceExtensionPattern.test(extname(file))) {
    source = replaceExemptions(
      source,
      parserExemptions(file, program, checker)
    );
    analyzedSources = [{ lineOffset: 0, source }];
  } else {
    analyzedSources = htmlSources.get(file) ?? [
      { lineOffset: 0, source: replaceNonSourceStorageKeys(source) },
    ];
  }

  for (const analyzed of analyzedSources) {
    analyzed.source.split("\n").forEach((line, index) => {
      if (secpalDomainPattern.test(line)) {
        process.stdout.write(
          `${file}:${analyzed.lineOffset + index + 1}:${line}\n`
        );
      }
    });
  }
}
