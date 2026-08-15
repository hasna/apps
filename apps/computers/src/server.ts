import { authenticateBearer, type BearerPrincipal } from "./auth";
import { existsSync } from "node:fs";
import {
  API_VERSION,
  ALL_SCOPES,
  ComputersError,
  PACKAGE_NAME,
  VERSION,
  type ApiErrorBody,
  type AuthorizationContext,
  type AdoptComputerInput,
  type CreateComputerGrantInput,
  type CreateComputerInput,
  type CreateComputerProfileInput,
  type ExecRequest,
  type ErrorCode,
  type InstallPolicyRule,
  type Scope,
} from "./contracts";
import type { ComputersService } from "./service";
import { assertExactKeys, validateId, validateIdempotencyKey, validateRequestObject } from "./validation";

export const MAX_REQUEST_BYTES = 1024 * 1024;
export const MAX_AUTH_CONFIG_BYTES = 256 * 1024;
export const REST_ROUTE_MANIFEST = [
  { method: "GET", path: "/health" }, { method: "GET", path: "/ready" }, { method: "GET", path: "/version" }, { method: "GET", path: "/openapi.json" },
  { method: "GET", path: "/v1/computers" }, { method: "POST", path: "/v1/computers" }, { method: "POST", path: "/v1/computers/adopt" },
  { method: "GET", path: "/v1/computer-create-grants" }, { method: "POST", path: "/v1/computer-create-grants" },
  { method: "GET", path: "/v1/computers/{computerId}" }, { method: "POST", path: "/v1/computers/{computerId}/start" },
  { method: "POST", path: "/v1/computers/{computerId}/stop" }, { method: "POST", path: "/v1/computers/{computerId}/quarantine" },
  { method: "POST", path: "/v1/computers/{computerId}/delete" }, { method: "POST", path: "/v1/computers/{computerId}/exec" },
  { method: "POST", path: "/v1/computers/{computerId}/install/plan" }, { method: "POST", path: "/v1/computers/{computerId}/install/apply" },
  { method: "GET", path: "/v1/computers/{computerId}/install/policy" }, { method: "POST", path: "/v1/computers/{computerId}/install/policy" },
  { method: "GET", path: "/v1/computers/{computerId}/snapshots" }, { method: "POST", path: "/v1/computers/{computerId}/snapshots" },
  { method: "GET", path: "/v1/operations" }, { method: "GET", path: "/v1/assignments" }, { method: "GET", path: "/v1/profiles" }, { method: "POST", path: "/v1/profiles" },
  { method: "GET", path: "/v1/providers/readiness" }, { method: "GET", path: "/v1/sandboxes" }, { method: "POST", path: "/v1/sandboxes" },
] as const;
export const REST_NON_OPERATION_RESPONSE_MANIFEST = {
  corsPreflight: {
    appliesTo: "all paths except /v1/sandboxes/*",
    statuses: ["204", "403"],
    errorCodes: { "403": ["authorization_denied"] },
  },
  authenticatedFallthrough: {
    appliesTo: "unmatched methods and paths after authentication",
    statuses: ["401", "403", "404"],
    errorCodes: {
      "401": ["authentication_required"], "403": ["authorization_denied"], "404": ["not_found"],
    },
  },
} as const;

type RestErrorContract = Readonly<Record<string, readonly ErrorCode[]>>;

