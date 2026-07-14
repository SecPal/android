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
const browserStorageKinds = ["localStorage", "sessionStorage"];
const storageMutatingMethods = new Map([
  [
    "Object",
    ["assign", "defineProperties", "defineProperty", "setPrototypeOf"],
  ],
  ["Reflect", ["defineProperty", "deleteProperty", "set", "setPrototypeOf"]],
]);
const unreachableCodeDiagnostic = 7027;
const unreachableRanges = new WeakMap();
const executionHazards = new WeakMap();
const sourceCheckers = new WeakMap();

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

function functionLikeDefersChild(functionLike, child) {
  return !(
    (functionLike.name === child && ts.isComputedPropertyName(child)) ||
    ts.isDecorator(child)
  );
}

function doBodyMaySkipCondition(statement, checker) {
  let skipsCondition = false;

  function visit(node, catchesThrows = false, nestedBreakable = false) {
    if (skipsCondition || isCompilerUnreachable(node)) {
      return;
    }
    if (node !== statement && ts.isFunctionLike(node)) {
      return;
    }
    if (ts.isThrowStatement(node)) {
      skipsCondition = !catchesThrows;
      return;
    }
    if (ts.isReturnStatement(node)) {
      skipsCondition = true;
      return;
    }
    if (ts.isBreakStatement(node)) {
      skipsCondition = Boolean(node.label) || !nestedBreakable;
      return;
    }
    if (ts.isContinueStatement(node)) {
      skipsCondition = Boolean(node.label);
      return;
    }
    if (
      ts.isExpressionStatement(node) &&
      expressionAbruptCompletion(node.expression, checker).throws
    ) {
      skipsCondition = !catchesThrows;
      return;
    }
    if (ts.isTryStatement(node)) {
      if (node.finallyBlock) {
        visit(node.finallyBlock, catchesThrows, nestedBreakable);
      }
      visit(
        node.tryBlock,
        catchesThrows || Boolean(node.catchClause),
        nestedBreakable
      );
      if (node.catchClause) {
        visit(node.catchClause.block, catchesThrows, nestedBreakable);
      }
      return;
    }
    const childIsNestedBreakable =
      node !== statement &&
      (ts.isSwitchStatement(node) ||
        ts.isWhileStatement(node) ||
        ts.isDoStatement(node) ||
        ts.isForStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForOfStatement(node));
    ts.forEachChild(node, (child) =>
      visit(child, catchesThrows, nestedBreakable || childIsNestedBreakable)
    );
  }

  visit(statement);
  return skipsCondition;
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
          ts.SyntaxKind.AmpersandAmpersandEqualsToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.BarBarEqualsToken,
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.QuestionQuestionEqualsToken,
        ].includes(ancestor.operatorToken.kind) &&
        ancestor.right === child) ||
      (ts.isCallExpression(ancestor) &&
        ts.isCallChain(ancestor) &&
        ancestor.arguments.includes(child)) ||
      (ts.isElementAccessExpression(ancestor) &&
        ts.isOptionalChain(ancestor) &&
        ancestor.argumentExpression === child) ||
      (ts.isWhileStatement(ancestor) && ancestor.statement === child) ||
      (ts.isDoStatement(ancestor) &&
        ancestor.expression === child &&
        doBodyMaySkipCondition(
          ancestor.statement,
          sourceCheckers.get(node.getSourceFile())
        )) ||
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
    if (
      (ts.isFunctionLike(ancestor) &&
        functionLikeDefersChild(ancestor, child)) ||
      ts.isSourceFile(ancestor)
    ) {
      return false;
    }
    child = ancestor;
  }
  return false;
}

function expressionAbruptCompletion(expression, checker, visiting = new Set()) {
  expression = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(expression)) {
    return expressionAbruptCompletion(expression.expression, checker, visiting);
  }
  if (ts.isElementAccessExpression(expression)) {
    const receiver = expressionAbruptCompletion(
      expression.expression,
      checker,
      visiting
    );
    return receiver.always || !expression.argumentExpression
      ? receiver
      : expressionAbruptCompletion(
          expression.argumentExpression,
          checker,
          visiting
        );
  }
  if (
    ts.isPrefixUnaryExpression(expression) ||
    ts.isPostfixUnaryExpression(expression)
  ) {
    return expressionAbruptCompletion(expression.operand, checker, visiting);
  }
  if (
    ts.isDeleteExpression(expression) ||
    ts.isTypeOfExpression(expression) ||
    ts.isVoidExpression(expression) ||
    ts.isAwaitExpression(expression)
  ) {
    return expressionAbruptCompletion(expression.expression, checker, visiting);
  }
  if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
    const calleeCompletion = expressionAbruptCompletion(
      expression.expression,
      checker,
      visiting
    );
    if (calleeCompletion.always) {
      return calleeCompletion;
    }
    for (const argument of expression.arguments ?? []) {
      const argumentCompletion = expressionAbruptCompletion(
        ts.isSpreadElement(argument) ? argument.expression : argument,
        checker,
        visiting
      );
      if (argumentCompletion.always) {
        return argumentCompletion;
      }
    }
    const functions = directlyCalledFunctions(expression.expression, checker);
    if (
      functions.length > 0 &&
      functions.every((functionLike) => {
        if (!functionLike.body || visiting.has(functionLike)) {
          return false;
        }
        const nextVisiting = new Set(visiting).add(functionLike);
        const completion = ts.isBlock(functionLike.body)
          ? abruptCompletion(functionLike.body, checker, nextVisiting)
          : expressionAbruptCompletion(
              functionLike.body,
              checker,
              nextVisiting
            );
        return completion.always && completion.throws;
      })
    ) {
      return { always: true, uncatchable: false, throws: true };
    }
  }
  if (ts.isConditionalExpression(expression)) {
    const whenTrue = expressionAbruptCompletion(
      expression.whenTrue,
      checker,
      visiting
    );
    const whenFalse = expressionAbruptCompletion(
      expression.whenFalse,
      checker,
      visiting
    );
    return {
      always: whenTrue.always && whenFalse.always,
      uncatchable: whenTrue.uncatchable && whenFalse.uncatchable,
      throws: whenTrue.throws && whenFalse.throws,
    };
  }
  if (ts.isBinaryExpression(expression)) {
    const left = expressionAbruptCompletion(expression.left, checker, visiting);
    if (left.always) {
      return left;
    }
    if (
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.AmpersandAmpersandEqualsToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.BarBarEqualsToken,
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.QuestionQuestionEqualsToken,
      ].includes(expression.operatorToken.kind)
    ) {
      return { always: false, uncatchable: false, throws: false };
    }
    return expressionAbruptCompletion(expression.right, checker, visiting);
  }
  if (
    ts.isArrayLiteralExpression(expression) ||
    ts.isObjectLiteralExpression(expression) ||
    ts.isTemplateExpression(expression) ||
    ts.isTaggedTemplateExpression(expression) ||
    ts.isJsxElement(expression) ||
    ts.isJsxSelfClosingElement(expression)
  ) {
    for (const step of eagerEvaluationSteps(expression) ?? []) {
      for (const operation of step.operations) {
        const completion = evaluationAbruptCompletion(
          operation,
          checker,
          visiting
        );
        if (completion.always) {
          return completion;
        }
      }
    }
    if (ts.isTaggedTemplateExpression(expression)) {
      const functions = directlyCalledFunctions(expression.tag, checker);
      if (
        functions.length > 0 &&
        functions.every((functionLike) => {
          if (!functionLike.body || visiting.has(functionLike)) {
            return false;
          }
          const nextVisiting = new Set(visiting).add(functionLike);
          const completion = ts.isBlock(functionLike.body)
            ? abruptCompletion(functionLike.body, checker, nextVisiting)
            : expressionAbruptCompletion(
                functionLike.body,
                checker,
                nextVisiting
              );
          return completion.always && completion.throws;
        })
      ) {
        return { always: true, uncatchable: false, throws: true };
      }
    }
  }
  if (ts.isClassExpression(expression)) {
    const operations = classEvaluationOperations(expression);
    if (operations) {
      for (const operation of operations) {
        const completion = evaluationAbruptCompletion(
          operation,
          checker,
          visiting
        );
        if (completion.always) {
          return completion;
        }
      }
    }
  }
  return { always: false, uncatchable: false, throws: false };
}

function eagerObjectElementExpressions(element) {
  const expressions = [];
  if (element.name && ts.isComputedPropertyName(element.name)) {
    expressions.push(element.name);
  }
  if (ts.isPropertyAssignment(element)) {
    expressions.push(element.initializer);
  } else if (
    ts.isShorthandPropertyAssignment(element) &&
    element.objectAssignmentInitializer
  ) {
    expressions.push(element.objectAssignmentInitializer);
  } else if (ts.isSpreadAssignment(element)) {
    expressions.push(element);
  }
  return expressions;
}

function arrayElementExpressions(element) {
  if (ts.isOmittedExpression(element)) {
    return [];
  }
  return [element];
}

function callArgumentExpressions(argument) {
  return [argument];
}

