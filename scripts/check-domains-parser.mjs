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
const secpalDomainPattern = /secpal\.[A-Za-z0-9.-]{1,100}/;
const approvedSecPalDomainPattern =
  /(?<![A-Za-z0-9.-])(?:(?:changelog|apk)\.secpal\.app|secpal\.app|(?:\*\.|\.)?(?:[A-Za-z0-9-]+\.)*secpal\.dev)(?=$|[^A-Za-z0-9._-]|\.[^A-Za-z0-9_-]|\.$)/g;
const sourceExtensionPattern = /^\.(?:[cm]?[jt]sx?)$/;
const htmlExtensionPattern = /^\.html?$/;
const syntheticHtmlScopes = new Map();
const helperProofCallLimit = 8;
const browserStorageKinds = new Set(["localStorage", "sessionStorage"]);
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
  return remainingTargets.size === 0 ? helperCalls : Number.POSITIVE_INFINITY;
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
  for (const declaration of functionDeclarations) {
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
      continue;
    }
    const symbol = checker.getSymbolAtLocation(declaration.name);
    if (
      !symbol ||
      !isSingleFunctionImplementation(symbol, declaration) ||
      symbolIsRuntimeExported(sourceFile, checker, symbol)
    ) {
      continue;
    }
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
    helperDeclarationsByInvocation,
    helperInvocations,
    safeStorageKeyUses,
  };
  const candidateRecords = [];
  const pendingCandidates = new Set(candidates);
  let provedCandidate;
  do {
    provedCandidate = false;
    for (const candidate of pendingCandidates) {
      const targetExecutions = [];
      for (const identifier of candidate.references) {
        targetExecutions.push(
          ...proofTargetExecutions(storageUses.get(identifier), proofContext)
        );
      }
      if (
        helperExecutionCountThroughTargets(
          sourceFile,
          targetExecutions,
          proofContext
        ) > helperProofCallLimit
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

function htmlSpace(character) {
  return character !== undefined && /[\t\n\f\r ]/.test(character);
}

function tagEnd(source, start) {
  let quote;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return undefined;
}

function htmlAttributes(source, start, end) {
  const attributes = new Map();
  let index = start;
  while (index < end) {
    while (htmlSpace(source[index]) || source[index] === "/") {
      index += 1;
    }
    const nameStart = index;
    while (
      index < end &&
      !htmlSpace(source[index]) &&
      !["/", "=", ">"].includes(source[index])
    ) {
      index += 1;
    }
    if (index === nameStart) {
      index += 1;
      continue;
    }
    const name = source.slice(nameStart, index).toLowerCase();
    while (htmlSpace(source[index])) {
      index += 1;
    }
    let value = "";
    if (source[index] === "=") {
      index += 1;
      while (htmlSpace(source[index])) {
        index += 1;
      }
      const quote = source[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < end && source[index] !== quote) {
          index += 1;
        }
        value = source.slice(valueStart, index);
        if (source[index] === quote) {
          index += 1;
        }
      } else {
        const valueStart = index;
        while (
          index < end &&
          !htmlSpace(source[index]) &&
          source[index] !== ">"
        ) {
          index += 1;
        }
        value = source.slice(valueStart, index);
      }
    }
    if (!attributes.has(name)) {
      attributes.set(name, value);
    }
  }
  return attributes;
}

function decodeHtmlType(value) {
  const namedCharacters = new Map([
    ["amp", "&"],
    ["apos", "'"],
    ["colon", ":"],
    ["equals", "="],
    ["gt", ">"],
    ["lt", "<"],
    ["period", "."],
    ["quot", '"'],
    ["semi", ";"],
    ["sol", "/"],
  ]);
  return value.replace(
    /&#(?:x([\da-f]+)|(\d+));?|&([a-z]+);/gi,
    (reference, hexadecimal, decimal, named) => {
      if (hexadecimal || decimal) {
        const codePoint = Number.parseInt(
          hexadecimal ?? decimal,
          hexadecimal ? 16 : 10
        );
        return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : reference;
      }
      return namedCharacters.get(named.toLowerCase()) ?? reference;
    }
  );
}

function executableScriptType(rawType) {
  if (rawType === undefined || rawType.trim() === "") {
    return { executable: true, module: false };
  }
  const type = decodeHtmlType(rawType).split(";", 1)[0].trim().toLowerCase();
  if (type === "module") {
    return { executable: true, module: true };
  }
  if (javascriptMimeTypes.has(type)) {
    return { executable: true, module: false };
  }
  return { executable: type.includes("&"), module: false };
}

function executableHtmlScripts(source) {
  const scripts = [];
  const lowerSource = source.toLowerCase();
  let index = 0;
  while (index < source.length) {
    const tagStart = source.indexOf("<", index);
    if (tagStart === -1) {
      break;
    }
    if (source.startsWith("<!--", tagStart)) {
      const commentEnd = source.indexOf("-->", tagStart + 4);
      index = commentEnd === -1 ? source.length : commentEnd + 3;
      continue;
    }
    const isScript =
      lowerSource.startsWith("<script", tagStart) &&
      (htmlSpace(source[tagStart + 7]) ||
        ["/", ">"].includes(source[tagStart + 7]));
    if (!isScript) {
      const nextCharacter = source[tagStart + 1];
      const markupStart =
        nextCharacter !== undefined && /[A-Za-z!/?]/.test(nextCharacter);
      const end = markupStart ? tagEnd(source, tagStart + 1) : undefined;
      index = end === undefined ? tagStart + 1 : end + 1;
      continue;
    }
    const openingEnd = tagEnd(source, tagStart + 7);
    if (openingEnd === undefined) {
      break;
    }
    const attributes = htmlAttributes(source, tagStart + 7, openingEnd);
    const type = executableScriptType(attributes.get("type"));
    const contentStart = openingEnd + 1;
    let closingStart = lowerSource.indexOf("</script", contentStart);
    while (
      closingStart !== -1 &&
      !(
        htmlSpace(source[closingStart + 8]) ||
        ["/", ">"].includes(source[closingStart + 8])
      )
    ) {
      closingStart = lowerSource.indexOf("</script", closingStart + 8);
    }
    const contentEnd = closingStart === -1 ? source.length : closingStart;
    if (type.executable) {
      scripts.push({
        async: attributes.has("async"),
        defer: attributes.has("defer"),
        end: contentEnd,
        external: attributes.has("src"),
        module: type.module,
        start: contentStart,
      });
    }
    if (closingStart === -1) {
      break;
    }
    const closingEnd = tagEnd(source, closingStart + 8);
    index = closingEnd === undefined ? source.length : closingEnd + 1;
  }
  return scripts;
}

function syntheticHtmlSource(source, entries) {
  const mappings = [];
  let synthetic = "";
  for (const entry of entries) {
    synthetic += entry.module ? "(() => {\n" : "";
    const syntheticStart = synthetic.length;
    synthetic += source.slice(entry.script.start, entry.script.end);
    mappings.push({
      executionIndex: mappings.length,
      sourceStart: entry.script.start,
      syntheticEnd: synthetic.length,
      syntheticStart,
    });
    synthetic += entry.module ? "\n})();\n" : "\n;\n";
  }
  return { mappings, synthetic };
}

function mappedHtmlExemptions(source, document, entries, analysisIndex) {
  const { mappings, synthetic } = syntheticHtmlSource(source, entries);
  const file = `${document}.secpal-html-analysis-${analysisIndex}.js`;
  const sources = new Map([[file, synthetic]]);
  syntheticHtmlScopes.set(file, mappings);
  const program = createDomainProgram(
    [],
    sources,
    ts.ModuleDetectionKind.Legacy
  );
  return parserExemptions(file, program, program.getTypeChecker()).flatMap(
    (exemption) => {
      const mapping = mappings.find(
        (candidate) =>
          exemption.start >= candidate.syntheticStart &&
          exemption.end <= candidate.syntheticEnd
      );
      return mapping
        ? [
            {
              end: mapping.sourceStart + exemption.end - mapping.syntheticStart,
              start:
                mapping.sourceStart + exemption.start - mapping.syntheticStart,
            },
          ]
        : [];
    }
  );
}

function htmlParserExemptions(source, document, scripts) {
  const exemptions = new Map();
  let analysisIndex = 0;
  const addAnalysis = (entries) => {
    for (const exemption of mappedHtmlExemptions(
      source,
      document,
      entries,
      analysisIndex
    )) {
      exemptions.set(`${exemption.start}:${exemption.end}`, exemption);
    }
    analysisIndex += 1;
  };

  const classicEntries = [];
  let classicPrefixBlocked = false;
  for (const script of scripts) {
    if (script.external) {
      if (script.async || (!script.module && !script.defer)) {
        classicPrefixBlocked = true;
      }
      continue;
    }
    if (script.module) {
      continue;
    }
    classicEntries.push({ module: false, script });
    if (!classicPrefixBlocked) {
      addAnalysis(classicEntries);
    }
  }

  if (!scripts.some((script) => script.external)) {
    const modulePrefix = [...classicEntries];
    for (const script of scripts) {
      if (!script.module) {
        continue;
      }
      modulePrefix.push({ module: true, script });
      addAnalysis(modulePrefix);
    }
  }

  return [...exemptions.values()];
}

function replaceStorageKeysOutsideScripts(source, scripts) {
  let result = "";
  let start = 0;
  for (const script of scripts) {
    result += replaceNonSourceStorageKeys(source.slice(start, script.start));
    result += source.slice(script.start, script.end);
    start = script.end;
  }
  return result + replaceNonSourceStorageKeys(source.slice(start));
}

function createDomainProgram(
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
const htmlScripts = new Map();
for (const file of files) {
  if (!htmlExtensionPattern.test(extname(file))) {
    continue;
  }
  const source = readFileSync(file, "utf8");
  const document = resolve(file);
  const scripts = executableHtmlScripts(source);
  htmlScripts.set(file, {
    exemptions: htmlParserExemptions(source, document, scripts),
    scripts,
  });
}
const program = createDomainProgram(sourceFiles, new Map());
const checker = program.getTypeChecker();

for (const file of files) {
  let source = readFileSync(file, "utf8");
  if (sourceExtensionPattern.test(extname(file))) {
    source = replaceExemptions(
      source,
      parserExemptions(file, program, checker)
    );
  } else {
    const html = htmlScripts.get(file);
    source = replaceExemptions(source, html?.exemptions ?? []);
    source = html
      ? replaceStorageKeysOutsideScripts(
          source,
          executableHtmlScripts(source).filter((script) => !script.external)
        )
      : replaceNonSourceStorageKeys(source);
  }

  source.split("\n").forEach((line, index) => {
    if (secpalDomainPattern.test(line)) {
      process.stdout.write(`${file}:${index + 1}:${line}\n`);
    }
  });
}
