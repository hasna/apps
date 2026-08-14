import { existsSync, readFileSync } from "node:fs";
import packageJson from "../package.json";
import { CLI_HELP } from "../src/cli";
import { SAFE_MCP_TOOLS } from "../src/mcp";
import { ComputersClient } from "../src/sdk";
import { REST_NON_OPERATION_RESPONSE_MANIFEST, REST_ROUTE_ERROR_CONTRACT, REST_ROUTE_MANIFEST } from "../src/server";

interface ResourceSurface {
  rest: string[];
  sdk: string[];
  cli: string[];
  mcp: string[];
  restOmission?: string;
  sdkOmission?: string;
  cliOmission?: string;
  mcpOmission?: string;
}

interface Manifest {
  package: string;
  binaries: string[];
  exports: string[];
  mcpTools: string[];
  mcpAnnotations: Record<string, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }>;
  forbiddenMcp: string[];
  resources: Record<string, ResourceSurface>;
  sandbox: { executableMutation: boolean; errorCode: string };
}

interface OpenApiOperation {
  responses?: Record<string, unknown>;
  security?: unknown;
  "x-error-codes-by-status"?: Record<string, string[]>;
}

export interface OpenApiDocument {
  security?: unknown;
  "x-runtime-response-matrix"?: unknown;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    responses?: Record<string, unknown>;
    schemas?: Record<string, unknown>;
  };
}

export const REQUIRED_MUTABLE_RUNTIME_RESPONSES = {
  "POST /v1/computers": ["201", "400", "401", "403", "404", "409", "413", "500", "503"],
  "POST /v1/computers/adopt": ["201", "400", "401", "403", "409", "413", "500"],
  "POST /v1/computer-create-grants": ["201", "400", "401", "403", "404", "409", "413", "500"],
  "POST /v1/computers/{computerId}/start": ["202", "400", "401", "403", "404", "409", "413", "500"],
  "POST /v1/computers/{computerId}/stop": ["202", "400", "401", "403", "404", "409", "413", "500"],
  "POST /v1/computers/{computerId}/quarantine": ["202", "400", "401", "403", "404", "409", "413", "500"],
  "POST /v1/computers/{computerId}/delete": ["202", "400", "401", "403", "404", "409", "413", "500"],
  "POST /v1/computers/{computerId}/exec": ["202", "400", "401", "403", "404", "409", "413", "500"],
  "POST /v1/computers/{computerId}/install/plan": ["200", "400", "401", "403", "404", "413", "500"],
  "POST /v1/computers/{computerId}/install/apply": ["202", "400", "401", "403", "404", "409", "413", "500"],
  "POST /v1/computers/{computerId}/install/policy": ["201", "400", "401", "403", "404", "409", "413", "500"],
  "POST /v1/computers/{computerId}/snapshots": ["401", "403", "404", "500", "503"],
  "POST /v1/profiles": ["201", "400", "401", "403", "409", "413", "500"],
} as const satisfies Record<string, readonly string[]>;

export const REQUIRED_MUTABLE_RUNTIME_ERROR_CODES = Object.fromEntries(
  Object.keys(REQUIRED_MUTABLE_RUNTIME_RESPONSES).map((route) => [
    route,
    REST_ROUTE_ERROR_CONTRACT[route as keyof typeof REST_ROUTE_ERROR_CONTRACT],
  ]),
) as {
  [Route in keyof typeof REQUIRED_MUTABLE_RUNTIME_RESPONSES]: (typeof REST_ROUTE_ERROR_CONTRACT)[Route];
};

export const RUNTIME_ERROR_CODES = [
  "authentication_required", "authorization_denied", "not_found", "conflict", "invalid_request", "request_too_large",
  "provider_not_configured", "provider_outcome_unknown", "unsupported_operation", "sandbox_disabled", "replay_detected",
  "stale_fence", "expired", "policy_generation_mismatch", "quota_exceeded", "storage_error",
] as const;

type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];
interface AuthenticatedGetContract {
  statuses: readonly string[];
  errorCodes: Readonly<Record<string, readonly RuntimeErrorCode[]>>;
}