function jsxAttributeExpressions(attribute) {
  if (ts.isJsxSpreadAttribute(attribute)) {
    return [attribute];
  }
  const initializer = attribute.initializer;
  if (!initializer || ts.isStringLiteral(initializer)) {
    return [];
  }
  return ts.isJsxExpression(initializer) && initializer.expression
    ? [initializer.expression]
    : [];
}

function jsxChildExpressions(child) {
  if (ts.isJsxExpression(child)) {
    return child.expression ? [child.expression] : [];
  }
  return ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)
    ? [child]
    : [];
}

function evaluationStep(owner, operations) {
  return { operations, owner };
}

function isWithinNode(node, root) {
  for (let current = node; current; current = current.parent) {
    if (current === root) {
      return true;
    }
  }
  return false;
}

function decoratorsFor(node) {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function classHeritageExpressions(node) {
  return (node.heritageClauses ?? [])
    .filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
    .flatMap((clause) => clause.types.map((type) => type.expression));
}

function computedClassNameOperation(member) {
  return member.name && ts.isComputedPropertyName(member.name)
    ? member.name
    : undefined;
}

function staticClassInitialization(member) {
  if (ts.isClassStaticBlockDeclaration(member)) {
    return member.body;
  }
  return ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static &&
    ts.isPropertyDeclaration(member) &&
    member.initializer
    ? member.initializer
    : undefined;
}

function classEvaluationPhases(node) {
  if (
    decoratorsFor(node).length > 0 ||
    node.members.some((member) => decoratorsFor(member).length > 0)
  ) {
    return undefined;
  }
  return {
    heritage: classHeritageExpressions(node),
    members: node.members.map((member) => ({
      computedName: computedClassNameOperation(member),
      staticInitialization: staticClassInitialization(member),
    })),
  };
}

function classEvaluationOperations(node) {
  const phases = classEvaluationPhases(node);
  return phases
    ? [
        ...phases.heritage,
        ...phases.members.flatMap(({ computedName }) =>
          computedName ? [computedName] : []
        ),
        ...phases.members.flatMap(({ staticInitialization }) =>
          staticInitialization ? [staticInitialization] : []
        ),
      ]
    : undefined;
}

function classPrecedingEvaluation(node, child, target) {
  const phases = classEvaluationPhases(node);
  if (!phases) {
    return { operations: [], proven: false };
  }

  const heritageClauseIndex = node.heritageClauses?.indexOf(child) ?? -1;
  if (heritageClauseIndex >= 0) {
    const precedingHeritageExpressions = (node.heritageClauses ?? [])
      .slice(0, heritageClauseIndex)
      .filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
      .flatMap((clause) => clause.types.map((type) => type.expression));
    return { operations: precedingHeritageExpressions, proven: true };
  }

  const memberIndex = node.members.indexOf(child);
  if (memberIndex < 0) {
    return { operations: [], proven: false };
  }
  const member = node.members[memberIndex];
  const targetIsComputedName =
    member.name &&
    ts.isComputedPropertyName(member.name) &&
    isWithinNode(target, member.name);
  const computedNameExpressions = phases.members
    .slice(0, targetIsComputedName ? memberIndex : node.members.length)
    .flatMap(({ computedName }) => (computedName ? [computedName] : []));
  if (targetIsComputedName) {
    return {
      operations: [...phases.heritage, ...computedNameExpressions],
      proven: true,
    };
  }
  const precedingStaticInitializations = phases.members
    .slice(0, memberIndex)
    .flatMap(({ staticInitialization }) =>
      staticInitialization ? [staticInitialization] : []
    );
  return {
    operations: [
      ...phases.heritage,
      ...computedNameExpressions,
      ...precedingStaticInitializations,
    ],
    proven: true,
  };
}

function eagerEvaluationSteps(node) {
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    return [
      evaluationStep(node.expression, [node.expression]),
      ...(node.arguments ?? []).map((argument) =>
        evaluationStep(argument, callArgumentExpressions(argument))
      ),
    ];
  }
  if (ts.isElementAccessExpression(node)) {
    return [
      evaluationStep(node.expression, [node.expression]),
      ...(node.argumentExpression
        ? [evaluationStep(node.argumentExpression, [node.argumentExpression])]
        : []),
    ];
  }
  if (ts.isBinaryExpression(node)) {
    return [
      evaluationStep(node.left, [node.left]),
      evaluationStep(node.right, [node.right]),
    ];
  }
  if (ts.isConditionalExpression(node)) {
    return [
      evaluationStep(node.condition, [node.condition]),
      evaluationStep(node.whenTrue, [node.whenTrue]),
      evaluationStep(node.whenFalse, [node.whenFalse]),
    ];
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) =>
      evaluationStep(element, arrayElementExpressions(element))
    );
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.map((property) =>
      evaluationStep(property, eagerObjectElementExpressions(property))
    );
  }
  if (ts.isVariableDeclarationList(node)) {
    return node.declarations.map((declaration) =>
      evaluationStep(
        declaration,
        declaration.initializer ? [declaration.initializer] : []
      )
    );
  }
  if (ts.isPropertyAssignment(node)) {
    return [
      ...(ts.isComputedPropertyName(node.name)
        ? [evaluationStep(node.name, [node.name])]
        : []),
      evaluationStep(node.initializer, [node.initializer]),
    ];
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.map((span) => evaluationStep(span, [span]));
  }
  if (ts.isTaggedTemplateExpression(node)) {
    return [
      evaluationStep(node.tag, [node.tag]),
      evaluationStep(node.template, [node.template]),
    ];
  }
  if (ts.isJsxAttributes(node)) {
    return node.properties.map((attribute) =>
      evaluationStep(attribute, jsxAttributeExpressions(attribute))
    );
  }
  if (ts.isJsxElement(node)) {
    return [
      evaluationStep(node.openingElement, [node.openingElement]),
      ...node.children.map((child) =>
        evaluationStep(child, jsxChildExpressions(child))
      ),
      evaluationStep(node.closingElement, []),
    ];
  }
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    return [
      evaluationStep(node.tagName, [node.tagName]),
      evaluationStep(
        node.attributes,
        node.attributes.properties.flatMap(jsxAttributeExpressions)
      ),
    ];
  }
  if (ts.isSwitchStatement(node)) {
    return [
      evaluationStep(node.expression, [node.expression]),
      evaluationStep(node.caseBlock, []),
    ];
  }
  if (ts.isForStatement(node)) {
    const initializerExpressions = ts.isVariableDeclarationList(
      node.initializer
    )
      ? node.initializer.declarations.flatMap((declaration) =>
          declaration.initializer ? [declaration.initializer] : []
        )
      : node.initializer
        ? [node.initializer]
        : [];
    return [
      ...(node.initializer
        ? [evaluationStep(node.initializer, initializerExpressions)]
        : []),
      ...(node.condition
        ? [evaluationStep(node.condition, [node.condition])]
        : []),
      ...(node.incrementor
        ? [evaluationStep(node.incrementor, [node.incrementor])]
        : []),
      evaluationStep(node.statement, []),
    ];
  }
  return undefined;
}

function precedingEvaluation(ancestor, child, target) {
  if (ts.isClassLike(ancestor)) {
    return classPrecedingEvaluation(ancestor, child, target);
  }
  const steps = eagerEvaluationSteps(ancestor);
  if (!steps) {
    return { operations: [], proven: true };
  }
  const childIndex = steps.findIndex((step) => step.owner === child);
  if (childIndex < 0) {
    return { operations: [], proven: false };
  }
  return {
    operations: steps.slice(0, childIndex).flatMap((step) => step.operations),
    proven: true,
  };
}

function functionReturnExpressions(functionLike) {
  if (!functionLike.body) {
    return [];
  }
  if (!ts.isBlock(functionLike.body)) {
    return [functionLike.body];
  }
  const expressions = [];
  function visit(node) {
    if (node !== functionLike.body && ts.isFunctionLike(node)) {
      return;
    }
    if (ts.isReturnStatement(node)) {
      if (node.expression) {
        expressions.push(node.expression);
      }
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(functionLike.body);
  return expressions;
}

function valueDefinitions(expression, checker, visiting = new Set()) {
  expression = unwrapExpression(expression);
  if (ts.isIdentifier(expression)) {
    const symbol = checker.getSymbolAtLocation(expression);
    if (!symbol || visiting.has(symbol)) {
      return [expression];
    }
    const nextVisiting = new Set(visiting).add(symbol);
    const definitions = (symbol.declarations ?? []).flatMap((declaration) => {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return valueDefinitions(declaration.initializer, checker, nextVisiting);
      }
      return ts.isClassDeclaration(declaration) ||
        ts.isFunctionDeclaration(declaration)
        ? [declaration]
        : [];
    });
    return definitions.length > 0 ? definitions : [expression];
  }
  if (ts.isCallExpression(expression)) {
    const definitions = directlyCalledFunctions(
      expression.expression,
      checker
    ).flatMap((functionLike) =>
      functionReturnExpressions(functionLike).flatMap((returned) =>
        valueDefinitions(returned, checker, visiting)
      )
    );
    return definitions.length > 0 ? definitions : [expression];
  }
  if (ts.isNewExpression(expression)) {
    const constructor = unwrapExpression(expression.expression);
    const symbol = checker.getSymbolAtLocation(constructor);
    const definitions = (symbol?.declarations ?? []).filter(
      (declaration) =>
        ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration)
    );
    return definitions.length > 0 ? definitions : [expression];
  }
  return [expression];
}

