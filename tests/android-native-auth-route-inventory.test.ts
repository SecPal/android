/*
 * SPDX-FileCopyrightText: 2026 SecPal Contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@typescript-eslint/parser";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const packagedAssetsDirectory = resolve(
  repoRoot,
  "android/app/src/main/assets/public/assets"
);
const nativePolicy = readFileSync(
  resolve(
    repoRoot,
    "android/app/src/main/java/app/secpal/NativeAuthRequestPolicy.java"
  ),
  "utf8"
);
const protectedRouteFamilies = [
  "/v1/activity-logs",
  "/v1/addresses/de/",
  "/v1/auth/email/verification-notification",
  "/v1/customer-establishments",
  "/v1/customers",
  "/v1/employees",
  "/v1/lookups/",
  "/v1/me",
  "/v1/me/mfa",
  "/v1/me/notification-installations/",
  "/v1/me/passkeys",
  "/v1/onboarding/",
  "/v1/onboarding-review/employees/",
  "/v1/organizational-units",
  "/v1/sites",
];
const browserOnlyRoutesWithinProtectedFamilies = new Set([
  "/v1/onboarding/complete",
  "/v1/onboarding/validate-token",
]);

type RouteContract = {
  method: string;
  path: string;
  queryKeys: string[];
  contentTypes: string[];
  responseType: "json";
};

function compareRouteContracts(left: RouteContract, right: RouteContract) {
  return `${left.method} ${left.path}`.localeCompare(
    `${right.method} ${right.path}`
  );
}

function parseNativeRouteContracts(source: string): RouteContract[] {
  const routePattern =
    /add\(routes,\s*"([A-Z]+)",\s*(.*?),\s*(NO_QUERY|keys\(.*?\)),\s*(NO_CONTENT|JSON_CONTENT|MULTIPART_CONTENT),\s*ResponseKind\.JSON\s*\);/gs;
  const contentTypesByPolicy = {
    NO_CONTENT: ["none"],
    JSON_CONTENT: ["application/json"],
    MULTIPART_CONTENT: ["multipart/form-data"],
  } as const;
  const contracts: RouteContract[] = [];

  for (const match of source.matchAll(routePattern)) {
    const [, method, pathExpression, queryExpression, contentPolicy] = match;
    const path = [...pathExpression.matchAll(/"([^"]*)"|\bID\b/g)]
      .map((part) => (part[0] === "ID" ? "{id}" : part[1]))
      .join("");
    const queryKeys =
      queryExpression === "NO_QUERY"
        ? []
        : [...queryExpression.matchAll(/"([^"]+)"/g)].map(
            (queryMatch) => queryMatch[1]
          );

    contracts.push({
      method,
      path,
      queryKeys: queryKeys.sort(),
      contentTypes: [
        ...contentTypesByPolicy[
          contentPolicy as keyof typeof contentTypesByPolicy
        ],
      ].sort(),
      responseType: "json",
    });
  }

  return contracts.sort(compareRouteContracts);
}

type AstNode = { type: string } & Record<string, unknown>;

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}

function collectAstNodes(root: unknown, type: string): AstNode[] {
  const matches: AstNode[] = [];

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isAstNode(value)) return;
    if (value.type === type) matches.push(value);
    for (const [key, child] of Object.entries(value)) {
      if (key !== "parent") visit(child);
    }
  }

  visit(root);
  return matches;
}

const functionNodeTypes = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

function collectFunctionBodyNodes(root: unknown, type: string): AstNode[] {
  const matches: AstNode[] = [];

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isAstNode(value) || functionNodeTypes.has(value.type)) return;
    if (value.type === type) matches.push(value);
    for (const [key, child] of Object.entries(value)) {
      if (key !== "parent") visit(child);
    }
  }

  visit(root);
  return matches;
}

function identifierName(value: unknown): string | null {
  return isAstNode(value) &&
    value.type === "Identifier" &&
    typeof value.name === "string"
    ? value.name
    : null;
}

function staticString(value: unknown): string | null {
  if (!isAstNode(value)) return null;
  if (value.type === "Literal" && typeof value.value === "string") {
    return value.value;
  }
  if (
    value.type === "TemplateLiteral" &&
    Array.isArray(value.expressions) &&
    value.expressions.length === 0 &&
    Array.isArray(value.quasis) &&
    value.quasis.length === 1
  ) {
    const quasi = value.quasis[0];
    return isAstNode(quasi) &&
      typeof quasi.value === "object" &&
      quasi.value !== null &&
      "cooked" in quasi.value &&
      typeof quasi.value.cooked === "string"
      ? quasi.value.cooked
      : null;
  }
  return null;
}

function memberName(value: unknown): string | null {
  if (!isAstNode(value) || value.type !== "MemberExpression") return null;
  return identifierName(value.property) ?? staticString(value.property);
}

function propertyName(value: AstNode): string | null {
  return identifierName(value.key) ?? staticString(value.key);
}

function isRouteIdentifierExpression(value: unknown): boolean {
  if (identifierName(value) !== null) return true;
  if (!isAstNode(value) || value.type !== "CallExpression") return false;
  return (
    identifierName(value.callee) === "encodeURIComponent" &&
    Array.isArray(value.arguments) &&
    value.arguments.length === 1 &&
    identifierName(value.arguments[0]) !== null
  );
}

function routeFromTemplate(node: AstNode): string | null {
  if (!Array.isArray(node.quasis) || !Array.isArray(node.expressions)) {
    return null;
  }
  const expressions = node.expressions;

  let template = "";
  node.quasis.forEach((quasi, index) => {
    if (
      isAstNode(quasi) &&
      typeof quasi.value === "object" &&
      quasi.value !== null &&
      "cooked" in quasi.value &&
      typeof quasi.value.cooked === "string"
    ) {
      template += quasi.value.cooked;
    }
    if (
      index < expressions.length &&
      template.includes("/v1/") &&
      !template.includes("?") &&
      template.endsWith("/")
    ) {
      if (!isRouteIdentifierExpression(expressions[index])) {
        throw new Error(
          "Protected Android caller contains an ambiguous dynamic route segment"
        );
      }
      template += "{id}";
    }
  });

  const routeStart = template.indexOf("/v1/");
  if (routeStart === -1) return null;
  return template.slice(routeStart).split("?", 1)[0].replace(/\/+$/, "");
}

function templateContainsQuery(node: AstNode): boolean {
  return (
    Array.isArray(node.quasis) &&
    node.quasis.some(
      (quasi) =>
        isAstNode(quasi) &&
        typeof quasi.value === "object" &&
        quasi.value !== null &&
        "cooked" in quasi.value &&
        typeof quasi.value.cooked === "string" &&
        quasi.value.cooked.includes("?")
    )
  );
}

function isProtectedRoute(path: string): boolean {
  if (browserOnlyRoutesWithinProtectedFamilies.has(path)) return false;
  return protectedRouteFamilies.some((family) =>
    family.endsWith("/")
      ? path.startsWith(family)
      : path === family || path.startsWith(`${family}/`)
  );
}

function derivePackagedCallerContracts(sources: string[]): RouteContract[] {
  const contracts = new Map<string, RouteContract>();

  for (const source of sources.filter((candidate) =>
    candidate.includes("/v1/")
  )) {
    const program = parse(source, { sourceType: "module" });
    const functionNodes = [
      ...collectAstNodes(program, "FunctionDeclaration"),
      ...collectAstNodes(program, "FunctionExpression"),
      ...collectAstNodes(program, "ArrowFunctionExpression"),
    ];
    for (const functionNode of functionNodes) {
      const templateNodes = collectFunctionBodyNodes(
        functionNode.body,
        "TemplateLiteral"
      );
      const protectedLiteralNodes = collectFunctionBodyNodes(
        functionNode.body,
        "Literal"
      )
        .map((node) => ({ node, literal: staticString(node) }))
        .filter(
          (candidate): candidate is { node: AstNode; literal: string } =>
            candidate.literal !== null
        )
        .map(({ node, literal }) => {
          const routeStart = literal.indexOf("/v1/");
          return routeStart === -1
            ? null
            : {
                node,
                path: literal
                  .slice(routeStart)
                  .split("?", 1)[0]
                  .replace(/\/+$/, ""),
              };
        })
        .filter(
          (route): route is { node: AstNode; path: string } =>
            route !== null && isProtectedRoute(route.path)
        );
      if (functionNode.async !== true) {
        const protectedTemplateNodes = templateNodes.filter((node) => {
          if (!Array.isArray(node.quasis)) return false;
          const staticSegments = node.quasis
            .map((quasi) =>
              isAstNode(quasi) &&
              typeof quasi.value === "object" &&
              quasi.value !== null &&
              "cooked" in quasi.value &&
              typeof quasi.value.cooked === "string"
                ? quasi.value.cooked
                : ""
            )
            .join("");
          const routeStart = staticSegments.indexOf("/v1/");
          const path =
            routeStart === -1
              ? null
              : staticSegments
                  .slice(routeStart)
                  .split("?", 1)[0]
                  .replace(/\/+$/, "");
          return path !== null && isProtectedRoute(path);
        });
        const protectedExpressionNodes = [
          ...protectedTemplateNodes,
          ...protectedLiteralNodes.map(({ node }) => node),
        ];
        if (protectedExpressionNodes.length === 0) continue;

        const staticCatalogExpressionNodes = new Set(
          collectFunctionBodyNodes(
            functionNode.body,
            "ArrayExpression"
          ).flatMap((arrayExpression) => [
            ...collectFunctionBodyNodes(arrayExpression, "TemplateLiteral"),
            ...collectFunctionBodyNodes(arrayExpression, "Literal"),
          ])
        );
        if (
          protectedExpressionNodes.some(
            (node) => !staticCatalogExpressionNodes.has(node)
          )
        ) {
          throw new Error(
            "Protected Android caller must use a statically classified async function"
          );
        }
        continue;
      }
      if (protectedLiteralNodes.length > 0) {
        throw new Error(
          "Protected Android caller contains an ambiguous route expression"
        );
      }
      const routeTemplates = templateNodes
        .map((node) => ({ node, path: routeFromTemplate(node) }))
        .filter(
          (route): route is { node: AstNode; path: string } =>
            route.path !== null && isProtectedRoute(route.path)
        );
      const paths = routeTemplates.map((route) => route.path);
      if (paths.length === 0) continue;
      if (paths.length !== 1) {
        throw new Error(
          `Protected Android caller must declare one route per async function: ${paths.join(", ")}`
        );
      }

      const properties = collectFunctionBodyNodes(
        functionNode.body,
        "Property"
      );
      const methodProperties = properties.filter(
        (property) => propertyName(property) === "method"
      );
      const methods = methodProperties
        .map((property) => staticString(property.value))
        .filter((method): method is string => method !== null);
      if (methods.length !== methodProperties.length) {
        throw new Error(
          `Protected Android caller has a dynamic method for ${paths[0]}`
        );
      }
      const method = methods.length === 0 ? "GET" : methods[0];
      if (methods.some((candidate) => candidate !== method)) {
        throw new Error(
          `Protected Android caller has ambiguous methods for ${paths[0]}`
        );
      }

      const searchParamsDeclarations = collectFunctionBodyNodes(
        functionNode.body,
        "VariableDeclarator"
      ).filter((declaration) => {
        const init = declaration.init;
        return (
          isAstNode(init) &&
          init.type === "NewExpression" &&
          identifierName(init.callee) === "URLSearchParams"
        );
      });
      if (
        searchParamsDeclarations.some((declaration) => {
          const init = declaration.init;
          return (
            !isAstNode(init) ||
            !Array.isArray(init.arguments) ||
            init.arguments.length !== 0
          );
        })
      ) {
        throw new Error(
          `Protected Android caller constructs query parameters ambiguously for ${paths[0]}`
        );
      }
      const searchParamsVariables = new Set(
        searchParamsDeclarations
          .map((declaration) => identifierName(declaration.id))
          .filter((name): name is string => name !== null)
      );
      if (
        routeTemplates.some((route) => templateContainsQuery(route.node)) &&
        searchParamsVariables.size === 0
      ) {
        throw new Error(
          `Protected Android caller declares query parameters without URLSearchParams for ${paths[0]}`
        );
      }
      const queryMutationCalls = collectFunctionBodyNodes(
        functionNode.body,
        "CallExpression"
      ).filter((call) => {
        const callee = call.callee;
        return (
          isAstNode(callee) &&
          callee.type === "MemberExpression" &&
          searchParamsVariables.has(identifierName(callee.object) ?? "") &&
          ["append", "set"].includes(memberName(callee) ?? "")
        );
      });
      const queryKeys = queryMutationCalls
        .map((call) =>
          Array.isArray(call.arguments) ? staticString(call.arguments[0]) : null
        )
        .filter((key): key is string => key !== null)
        .sort();
      if (queryKeys.length !== queryMutationCalls.length) {
        throw new Error(
          `Protected Android caller has a dynamic query key for ${paths[0]}`
        );
      }
      const usesFormData = collectFunctionBodyNodes(
        functionNode.body,
        "NewExpression"
      ).some((expression) => identifierName(expression.callee) === "FormData");
      const contentTypeProperties = properties.filter(
        (property) => propertyName(property) === "Content-Type"
      );
      const declaredContentTypes = contentTypeProperties
        .map((property) => staticString(property.value))
        .filter((contentType): contentType is string => contentType !== null);
      if (declaredContentTypes.length !== contentTypeProperties.length) {
        throw new Error(
          `Protected Android caller has a dynamic content type for ${paths[0]}`
        );
      }
      const contentTypes = usesFormData
        ? ["multipart/form-data"]
        : declaredContentTypes.length > 0
          ? [...new Set(declaredContentTypes)].sort()
          : ["none"];
      const contract = {
        method,
        path: paths[0],
        queryKeys,
        contentTypes,
        responseType: "json" as const,
      };
      const key = `${method} ${paths[0]}`;
      const previous = contracts.get(key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(contract)) {
        throw new Error(
          `Protected Android caller contract is ambiguous: ${key}`
        );
      }
      contracts.set(key, contract);
    }
  }

  return [...contracts.values()].sort(compareRouteContracts);
}

function readPackagedJavascriptFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    throw new Error(
      `Packaged Android JavaScript assets are unavailable: ${directory}`
    );
  }

  const javascriptFiles = readdirSync(directory)
    .filter((name) => name.endsWith(".js"))
    .sort();
  if (javascriptFiles.length === 0) {
    throw new Error(
      `Packaged Android JavaScript assets are unavailable: ${directory}`
    );
  }

  return javascriptFiles.map((name) =>
    readFileSync(resolve(directory, name), "utf8")
  );
}

function readPackagedJavascript(directory: string): string {
  return readPackagedJavascriptFiles(directory).join("\n");
}

describe("Android caller contract derivation", () => {
  it("derives method, route template, query keys, and content type together", () => {
    const generatedCaller = `
      async function updateCustomer(id) {
        const query = new URLSearchParams();
        query.append(\`page\`, \`1\`);
        return apiFetch(\`\${apiBase}/v1/customers/\${id}?\${query}\`, {
          method: \`PATCH\`,
          headers: { "Content-Type": \`application/json\` },
        });
      }
    `;

    expect(derivePackagedCallerContracts([generatedCaller])).toEqual([
      {
        method: "PATCH",
        path: "/v1/customers/{id}",
        queryKeys: ["page"],
        contentTypes: ["application/json"],
        responseType: "json",
      },
    ]);
  });

  it("derives protected callers expressed as async arrow functions", () => {
    const templateQuote = String.fromCharCode(96);
    const generatedCaller = [
      "const updateCustomer = async (id) => {",
      "  return apiFetch(" +
        templateQuote +
        "$" +
        "{apiBase}/v1/customers/" +
        "$" +
        "{id}" +
        templateQuote +
        ", {",
      '    method: "PATCH",',
      '    headers: { "Content-Type": "application/json" },',
      "  });",
      "};",
    ].join("\n");

    expect(derivePackagedCallerContracts([generatedCaller])).toEqual([
      {
        method: "PATCH",
        path: "/v1/customers/{id}",
        queryKeys: [],
        contentTypes: ["application/json"],
        responseType: "json",
      },
    ]);
  });

  it("rejects promise-returning protected callers that are not statically classified", () => {
    const templateQuote = String.fromCharCode(96);
    const generatedCaller = [
      "function loadCustomers() {",
      "  return apiFetch(" +
        templateQuote +
        "$" +
        "{apiBase}/v1/customers" +
        templateQuote +
        ");",
      "}",
    ].join("\n");

    expect(() => derivePackagedCallerContracts([generatedCaller])).toThrow(
      "Protected Android caller must use a statically classified async function"
    );
  });

  it("rejects non-async callers with multiple protected requests", () => {
    const templateQuote = String.fromCharCode(96);
    const generatedCaller = [
      "function loadProtectedResources() {",
      "  apiFetch(" +
        templateQuote +
        "$" +
        "{apiBase}/v1/customers" +
        templateQuote +
        ");",
      "  return apiFetch(" +
        templateQuote +
        "$" +
        "{apiBase}/v1/sites" +
        templateQuote +
        ");",
      "}",
    ].join("\n");

    expect(() => derivePackagedCallerContracts([generatedCaller])).toThrow(
      "Protected Android caller must use a statically classified async function"
    );
  });

  it("rejects protected routes assembled through string concatenation", () => {
    const generatedCaller = [
      "async function loadCustomer(id) {",
      '  return apiFetch(apiBase + "/v1/customers/" + id);',
      "}",
    ].join("\n");

    expect(() => derivePackagedCallerContracts([generatedCaller])).toThrow(
      "Protected Android caller contains an ambiguous route expression"
    );
  });
});

describe("Android native-auth route inventory", () => {
  it("fails closed when packaged Android assets are unavailable", () => {
    expect(() =>
      readPackagedJavascript(
        resolve(repoRoot, "android/app/src/main/assets/missing-public-assets")
      )
    ).toThrow("Packaged Android JavaScript assets are unavailable");
  });

  it("keeps every reviewed protected route family represented in the native policy", () => {
    for (const routeFamily of protectedRouteFamilies) {
      expect(nativePolicy, routeFamily).toContain(routeFamily);
    }
  });

  it("keeps removed Android provisioning requests out of the native policy", () => {
    expect(nativePolicy).not.toContain("/v1/android-enrollment-sessions");
  });

  it("does not retain route families that have no packaged Android caller", () => {
    const unprovenNativeRoutes = [
      '"PATCH", "/v1/me/language"',
      '"GET", "/v1/me/organizational-scopes"',
      '"POST", "/v1/qualifications"',
      '"POST", "/v1/employees/" + ID + "/qualifications"',
      '"POST", "/v1/sites/" + ID + "/cost-centers"',
      '"POST", "/v1/customers/" + ID + "/assignments"',
      '"POST", "/v1/employees/" + ID + "/documents"',
      '"GET", "/v1/onboarding/steps"',
      '"POST", "/v1/onboarding-review/submissions/"',
      '"GET", "/v1/android-enrollment-sessions"',
    ];

    for (const route of unprovenNativeRoutes) {
      expect(nativePolicy).not.toContain(route);
    }
  });
});

describe("generated Android frontend route parity", () => {
  let generatedJavascript = "";
  let generatedJavascriptFiles: string[] = [];

  beforeAll(() => {
    generatedJavascriptFiles = readPackagedJavascriptFiles(
      packagedAssetsDirectory
    );
    generatedJavascript = generatedJavascriptFiles.join("\n");
  });

  it("matches every protected caller's complete native request contract", () => {
    expect(derivePackagedCallerContracts(generatedJavascriptFiles)).toEqual(
      parseNativeRouteContracts(nativePolicy)
    );
  });

  it("keeps removed Android provisioning requests out of the packaged app", () => {
    expect(generatedJavascript).not.toContain(
      "/v1/android-enrollment-sessions"
    );
  });
});