export const REQUIRED_AUTHENTICATED_GET_RESPONSES = {
  "GET /v1/computers": {
    statuses: ["200", "401", "403", "500"],
    errorCodes: REST_ROUTE_ERROR_CONTRACT["GET /v1/computers"],
  },
  "GET /v1/computer-create-grants": {
    statuses: ["200", "401", "403", "500"],
    errorCodes: REST_ROUTE_ERROR_CONTRACT["GET /v1/computer-create-grants"],
  },
  "GET /v1/computers/{computerId}": {
    statuses: ["200", "401", "403", "404", "500"],
    errorCodes: REST_ROUTE_ERROR_CONTRACT["GET /v1/computers/{computerId}"],
  },
  "GET /v1/computers/{computerId}/install/policy": {
    statuses: ["200", "401", "403", "404", "500"],
    errorCodes: REST_ROUTE_ERROR_CONTRACT["GET /v1/computers/{computerId}/install/policy"],
  },
  "GET /v1/computers/{computerId}/snapshots": {
    statuses: ["200", "401", "403", "404", "500"],
    errorCodes: REST_ROUTE_ERROR_CONTRACT["GET /v1/computers/{computerId}/snapshots"],
  },
  "GET /v1/operations": {
    statuses: ["200", "400", "401", "403", "404", "500"],
    errorCodes: REST_ROUTE_ERROR_CONTRACT["GET /v1/operations"],
  },
  "GET /v1/assignments": {
    statuses: ["200", "401", "403", "500"],
    errorCodes: REST_ROUTE_ERROR_CONTRACT["GET /v1/assignments"],
  },
  "GET /v1/profiles": {
    statuses: ["200", "401", "403", "500"],
    errorCodes: REST_ROUTE_ERROR_CONTRACT["GET /v1/profiles"],
  },
  "GET /v1/providers/readiness": {
    statuses: ["200", "401", "403", "500"],
    errorCodes: REST_ROUTE_ERROR_CONTRACT["GET /v1/providers/readiness"],
  },
} as const satisfies Record<string, AuthenticatedGetContract>;

export const REQUIRED_PUBLIC_RUNTIME_RESPONSES = {
  "GET /health": {
    statuses: ["200", "403"],
    errorCodes: REST_ROUTE_ERROR_CONTRACT["GET /health"],
  },
  "GET /ready": {
    statuses: ["200", "403", "500", "503"],
    errorCodes: REST_ROUTE_ERROR_CONTRACT["GET /ready"],
  },
  "GET /version": {
    statuses: ["200", "403"],
    errorCodes: REST_ROUTE_ERROR_CONTRACT["GET /version"],
  },
  "GET /openapi.json": {
    statuses: ["200", "403", "500"],
    errorCodes: REST_ROUTE_ERROR_CONTRACT["GET /openapi.json"],
  },
} as const satisfies Record<string, AuthenticatedGetContract>;

export const REQUIRED_SANDBOX_RUNTIME_RESPONSES = {
  "GET /v1/sandboxes": {
    statuses: ["401", "403", "500", "501"],
    errorCodes: REST_ROUTE_ERROR_CONTRACT["GET /v1/sandboxes"],
  },
  "POST /v1/sandboxes": {
    statuses: ["401", "403", "500", "501"],
    errorCodes: REST_ROUTE_ERROR_CONTRACT["POST /v1/sandboxes"],
  },
} as const satisfies Record<string, AuthenticatedGetContract>;

const manifest = JSON.parse(readFileSync("schemas/surface-parity.json", "utf8")) as Manifest;
const openapi = JSON.parse(readFileSync("schemas/openapi.json", "utf8")) as OpenApiDocument;
if (manifest.package !== packageJson.name) throw new Error("Surface package name mismatch");