function valueMembers(expression, checker) {
  return valueDefinitions(expression, checker).flatMap((definition) => {
    if (ts.isObjectLiteralExpression(definition)) {
      return [...definition.properties];
    }
    if (ts.isClassDeclaration(definition) || ts.isClassExpression(definition)) {
      return [...definition.members];
    }
    return [];
  });
}

function wellKnownMemberName(name, checker) {
  if (!name || !ts.isComputedPropertyName(name)) {
    return undefined;
  }
  const expression = unwrapExpression(name.expression);
  if (
    (!ts.isPropertyAccessExpression(expression) &&
      !ts.isElementAccessExpression(expression)) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== "Symbol" ||
    !isUnshadowedGlobal(checker, expression.expression)
  ) {
    return undefined;
  }
  return staticPropertyName(expression);
}

function valueHasMember(expression, checker, memberName, wellKnown = false) {
  return valueMembers(expression, checker).some((member) => {
    const name = member.name;
    return wellKnown
      ? wellKnownMemberName(name, checker) === memberName
      : name && staticDeclarationName(name) === memberName;
  });
}

function valueHasGetter(expression, checker) {
  return valueMembers(expression, checker).some(ts.isGetAccessorDeclaration);
}

function propertyAccessIsProvenData(expression, checker) {
  const location = ts.isPropertyAccessExpression(expression)
    ? expression.name
    : expression.argumentExpression;
  if (!location) {
    return false;
  }
  const declarations =
    checker.getSymbolAtLocation(location)?.declarations ?? [];
  return (
    declarations.length > 0 &&
    declarations.every(
      (declaration) => !ts.isGetAccessorDeclaration(declaration)
    )
  );
}

function valueIsDefinitelyPrimitive(expression, checker) {
  const definitions = valueDefinitions(expression, checker);
  return (
    definitions.length > 0 &&
    definitions.every((definition) => {
      definition = unwrapExpression(definition);
      return (
        ts.isStringLiteral(definition) ||
        ts.isNoSubstitutionTemplateLiteral(definition) ||
        ts.isNumericLiteral(definition) ||
        ts.isBigIntLiteral(definition) ||
        definition.kind === ts.SyntaxKind.TrueKeyword ||
        definition.kind === ts.SyntaxKind.FalseKeyword ||
        definition.kind === ts.SyntaxKind.NullKeyword ||
        ts.isTemplateExpression(definition) ||
        ts.isTypeOfExpression(definition) ||
        ts.isDeleteExpression(definition) ||
        ts.isVoidExpression(definition) ||
        ts.isPrefixUnaryExpression(definition) ||
        ts.isPostfixUnaryExpression(definition) ||
        (ts.isIdentifier(definition) &&
          definition.text === "undefined" &&
          isUnshadowedGlobal(checker, definition))
      );
    })
  );
}

function valueIsProvenIterable(expression, checker) {
  const definitions = valueDefinitions(expression, checker);
  return (
    definitions.length > 0 &&
    definitions.every((definition) => {
      definition = unwrapExpression(definition);
      return (
        ts.isArrayLiteralExpression(definition) ||
        ts.isStringLiteral(definition) ||
        ts.isNoSubstitutionTemplateLiteral(definition)
      );
    })
  );
}

function valueIsProvenPlainObject(expression, checker) {
  const definitions = valueDefinitions(expression, checker);
  return (
    definitions.length > 0 &&
    definitions.every(
      (definition) =>
        ts.isObjectLiteralExpression(definition) &&
        definition.properties.every(
          (property) =>
            !ts.isGetAccessorDeclaration(property) &&
            !ts.isSpreadAssignment(property)
        )
    )
  );
}

function valueIsProvenMatcher(expression, checker) {
  const definitions = valueDefinitions(expression, checker);
  return (
    definitions.length > 0 &&
    definitions.every(
      (definition) =>
        ts.isClassDeclaration(definition) ||
        ts.isClassExpression(definition) ||
        ts.isFunctionDeclaration(definition) ||
        ts.isFunctionExpression(definition) ||
        ts.isArrowFunction(definition)
    )
  );
}

function binaryHasUnprovenCoercion(expression, checker) {
  const operator = expression.operatorToken.kind;
  if (operator === ts.SyntaxKind.InstanceOfKeyword) {
    return (
      valueHasMember(expression.right, checker, "hasInstance", true) ||
      !valueIsProvenMatcher(expression.right, checker)
    );
  }
  if (operator === ts.SyntaxKind.InKeyword) {
    return (
      !valueIsDefinitelyPrimitive(expression.left, checker) ||
      !valueIsProvenPlainObject(expression.right, checker)
    );
  }
  if (
    [
      ts.SyntaxKind.PlusToken,
      ts.SyntaxKind.PlusEqualsToken,
      ts.SyntaxKind.MinusToken,
      ts.SyntaxKind.MinusEqualsToken,
      ts.SyntaxKind.AsteriskToken,
      ts.SyntaxKind.AsteriskEqualsToken,
      ts.SyntaxKind.AsteriskAsteriskToken,
      ts.SyntaxKind.AsteriskAsteriskEqualsToken,
      ts.SyntaxKind.SlashToken,
      ts.SyntaxKind.SlashEqualsToken,
      ts.SyntaxKind.PercentToken,
      ts.SyntaxKind.PercentEqualsToken,
      ts.SyntaxKind.LessThanToken,
      ts.SyntaxKind.LessThanEqualsToken,
      ts.SyntaxKind.GreaterThanToken,
      ts.SyntaxKind.GreaterThanEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
      ts.SyntaxKind.LessThanLessThanToken,
      ts.SyntaxKind.LessThanLessThanEqualsToken,
      ts.SyntaxKind.GreaterThanGreaterThanToken,
      ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
      ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
      ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
      ts.SyntaxKind.AmpersandToken,
      ts.SyntaxKind.AmpersandEqualsToken,
      ts.SyntaxKind.BarToken,
      ts.SyntaxKind.BarEqualsToken,
      ts.SyntaxKind.CaretToken,
      ts.SyntaxKind.CaretEqualsToken,
    ].includes(operator)
  ) {
    return (
      !valueIsDefinitelyPrimitive(expression.left, checker) ||
      !valueIsDefinitelyPrimitive(expression.right, checker)
    );
  }
  return false;
}

function assignmentTargetHasUnprovenImplicitExecution(
  target,
  checker,
  visiting
) {
  target = unwrapExpression(target);
  if (ts.isIdentifier(target)) {
    return false;
  }
  if (
    !ts.isPropertyAccessExpression(target) &&
    !ts.isElementAccessExpression(target)
  ) {
    return true;
  }
  if (
    operationHasUnprovenImplicitExecution(
      target.expression,
      checker,
      visiting
    ) ||
    (target.argumentExpression &&
      (operationHasUnprovenImplicitExecution(
        target.argumentExpression,
        checker,
        visiting
      ) ||
        !valueIsDefinitelyPrimitive(target.argumentExpression, checker)))
  ) {
    return true;
  }
  return (
    !browserStorageKind(target.expression, checker) &&
    !valueIsProvenPlainObject(target.expression, checker)
  );
}

function isProvenIntrinsicCall(expression, checker) {
  if (
    !ts.isCallExpression(expression) ||
    (!ts.isPropertyAccessExpression(expression.expression) &&
      !ts.isElementAccessExpression(expression.expression))
  ) {
    return false;
  }
  if (
    ["getItem", "setItem", "removeItem"].includes(
      staticPropertyName(expression.expression) ?? ""
    ) &&
    browserStorageKind(expression.expression.expression, checker)
  ) {
    return true;
  }
  if (
    staticPropertyName(expression.expression) !== "getPrototypeOf" ||
    !intrinsicObjectName(expression.expression.expression, checker) ||
    !expression.arguments[0]
  ) {
    return false;
  }
  return Boolean(browserStorageKind(expression.arguments[0], checker));
}