export const REST_ROUTE_ERROR_CONTRACT = {
  "GET /health": { "403": ["authorization_denied"] },
  "GET /ready": { "403": ["authorization_denied"], "500": ["storage_error"], "503": ["storage_error"] },
  "GET /version": { "403": ["authorization_denied"] },
  "GET /openapi.json": { "403": ["authorization_denied"], "500": ["storage_error"] },
  "GET /v1/computers": { "401": ["authentication_required"], "403": ["authorization_denied"], "500": ["storage_error"] },
  "POST /v1/computers": { "400": ["invalid_request"], "401": ["authentication_required"], "403": ["authorization_denied", "policy_generation_mismatch"], "404": ["not_found"], "409": ["conflict", "quota_exceeded"], "413": ["request_too_large"], "500": ["storage_error"], "503": ["provider_not_configured"] },
  "POST /v1/computers/adopt": { "400": ["invalid_request"], "401": ["authentication_required"], "403": ["authorization_denied"], "409": ["conflict"], "413": ["request_too_large"], "500": ["storage_error"] },
  "GET /v1/computer-create-grants": { "401": ["authentication_required"], "403": ["authorization_denied"], "500": ["storage_error"] },
  "POST /v1/computer-create-grants": { "400": ["invalid_request"], "401": ["authentication_required"], "403": ["authorization_denied", "policy_generation_mismatch"], "404": ["not_found"], "409": ["conflict"], "413": ["request_too_large"], "500": ["storage_error"] },
  "GET /v1/computers/{computerId}": { "401": ["authentication_required"], "403": ["authorization_denied", "policy_generation_mismatch"], "404": ["not_found"], "500": ["storage_error"] },
  "POST /v1/computers/{computerId}/start": { "400": ["invalid_request"], "401": ["authentication_required"], "403": ["authorization_denied", "policy_generation_mismatch"], "404": ["not_found"], "409": ["conflict", "stale_fence"], "413": ["request_too_large"], "500": ["storage_error"] },
  "POST /v1/computers/{computerId}/stop": { "400": ["invalid_request"], "401": ["authentication_required"], "403": ["authorization_denied", "policy_generation_mismatch"], "404": ["not_found"], "409": ["conflict"], "413": ["request_too_large"], "500": ["storage_error"] },
  "POST /v1/computers/{computerId}/quarantine": { "400": ["invalid_request"], "401": ["authentication_required"], "403": ["authorization_denied", "policy_generation_mismatch"], "404": ["not_found"], "409": ["conflict"], "413": ["request_too_large"], "500": ["storage_error"] },
  "POST /v1/computers/{computerId}/delete": { "400": ["invalid_request"], "401": ["authentication_required"], "403": ["authorization_denied", "policy_generation_mismatch"], "404": ["not_found"], "409": ["conflict"], "413": ["request_too_large"], "500": ["storage_error"] },
  "POST /v1/computers/{computerId}/exec": { "400": ["invalid_request"], "401": ["authentication_required"], "403": ["authorization_denied", "policy_generation_mismatch"], "404": ["not_found"], "409": ["conflict"], "413": ["request_too_large"], "500": ["storage_error"] },
  "POST /v1/computers/{computerId}/install/plan": { "400": ["invalid_request"], "401": ["authentication_required"], "403": ["authorization_denied", "policy_generation_mismatch"], "404": ["not_found"], "413": ["request_too_large"], "500": ["storage_error"] },
  "POST /v1/computers/{computerId}/install/apply": { "400": ["invalid_request"], "401": ["authentication_required"], "403": ["authorization_denied", "policy_generation_mismatch"], "404": ["not_found"], "409": ["conflict", "expired", "policy_generation_mismatch", "replay_detected"], "413": ["request_too_large"], "500": ["storage_error"] },
  "GET /v1/computers/{computerId}/install/policy": { "401": ["authentication_required"], "403": ["authorization_denied", "policy_generation_mismatch"], "404": ["not_found"], "500": ["storage_error"] },
  "POST /v1/computers/{computerId}/install/policy": { "400": ["invalid_request"], "401": ["authentication_required"], "403": ["authorization_denied", "policy_generation_mismatch"], "404": ["not_found"], "409": ["conflict", "policy_generation_mismatch"], "413": ["request_too_large"], "500": ["storage_error"] },
  "GET /v1/computers/{computerId}/snapshots": { "401": ["authentication_required"], "403": ["authorization_denied", "policy_generation_mismatch"], "404": ["not_found"], "500": ["storage_error"] },
  "POST /v1/computers/{computerId}/snapshots": { "401": ["authentication_required"], "403": ["authorization_denied", "policy_generation_mismatch"], "404": ["not_found"], "500": ["storage_error"], "503": ["provider_not_configured"] },
  "GET /v1/operations": { "400": ["invalid_request"], "401": ["authentication_required"], "403": ["authorization_denied", "policy_generation_mismatch"], "404": ["not_found"], "500": ["storage_error"] },
  "GET /v1/assignments": { "401": ["authentication_required"], "403": ["authorization_denied"], "500": ["storage_error"] },
  "GET /v1/profiles": { "401": ["authentication_required"], "403": ["authorization_denied"], "500": ["storage_error"] },
  "POST /v1/profiles": { "400": ["invalid_request"], "401": ["authentication_required"], "403": ["authorization_denied"], "409": ["conflict"], "413": ["request_too_large"], "500": ["storage_error"] },
  "GET /v1/providers/readiness": { "401": ["authentication_required"], "403": ["authorization_denied"], "500": ["storage_error"] },
  "GET /v1/sandboxes": { "401": ["authentication_required"], "403": ["authorization_denied"], "500": ["storage_error"], "501": ["sandbox_disabled"] },
  "POST /v1/sandboxes": { "401": ["authentication_required"], "403": ["authorization_denied"], "500": ["storage_error"], "501": ["sandbox_disabled"] },
} as const satisfies Record<string, RestErrorContract>;