function equalSets(left: string[], right: string[], label: string): void {
  const a = [...left].sort(); const b = [...right].sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label} mismatch: ${JSON.stringify({ manifest: a, runtime: b })}`);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  equalSets(Object.keys(value), [...expected], `${label} keys`);
}

function assertErrorCodeMatrix(
  rawActual: unknown,
  expected: Readonly<Record<string, readonly RuntimeErrorCode[]>>,
  label: string,
): void {
  const actual = object(rawActual, label);
  equalSets(Object.keys(actual), Object.keys(expected), `${label} statuses`);
  for (const [status, expectedCodes] of Object.entries(expected)) {
    equalSets(stringArray(actual[status], `${label} ${status}`), [...expectedCodes], `${label} ${status}`);
  }
}

function assertRouteContract(document: OpenApiDocument, route: string, contract: AuthenticatedGetContract): void {
  const separator = route.indexOf(" ");
  const method = route.slice(0, separator).toLowerCase();
  const path = route.slice(separator + 1);
  const operation = document.paths[path]?.[method];
  if (operation === undefined) throw new Error(`OpenAPI/runtime route mismatch: ${route}`);
  const responses = object(operation.responses, `${route} responses`);
  equalSets(Object.keys(responses), [...contract.statuses], `${route} response status matrix`);
  for (const status of contract.statuses.filter((candidate) => Number(candidate) >= 400)) {
    if (object(responses[status], `${route} response ${status}`).$ref !== "#/components/responses/Error") {
      throw new Error(`${route} response ${status} must use the bounded reusable Error response`);
    }
  }
  assertErrorCodeMatrix(operation["x-error-codes-by-status"], contract.errorCodes, `${route} error-code matrix`);
}

export function assertRequiredRuntimeResponses(document: OpenApiDocument): void {
  const mutableRoutes = REST_ROUTE_MANIFEST
    .filter((route) => route.method === "POST" && route.path.startsWith("/v1/") && route.path !== "/v1/sandboxes")
    .map((route) => `${route.method} ${route.path}`);
  equalSets(Object.keys(REQUIRED_MUTABLE_RUNTIME_RESPONSES), mutableRoutes, "Mutable REST response contract coverage");
  equalSets(Object.keys(REQUIRED_MUTABLE_RUNTIME_ERROR_CODES), mutableRoutes, "Mutable REST error-code contract coverage");
  for (const [route, requiredStatuses] of Object.entries(REQUIRED_MUTABLE_RUNTIME_RESPONSES)) {
    assertRouteContract(document, route, {
      statuses: requiredStatuses,
      errorCodes: REQUIRED_MUTABLE_RUNTIME_ERROR_CODES[route as keyof typeof REQUIRED_MUTABLE_RUNTIME_ERROR_CODES],
    });
  }
}

export function assertAuthenticatedGetResponses(document: OpenApiDocument): void {
  const authenticatedGetRoutes = REST_ROUTE_MANIFEST
    .filter((route) => route.method === "GET" && route.path.startsWith("/v1/") && route.path !== "/v1/sandboxes")
    .map((route) => `${route.method} ${route.path}`);
  equalSets(Object.keys(REQUIRED_AUTHENTICATED_GET_RESPONSES), authenticatedGetRoutes, "Authenticated GET response contract coverage");
  for (const [route, contract] of Object.entries(REQUIRED_AUTHENTICATED_GET_RESPONSES)) {
    assertRouteContract(document, route, contract);
  }
}

export function assertPublicResponses(document: OpenApiDocument): void {
  const publicRoutes = REST_ROUTE_MANIFEST
    .filter((route) => route.method === "GET" && !route.path.startsWith("/v1/"))
    .map((route) => `${route.method} ${route.path}`);
  equalSets(Object.keys(REQUIRED_PUBLIC_RUNTIME_RESPONSES), publicRoutes, "Public REST response contract coverage");
  for (const [route, contract] of Object.entries(REQUIRED_PUBLIC_RUNTIME_RESPONSES)) assertRouteContract(document, route, contract);
}

export function assertSandboxResponses(document: OpenApiDocument): void {
  const sandboxRoutes = REST_ROUTE_MANIFEST
    .filter((route) => route.path === "/v1/sandboxes")
    .map((route) => `${route.method} ${route.path}`);
  equalSets(Object.keys(REQUIRED_SANDBOX_RUNTIME_RESPONSES), sandboxRoutes, "Sandbox REST response contract coverage");
  for (const [route, contract] of Object.entries(REQUIRED_SANDBOX_RUNTIME_RESPONSES)) assertRouteContract(document, route, contract);
}

export function assertNonOperationResponses(document: OpenApiDocument): void {
  if (JSON.stringify(document["x-runtime-response-matrix"]) !== JSON.stringify(REST_NON_OPERATION_RESPONSE_MANIFEST)) {
    throw new Error("CORS preflight/fallthrough response matrix mismatch");
  }
}

export function assertOperationSecurity(document: OpenApiDocument): void {
  if (JSON.stringify(document.security) !== JSON.stringify([{ bearerAuth: [] }])) {
    throw new Error("OpenAPI root security must require bearerAuth");
  }
  const publicRoutes = new Set(Object.keys(REQUIRED_PUBLIC_RUNTIME_RESPONSES));
  for (const route of REST_ROUTE_MANIFEST) {
    const routeName = `${route.method} ${route.path}`;
    const operation = document.paths[route.path]?.[route.method.toLowerCase()];
    if (operation === undefined) throw new Error(`OpenAPI/runtime route mismatch: ${routeName}`);
    if (publicRoutes.has(routeName)) {
      if (!Array.isArray(operation.security) || operation.security.length !== 0) {
        throw new Error(`${routeName} must declare security: []`);
      }
    } else if (operation.security !== undefined) {
      throw new Error(`${routeName} must inherit bearer security`);
    }
  }
}

export function assertBoundedErrorSchema(document: OpenApiDocument): void {
  const responses = object(document.components?.responses, "OpenAPI component responses");
  const errorResponse = object(responses.Error, "Error response");
  const content = object(errorResponse.content, "Error response content");
  const media = object(content["application/json"], "Error response JSON content");
  if (object(media.schema, "Error response schema").$ref !== "#/components/schemas/Error") throw new Error("Error response must reuse the Error schema");

  const schemas = object(document.components?.schemas, "OpenAPI component schemas");
  const errorCode = object(schemas.ErrorCode, "ErrorCode schema");
  exactKeys(errorCode, ["type", "enum"], "ErrorCode schema");
  if (errorCode.type !== "string" || !Array.isArray(errorCode.enum)) throw new Error("ErrorCode must be a bounded string enum");
  equalSets(errorCode.enum.map(String), [...RUNTIME_ERROR_CODES], "ErrorCode/runtime error code surface");

  const errorDetail = object(schemas.ErrorDetail, "ErrorDetail schema");
  exactKeys(errorDetail, ["type", "required", "properties", "additionalProperties"], "ErrorDetail schema");
  if (errorDetail.type !== "object" || errorDetail.additionalProperties !== false) throw new Error("ErrorDetail must be a closed object");
  if (!Array.isArray(errorDetail.required)) throw new Error("ErrorDetail required fields must be bounded");
  equalSets(errorDetail.required.map(String), ["code", "message", "requestId"], "ErrorDetail required fields");
  const detailProperties = object(errorDetail.properties, "ErrorDetail properties");
  exactKeys(detailProperties, ["code", "message", "requestId"], "ErrorDetail properties");
  if (object(detailProperties.code, "ErrorDetail.code").$ref !== "#/components/schemas/ErrorCode") throw new Error("ErrorDetail.code must reuse ErrorCode");
  const message = object(detailProperties.message, "ErrorDetail.message");
  if (message.type !== "string" || message.minLength !== 1 || message.maxLength !== 512) throw new Error("ErrorDetail.message must be bounded");
  const requestId = object(detailProperties.requestId, "ErrorDetail.requestId");
  if (requestId.type !== "string" || requestId.minLength !== 8 || requestId.maxLength !== 128 || requestId.pattern !== "^[A-Za-z0-9._:-]+$") {
    throw new Error("ErrorDetail.requestId must match the bounded runtime request ID contract");
  }

  const error = object(schemas.Error, "Error schema");
  exactKeys(error, ["type", "required", "properties", "additionalProperties"], "Error schema");
  if (error.type !== "object" || error.additionalProperties !== false || !Array.isArray(error.required)) throw new Error("Error must be a closed object");
  equalSets(error.required.map(String), ["error"], "Error required fields");
  const errorProperties = object(error.properties, "Error properties");
  exactKeys(errorProperties, ["error"], "Error properties");
  if (object(errorProperties.error, "Error.error").$ref !== "#/components/schemas/ErrorDetail") throw new Error("Error must reuse ErrorDetail");
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) throw new Error(`${label} must be a string array`);
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicates`);
  return value as string[];
}