function operationHasUnprovenImplicitExecution(
  operation,
  checker,
  visiting = new Set()
) {
  if (ts.isComputedPropertyName(operation)) {
    return (
      operationHasUnprovenImplicitExecution(
        operation.expression,
        checker,
        visiting
      ) || !valueIsDefinitelyPrimitive(operation.expression, checker)
    );
  }
  if (ts.isSpreadElement(operation)) {
    return (
      operationHasUnprovenImplicitExecution(
        operation.expression,
        checker,
        visiting
      ) || !valueIsProvenIterable(operation.expression, checker)
    );
  }
  if (ts.isSpreadAssignment(operation) || ts.isJsxSpreadAttribute(operation)) {
    return (
      operationHasUnprovenImplicitExecution(
        operation.expression,
        checker,
        visiting
      ) ||
      valueHasGetter(operation.expression, checker) ||
      !valueIsProvenPlainObject(operation.expression, checker)
    );
  }
  if (ts.isTemplateSpan(operation)) {
    return (
      operationHasUnprovenImplicitExecution(
        operation.expression,
        checker,
        visiting
      ) || !valueIsDefinitelyPrimitive(operation.expression, checker)
    );
  }

  const expression = unwrapExpression(operation);
  if (
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  ) {
    return (
      operationHasUnprovenImplicitExecution(
        expression.expression,
        checker,
        visiting
      ) ||
      (expression.argumentExpression
        ? operationHasUnprovenImplicitExecution(
            expression.argumentExpression,
            checker,
            visiting
          )
        : false) ||
      !propertyAccessIsProvenData(expression, checker)
    );
  }
  if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
    const provenIntrinsicCall = isProvenIntrinsicCall(expression, checker);
    const invocationIsProven = ts.isCallExpression(expression)
      ? provenIntrinsicCall ||
        callTargetIsProvenFunction(expression.expression, checker)
      : valueIsProvenMatcher(expression.expression, checker);
    return (
      !invocationIsProven ||
      (!provenIntrinsicCall &&
        operationHasUnprovenImplicitExecution(
          expression.expression,
          checker,
          visiting
        )) ||
      (expression.arguments ?? []).some((argument) =>
        operationHasUnprovenImplicitExecution(argument, checker, visiting)
      ) ||
      calledFunctionsHaveUnprovenImplicitExecution(
        expression.expression,
        checker,
        visiting
      )
    );
  }
  if (ts.isBinaryExpression(expression)) {
    const leftHasUnprovenExecution =
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
        ? assignmentTargetHasUnprovenImplicitExecution(
            expression.left,
            checker,
            visiting
          )
        : operationHasUnprovenImplicitExecution(
            expression.left,
            checker,
            visiting
          );
    return (
      leftHasUnprovenExecution ||
      operationHasUnprovenImplicitExecution(
        expression.right,
        checker,
        visiting
      ) ||
      binaryHasUnprovenCoercion(expression, checker)
    );
  }
  if (
    ts.isPrefixUnaryExpression(expression) ||
    ts.isPostfixUnaryExpression(expression)
  ) {
    return (
      operationHasUnprovenImplicitExecution(
        expression.operand,
        checker,
        visiting
      ) ||
      ([
        ts.SyntaxKind.PlusToken,
        ts.SyntaxKind.MinusToken,
        ts.SyntaxKind.TildeToken,
      ].includes(expression.operator) &&
        !valueIsDefinitelyPrimitive(expression.operand, checker))
    );
  }
  if (
    ts.isDeleteExpression(expression) ||
    ts.isTypeOfExpression(expression) ||
    ts.isVoidExpression(expression) ||
    ts.isAwaitExpression(expression)
  ) {
    return operationHasUnprovenImplicitExecution(
      expression.expression,
      checker,
      visiting
    );
  }
  if (ts.isClassExpression(expression)) {
    const operations = classEvaluationOperations(expression);
    return (
      !operations ||
      operations.some((nested) =>
        operationHasUnprovenImplicitExecution(nested, checker, visiting)
      )
    );
  }
  if (
    ts.isArrayLiteralExpression(expression) ||
    ts.isObjectLiteralExpression(expression) ||
    ts.isTemplateExpression(expression) ||
    ts.isTaggedTemplateExpression(expression) ||
    ts.isJsxElement(expression) ||
    ts.isJsxSelfClosingElement(expression)
  ) {
    return (
      (eagerEvaluationSteps(expression) ?? []).some((step) =>
        step.operations.some((nested) =>
          operationHasUnprovenImplicitExecution(nested, checker, visiting)
        )
      ) ||
      (ts.isTaggedTemplateExpression(expression) &&
        (!callTargetIsProvenFunction(expression.tag, checker) ||
          calledFunctionsHaveUnprovenImplicitExecution(
            expression.tag,
            checker,
            visiting
          )))
    );
  }
  return false;
}

function calledFunctionsHaveUnprovenImplicitExecution(
  expression,
  checker,
  visiting
) {
  return directlyCalledFunctions(expression, checker).some(
    (functionLike) =>
      visiting.has(functionLike) ||
      functionLikeHasUnprovenImplicitExecution(
        functionLike,
        checker,
        new Set(visiting).add(functionLike)
      )
  );
}

function functionLikeHasUnprovenImplicitExecution(
  functionLike,
  checker,
  visiting
) {
  if (!functionLike.body) {
    return true;
  }
  if (
    functionLike.parameters.some((parameter) =>
      parameterPreventsExecutionProof(parameter, checker, visiting)
    )
  ) {
    return true;
  }
  if (!ts.isBlock(functionLike.body)) {
    return operationHasUnprovenImplicitExecution(
      functionLike.body,
      checker,
      visiting
    );
  }

  let returnValueIsUnproven = false;
  function visitReturns(node) {
    if (
      returnValueIsUnproven ||
      (node !== functionLike.body && ts.isFunctionLike(node))
    ) {
      return;
    }
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      operationHasUnprovenImplicitExecution(node.expression, checker, visiting)
    ) {
      returnValueIsUnproven = true;
      return;
    }
    ts.forEachChild(node, visitReturns);
  }
  visitReturns(functionLike.body);
  if (returnValueIsUnproven) {
    return true;
  }

  for (const statement of functionLike.body.statements) {
    const completion = abruptCompletion(statement, checker, visiting);
    if (completion.always && !completion.throws) {
      return false;
    }
    if (statementPreventsExecutionProof(statement, checker, visiting)) {
      return true;
    }
  }
  return false;
}

function evaluationAbruptCompletion(operation, checker, visiting = new Set()) {
  if (
    ts.isComputedPropertyName(operation) ||
    ts.isSpreadElement(operation) ||
    ts.isSpreadAssignment(operation) ||
    ts.isJsxSpreadAttribute(operation) ||
    ts.isTemplateSpan(operation)
  ) {
    return expressionAbruptCompletion(operation.expression, checker, visiting);
  }
  return ts.isStatement(operation) || ts.isBlock(operation)
    ? abruptCompletion(operation, checker, visiting)
    : expressionAbruptCompletion(operation, checker, visiting);
}

function operationPreventsExecutionProof(
  operation,
  checker,
  visiting = new Set()
) {
  return (
    evaluationAbruptCompletion(operation, checker, visiting).always ||
    operationHasUnprovenImplicitExecution(operation, checker, visiting)
  );
}

function statementPreventsExecutionProof(
  statement,
  checker,
  visiting = new Set()
) {
  if (abruptCompletion(statement, checker, visiting).always) {
    return true;
  }
  if (ts.isBlock(statement)) {
    return statement.statements.some((nested) =>
      statementPreventsExecutionProof(nested, checker, visiting)
    );
  }
  if (ts.isExpressionStatement(statement)) {
    return operationPreventsExecutionProof(
      statement.expression,
      checker,
      visiting
    );
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some(
      (declaration) =>
        declaration.initializer &&
        operationPreventsExecutionProof(
          declaration.initializer,
          checker,
          visiting
        )
    );
  }
  if (ts.isClassDeclaration(statement)) {
    const operations = classEvaluationOperations(statement);
    return (
      !operations ||
      operations.some((operation) =>
        operationPreventsExecutionProof(operation, checker, visiting)
      )
    );
  }
  if (ts.isIfStatement(statement)) {
    return (
      operationPreventsExecutionProof(
        statement.expression,
        checker,
        visiting
      ) ||
      Boolean(
        statement.elseStatement &&
        statementPreventsExecutionProof(
          statement.thenStatement,
          checker,
          visiting
        ) &&
        statementPreventsExecutionProof(
          statement.elseStatement,
          checker,
          visiting
        )
      )
    );
  }
  if (ts.isSwitchStatement(statement)) {
    return operationPreventsExecutionProof(
      statement.expression,
      checker,
      visiting
    );
  }
  if (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) {
    if (
      operationPreventsExecutionProof(statement.expression, checker, visiting)
    ) {
      return true;
    }
    return ts.isForOfStatement(statement)
      ? !valueIsProvenIterable(statement.expression, checker)
      : !valueIsProvenPlainObject(statement.expression, checker);
  }
  if (ts.isForStatement(statement)) {
    if (
      statement.initializer &&
      (ts.isVariableDeclarationList(statement.initializer)
        ? statement.initializer.declarations.some(
            (declaration) =>
              declaration.initializer &&
              operationPreventsExecutionProof(
                declaration.initializer,
                checker,
                visiting
              )
          )
        : operationPreventsExecutionProof(
            statement.initializer,
            checker,
            visiting
          ))
    ) {
      return true;
    }
    return Boolean(
      statement.condition &&
      operationPreventsExecutionProof(statement.condition, checker, visiting)
    );
  }
  if (ts.isWhileStatement(statement)) {
    return operationPreventsExecutionProof(
      statement.expression,
      checker,
      visiting
    );
  }
  if (ts.isDoStatement(statement)) {
    return statementPreventsExecutionProof(
      statement.statement,
      checker,
      visiting
    );
  }
  if (ts.isLabeledStatement(statement)) {
    return statementPreventsExecutionProof(
      statement.statement,
      checker,
      visiting
    );
  }
  if (ts.isTryStatement(statement)) {
    if (
      statement.finallyBlock &&
      statementPreventsExecutionProof(statement.finallyBlock, checker, visiting)
    ) {
      return true;
    }
    return (
      !statement.catchClause &&
      statementPreventsExecutionProof(statement.tryBlock, checker, visiting)
    );
  }
  return false;
}