function invalidAuthConfiguration(): never {
  throw new ComputersError("authentication_required", "Invalid authentication configuration", 500);
}

export function parseBearerPrincipals(raw: string): BearerPrincipal[] {
  try {
    if (new TextEncoder().encode(raw).byteLength > MAX_AUTH_CONFIG_BYTES) invalidAuthConfiguration();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 128) invalidAuthConfiguration();
    const hashes = new Set<string>();
    const identities = new Set<string>();
    return parsed.map((entry) => {
      const object = validateRequestObject(entry);
      assertExactKeys(object, ["tokenHash", "context"]);
      if (typeof object.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(object.tokenHash) || hashes.has(object.tokenHash)) invalidAuthConfiguration();
      hashes.add(object.tokenHash);
      const contextObject = validateRequestObject(object.context);
      assertExactKeys(contextObject, ["tenantId", "principalId", "scopes", "boundComputerId", "policyGeneration", "authMethod"]);
      const tenantId = validateId(contextObject.tenantId, "tenantId");
      const principalId = validateId(contextObject.principalId, "principalId");
      if (contextObject.authMethod !== "bearer" || !Array.isArray(contextObject.scopes) || contextObject.scopes.length < 1 || contextObject.scopes.length > ALL_SCOPES.length) invalidAuthConfiguration();
      const scopes = contextObject.scopes.map((scope) => {
        if (typeof scope !== "string" || !(ALL_SCOPES as readonly string[]).includes(scope)) invalidAuthConfiguration();
        return scope as Scope;
      });
      if (new Set(scopes).size !== scopes.length) invalidAuthConfiguration();
      const context: AuthorizationContext = { tenantId, principalId, scopes, authMethod: "bearer" };
      if (contextObject.boundComputerId !== undefined) context.boundComputerId = validateId(contextObject.boundComputerId, "boundComputerId");
      if (contextObject.policyGeneration !== undefined) {
        if (!Number.isSafeInteger(contextObject.policyGeneration) || Number(contextObject.policyGeneration) < 1) invalidAuthConfiguration();
        context.policyGeneration = Number(contextObject.policyGeneration);
      }
      if ((context.boundComputerId === undefined) !== (context.policyGeneration === undefined)) invalidAuthConfiguration();
      const mutatingScopes: Scope[] = ["computers:create", "computers:operate", "computers:exec", "computers:install", "computers:snapshot", "computers:assign", "computers:policy"];
      if (!scopes.includes("computers:admin") && scopes.some((scope) => mutatingScopes.includes(scope))
        && (context.boundComputerId === undefined || context.policyGeneration === undefined)) invalidAuthConfiguration();
      const identity = `${tenantId}\0${principalId}\0${context.boundComputerId ?? ""}`;
      if (identities.has(identity)) invalidAuthConfiguration();
      identities.add(identity);
      return { tokenHash: object.tokenHash, context };
    });
  } catch (error) {
    if (error instanceof ComputersError && error.message === "Invalid authentication configuration") throw error;
    return invalidAuthConfiguration();
  }
}

export interface AppOptions {
  principals?: BearerPrincipal[];
  loopbackDevelopmentMode?: boolean;
  loopbackContext?: AuthorizationContext;
  allowedOrigins?: string[];
  maxRequestBytes?: number;
  openApiAssetLoader?: () => Blob;
}

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

function internalFailure(): ComputersError {
  return new ComputersError("storage_error", "Internal server error", 500);
}

function requestErrorContract(request: Request): RestErrorContract {
  const pathname = new URL(request.url).pathname;
  if (request.method === "OPTIONS" && !pathname.startsWith("/v1/sandboxes/")) {
    return REST_NON_OPERATION_RESPONSE_MANIFEST.corsPreflight.errorCodes;
  }
  const directRoute = `${request.method} ${pathname}` as keyof typeof REST_ROUTE_ERROR_CONTRACT;
  const direct = REST_ROUTE_ERROR_CONTRACT[directRoute];
  if (direct !== undefined) return direct;
  const templatedPath = pathname.replace(
    /^\/v1\/computers\/[a-z][a-z0-9_]{2,63}(?=\/|$)/,
    "/v1/computers/{computerId}",
  );
  const templatedRoute = `${request.method} ${templatedPath}` as keyof typeof REST_ROUTE_ERROR_CONTRACT;
  return REST_ROUTE_ERROR_CONTRACT[templatedRoute]
    ?? REST_NON_OPERATION_RESPONSE_MANIFEST.authenticatedFallthrough.errorCodes;
}