function cliCommandsFromHelp(): string[] {
  const section = CLI_HELP.match(/Commands:\n([\s\S]*?)\n\nRequests return/);
  if (section?.[1] === undefined) throw new Error("CLI help command section is unavailable");
  return section[1].split("\n").map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    const withoutNote = line.replace(/\s+\(.*$/, "");
    const withoutOptions = withoutNote.replace(/\s+\[?--.*$/, "");
    const tokens = withoutOptions.split(/\s+/);
    const variantIndex = tokens.findIndex((token) => token.includes("|"));
    if (variantIndex < 0) return [tokens.join(" ")];
    const prefix = tokens.slice(0, variantIndex).join(" ");
    return tokens[variantIndex]!.split("|").map((variant) => `${prefix} ${variant}`);
  });
}

export function assertResourceSurfaceMatrix(rawManifest: unknown): void {
  const value = object(rawManifest, "Surface manifest");
  const resources = object(value.resources, "Resource surface matrix");
  if (Object.keys(resources).length === 0) throw new Error("Resource surface matrix is empty");
  const collected = { rest: [] as string[], sdk: [] as string[], cli: [] as string[], mcp: [] as string[] };
  for (const [resourceName, rawResource] of Object.entries(resources)) {
    const resource = object(rawResource, `Resource ${resourceName}`);
    const allowed = ["rest", "sdk", "cli", "mcp", "restOmission", "sdkOmission", "cliOmission", "mcpOmission"];
    if (Object.keys(resource).some((key) => !allowed.includes(key))) throw new Error(`Resource ${resourceName} has an unknown surface field`);
    for (const surface of ["rest", "sdk", "cli", "mcp"] as const) {
      const entries = stringArray(resource[surface], `Resource ${resourceName}.${surface}`);
      const omission = resource[`${surface}Omission`];
      if (entries.length === 0 && (typeof omission !== "string" || omission.length < 16 || omission.length > 256)) {
        throw new Error(`Resource ${resourceName}.${surface} omission must be documented`);
      }
      if (entries.length > 0 && omission !== undefined) throw new Error(`Resource ${resourceName}.${surface} cannot declare an omission with entries`);
      collected[surface].push(...entries);
    }
  }
  for (const [surface, entries] of Object.entries(collected)) {
    if (new Set(entries).size !== entries.length) throw new Error(`${surface.toUpperCase()} resource surface contains duplicate ownership`);
  }
  equalSets(collected.rest, REST_ROUTE_MANIFEST.map((route) => `${route.method} ${route.path}`), "REST resource surface");
  const sdkMethods = Object.getOwnPropertyNames(ComputersClient.prototype).filter((name) => !["constructor", "request"].includes(name));
  equalSets(collected.sdk, sdkMethods, "SDK resource surface");
  equalSets(collected.cli, cliCommandsFromHelp(), "CLI resource surface");
  equalSets(collected.mcp, SAFE_MCP_TOOLS.map((tool) => tool.name), "MCP resource surface");
}