function bindingNameHasProvenInitialization(
  name,
  initializer,
  checker,
  visiting = new Set()
) {
  if (ts.isIdentifier(name)) {
    return true;
  }
  if (!initializer) {
    return false;
  }
  const sourceIsProven = ts.isObjectBindingPattern(name)
    ? valueIsProvenPlainObject(initializer, checker)
    : valueIsProvenIterable(initializer, checker);
  return (
    sourceIsProven &&
    name.elements.every(
      (element) =>
        ts.isOmittedExpression(element) ||
        (ts.isIdentifier(element.name) &&
          (!element.initializer ||
            !operationPreventsExecutionProof(
              element.initializer,
              checker,
              visiting
            )))
    )
  );
}

function parameterPreventsExecutionProof(
  parameter,
  checker,
  visiting = new Set()
) {
  return (
    Boolean(
      parameter.initializer &&
      operationPreventsExecutionProof(parameter.initializer, checker, visiting)
    ) ||
    !bindingNameHasProvenInitialization(
      parameter.name,
      parameter.initializer,
      checker,
      visiting
    )
  );
}

function hasPrecedingAbruptExpression(node, checker) {
  let child = node;
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (
      (ts.isFunctionLike(ancestor) &&
        functionLikeDefersChild(ancestor, child)) ||
      ts.isSourceFile(ancestor)
    ) {
      return (
        ts.isFunctionLike(ancestor) &&
        ancestor.parameters.some((parameter) =>
          parameterPreventsExecutionProof(parameter, checker)
        )
      );
    }
    const evaluation = precedingEvaluation(ancestor, child, node);
    if (
      !evaluation.proven ||
      evaluation.operations.some((operation) =>
        operationPreventsExecutionProof(operation, checker)
      )
    ) {
      return true;
    }
    child = ancestor;
  }
  return false;
}

function abruptCompletion(statement, checker, visiting = new Set()) {
  if (ts.isThrowStatement(statement)) {
    return { always: true, uncatchable: false, throws: true };
  }
  if (
    ts.isReturnStatement(statement) ||
    ts.isBreakStatement(statement) ||
    ts.isContinueStatement(statement)
  ) {
    return { always: true, uncatchable: true, throws: false };
  }
  if (ts.isBlock(statement)) {
    for (const nestedStatement of statement.statements) {
      const completion = abruptCompletion(nestedStatement, checker, visiting);
      if (completion.always) {
        return completion;
      }
    }
  }
  if (ts.isExpressionStatement(statement)) {
    return expressionAbruptCompletion(statement.expression, checker, visiting);
  }
  if (ts.isIfStatement(statement) && statement.elseStatement) {
    const thenCompletion = abruptCompletion(
      statement.thenStatement,
      checker,
      visiting
    );
    const elseCompletion = abruptCompletion(
      statement.elseStatement,
      checker,
      visiting
    );
    return {
      always: thenCompletion.always && elseCompletion.always,
      uncatchable: thenCompletion.uncatchable && elseCompletion.uncatchable,
      throws: thenCompletion.throws && elseCompletion.throws,
    };
  }
  if (ts.isTryStatement(statement)) {
    const finallyCompletion = statement.finallyBlock
      ? abruptCompletion(statement.finallyBlock, checker, visiting)
      : { always: false, uncatchable: false, throws: false };
    if (finallyCompletion.always) {
      return finallyCompletion;
    }
    const tryCompletion = abruptCompletion(
      statement.tryBlock,
      checker,
      visiting
    );
    if (!tryCompletion.always || tryCompletion.uncatchable) {
      return tryCompletion;
    }
    if (!statement.catchClause) {
      return tryCompletion;
    }
    return abruptCompletion(statement.catchClause.block, checker, visiting);
  }
  return { always: false, uncatchable: false, throws: false };
}

function hasPrecedingAbruptCompletion(node) {
  const checker = sourceCheckers.get(node.getSourceFile());
  if (!checker) {
    return false;
  }
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
          .some((statement) =>
            statementPreventsExecutionProof(statement, checker)
          )
      ) {
        return true;
      }
    }
    if (
      (ts.isFunctionLike(ancestor) &&
        functionLikeDefersChild(ancestor, child)) ||
      ts.isSourceFile(ancestor)
    ) {
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

function hasPrecedingPosition(positions, node) {
  if (!positions) {
    return false;
  }
  const scope = executionScope(node);
  const position = node.getStart(node.getSourceFile());
  return (scope ? positions.get(scope) : undefined)?.some(
    (hazardPosition) => hazardPosition < position
  );
}

function hasExecutionHazard(node, storageKind) {
  const hazards = executionHazards.get(node.getSourceFile());
  if (!hazards) {
    return false;
  }
  if (hasPrecedingPosition(hazards.awaits, node)) {
    return true;
  }
  if (!storageKind) {
    return false;
  }
  return hasPrecedingPosition(hazards.storageMutations.get(storageKind), node);
}

function hasProvenExecutionAt(node, storageKind) {
  const checker = sourceCheckers.get(node.getSourceFile());
  return (
    !ts.isOptionalChain(node) &&
    !hasWithStatementAncestor(node) &&
    !isConditionallyEvaluated(node) &&
    !hasPrecedingAbruptCompletion(node) &&
    (!checker || !hasPrecedingAbruptExpression(node, checker)) &&
    !isCompilerUnreachable(node) &&
    !hasExecutionHazard(node, storageKind)
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
    return staticStringValue(expression.argumentExpression);
  }
  return undefined;
}

function staticStringValue(expression) {
  expression = unwrapExpression(expression);
  return ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text
    : undefined;
}

function staticDeclarationName(name) {
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    return staticStringValue(name.expression);
  }
  return staticStringValue(name);
}

function browserStorageKind(expression, checker) {
  expression = unwrapExpression(expression);
  if (
    ts.isIdentifier(expression) &&
    browserStorageKinds.includes(expression.text) &&
    isUnshadowedGlobal(checker, expression)
  ) {
    return expression.text;
  }
  if (
    (ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)) &&
    ts.isIdentifier(expression.expression) &&
    ["window", "globalThis"].includes(expression.expression.text) &&
    isUnshadowedGlobal(checker, expression.expression)
  ) {
    const property = staticPropertyName(expression);
    return browserStorageKinds.includes(property ?? "") ? property : undefined;
  }
  return undefined;
}

function isStorageConstructor(expression, checker) {
  expression = unwrapExpression(expression);
  if (
    ts.isIdentifier(expression) &&
    expression.text === "Storage" &&
    isUnshadowedGlobal(checker, expression)
  ) {
    return true;
  }
  return (
    (ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)) &&
    ts.isIdentifier(expression.expression) &&
    ["window", "globalThis"].includes(expression.expression.text) &&
    isUnshadowedGlobal(checker, expression.expression) &&
    staticPropertyName(expression) === "Storage"
  );
}

function targetsStoragePrototype(expression, checker) {
  expression = unwrapExpression(expression);
  if (
    !ts.isPropertyAccessExpression(expression) &&
    !ts.isElementAccessExpression(expression)
  ) {
    return false;
  }
  return (
    (staticPropertyName(expression) === "prototype" &&
      isStorageConstructor(expression.expression, checker)) ||
    targetsStoragePrototype(expression.expression, checker)
  );
}

function storageKindsForPrototypeLookup(
  expression,
  checker,
  visiting = new Set()
) {
  expression = unwrapExpression(expression);
  if (
    !ts.isCallExpression(expression) ||
    (!ts.isPropertyAccessExpression(expression.expression) &&
      !ts.isElementAccessExpression(expression.expression)) ||
    staticPropertyName(expression.expression) !== "getPrototypeOf" ||
    !intrinsicObjectName(expression.expression.expression, checker) ||
    !expression.arguments[0]
  ) {
    return [];
  }
  return storageKindsForMutationTarget(
    expression.arguments[0],
    checker,
    visiting
  );
}

function storageKindsForMutationTarget(
  expression,
  checker,
  visiting = new Set()
) {
  expression = unwrapExpression(expression);
  const storageKind = browserStorageKind(expression, checker);
  if (storageKind) {
    return [storageKind];
  }
  if (ts.isIdentifier(expression)) {
    const symbol = checker.getSymbolAtLocation(expression);
    if (!symbol || visiting.has(symbol)) {
      return [];
    }
    const nextVisiting = new Set(visiting).add(symbol);
    return [
      ...new Set(
        (symbol.declarations ?? []).flatMap((declaration) =>
          ts.isVariableDeclaration(declaration) && declaration.initializer
            ? storageKindsForMutationTarget(
                declaration.initializer,
                checker,
                nextVisiting
              )
            : []
        )
      ),
    ];
  }
  if (targetsStoragePrototype(expression, checker)) {
    return browserStorageKinds;
  }
  const prototypeStorageKinds = storageKindsForPrototypeLookup(
    expression,
    checker,
    visiting
  );
  if (prototypeStorageKinds.length > 0) {
    return prototypeStorageKinds;
  }
  if (
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  ) {
    return storageKindsForMutationTarget(
      expression.expression,
      checker,
      visiting
    );
  }
  return [];
}