function boundedFailure(error: unknown, request: Request): ComputersError {
  if (!(error instanceof ComputersError)) return internalFailure();
  const status = error.status;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) return internalFailure();
  if (typeof error.message !== "string" || error.message.length < 1 || error.message.length > 512) return internalFailure();
  if (typeof error.code !== "string") return internalFailure();
  const allowedCodes = requestErrorContract(request)[String(status)];
  if (allowedCodes === undefined || !allowedCodes.includes(error.code)) return internalFailure();
  if (error.code === "storage_error" && status === 500) return internalFailure();
  const pathname = new URL(request.url).pathname;
  if (error.code === "sandbox_disabled" && status === 501 && pathname === "/v1/sandboxes"
    && (request.method === "GET" || request.method === "POST")) {
    return new ComputersError("sandbox_disabled", "Sandbox integration is disabled", 501);
  }
  if (error.code === "provider_not_configured" && status === 503 && request.method === "POST"
    && /^\/v1\/computers\/[a-z][a-z0-9_]{2,63}\/snapshots$/.test(pathname)) {
    return new ComputersError("provider_not_configured", "Snapshot provider is not configured", 503);
  }
  if (error.code === "storage_error" && status === 503 && request.method === "GET" && pathname === "/ready") {
    return new ComputersError("storage_error", "Internal server error", 503);
  }
  return error;
}