equalSets(manifest.binaries, Object.keys(packageJson.bin), "Binary surface");
equalSets(manifest.exports, Object.keys(packageJson.exports), "Export surface");
equalSets(manifest.mcpTools, SAFE_MCP_TOOLS.map((tool) => tool.name), "MCP tool surface");
equalSets(Object.keys(manifest.mcpAnnotations), SAFE_MCP_TOOLS.map((tool) => tool.name), "MCP annotation surface");
equalSets(
  Object.keys(REST_ROUTE_ERROR_CONTRACT),
  REST_ROUTE_MANIFEST.map((route) => `${route.method} ${route.path}`),
  "Runtime route error-contract coverage",
);
for (const target of Object.values(packageJson.bin)) if (!existsSync(String(target).replace("./dist", "src").replace(/\.js$/, ".ts").replace("src/computers", "src/bin/computers"))) {
  throw new Error(`Binary source is missing for ${target}`);
}
for (const route of REST_ROUTE_MANIFEST) {
  if (openapi.paths[route.path]?.[route.method.toLowerCase()] === undefined) throw new Error(`OpenAPI/runtime route mismatch: ${route.method} ${route.path}`);
}
assertRequiredRuntimeResponses(openapi);
assertAuthenticatedGetResponses(openapi);
assertPublicResponses(openapi);
assertSandboxResponses(openapi);
assertNonOperationResponses(openapi);
assertOperationSecurity(openapi);
assertBoundedErrorSchema(openapi);
assertResourceSurfaceMatrix(manifest);
const openapiRoutes = Object.entries(openapi.paths).flatMap(([path, item]) => Object.keys(item)
  .filter((method) => ["get", "post", "put", "patch", "delete", "options", "head", "trace"].includes(method))
  .map((method) => `${method.toUpperCase()} ${path}`));
equalSets(openapiRoutes, REST_ROUTE_MANIFEST.map((route) => `${route.method} ${route.path}`), "REST/OpenAPI route surface");
for (const tool of SAFE_MCP_TOOLS) {
  if (tool.inputSchema.additionalProperties !== false) throw new Error(`Unsafe MCP schema: ${tool.name}`);
  if (JSON.stringify(manifest.mcpAnnotations[tool.name]) !== JSON.stringify(tool.annotations)) throw new Error(`MCP annotation mismatch: ${tool.name}`);
}
const expectedAnnotations: Manifest["mcpAnnotations"] = {
  computers_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  computers_get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  computers_operations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  computers_exec_request: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  computers_install_plan: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  computers_provider_readiness: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
if (JSON.stringify(manifest.mcpAnnotations) !== JSON.stringify(expectedAnnotations)) throw new Error("MCP annotations are not the reviewed truthful contract");
for (const forbidden of ["delete", "reassign", "restore", "policy", "sandbox"]) {
  if (SAFE_MCP_TOOLS.some((tool) => tool.name.toLowerCase().includes(forbidden))) throw new Error(`Forbidden MCP tool exposed: ${forbidden}`);
}
if (manifest.sandbox.executableMutation || manifest.sandbox.errorCode !== "sandbox_disabled") throw new Error("Sandbox must remain deterministically disabled");
process.stdout.write("surface parity checks passed\n");