function isBrowserGlobalObject(expression, checker) {
  expression = unwrapExpression(expression);
  return (
    ts.isIdentifier(expression) &&
    ["window", "globalThis"].includes(expression.text) &&
    isUnshadowedGlobal(checker, expression)
  );
}

function intrinsicObjectName(expression, checker) {
  expression = unwrapExpression(expression);
  if (
    ts.isIdentifier(expression) &&
    storageMutatingMethods.has(expression.text) &&
    isUnshadowedGlobal(checker, expression)
  ) {
    return expression.text;
  }
  if (
    (ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)) &&
    isBrowserGlobalObject(expression.expression, checker)
  ) {
    const property = staticPropertyName(expression);
    return storageMutatingMethods.has(property) ? property : undefined;
  }
  return undefined;
}

function browserStorageProperty(expression) {
  const property = staticStringValue(expression);
  if (property !== undefined) {
    return browserStorageKinds.includes(property) ? property : null;
  }
  return undefined;
}

function containsImmediateAwait(node) {
  let found = false;
  function visit(current) {
    if (current !== node && ts.isFunctionLike(current)) {
      return;
    }
    if (ts.isAwaitExpression(current)) {
      found = true;
      return;
    }
    if (!found) {
      ts.forEachChild(current, visit);
    }
  }
  visit(node);
  return found;
}

function directlyCalledFunctions(expression, checker) {
  expression = unwrapExpression(expression);
  if (
    (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) &&
    !expression.asteriskToken &&
    !(ts.getCombinedModifierFlags(expression) & ts.ModifierFlags.Async)
  ) {
    return [expression];
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...directlyCalledFunctions(expression.whenTrue, checker),
      ...directlyCalledFunctions(expression.whenFalse, checker),
    ];
  }
  if (
    ts.isBinaryExpression(expression) &&
    [
      ts.SyntaxKind.CommaToken,
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(expression.operatorToken.kind)
  ) {
    return directlyCalledFunctions(expression.right, checker);
  }
  const symbol = checker.getSymbolAtLocation(
    ts.isPropertyAccessExpression(expression)
      ? expression.name
      : ts.isElementAccessExpression(expression) &&
          expression.argumentExpression
        ? expression.argumentExpression
        : expression
  );
  const functions = [];
  for (const declaration of symbol?.declarations ?? []) {
    if (
      ts.isClassDeclaration(declaration) ||
      ts.isClassExpression(declaration)
    ) {
      functions.push(
        ...declaration.members.filter(ts.isConstructorDeclaration)
      );
    } else if (
      ts.isFunctionDeclaration(declaration) ||
      ts.isMethodDeclaration(declaration)
    ) {
      if (
        !declaration.asteriskToken &&
        !(ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Async)
      ) {
        functions.push(declaration);
      }
    } else if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer
    ) {
      const initializer = unwrapExpression(declaration.initializer);
      if (
        (ts.isArrowFunction(initializer) ||
          ts.isFunctionExpression(initializer)) &&
        !initializer.asteriskToken &&
        !(ts.getCombinedModifierFlags(initializer) & ts.ModifierFlags.Async)
      ) {
        functions.push(initializer);
      }
    }
  }
  return functions;
}

function callTargetIsProvenFunction(expression, checker) {
  expression = unwrapExpression(expression);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return true;
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      callTargetIsProvenFunction(expression.whenTrue, checker) &&
      callTargetIsProvenFunction(expression.whenFalse, checker)
    );
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) {
    return callTargetIsProvenFunction(expression.right, checker);
  }

  const symbol = checker.getSymbolAtLocation(
    ts.isPropertyAccessExpression(expression)
      ? expression.name
      : ts.isElementAccessExpression(expression) &&
          expression.argumentExpression
        ? expression.argumentExpression
        : expression
  );
  const declarations = symbol?.declarations ?? [];
  return (
    declarations.length > 0 &&
    declarations.every((declaration) => {
      if (
        ts.isFunctionDeclaration(declaration) ||
        ts.isMethodDeclaration(declaration)
      ) {
        return Boolean(declaration.body);
      }
      if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) {
        return false;
      }
      const initializer = unwrapExpression(declaration.initializer);
      return (
        ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)
      );
    })
  );
}

function storageCall(node, checker) {
  if (
    !ts.isCallExpression(node) ||
    hasWithStatementAncestor(node) ||
    isDeferredClassFieldInitializer(node) ||
    containsImmediateAwait(node) ||
    (!ts.isPropertyAccessExpression(node.expression) &&
      !ts.isElementAccessExpression(node.expression))
  ) {
    return undefined;
  }

  const method = staticPropertyName(node.expression);
  if (!["getItem", "setItem", "removeItem"].includes(method)) {
    return undefined;
  }
  if (node.arguments.length < 1 || ts.isSpreadElement(node.arguments[0])) {
    return undefined;
  }
  if (
    method === "setItem" &&
    (node.arguments.length < 2 ||
      ts.isSpreadElement(node.arguments[1]) ||
      operationPreventsExecutionProof(node.arguments[1], checker))
  ) {
    return undefined;
  }

  const storageKind = browserStorageKind(node.expression.expression, checker);
  return storageKind
    ? { argument: node.arguments[0], storageKind, storageUse: node }
    : undefined;
}

function mutatingMethodForExpression(
  expression,
  checker,
  visiting = new Set()
) {
  expression = unwrapExpression(expression);
  if (
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  ) {
    const method = staticPropertyName(expression);
    const intrinsic = intrinsicObjectName(expression.expression, checker);
    return method &&
      intrinsic &&
      storageMutatingMethods.get(intrinsic)?.includes(method)
      ? method
      : undefined;
  }
  if (!ts.isIdentifier(expression)) {
    return undefined;
  }
  const symbol = checker.getSymbolAtLocation(expression);
  if (!symbol || visiting.has(symbol)) {
    return undefined;
  }
  const nextVisiting = new Set(visiting).add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const method = mutatingMethodForExpression(
        declaration.initializer,
        checker,
        nextVisiting
      );
      if (method) {
        return method;
      }
    }
    if (
      ts.isBindingElement(declaration) &&
      ts.isObjectBindingPattern(declaration.parent) &&
      ts.isVariableDeclaration(declaration.parent.parent) &&
      declaration.parent.parent.initializer
    ) {
      const intrinsic = intrinsicObjectName(
        declaration.parent.parent.initializer,
        checker
      );
      const method = staticDeclarationName(
        declaration.propertyName ?? declaration.name
      );
      if (
        intrinsic &&
        method &&
        storageMutatingMethods.get(intrinsic)?.includes(method)
      ) {
        return method;
      }
    }
  }
  return undefined;
}

function mutatingMethodCall(node, checker) {
  return ts.isCallExpression(node)
    ? mutatingMethodForExpression(node.expression, checker)
    : undefined;
}

function browserStorageMutations(node, checker) {
  const mutatingMethod = mutatingMethodCall(node, checker);
  if (mutatingMethod) {
    const target = node.arguments[0];
    if (!target) {
      return [];
    }
    const storageTargets = storageKindsForMutationTarget(target, checker);
    if (storageTargets.length > 0) {
      return storageTargets;
    }
    if (!isBrowserGlobalObject(target, checker)) {
      return [];
    }
    if (["defineProperty", "deleteProperty", "set"].includes(mutatingMethod)) {
      const storageProperty = node.arguments[1]
        ? browserStorageProperty(node.arguments[1])
        : undefined;
      return storageProperty === null
        ? []
        : storageProperty
          ? [storageProperty]
          : browserStorageKinds;
    }
    return browserStorageKinds;
  }
  if (
    !node.parent ||
    (!ts.isAssignmentTarget(node) && !ts.isDeleteExpression(node.parent))
  ) {
    return [];
  }
  return storageKindsForMutationTarget(node, checker);
}

function isDynamicCodeReference(node, checker) {
  if (
    (ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)) &&
    ["eval", "Function"].includes(staticPropertyName(node)) &&
    isBrowserGlobalObject(node.expression, checker) &&
    !isTypeOnlyReference(node)
  ) {
    return true;
  }
  if (
    !ts.isIdentifier(node) ||
    !["eval", "Function"].includes(node.text) ||
    isTypeOnlyReference(node)
  ) {
    return false;
  }
  if (
    (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
    (ts.isMethodDeclaration(node.parent) && node.parent.name === node) ||
    (ts.isPropertyDeclaration(node.parent) && node.parent.name === node) ||
    (ts.isPropertyAssignment(node.parent) && node.parent.name === node)
  ) {
    return false;
  }
  return isUnshadowedGlobal(checker, node);
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

function containingFunctionLike(node) {
  let child = node;
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (
      ts.isFunctionLike(ancestor) &&
      functionLikeDefersChild(ancestor, child)
    ) {
      return ancestor;
    }
    child = ancestor;
  }
  return undefined;
}

