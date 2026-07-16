import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { hashBearerToken } from "../src/auth";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { ComputersError, type AuthorizationContext } from "../src/contracts";
import { createApp, MAX_REQUEST_BYTES, REST_ROUTE_MANIFEST } from "../src/server";
import { ComputersService } from "../src/service";
import { SQLiteStorage } from "../src/storage";

describe("REST authentication and input boundaries", () => {
  let storage: SQLiteStorage;
  let service: ComputersService;
  let app: (request: Request) => Promise<Response>;
  let ownerCredential: string;
  let adminCredential: string;
  let ownerContext: AuthorizationContext;
  let adminContext: AuthorizationContext;

  beforeEach(async () => {
    storage = new SQLiteStorage(":memory:"); storage.migrate();
    ownerCredential = randomBytes(32).toString("base64url");
    adminCredential = randomBytes(32).toString("base64url");
    ownerContext = { tenantId: "tenant_test", principalId: "principal_owner", scopes: ["computers:read", "computers:create", "computers:operate", "computers:exec", "computers:install"], authMethod: "bearer" };
    adminContext = { tenantId: "tenant_test", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };
    service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    app = createApp(service, { principals: [
      { tokenHash: await hashBearerToken(ownerCredential), context: ownerContext },
      { tokenHash: await hashBearerToken(adminCredential), context: adminContext },
    ], allowedOrigins: ["https://console.example.invalid"] });
  });
  afterEach(() => storage.close());

  const call = (path: string, init: RequestInit = {}) => app(new Request(`http://127.0.0.1${path}`, init));

  test("allows every public probe but returns exact closed authentication errors", async () => {
    for (const path of ["/health", "/ready", "/version", "/openapi.json"]) {
      const response = await call(path, { headers: { "x-request-id": `req_public_${path.replaceAll(/[^a-z]/g, "_")}` } });
      expect(response.status, path).toBe(200);
    }
    for (const [headers, requestId] of [
      [{}, "req_auth_missing"],
      [{ authorization: `Bearer ${randomBytes(32).toString("base64url")}` }, "req_auth_invalid"],
    ] as const) {
      const response = await call("/v1/computers", { headers: { ...headers, "x-request-id": requestId } });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: "authentication_required", message: "Authentication required", requestId },
      });
    }
  });

  test("emits the exact runtime success or intentional-unavailable status for every declared route", async () => {
    const routeService = {
      storage: { ready: () => true },
      listComputers: () => [],
      listComputerGrants: () => [],
      createComputerGrant: () => ({ id: "grt_probe" }),
      createComputer: () => ({ id: "cmp_probe" }),
      adoptComputer: () => ({ id: "cmp_probe" }),
      listOperations: () => [],
      providerReadiness: () => [],
      listProfiles: () => [],
      createProfile: () => ({ id: "profile_probe" }),
      sandboxDisabled: () => { throw new ComputersError("sandbox_disabled", "Sandbox integration is disabled", 501); },
      getComputer: () => ({ id: "cmp_probe" }),
      requestLifecycle: () => ({ id: "op_probe" }),
      requestExec: () => ({ id: "op_probe" }),
      installPlan: () => ({ decision: "deny" }),
      installApply: () => ({ id: "op_probe" }),
      getInstallPolicy: () => ({ id: "policy_probe" }),
      createInstallPolicy: () => ({ id: "policy_probe" }),
    } as unknown as ComputersService;
    const routeApp = createApp(routeService, {
      loopbackDevelopmentMode: true,
      openApiAssetLoader: () => new Blob(["{}"], { type: "application/json" }),
    });
    const packageSpec = {
      manager: "bun", name: "example", version: "1.0.0", digest: `sha256:${"a".repeat(64)}`,
      registry: "https://registry.example.invalid/", dependencyClosure: [], allowLifecycleScripts: false,
    };
    const fixtures: Array<{
      method: "GET" | "POST";
      path: string;
      status: number;
      body?: unknown;
      idempotencyKey?: string;
    }> = [
      { method: "GET", path: "/health", status: 200 },
      { method: "GET", path: "/ready", status: 200 },
      { method: "GET", path: "/version", status: 200 },
      { method: "GET", path: "/openapi.json", status: 200 },
      { method: "GET", path: "/v1/computers", status: 200 },
      { method: "POST", path: "/v1/computers", status: 201, body: {}, idempotencyKey: "probe-create-001" },
      { method: "POST", path: "/v1/computers/adopt", status: 201, body: {}, idempotencyKey: "probe-adopt-001" },
      { method: "GET", path: "/v1/computer-create-grants", status: 200 },
      { method: "POST", path: "/v1/computer-create-grants", status: 201, body: {} },
      { method: "GET", path: "/v1/computers/cmp_probe", status: 200 },
      { method: "POST", path: "/v1/computers/cmp_probe/start", status: 202, idempotencyKey: "probe-start-001" },
      { method: "POST", path: "/v1/computers/cmp_probe/stop", status: 202, idempotencyKey: "probe-stop-001" },
      { method: "POST", path: "/v1/computers/cmp_probe/quarantine", status: 202, idempotencyKey: "probe-quarantine-001" },
      { method: "POST", path: "/v1/computers/cmp_probe/delete", status: 202, idempotencyKey: "probe-delete-001" },
      { method: "POST", path: "/v1/computers/cmp_probe/exec", status: 202, body: { argv: ["true"] }, idempotencyKey: "probe-exec-001" },
      { method: "POST", path: "/v1/computers/cmp_probe/install/plan", status: 200, body: { spec: packageSpec } },
      { method: "POST", path: "/v1/computers/cmp_probe/install/apply", status: 202, body: { ticket: "ticket" }, idempotencyKey: "probe-apply-001" },
      { method: "GET", path: "/v1/computers/cmp_probe/install/policy", status: 200 },
      { method: "POST", path: "/v1/computers/cmp_probe/install/policy", status: 201, body: { rules: [{ effect: "deny" }] } },
      { method: "GET", path: "/v1/computers/cmp_probe/snapshots", status: 200 },
      { method: "POST", path: "/v1/computers/cmp_probe/snapshots", status: 503 },
      { method: "GET", path: "/v1/operations", status: 200 },
      { method: "GET", path: "/v1/assignments", status: 200 },
      { method: "GET", path: "/v1/profiles", status: 200 },
      { method: "POST", path: "/v1/profiles", status: 201, body: {} },
      { method: "GET", path: "/v1/providers/readiness", status: 200 },
      { method: "GET", path: "/v1/sandboxes", status: 501 },
      { method: "POST", path: "/v1/sandboxes", status: 501 },
    ];
    expect(fixtures.map(({ method, path }) => `${method} ${path.replace("cmp_probe", "{computerId}")}`))
      .toEqual(REST_ROUTE_MANIFEST.map(({ method, path }) => `${method} ${path}`));

    for (const [index, fixture] of fixtures.entries()) {
      const headers: Record<string, string> = { "x-request-id": `req_route_probe_${index.toString().padStart(2, "0")}` };
      if (fixture.body !== undefined) headers["content-type"] = "application/json";
      if (fixture.idempotencyKey !== undefined) headers["idempotency-key"] = fixture.idempotencyKey;
      const response = await routeApp(new Request(`http://127.0.0.1${fixture.path}`, {
        method: fixture.method,
        headers,
        body: fixture.body === undefined ? undefined : JSON.stringify(fixture.body),
      }));
      expect(response.status, `${fixture.method} ${fixture.path}`).toBe(fixture.status);
    }
  });

  test("creates through authenticated API and returns deterministic idempotent response", async () => {
    const deniedBody = { slug: "denied", provider: "local_machine", ownerPrincipalId: ownerContext.principalId, idempotencyKey: "api-denied-001", parentComputerId: "cmp_parent_required" };
    expect((await call("/v1/computers", { method: "POST", headers: { authorization: `Bearer ${ownerCredential}`, "content-type": "application/json" }, body: JSON.stringify(deniedBody) })).status).toBe(403);
    const body = { slug: "primary", provider: "local_machine", ownerPrincipalId: ownerContext.principalId, idempotencyKey: "api-create-001" };
    const first = await call("/v1/computers", { method: "POST", headers: { authorization: `Bearer ${adminCredential}`, "content-type": "application/json", "idempotency-key": "api-create-001" }, body: JSON.stringify(body) });
    const second = await call("/v1/computers", { method: "POST", headers: { authorization: `Bearer ${adminCredential}`, "content-type": "application/json", "idempotency-key": "api-create-001" }, body: JSON.stringify(body) });
    expect(first.status).toBe(201); expect(second.status).toBe(201);
    expect((await first.json() as { id: string }).id).toBe((await second.json() as { id: string }).id);
  });

  test("exposes only the exact disabled Sandbox routes with closed error envelopes", async () => {
    for (const [method, requestId] of [["GET", "req_sandbox_get"], ["POST", "req_sandbox_post"]] as const) {
      const response = await call("/v1/sandboxes", {
        method,
        headers: { authorization: `Bearer ${ownerCredential}`, "x-request-id": requestId },
      });
      expect(response.status).toBe(501);
      expect(response.headers.get("x-request-id")).toBe(requestId);
      expect(await response.json()).toEqual({
        error: { code: "sandbox_disabled", message: "Sandbox integration is disabled", requestId },
      });
    }

    const undeclared = [
      ["PUT", "/v1/sandboxes", "req_sandbox_put"],
      ["PATCH", "/v1/sandboxes", "req_sandbox_patch"],
      ["DELETE", "/v1/sandboxes", "req_sandbox_delete"],
      ["HEAD", "/v1/sandboxes", "req_sandbox_head"],
      ["GET", "/v1/sandboxes/", "req_sandbox_nested_root_get"],
      ["GET", "/v1/sandboxes/child", "req_sandbox_nested_get"],
      ["POST", "/v1/sandboxes/child", "req_sandbox_nested_post"],
      ["PUT", "/v1/sandboxes/child", "req_sandbox_nested_put"],
      ["PATCH", "/v1/sandboxes/child", "req_sandbox_nested_patch"],
      ["DELETE", "/v1/sandboxes/child", "req_sandbox_nested_delete"],
      ["HEAD", "/v1/sandboxes/child", "req_sandbox_nested_head"],
      ["OPTIONS", "/v1/sandboxes/child", "req_sandbox_nested_options"],
    ] as const;
    for (const [method, path, requestId] of undeclared) {
      const response = await call(path, {
        method,
        headers: { authorization: `Bearer ${ownerCredential}`, "x-request-id": requestId },
      });
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(response.headers.get("x-request-id"), `${method} ${path}`).toBe(requestId);
      expect(await response.json(), `${method} ${path}`).toEqual({
        error: { code: "not_found", message: "Resource not found", requestId },
      });
    }
  });

  test("applies the exact blocked-Origin CORS envelope to public, read, mutable, sandbox, and fallthrough requests", async () => {
    for (const [method, path, requestId] of [
      ["GET", "/health", "req_cors_public"],
      ["GET", "/v1/computers", "req_cors_read"],
      ["POST", "/v1/computers", "req_cors_mutable"],
      ["GET", "/v1/sandboxes", "req_cors_sandbox"],
      ["GET", "/unmatched", "req_cors_fallthrough"],
    ] as const) {
      const response = await call(path, {
        method,
        headers: { origin: "https://attacker.example.invalid", "x-request-id": requestId },
      });
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(response.headers.get("access-control-allow-origin"), `${method} ${path}`).toBeNull();
      expect(await response.json(), `${method} ${path}`).toEqual({
        error: { code: "authorization_denied", message: "Origin is not allowed", requestId },
      });
    }
  });

  test("implements the exact CORS preflight and authenticated fallthrough matrices", async () => {
    for (const path of ["/health", "/v1/computers", "/v1/sandboxes"]) {
      const requestId = `req_preflight_${path.replaceAll(/[^a-z]/g, "_")}`;
      const response = await call(path, {
        method: "OPTIONS",
        headers: { origin: "https://console.example.invalid", "x-request-id": requestId },
      });
      expect(response.status, path).toBe(204);
      expect(response.headers.get("x-request-id"), path).toBe(requestId);
      expect(response.headers.get("access-control-allow-origin"), path).toBe("https://console.example.invalid");
      expect(await response.text(), path).toBe("");
    }
    const missingOrigin = await call("/v1/computers", { method: "OPTIONS", headers: { "x-request-id": "req_preflight_denied" } });
    expect(missingOrigin.status).toBe(403);
    expect(await missingOrigin.json()).toEqual({
      error: { code: "authorization_denied", message: "Origin is not allowed", requestId: "req_preflight_denied" },
    });

    const nestedUnauthenticated = await call("/v1/sandboxes/child", {
      method: "OPTIONS", headers: { origin: "https://console.example.invalid", "x-request-id": "req_nested_unauth" },
    });
    expect(nestedUnauthenticated.status).toBe(401);
    expect(await nestedUnauthenticated.json()).toEqual({
      error: { code: "authentication_required", message: "Authentication required", requestId: "req_nested_unauth" },
    });
    const nestedAuthenticated = await call("/v1/sandboxes/child", {
      method: "OPTIONS",
      headers: {
        origin: "https://console.example.invalid", authorization: `Bearer ${ownerCredential}`, "x-request-id": "req_nested_fallthrough",
      },
    });
    expect(nestedAuthenticated.status).toBe(404);
    expect(await nestedAuthenticated.json()).toEqual({
      error: { code: "not_found", message: "Resource not found", requestId: "req_nested_fallthrough" },
    });
  });

  test("returns exact public readiness, asset, generic, snapshot, and fallthrough error envelopes", async () => {
    const notReadyApp = createApp({ storage: { ready: () => false } } as ComputersService);
    const notReady = await notReadyApp(new Request("http://127.0.0.1/ready", {
      headers: { "x-request-id": "req_ready_unavailable" },
    }));
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toEqual({
      error: { code: "storage_error", message: "Internal server error", requestId: "req_ready_unavailable" },
    });

    const brokenReadyApp = createApp({ storage: { ready: () => { throw new Error("sensitive readiness failure"); } } } as ComputersService);
    const brokenReady = await brokenReadyApp(new Request("http://127.0.0.1/ready", {
      headers: { "x-request-id": "req_ready_generic" },
    }));
    expect(brokenReady.status).toBe(500);
    expect(await brokenReady.json()).toEqual({
      error: { code: "storage_error", message: "Internal server error", requestId: "req_ready_generic" },
    });

    const brokenAssetApp = createApp(service, { openApiAssetLoader: () => { throw new Error("sensitive asset path"); } });
    const brokenAsset = await brokenAssetApp(new Request("http://127.0.0.1/openapi.json", {
      headers: { "x-request-id": "req_openapi_asset" },
    }));
    expect(brokenAsset.status).toBe(500);
    expect(await brokenAsset.json()).toEqual({
      error: { code: "storage_error", message: "Internal server error", requestId: "req_openapi_asset" },
    });

    const misleadingAssetApp = createApp(service, {
      openApiAssetLoader: () => { throw new ComputersError("not_found", "sensitive asset location", 404); },
    });
    const misleadingAsset = await misleadingAssetApp(new Request("http://127.0.0.1/openapi.json", {
      headers: { "x-request-id": "req_openapi_asset_domain" },
    }));
    expect(misleadingAsset.status).toBe(500);
    expect(await misleadingAsset.json()).toEqual({
      error: { code: "storage_error", message: "Internal server error", requestId: "req_openapi_asset_domain" },
    });

    const missingAssetApp = createApp(service, {
      openApiAssetLoader: () => Bun.file("/definitely-missing-computers-openapi.json"),
    });
    const missingAsset = await missingAssetApp(new Request("http://127.0.0.1/openapi.json", {
      headers: { "x-request-id": "req_openapi_asset_missing" },
    }));
    expect(missingAsset.status).toBe(500);
    expect(missingAsset.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await missingAsset.json()).toEqual({
      error: { code: "storage_error", message: "Internal server error", requestId: "req_openapi_asset_missing" },
    });

    const successfulAssetApp = createApp(service, {
      openApiAssetLoader: () => new Blob([JSON.stringify({ openapi: "3.1.0" })], { type: "text/plain" }),
    });
    const successfulAsset = await successfulAssetApp(new Request("http://127.0.0.1/openapi.json", {
      headers: { "x-request-id": "req_openapi_asset_success" },
    }));
    expect(successfulAsset.status).toBe(200);
    expect(successfulAsset.headers.get("content-type")).toBe("application/json");
    expect(await successfulAsset.json()).toEqual({ openapi: "3.1.0" });

    const genericService = new Proxy(service, {
      get: (target, property, receiver) => property === "listComputers"
        ? () => { throw new Error("sensitive implementation failure"); }
        : Reflect.get(target, property, receiver),
    });
    const genericApp = createApp(genericService, { loopbackDevelopmentMode: true });
    const generic = await genericApp(new Request("http://127.0.0.1/v1/computers", {
      headers: { "x-request-id": "req_read_generic" },
    }));
    expect(generic.status).toBe(500);
    expect(await generic.json()).toEqual({
      error: { code: "storage_error", message: "Internal server error", requestId: "req_read_generic" },
    });

    const computer = service.createComputer(adminContext, {
      slug: "snapshot", provider: "local_machine", ownerPrincipalId: ownerContext.principalId, idempotencyKey: "snapshot-create-001",
    });
    const snapshot = await call(`/v1/computers/${computer.id}/snapshots`, {
      method: "POST",
      headers: { authorization: `Bearer ${adminCredential}`, "x-request-id": "req_snapshot_unavailable" },
    });
    expect(snapshot.status).toBe(503);
    expect(await snapshot.json()).toEqual({
      error: { code: "provider_not_configured", message: "Snapshot provider is not configured", requestId: "req_snapshot_unavailable" },
    });

    for (const [method, path, requestId] of [
      ["GET", "/unmatched", "req_fallthrough_path"],
      ["POST", "/health", "req_fallthrough_method"],
    ] as const) {
      const response = await call(path, {
        method, headers: { authorization: `Bearer ${ownerCredential}`, "x-request-id": requestId },
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "not_found", message: "Resource not found", requestId },
      });
    }
  });

  test("normalizes every mismatched or unbounded ComputersError to a route-valid envelope", async () => {
    const errorApp = (error: ComputersError) => createApp(new Proxy(service, {
      get: (target, property, receiver) => property === "listComputers" ? () => { throw error; } : Reflect.get(target, property, receiver),
    }), { loopbackDevelopmentMode: true });
    const withRuntimeStatus = (error: ComputersError, status: unknown): ComputersError => {
      Object.defineProperty(error, "status", { value: status });
      return error;
    };
    for (const [error, requestId] of [
      [new ComputersError("invalid_request", "sensitive invalid request", 500), "req_5xx_bad_code"],
      [new ComputersError("provider_not_configured", "sensitive provider state", 503), "req_5xx_wrong_route"],
      [new ComputersError("storage_error", "sensitive readiness state", 503), "req_5xx_wrong_ready"],
      [new ComputersError("quota_exceeded", "quota is only declared for create", 409), "req_route_boundary_quota"],
      [new ComputersError("authorization_denied", "x".repeat(513), 403), "req_route_boundary_long_message"],
      [new ComputersError("invalid_request", "success statuses cannot carry errors", 200), "req_route_boundary_success_status"],
      [new ComputersError("invalid_request", "unknown status", 418), "req_route_boundary_unknown_status"],
      [new ComputersError("invalid_request", "invalid status", Number.NaN), "req_route_boundary_invalid_status"],
      [withRuntimeStatus(new ComputersError("storage_error", "sensitive string status", 500), "500"), "req_route_boundary_string_status"],
      [withRuntimeStatus(new ComputersError("storage_error", "sensitive bigint status", 500), 500n), "req_route_boundary_bigint_status"],
      [withRuntimeStatus(new ComputersError("authorization_denied", "sensitive coercion status", 403), {
        toString: () => "403",
        valueOf: () => 200,
      }), "req_route_boundary_coercion_status"],
    ] as const) {
      const response = await errorApp(error)(new Request("http://127.0.0.1/v1/computers", {
        headers: { "x-request-id": requestId },
      }));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: { code: "storage_error", message: "Internal server error", requestId },
      });
    }

    const declaredStorage = await errorApp(new ComputersError("storage_error", "sensitive storage detail", 500))(
      new Request("http://127.0.0.1/v1/computers", { headers: { "x-request-id": "req_route_boundary_valid_500" } }),
    );
    expect(declaredStorage.status).toBe(500);
    expect(await declaredStorage.json()).toEqual({
      error: { code: "storage_error", message: "Internal server error", requestId: "req_route_boundary_valid_500" },
    });

    const declaredAuthorization = await errorApp(new ComputersError("authorization_denied", "Read access denied", 403))(
      new Request("http://127.0.0.1/v1/computers", { headers: { "x-request-id": "req_route_boundary_valid_403" } }),
    );
    expect(declaredAuthorization.status).toBe(403);
    expect(await declaredAuthorization.json()).toEqual({
      error: { code: "authorization_denied", message: "Read access denied", requestId: "req_route_boundary_valid_403" },
    });

    const notFoundApp = createApp(new Proxy(service, {
      get: (target, property, receiver) => property === "getComputer"
        ? () => { throw new ComputersError("not_found", "Computer not found", 404); }
        : Reflect.get(target, property, receiver),
    }), { loopbackDevelopmentMode: true });
    const declaredNotFound = await notFoundApp(new Request("http://127.0.0.1/v1/computers/cmp_route", {
      headers: { "x-request-id": "req_route_boundary_valid_404" },
    }));
    expect(declaredNotFound.status).toBe(404);
    expect(await declaredNotFound.json()).toEqual({
      error: { code: "not_found", message: "Computer not found", requestId: "req_route_boundary_valid_404" },
    });

    const readyApp = createApp({ storage: {
      ready: () => { throw new ComputersError("storage_error", "sensitive readiness state", 503); },
    } } as ComputersService);
    const ready = await readyApp(new Request("http://127.0.0.1/ready", {
      headers: { "x-request-id": "req_5xx_ready" },
    }));
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({
      error: { code: "storage_error", message: "Internal server error", requestId: "req_5xx_ready" },
    });

    const sandboxApp = createApp({
      sandboxDisabled: () => { throw new ComputersError("sandbox_disabled", "sensitive sandbox state", 501); },
    } as ComputersService, { loopbackDevelopmentMode: true });
    const sandbox = await sandboxApp(new Request("http://127.0.0.1/v1/sandboxes", {
      headers: { "x-request-id": "req_5xx_sandbox" },
    }));
    expect(sandbox.status).toBe(501);
    expect(await sandbox.json()).toEqual({
      error: { code: "sandbox_disabled", message: "Sandbox integration is disabled", requestId: "req_5xx_sandbox" },
    });
  });

  test("returns exact method fallthroughs without calling the service", async () => {
    const throwingService = new Proxy({} as ComputersService, {
      get: (_target, property) => { throw new Error(`Unexpected service call: ${String(property)}`); },
    });
    const fallthroughApp = createApp(throwingService, { loopbackDevelopmentMode: true });

    const adopt = await fallthroughApp(new Request("http://127.0.0.1/v1/computers/adopt", {
      headers: { "x-request-id": "req_adopt_get_fallthrough" },
    }));
    expect(adopt.status).toBe(404);
    expect(adopt.headers.get("x-request-id")).toBe("req_adopt_get_fallthrough");
    expect(await adopt.json()).toEqual({
      error: { code: "not_found", message: "Resource not found", requestId: "req_adopt_get_fallthrough" },
    });

    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      const requestId = `req_snapshots_${method.toLowerCase()}_fallthrough`;
      const response = await fallthroughApp(new Request("http://127.0.0.1/v1/computers/cmp_route/snapshots", {
        method,
        headers: { "x-request-id": requestId },
      }));
      expect(response.status, method).toBe(404);
      expect(response.headers.get("x-request-id"), method).toBe(requestId);
      expect(await response.json(), method).toEqual({
        error: { code: "not_found", message: "Resource not found", requestId },
      });
    }

    const head = await fallthroughApp(new Request("http://127.0.0.1/v1/computers/cmp_route/snapshots", {
      method: "HEAD",
      headers: { "x-request-id": "req_snapshots_head_fallthrough" },
    }));
    expect(head.status).toBe(404);
    expect(head.headers.get("x-request-id")).toBe("req_snapshots_head_fallthrough");
    expect(head.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  test("rejects non-canonical package and policy registries through exact REST envelopes", async () => {
    const computer = service.createComputer(adminContext, {
      slug: "registry", provider: "local_machine", ownerPrincipalId: ownerContext.principalId, idempotencyKey: "registry-create-001",
    });
    const spec = {
      manager: "bun", name: "example", version: "1.0.0", digest: `sha256:${"a".repeat(64)}`,
      registry: "https://REGISTRY.example.invalid/", dependencyClosure: [], allowLifecycleScripts: false,
    };
    const installPlan = await call(`/v1/computers/${computer.id}/install/plan`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminCredential}`, "content-type": "application/json", "x-request-id": "req_registry_package",
      },
      body: JSON.stringify({ spec }),
    });
    expect(installPlan.status).toBe(400);
    expect(await installPlan.json()).toEqual({
      error: { code: "invalid_request", message: "Invalid spec.registry", requestId: "req_registry_package" },
    });

    const installPolicy = await call(`/v1/computers/${computer.id}/install/policy`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminCredential}`, "content-type": "application/json", "x-request-id": "req_registry_policy",
      },
      body: JSON.stringify({ rules: [{ effect: "allow", registries: ["https://registry.example.invalid:443/"] }] }),
    });
    expect(installPolicy.status).toBe(400);
    expect(await installPolicy.json()).toEqual({
      error: { code: "invalid_request", message: "Invalid install policy", requestId: "req_registry_policy" },
    });
  });

  test("rejects malformed and oversized JSON before domain mutation", async () => {
    const malformed = await call("/v1/computers", { method: "POST", headers: { authorization: `Bearer ${ownerCredential}`, "content-type": "application/json" }, body: "{" });
    expect(malformed.status).toBe(400);
    const oversized = await call("/v1/computers", { method: "POST", headers: { authorization: `Bearer ${ownerCredential}`, "content-type": "application/json" }, body: JSON.stringify({ padding: "x".repeat(MAX_REQUEST_BYTES) }) });
    expect(oversized.status).toBe(413);
    const lifecycleUnknown = await call("/v1/computers/cmp_missing/start", { method: "POST", headers: { authorization: `Bearer ${adminCredential}`, "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: "unknown-wrapper-001", extra: true }) });
    expect(lifecycleUnknown.status).toBe(400);
    const installPlanUnknown = await call("/v1/computers/cmp_missing/install/plan", { method: "POST", headers: { authorization: `Bearer ${adminCredential}`, "content-type": "application/json" }, body: JSON.stringify({ spec: {}, extra: true }) });
    expect(installPlanUnknown.status).toBe(400);
    const execUnknown = await call("/v1/computers/cmp_missing/exec", { method: "POST", headers: { authorization: `Bearer ${adminCredential}`, "content-type": "application/json" }, body: JSON.stringify({ argv: ["id"], idempotencyKey: "unknown-exec-wrapper", extra: true }) });
    expect(execUnknown.status).toBe(400);
    const createUnknown = await call("/v1/computers", { method: "POST", headers: { authorization: `Bearer ${adminCredential}`, "content-type": "application/json" }, body: JSON.stringify({ slug: "unknown", provider: "local_machine", ownerPrincipalId: "principal_unknown", idempotencyKey: "unknown-create-wrapper", extra: true }) });
    expect(createUnknown.status).toBe(400);
    const idempotencyMismatch = await call("/v1/computers", { method: "POST", headers: { authorization: `Bearer ${adminCredential}`, "content-type": "application/json", "idempotency-key": "header-key-001" }, body: JSON.stringify({ slug: "mismatch", provider: "local_machine", ownerPrincipalId: "principal_mismatch", idempotencyKey: "body-key-001" }) });
    expect(idempotencyMismatch.status).toBe(409);
    const headerOnlyLifecycle = await call("/v1/computers/cmp_missing/start", { method: "POST", headers: { authorization: `Bearer ${adminCredential}`, "idempotency-key": "header-only-lifecycle" } });
    expect(headerOnlyLifecycle.status).toBe(404);
  });

  test("does not disclose a Computer across tenants", async () => {
    const adminContext: AuthorizationContext = { tenantId: "tenant_test", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const computer = service.createComputer(adminContext, { slug: "private", provider: "local_machine", ownerPrincipalId: "principal_owner", idempotencyKey: "private-create-001" });
    const otherCredential = randomBytes(32).toString("base64url");
    const otherContext: AuthorizationContext = { ...ownerContext, tenantId: "tenant_other" };
    const isolatedApp = createApp(service, { principals: [{ tokenHash: await hashBearerToken(otherCredential), context: otherContext }] });
    const response = await isolatedApp(new Request(`http://127.0.0.1/v1/computers/${computer.id}`, { headers: { authorization: `Bearer ${otherCredential}` } }));
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("tenant_test");
  });
});