function openApiAsset(): URL {
  for (const candidate of [new URL("../schemas/openapi.json", import.meta.url), new URL("../../schemas/openapi.json", import.meta.url)]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new ComputersError("storage_error", "OpenAPI schema asset is unavailable", 500);
}

function loopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function idempotencyFrom(request: Request, body: Record<string, unknown>): string {
  const header = request.headers.get("idempotency-key");
  if (header !== null && body.idempotencyKey !== undefined && body.idempotencyKey !== header) throw new ComputersError("conflict", "Idempotency key header and body differ", 409);
  return validateIdempotencyKey(header ?? body.idempotencyKey);
}

async function readJson(request: Request, limit: number): Promise<Record<string, unknown>> {
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > limit) throw new ComputersError("request_too_large", "Request body is too large", 413);
  if (request.body === null) throw new ComputersError("invalid_request", "JSON body is required", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ComputersError("request_too_large", "Request body is too large", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new ComputersError("invalid_request", "Malformed JSON body", 400); }
  return validateRequestObject(parsed);
}

async function readOptionalJson(request: Request, limit: number): Promise<Record<string, unknown>> {
  if (request.body === null) return {};
  return readJson(request, limit);
}

export function createApp(service: ComputersService, options: AppOptions = {}): (request: Request) => Promise<Response> {
  const principals = options.principals ?? [];
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const maxRequestBytes = options.maxRequestBytes ?? MAX_REQUEST_BYTES;
  const loopbackContext: AuthorizationContext = options.loopbackContext ?? {
    tenantId: "tenant_local", principalId: "principal_local", scopes: ["computers:admin"], authMethod: "loopback_dev",
  };

  return async (request: Request): Promise<Response> => {
    const requestId = request.headers.get("x-request-id")?.match(/^[A-Za-z0-9._:-]{8,128}$/)?.[0] ?? crypto.randomUUID();
    const responseHeaders: Record<string, string> = { "x-request-id": requestId, "cache-control": "no-store", "x-content-type-options": "nosniff" };
    try {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      if (request.method === "OPTIONS" && !url.pathname.startsWith("/v1/sandboxes/")) {
        if (origin === null || !allowedOrigins.has(origin)) throw new ComputersError("authorization_denied", "Origin is not allowed", 403);
        return new Response(null, { status: 204, headers: { ...responseHeaders, "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-methods": "GET,POST", "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,X-Request-Id" } });
      }
      if (origin !== null) {
        if (!allowedOrigins.has(origin)) throw new ComputersError("authorization_denied", "Origin is not allowed", 403);
        responseHeaders["access-control-allow-origin"] = origin;
        responseHeaders.vary = "Origin";
      }
      if (request.method === "GET" && url.pathname === "/health") return json({ status: "ok" }, 200, responseHeaders);
      if (request.method === "GET" && url.pathname === "/version") return json({ name: PACKAGE_NAME, version: VERSION, apiVersion: API_VERSION }, 200, responseHeaders);
      if (request.method === "GET" && url.pathname === "/openapi.json") {
        let asset: Blob;
        try {
          asset = options.openApiAssetLoader?.() ?? Bun.file(openApiAsset());
          const exists = (asset as { exists?: () => Promise<boolean> }).exists;
          if (typeof exists === "function" && !(await exists.call(asset))) {
            throw new ComputersError("storage_error", "Internal server error", 500);
          }
        } catch { throw new ComputersError("storage_error", "Internal server error", 500); }
        return new Response(asset, { headers: { ...responseHeaders, "content-type": "application/json" } });
      }
      if (request.method === "GET" && url.pathname === "/ready") {
        if (!service.storage.ready()) throw new ComputersError("storage_error", "Service is not ready", 503);
        return json({ ready: true, storage: "sqlite", postgresRuntimeReady: false, providersRequiredForCore: false, auditIndependentlyAnchored: false }, 200, responseHeaders);
      }

      const context = options.loopbackDevelopmentMode === true && loopbackHost(url.hostname)
        ? loopbackContext
        : await authenticateBearer(request.headers.get("authorization"), principals);

      if (request.method === "GET" && url.pathname === "/v1/computers") return json({ data: service.listComputers(context) }, 200, responseHeaders);
      if (request.method === "GET" && url.pathname === "/v1/computer-create-grants") return json({ data: service.listComputerGrants(context) }, 200, responseHeaders);
      if (request.method === "POST" && url.pathname === "/v1/computer-create-grants") {
        const body = await readJson(request, maxRequestBytes);
        return json(service.createComputerGrant(context, body as unknown as CreateComputerGrantInput), 201, responseHeaders);
      }
      if (request.method === "POST" && url.pathname === "/v1/computers") {
        const body = await readJson(request, maxRequestBytes);
        assertExactKeys(body, ["id", "slug", "provider", "ownerPrincipalId", "parentComputerId", "grantId", "region", "profileId", "storageGiB", "uptimeSeconds", "budgetMicros", "idempotencyKey", "broadInternet"]);
        const idempotencyKey = idempotencyFrom(request, body);
        return json(service.createComputer(context, { ...body, idempotencyKey } as unknown as CreateComputerInput), 201, responseHeaders);
      }
      if (request.method === "POST" && url.pathname === "/v1/computers/adopt") {
        const body = await readJson(request, maxRequestBytes); assertExactKeys(body, ["id", "slug", "ownerPrincipalId", "adoptionId", "profileId", "idempotencyKey"]);
        return json(service.adoptComputer(context, { ...body, idempotencyKey: idempotencyFrom(request, body) } as unknown as AdoptComputerInput), 201, responseHeaders);
      }
      if (request.method === "GET" && url.pathname === "/v1/operations") return json({ data: service.listOperations(context, url.searchParams.get("computerId") ?? undefined) }, 200, responseHeaders);
      if (request.method === "GET" && url.pathname === "/v1/providers/readiness") return json({ data: await service.providerReadiness(context) }, 200, responseHeaders);
      if (request.method === "GET" && url.pathname === "/v1/assignments") {
        return json({ data: service.listComputers(context).map((computer) => ({ computerId: computer.id, principalId: computer.ownerPrincipalId, generation: 1, active: true })) }, 200, responseHeaders);
      }
      if (request.method === "GET" && url.pathname === "/v1/profiles") return json({ data: service.listProfiles(context) }, 200, responseHeaders);
      if (request.method === "POST" && url.pathname === "/v1/profiles") return json(service.createProfile(context, await readJson(request, maxRequestBytes) as unknown as CreateComputerProfileInput), 201, responseHeaders);
      if (url.pathname === "/v1/sandboxes" && (request.method === "GET" || request.method === "POST")) service.sandboxDisabled();

      const computerMatch = url.pathname.match(/^\/v1\/computers\/(?!adopt$)([a-z][a-z0-9_]{2,63})$/);
      if (request.method === "GET" && computerMatch?.[1] !== undefined) return json(service.getComputer(context, computerMatch[1]), 200, responseHeaders);

      const actionMatch = url.pathname.match(/^\/v1\/computers\/([a-z][a-z0-9_]{2,63})\/(start|stop|quarantine|delete)$/);
      if (request.method === "POST" && actionMatch?.[1] !== undefined && actionMatch[2] !== undefined) {
        const body = await readOptionalJson(request, maxRequestBytes);
        assertExactKeys(body, ["idempotencyKey"]);
        const key = idempotencyFrom(request, body);
        return json(service.requestLifecycle(context, actionMatch[1], actionMatch[2] as "start" | "stop" | "quarantine" | "delete", key), 202, responseHeaders);
      }

      const execMatch = url.pathname.match(/^\/v1\/computers\/([a-z][a-z0-9_]{2,63})\/exec$/);
      if (request.method === "POST" && execMatch?.[1] !== undefined) {
        const body = await readJson(request, maxRequestBytes);
        assertExactKeys(body, ["argv", "cwd", "envNames", "timeoutSeconds", "idempotencyKey"]);
        const idempotencyKey = idempotencyFrom(request, body);
        return json(service.requestExec(context, execMatch[1], { ...body, idempotencyKey } as unknown as ExecRequest), 202, responseHeaders);
      }

      const installPlanMatch = url.pathname.match(/^\/v1\/computers\/([a-z][a-z0-9_]{2,63})\/install\/plan$/);
      if (request.method === "POST" && installPlanMatch?.[1] !== undefined) {
        const body = await readJson(request, maxRequestBytes);
        assertExactKeys(body, ["spec"]);
        return json(service.installPlan(context, installPlanMatch[1], body.spec), 200, responseHeaders);
      }
      const installApplyMatch = url.pathname.match(/^\/v1\/computers\/([a-z][a-z0-9_]{2,63})\/install\/apply$/);
      if (request.method === "POST" && installApplyMatch?.[1] !== undefined) {
        const body = await readJson(request, maxRequestBytes);
        assertExactKeys(body, ["ticket", "idempotencyKey"]);
        if (typeof body.ticket !== "string") throw new ComputersError("invalid_request", "Install ticket is required", 400);
        const key = idempotencyFrom(request, body);
        return json(service.installApply(context, installApplyMatch[1], body.ticket, key), 202, responseHeaders);
      }
      const policyMatch = url.pathname.match(/^\/v1\/computers\/([a-z][a-z0-9_]{2,63})\/install\/policy$/);
      if (request.method === "GET" && policyMatch?.[1] !== undefined) {
        return json(service.getInstallPolicy(context, policyMatch[1]), 200, responseHeaders);
      }
      if (request.method === "POST" && policyMatch?.[1] !== undefined) {
        const body = await readJson(request, maxRequestBytes); assertExactKeys(body, ["rules"]);
        return json(service.createInstallPolicy(context, policyMatch[1], body.rules as InstallPolicyRule[]), 201, responseHeaders);
      }
      const snapshotsMatch = url.pathname.match(/^\/v1\/computers\/([a-z][a-z0-9_]{2,63})\/snapshots$/);
      if (snapshotsMatch?.[1] !== undefined && (request.method === "GET" || request.method === "POST")) {
        service.getComputer(context, snapshotsMatch[1]);
        if (request.method === "GET") return json({ data: [], limitations: ["Snapshot provider adapter is not configured in this slice."] }, 200, responseHeaders);
        throw new ComputersError("provider_not_configured", "Snapshot provider is not configured", 503);
      }
      throw new ComputersError("not_found", "Resource not found", 404);
    } catch (error) {
      const failure = boundedFailure(error, request);
      const body: ApiErrorBody = { error: { code: failure.code, message: failure.message, requestId } };
      return json(body, failure.status, responseHeaders);
    }
  };
}

export interface ServeOptions extends AppOptions {
  hostname?: string;
  port?: number;
}

export function serve(service: ComputersService, options: ServeOptions = {}): ReturnType<typeof Bun.serve> {
  const hostname = options.hostname ?? "127.0.0.1";
  if (options.loopbackDevelopmentMode === true && !loopbackHost(hostname)) throw new ComputersError("invalid_request", "Loopback development mode may bind only to loopback", 400);
  if ((options.principals?.length ?? 0) === 0 && options.loopbackDevelopmentMode !== true) throw new ComputersError("authentication_required", "Authentication configuration is required", 500);
  return Bun.serve({ hostname, port: options.port ?? 7788, fetch: createApp(service, options) });
}