function executionScope(node) {
  let child = node;
  for (let current = node; current; current = current.parent) {
    if (
      (ts.isFunctionLike(current) && functionLikeDefersChild(current, child)) ||
      ts.isSourceFile(current)
    ) {
      return current;
    }
    child = current;
  }
  return undefined;
}

function addExecutionPosition(positions, node, scopeNode = node) {
  const scope = executionScope(scopeNode);
  if (!scope) {
    return;
  }
  const scopePositions = positions.get(scope) ?? [];
  scopePositions.push(node.getStart(node.getSourceFile()));
  positions.set(scope, scopePositions);
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
  if (
    ts.isMethodDeclaration(functionLike) &&
    ts.isIdentifier(functionLike.name)
  ) {
    const container = functionLike.parent;
    if (
      ts.isObjectLiteralExpression(container) ||
      ts.isClassDeclaration(container) ||
      ts.isClassExpression(container)
    ) {
      let owner;
      if (
        ts.isObjectLiteralExpression(container) ||
        ts.isClassExpression(container)
      ) {
        let expression = container;
        while (
          isTransparentExpressionWrapper(expression.parent) &&
          expression.parent.expression === expression
        ) {
          expression = expression.parent;
        }
        const declaration = expression.parent;
        if (
          ts.isVariableDeclaration(declaration) &&
          declaration.initializer === expression &&
          ts.isIdentifier(declaration.name)
        ) {
          owner = declaration.name;
        }
      }
      if (!owner && !ts.isObjectLiteralExpression(container)) {
        owner = container.name;
      }
      return {
        identifier: functionLike.name,
        initialization: container,
        initializationEnd: container.getEnd(),
        initializationScopeNode: container,
        methodName: functionLike.name.text,
        ownerSymbol: owner ? checker.getSymbolAtLocation(owner) : undefined,
        receiverKind:
          ts.isObjectLiteralExpression(container) ||
          ts.getCombinedModifierFlags(functionLike) & ts.ModifierFlags.Static
            ? "owner"
            : "instance",
      };
    }
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
        initializationScopeNode: declaration.name,
      }
    : undefined;
}

function directCallExpression(expression) {
  if (
    ts.isIdentifier(expression) &&
    ts.isPropertyAccessExpression(expression.parent) &&
    expression.parent.name === expression
  ) {
    expression = expression.parent;
  } else if (
    (ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)) &&
    ts.isElementAccessExpression(expression.parent) &&
    expression.parent.argumentExpression === expression
  ) {
    expression = expression.parent;
  }
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

function isMutationTargetReference(identifier) {
  let target = identifier;
  while (
    (isTransparentExpressionWrapper(target.parent) &&
      target.parent.expression === target) ||
    ((ts.isPropertyAccessExpression(target.parent) ||
      ts.isElementAccessExpression(target.parent)) &&
      target.parent.expression === target)
  ) {
    target = target.parent;
  }
  return (
    ts.isAssignmentTarget(target) ||
    (ts.isDeleteExpression(target.parent) &&
      target.parent.expression === target)
  );
}

function symbolIsMutatedBefore(symbol, identifiers, checker, beforeNode) {
  return Boolean(
    symbol &&
    identifiers.some(
      (identifier) =>
        identifier.getStart() < beforeNode.getStart() &&
        identifierReferencesSymbol(checker, identifier, symbol) &&
        (isMutationTargetReference(identifier) ||
          isMutatingCallTarget(identifier, checker))
    )
  );
}

function isMutatingCallTarget(identifier, checker) {
  let target = identifier;
  while (
    (isTransparentExpressionWrapper(target.parent) &&
      target.parent.expression === target) ||
    ((ts.isPropertyAccessExpression(target.parent) ||
      ts.isElementAccessExpression(target.parent)) &&
      target.parent.expression === target)
  ) {
    target = target.parent;
  }
  return (
    ts.isCallExpression(target.parent) &&
    target.parent.arguments[0] === target &&
    Boolean(mutatingMethodCall(target.parent, checker))
  );
}

function constructsOwner(expression, ownerSymbol, checker) {
  expression = unwrapExpression(expression);
  if (!ts.isNewExpression(expression)) {
    return false;
  }
  const constructor = unwrapExpression(expression.expression);
  return (
    ts.isIdentifier(constructor) &&
    identifierReferencesSymbol(checker, constructor, ownerSymbol)
  );
}

function isPrimitiveConstructorReturn(expression, checker) {
  expression = unwrapExpression(expression);
  return (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression) ||
    ts.isNumericLiteral(expression) ||
    ts.isBigIntLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    ts.isVoidExpression(expression) ||
    (ts.isIdentifier(expression) &&
      expression.text === "undefined" &&
      isUnshadowedGlobal(checker, expression)) ||
    expression.kind === ts.SyntaxKind.ThisKeyword
  );
}

function initializationMayReplaceMethod(
  root,
  checker,
  methodName,
  returnsReplaceInstance = false
) {
  let replacement = false;

  function visit(node) {
    if (
      replacement ||
      isCompilerUnreachable(node) ||
      (node.parent && ts.isFunctionLike(node))
    ) {
      return;
    }
    if (
      returnsReplaceInstance &&
      ts.isReturnStatement(node) &&
      node.expression &&
      !isPrimitiveConstructorReturn(node.expression, checker)
    ) {
      replacement = true;
      return;
    }
    if (
      methodName &&
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      node.expression.kind === ts.SyntaxKind.ThisKeyword &&
      staticPropertyName(node) === methodName &&
      (ts.isAssignmentTarget(node) || ts.isDeleteExpression(node.parent))
    ) {
      replacement = true;
      return;
    }
    const mutator = ts.isCallExpression(node)
      ? mutatingMethodCall(node, checker)
      : undefined;
    if (
      methodName &&
      mutator &&
      node.arguments[0] &&
      unwrapExpression(node.arguments[0]).kind === ts.SyntaxKind.ThisKeyword
    ) {
      const property = node.arguments[1]
        ? staticStringValue(node.arguments[1])
        : undefined;
      if (
        !["defineProperty", "deleteProperty", "set"].includes(mutator) ||
        property === undefined ||
        property === methodName
      ) {
        replacement = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(root);
  return replacement;
}

function classDeclarations(ownerSymbol) {
  return (ownerSymbol.declarations ?? []).flatMap((ownerDeclaration) => {
    let declaration = ownerDeclaration;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      declaration = unwrapExpression(declaration.initializer);
    }
    return ts.isClassDeclaration(declaration) ||
      ts.isClassExpression(declaration)
      ? [declaration]
      : [];
  });
}

function constructorMayReplaceInstance(ownerSymbol, checker, methodName) {
  for (const declaration of classDeclarations(ownerSymbol)) {
    if (
      declaration.heritageClauses?.some(
        (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword
      )
    ) {
      return true;
    }
    for (const member of declaration.members) {
      if (
        methodName &&
        ts.isPropertyDeclaration(member) &&
        !(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) &&
        staticDeclarationName(member.name) === methodName
      ) {
        return true;
      }
      if (
        ts.isConstructorDeclaration(member) &&
        member.body &&
        initializationMayReplaceMethod(member.body, checker, methodName, true)
      ) {
        return true;
      }
    }
  }
  return false;
}

function staticInitializationMayReplaceMethod(
  ownerSymbol,
  checker,
  methodName
) {
  for (const declaration of classDeclarations(ownerSymbol)) {
    for (const member of declaration.members) {
      if (
        !ts.isClassStaticBlockDeclaration(member) &&
        !(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static)
      ) {
        continue;
      }
      if (
        ts.isPropertyDeclaration(member) &&
        staticDeclarationName(member.name) === methodName
      ) {
        return true;
      }
      const initialization = ts.isClassStaticBlockDeclaration(member)
        ? member.body
        : ts.isPropertyDeclaration(member)
          ? member.initializer
          : undefined;
      if (
        initialization &&
        initializationMayReplaceMethod(initialization, checker, methodName)
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasProvenMethodReceiver(
  call,
  binding,
  identifiers,
  checker,
  storageKind
) {
  if (!binding.receiverKind || !binding.ownerSymbol) {
    return !binding.receiverKind;
  }
  const callee = unwrapExpression(call.expression);
  if (
    !ts.isPropertyAccessExpression(callee) &&
    !ts.isElementAccessExpression(callee)
  ) {
    return false;
  }
  if (staticPropertyName(callee) !== binding.methodName) {
    return false;
  }
  const receiver = unwrapExpression(callee.expression);
  if (binding.receiverKind === "owner") {
    return (
      ts.isIdentifier(receiver) &&
      identifierReferencesSymbol(checker, receiver, binding.ownerSymbol) &&
      !staticInitializationMayReplaceMethod(
        binding.ownerSymbol,
        checker,
        binding.methodName
      ) &&
      !symbolIsMutatedBefore(binding.ownerSymbol, identifiers, checker, call)
    );
  }
  if (symbolIsMutatedBefore(binding.ownerSymbol, identifiers, checker, call)) {
    return false;
  }
  if (
    constructorMayReplaceInstance(
      binding.ownerSymbol,
      checker,
      binding.methodName
    )
  ) {
    return false;
  }
  if (constructsOwner(receiver, binding.ownerSymbol, checker)) {
    return true;
  }
  if (!ts.isIdentifier(receiver)) {
    return false;
  }
  const receiverSymbol = checker.getSymbolAtLocation(receiver);
  const declaration = receiverSymbol?.declarations?.find(
    (candidate) =>
      ts.isVariableDeclaration(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.initializer
  );
  return (
    declaration?.initializer &&
    executionScope(declaration) === executionScope(call) &&
    declaration.initializer.getEnd() < call.getStart() &&
    hasProvenExecutionAt(declaration.initializer, storageKind) &&
    constructsOwner(declaration.initializer, binding.ownerSymbol, checker) &&
    !symbolIsMutatedBefore(receiverSymbol, identifiers, checker, call)
  );
}

function isDirectCall(identifier, binding, identifiers, checker, storageKind) {
  const call = directCallExpression(identifier);
  if (
    !call ||
    !hasProvenExecutionAt(call, storageKind) ||
    !hasProvenMethodReceiver(call, binding, identifiers, checker, storageKind)
  ) {
    return false;
  }
  return true;
}

function functionExecutionIsReachable(
  functionLike,
  initializationRequirements,
  identifiers,
  checker,
  storageKind,
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
    if (!hasProvenExecutionAt(immediateInvocation, storageKind)) {
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
          storageKind,
          visiting
        )
      : remainingRequirements.size === 0;
  }
  const binding = functionBinding(functionLike, checker);
  if (
    !binding ||
    (binding.initialization &&
      !hasProvenExecutionAt(binding.initialization, storageKind))
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
          binding.initializationScopeNode ?? binding.identifier,
          binding.initializationEnd
        );
  const nextVisiting = new Set(visiting).add(symbol);
  const references = identifiers.filter(
    (identifier) =>
      identifier !== binding.identifier &&
      !isTypeOnlyReference(identifier) &&
      identifierReferencesSymbol(checker, identifier, symbol)
  );
  return references.some((identifier) => {
    const call = directCallExpression(identifier);
    if (
      !call ||
      symbolIsMutatedBefore(symbol, identifiers, checker, call) ||
      !isDirectCall(identifier, binding, identifiers, checker, storageKind)
    ) {
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
          storageKind,
          nextVisiting
        )
      : remainingRequirements.size === 0;
  });
}

function isReachableStorageUse(
  storageUse,
  initializationRequirements,
  identifiers,
  checker,
  storageKind
) {
  if (!hasProvenExecutionAt(storageUse, storageKind)) {
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
        checker,
        storageKind
      )
    : remainingRequirements.size === 0;
}

function addMutationFunctionKind(mutationFunctions, functionLike, storageKind) {
  const storageKinds = mutationFunctions.get(functionLike) ?? new Set();
  const added = !storageKinds.has(storageKind);
  storageKinds.add(storageKind);
  mutationFunctions.set(functionLike, storageKinds);
  return added;
}

function propagateStorageMutations(hazards, identifiers, checker) {
  const pending = [...hazards.mutationFunctions.keys()];
  const processed = new Map();

  function recordUnresolvedEffect(node, scopeNode, storageKinds) {
    if (isCompilerUnreachable(node)) {
      return;
    }
    const scope = executionScope(scopeNode);
    for (const storageKind of storageKinds) {
      addExecutionPosition(
        hazards.storageMutations.get(storageKind),
        node,
        scopeNode
      );
      if (
        ts.isFunctionLike(scope) &&
        addMutationFunctionKind(hazards.mutationFunctions, scope, storageKind)
      ) {
        pending.push(scope);
      }
    }
  }

  while (pending.length > 0) {
    const functionLike = pending.shift();
    const storageKinds = hazards.mutationFunctions.get(functionLike);
    const processedKinds = processed.get(functionLike) ?? new Set();
    const newKinds = [...storageKinds].filter(
      (storageKind) => !processedKinds.has(storageKind)
    );
    if (newKinds.length === 0) {
      continue;
    }
    newKinds.forEach((storageKind) => processedKinds.add(storageKind));
    processed.set(functionLike, processedKinds);

    const calls = [];
    const immediateInvocation =
      ts.isArrowFunction(functionLike) || ts.isFunctionExpression(functionLike)
        ? directCallExpression(functionLike)
        : undefined;
    if (immediateInvocation) {
      calls.push(immediateInvocation);
    } else {
      const binding = functionBinding(functionLike, checker);
      const symbol = binding
        ? checker.getSymbolAtLocation(binding.identifier)
        : undefined;
      if (!symbol) {
        recordUnresolvedEffect(functionLike, functionLike.parent, newKinds);
        continue;
      }
      for (const identifier of identifiers) {
        if (
          identifier === binding.identifier ||
          isTypeOnlyReference(identifier) ||
          !identifierReferencesSymbol(checker, identifier, symbol)
        ) {
          continue;
        }
        const call = directCallExpression(identifier);
        if (call) {
          if (hasProvenExecutionAt(call)) {
            calls.push(call);
          }
        } else {
          recordUnresolvedEffect(identifier, identifier, newKinds);
        }
      }
    }

    for (const call of calls) {
      for (const storageKind of newKinds) {
        if (hasProvenExecutionAt(call, storageKind)) {
          addExecutionPosition(hazards.storageMutations.get(storageKind), call);
        }
      }
      const caller = containingFunctionLike(call);
      if (caller) {
        for (const storageKind of newKinds) {
          if (
            addMutationFunctionKind(
              hazards.mutationFunctions,
              caller,
              storageKind
            )
          ) {
            pending.push(caller);
          }
        }
      }
    }
  }
}

function parserExemptions(file, program, checker) {
  const sourceFile = program.getSourceFile(file);
  if (!sourceFile || sourceFile.parseDiagnostics.length > 0) {
    return [];
  }
  sourceCheckers.set(sourceFile, checker);

  const storageUses = new Map();
  const directLiterals = [];
  const candidates = [];
  const identifiers = [];
  const hazards = {
    awaits: new Map(),
    mutationFunctions: new Map(),
    storageMutations: new Map([
      ["localStorage", new Map()],
      ["sessionStorage", new Map()],
    ]),
  };
  executionHazards.set(sourceFile, hazards);
  let hasDynamicCode = false;

  function visit(node) {
    hasDynamicCode ||= isDynamicCodeReference(node, checker);
    if (
      (ts.isAwaitExpression(node) ||
        (ts.isForOfStatement(node) && node.awaitModifier)) &&
      !isCompilerUnreachable(node)
    ) {
      addExecutionPosition(hazards.awaits, node);
    }
    const mutatedStorages = browserStorageMutations(node, checker);
    if (mutatedStorages.length > 0 && !isCompilerUnreachable(node)) {
      const scope = executionScope(node);
      for (const storageKind of mutatedStorages) {
        addExecutionPosition(hazards.storageMutations.get(storageKind), node);
        if (ts.isFunctionLike(scope)) {
          addMutationFunctionKind(
            hazards.mutationFunctions,
            scope,
            storageKind
          );
        }
      }
    }
    const call = storageCall(node, checker);
    if (call) {
      const unwrappedArgument = unwrapExpression(call.argument);
      if (ts.isIdentifier(unwrappedArgument)) {
        storageUses.set(unwrappedArgument, call);
      } else {
        const literal = storageKeyLiteral(unwrappedArgument);
        if (literal) {
          directLiterals.push({ literal, ...call });
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

    if (
      ts.isIdentifier(node) ||
      ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        ts.isElementAccessExpression(node.parent) &&
        node.parent.argumentExpression === node)
    ) {
      identifiers.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  propagateStorageMutations(hazards, identifiers, checker);

  if (hasDynamicCode) {
    return [];
  }

  const exemptions = directLiterals
    .filter(({ storageKind, storageUse }) =>
      isReachableStorageUse(
        storageUse,
        new Map(),
        identifiers,
        checker,
        storageKind
      )
    )
    .map(({ literal }) => literal);
  for (const candidate of candidates) {
    if (!hasProvenExecutionAt(candidate.declaration.initializer)) {
      continue;
    }
    const references = identifiers.filter(
      (identifier) =>
        identifier !== candidate.declaration.name &&
        !isTypeOnlyReference(identifier) &&
        identifierReferencesSymbol(checker, identifier, candidate.symbol)
    );
    const initializationRequirements = addInitializationRequirement(
      new Map(),
      candidate.declaration,
      candidate.declaration.initializer.getEnd()
    );
    const onlyReachableStorageUses =
      references.length > 0 &&
      references.every((identifier) => {
        const use = storageUses.get(identifier);
        return (
          use &&
          isReachableStorageUse(
            use.storageUse,
            initializationRequirements,
            identifiers,
            checker,
            use.storageKind
          )
        );
      });
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
