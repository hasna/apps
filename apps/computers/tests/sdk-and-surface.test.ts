import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { StaticCredentialProvider, ComputersClient } from "../src/sdk";
import { REST_NON_OPERATION_RESPONSE_MANIFEST, REST_ROUTE_MANIFEST } from "../src/server";
import { SAFE_MCP_TOOLS } from "../src/mcp";
import {
  assertAuthenticatedGetResponses,
  assertBoundedErrorSchema,
  assertNonOperationResponses,
  assertOperationSecurity,
  assertPublicResponses,
  assertRequiredRuntimeResponses,
  assertResourceSurfaceMatrix,
  assertSandboxResponses,
  REQUIRED_AUTHENTICATED_GET_RESPONSES,
  REQUIRED_MUTABLE_RUNTIME_ERROR_CODES,
  REQUIRED_MUTABLE_RUNTIME_RESPONSES,
  REQUIRED_PUBLIC_RUNTIME_RESPONSES,
  REQUIRED_SANDBOX_RUNTIME_RESPONSES,
  RUNTIME_ERROR_CODES,
} from "../scripts/check-surfaces";
import { assertPortableOpenApiPattern } from "../scripts/check-schemas";
import { hashBearerToken } from "../src/auth";
import { ComputersError, type AuthorizationContext } from "../src/contracts";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { createApp } from "../src/server";
import { ComputersService } from "../src/service";
import { SQLiteStorage } from "../src/storage";
import { INSTALL_POLICY_PACKAGE_PATTERN_SCHEMA, MCP_INPUT_SCHEMA_FRAGMENTS } from "../src/validation";

describe("SDK and declared surfaces", () => {
  test("SDK exposes typed install-policy read and write methods on the REST routes", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const revisions = [
      { id: "pol_one", tenantId: "tenant_sdk", computerId: "cmp_sdk", generation: 1, digest: `sha256:${"a".repeat(64)}`, rules: [{ effect: "deny" }], createdAt: "2026-07-16T00:00:00.000Z" },
      { id: "pol_two", tenantId: "tenant_sdk", computerId: "cmp_sdk", generation: 2, digest: `sha256:${"b".repeat(64)}`, rules: [{ effect: "allow", managers: ["bun"] }], createdAt: "2026-07-16T00:00:01.000Z" },
    ] as const;
    const client = new ComputersClient({
      baseUrl: "https://api.example.invalid",
      credentials: new StaticCredentialProvider("x".repeat(32)),
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} });
        return Response.json(revisions[requests.length - 1]);
      }) as typeof fetch,
    });

    expect(await client.getInstallPolicy("cmp_sdk")).toEqual(revisions[0]);
    expect(await client.createInstallPolicy("cmp_sdk", [{ effect: "allow", managers: ["bun"] }])).toEqual(revisions[1]);
    expect(requests.map(({ url, init }) => ({ url, method: init.method, body: init.body }))).toEqual([
      { url: "https://api.example.invalid/v1/computers/cmp_sdk/install/policy", method: "GET", body: undefined },
      { url: "https://api.example.invalid/v1/computers/cmp_sdk/install/policy", method: "POST", body: JSON.stringify({ rules: [{ effect: "allow", managers: ["bun"] }] }) },
    ]);
  });

  test("SDK restricts transport, token, redirects, timeout, and non-JSON errors", async () => {
    const credential = new StaticCredentialProvider("x".repeat(32));
    for (const url of ["http://example.com", "http://127.0.0.2:7788", "ftp://127.0.0.1", "https://user:pass@example.com"]) {
      expect(() => new ComputersClient({ baseUrl: url, credentials: credential })).toThrow("Invalid Computers API URL");
    }
    new ComputersClient({ baseUrl: "http://127.0.0.1:7788", credentials: credential });
    new ComputersClient({ baseUrl: "http://localhost:7788", credentials: credential });
    const calls: RequestInit[] = [];
    const redirectClient = new ComputersClient({ baseUrl: "https://api.example.invalid", credentials: credential, timeoutMs: 500,
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => { calls.push(init ?? {}); return new Response(null, { status: 302, headers: { location: "https://evil.invalid" } }); }) as typeof fetch });
    await expect(redirectClient.listComputers()).rejects.toThrow("redirect");
    expect(calls[0]?.redirect).toBe("manual");
    expect(() => new StaticCredentialProvider("x".repeat(513))).toThrow("Authentication configuration");
    const textError = new ComputersClient({ baseUrl: "https://api.example.invalid", credentials: credential, fetch: (async () => new Response("gateway exploded", { status: 502 })) as typeof fetch });
    await expect(textError.listComputers()).rejects.toThrow("Request failed");
    const unsafeJsonError = new ComputersClient({ baseUrl: "https://api.example.invalid", credentials: credential,
      fetch: (async () => new Response(JSON.stringify({ error: { code: "invented", message: "do not trust me" } }), { status: 500, headers: { "content-type": "application/json" } })) as typeof fetch });
    await expect(unsafeJsonError.listComputers()).rejects.toThrow("Request failed");
    const oversizedSuccess = new ComputersClient({ baseUrl: "https://api.example.invalid", credentials: credential,
      fetch: (async () => new Response(JSON.stringify({ data: ["x".repeat(1024 * 1024)] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch });
    await expect(oversizedSuccess.listComputers()).rejects.toThrow("too large");
    const oversizedError = new ComputersClient({ baseUrl: "https://api.example.invalid", credentials: credential,
      fetch: (async () => new Response(JSON.stringify({ error: { code: "storage_error", message: "x".repeat(1024 * 1024) } }), { status: 500,
        headers: { "content-type": "application/json" } })) as typeof fetch });
    await expect(oversizedError.listComputers()).rejects.toThrow("too large");
    const timeoutClient = new ComputersClient({ baseUrl: "https://api.example.invalid", credentials: credential, timeoutMs: 100,
      fetch: ((_url: string | URL | Request, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })) as typeof fetch });
    await expect(timeoutClient.listComputers()).rejects.toBeDefined();
  });

  test("SDK accepts only the closed canonical error envelope with compatible HTTP status and code", async () => {
    const credential = new StaticCredentialProvider("x".repeat(32));
    const invoke = async (status: number, body: unknown): Promise<ComputersError> => {
      const client = new ComputersClient({
        baseUrl: "https://api.example.invalid",
        credentials: credential,
        fetch: (async () => Response.json(body, { status })) as typeof fetch,
      });
      try {
        await client.listComputers();
        throw new Error("expected SDK request to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(ComputersError);
        return error as ComputersError;
      }
    };

    expect(await invoke(404, { error: { code: "not_found", message: "Computer not found", requestId: "req_sdk_404" } }))
      .toMatchObject({ code: "not_found", status: 404, message: "Computer not found", details: { requestId: "req_sdk_404" } });
    for (const body of [
      { error: { code: "not_found", message: "Computer not found" } },
      { error: { code: "not_found", message: "Computer not found", requestId: "req_sdk_404" }, extra: true },
      { error: { code: "not_found", message: "Computer not found", requestId: "req_sdk_404", extra: true } },
      { error: { code: "not_found", message: "Computer not found", requestId: "short" } },
      { error: { code: "not_found", message: "Computer not found", requestId: "req sdk invalid" } },
      { error: { code: "not_found", message: "Computer not found", requestId: "r".repeat(129) } },
      { error: { code: "not_found", message: "", requestId: "req_sdk_empty" } },
      { error: { code: "not_found", message: "x".repeat(513), requestId: "req_sdk_long" } },
    ]) {
      expect(await invoke(404, body)).toMatchObject({ code: "storage_error", status: 502, message: "Request failed" });
    }
    expect(await invoke(500, { error: { code: "not_found", message: "Computer not found", requestId: "req_sdk_500" } }))
      .toMatchObject({ code: "storage_error", status: 502, message: "Request failed" });
    expect(await invoke(418, { error: { code: "not_found", message: "Computer not found", requestId: "req_sdk_418" } }))
      .toMatchObject({ code: "storage_error", status: 502, message: "Request failed" });
    expect(await invoke(403, { error: { code: "policy_generation_mismatch", message: "Authorization denied", requestId: "req_sdk_403" } }))
      .toMatchObject({ code: "policy_generation_mismatch", status: 403 });
    expect(await invoke(409, { error: { code: "policy_generation_mismatch", message: "Install ticket rejected", requestId: "req_sdk_409" } }))
      .toMatchObject({ code: "policy_generation_mismatch", status: 409, details: { requestId: "req_sdk_409" } });
    const malformedMediaType = new ComputersClient({
      baseUrl: "https://api.example.invalid", credentials: credential,
      fetch: (async () => new Response(JSON.stringify({ error: { code: "not_found", message: "Computer not found", requestId: "req_sdk_media" } }), {
        status: 404, headers: { "content-type": "text/application/json-invalid" },
      })) as typeof fetch,
    });
    await expect(malformedMediaType.listComputers()).rejects.toMatchObject({ code: "storage_error", status: 502, message: "Request failed" });
  });

  test("OpenAPI argv and package schemas exactly match canonical runtime and MCP fragments", () => {
    const api = JSON.parse(readFileSync("schemas/openapi.json", "utf8")) as {
      components: { schemas: {
        ExecRequest: { properties: { argv: unknown } };
        PackageSpec: unknown;
        InstallPolicyRule: { properties: { packagePatterns: { items: unknown }; registries: { items: unknown } } };
      } };
    };
    expect(api.components.schemas.ExecRequest.properties.argv).toEqual(MCP_INPUT_SCHEMA_FRAGMENTS.argv);
    expect(api.components.schemas.PackageSpec).toEqual(MCP_INPUT_SCHEMA_FRAGMENTS.packageSpec);
    expect(api.components.schemas.InstallPolicyRule.properties.packagePatterns.items).toEqual(INSTALL_POLICY_PACKAGE_PATTERN_SCHEMA);
    expect(api.components.schemas.InstallPolicyRule.properties.registries.items).toEqual(MCP_INPUT_SCHEMA_FRAGMENTS.registry);
    expect(() => assertPortableOpenApiPattern("^(a)\\1$")).toThrow("unsupported");
    expect(() => assertPortableOpenApiPattern("^\\01$")).toThrow("unsupported");
    expect(() => assertPortableOpenApiPattern("^(?<name>a)\\k<name>$")).toThrow("unsupported");
    expect(() => assertPortableOpenApiPattern("^\\\\1$")).not.toThrow();
    expect(() => assertPortableOpenApiPattern("^\\\\01$")).not.toThrow();
    expect(() => assertPortableOpenApiPattern("^\\\\k<name>$")).not.toThrow();
    expect(() => assertPortableOpenApiPattern("^\\(\\?=$")).not.toThrow();
    expect(() => assertPortableOpenApiPattern("^[a(?=]+$")).not.toThrow();
    expect(() => assertPortableOpenApiPattern("^[^\\u0000]+$")).not.toThrow();
  });

  test("OpenAPI public operations explicitly opt out while authenticated operations inherit bearer security", () => {
    const api = JSON.parse(readFileSync("schemas/openapi.json", "utf8")) as Parameters<typeof assertOperationSecurity>[0];
    assertOperationSecurity(api);

    const missingPublicOverride = structuredClone(api);
    delete missingPublicOverride.paths["/health"]?.get?.security;
    expect(() => assertOperationSecurity(missingPublicOverride)).toThrow("GET /health must declare security: []");

    const unauthenticatedPrivateRoute = structuredClone(api);
    unauthenticatedPrivateRoute.paths["/v1/computers"]!.get!.security = [];
    expect(() => assertOperationSecurity(unauthenticatedPrivateRoute)).toThrow("GET /v1/computers must inherit bearer security");

    const missingRootBearer = structuredClone(api);
    missingRootBearer.security = [];
    expect(() => assertOperationSecurity(missingRootBearer)).toThrow("OpenAPI root security must require bearerAuth");
  });

  test("OpenAPI operations and runtime route/tool manifests agree structurally", () => {
    const api = JSON.parse(readFileSync("schemas/openapi.json", "utf8")) as { paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, unknown> } };
    for (const route of REST_ROUTE_MANIFEST) {
      const operation = api.paths[route.path]?.[route.method.toLowerCase()];
      expect(operation).toBeDefined();
      expect((operation as { responses?: unknown }).responses).toBeDefined();
    }
    const serialized = JSON.stringify(api);
    expect(serialized).not.toContain("#/components/pathItems/");
    expect((api.components.schemas.Operation as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    const create = api.components.schemas.CreateComputer as {
      properties: Record<string, Record<string, unknown>>;
      allOf?: unknown[];
    };
    expect(create.properties.slug).toMatchObject({ minLength: 1, maxLength: 63, pattern: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$" });
    expect(create.properties.region).toEqual({ type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9][a-z0-9_-]*$" });
    expect(create.properties.storageGiB).toEqual({ type: "integer", minimum: 1, maximum: 1_048_576 });
    expect(create.properties.uptimeSeconds).toEqual({ type: "integer", minimum: 1, maximum: 31_536_000 });
    expect(create.properties.budgetMicros).toEqual({ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
    expect(create.allOf).toContainEqual({ if: { required: ["parentComputerId"] }, then: { required: ["grantId", "region", "profileId", "storageGiB", "uptimeSeconds", "budgetMicros"] } });
    expect(create.allOf).toContainEqual({ if: { properties: { provider: { const: "local_vm" } }, required: ["provider"] }, then: { required: ["profileId"] } });
    const profile = api.components.schemas.ComputerProfileDocument as { properties: Record<string, Record<string, unknown>> };
    expect(profile.properties.imageLocation).toEqual({ type: "string", format: "uri", pattern: "^https://", maxLength: 2048 });
    const grant = api.components.schemas.CreateComputerGrant as { properties: Record<string, Record<string, unknown>> };
    expect(grant.properties.allowedProviders).toEqual({ type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: { enum: ["local_machine", "local_vm", "aws_ec2"] } });
    expect(grant.properties.allowedChildOwnerPrincipalIds).toEqual({ type: "array", minItems: 1, maxItems: 128, uniqueItems: true, items: { $ref: "#/components/schemas/Id" } });
    expect(grant.properties.allowedRegions).toEqual({ type: "array", minItems: 1, maxItems: 32, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9][a-z0-9_-]*$" } });
    expect(grant.properties.allowedProfileIds).toEqual({ type: "array", minItems: 1, maxItems: 64, uniqueItems: true, items: { $ref: "#/components/schemas/Id" } });
    expect(grant.properties.maxStorageGiB).toEqual({ type: "integer", minimum: 1, maximum: 1_048_576 });
    expect(grant.properties.maxUptimeSeconds).toEqual({ type: "integer", minimum: 1, maximum: 31_536_000 });
    expect(grant.properties.maxBudgetMicros).toEqual({ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
    expect(grant.properties.limit).toEqual({ type: "integer", minimum: 1, maximum: 1000 });
    const manifest = JSON.parse(readFileSync("schemas/surface-parity.json", "utf8")) as { mcpTools: string[] };
    expect(manifest.mcpTools).toEqual(SAFE_MCP_TOOLS.map((tool) => tool.name));
  });

  test("OpenAPI lifecycle responses stay aligned with runtime failure modes", () => {
    const api = JSON.parse(readFileSync("schemas/openapi.json", "utf8")) as Parameters<typeof assertRequiredRuntimeResponses>[0];
    assertRequiredRuntimeResponses(api);
    const expectedLifecycle = ["202", "400", "401", "403", "404", "409", "413", "500"];
    for (const action of ["start", "stop", "quarantine", "delete"]) {
      const route = `POST /v1/computers/{computerId}/${action}` as keyof typeof REQUIRED_MUTABLE_RUNTIME_RESPONSES;
      expect([...REQUIRED_MUTABLE_RUNTIME_RESPONSES[route]]).toEqual(expectedLifecycle);
      expect(Object.keys(api.paths[`/v1/computers/{computerId}/${action}`]?.post?.responses ?? {}).sort()).toEqual([...expectedLifecycle].sort());
    }
    const missingConflict = structuredClone(api);
    delete missingConflict.paths["/v1/computers/{computerId}/start"]?.post?.responses?.["409"];
    expect(() => assertRequiredRuntimeResponses(missingConflict)).toThrow("POST /v1/computers/{computerId}/start response status matrix mismatch");
    const extraStatus = structuredClone(api);
    extraStatus.paths["/v1/computers/{computerId}/start"]!.post!.responses!["418"] = { $ref: "#/components/responses/Error" };
    expect(() => assertRequiredRuntimeResponses(extraStatus)).toThrow("POST /v1/computers/{computerId}/start response status matrix mismatch");
    expect(REQUIRED_MUTABLE_RUNTIME_ERROR_CODES["POST /v1/computers/{computerId}/install/apply"]["409"])
      .toEqual(["conflict", "expired", "policy_generation_mismatch", "replay_detected"]);
    expect(REQUIRED_MUTABLE_RUNTIME_ERROR_CODES["POST /v1/computers/{computerId}/install/policy"]["409"])
      .toEqual(["conflict", "policy_generation_mismatch"]);
    const missingRuntimeCode = structuredClone(api);
    missingRuntimeCode.paths["/v1/computers/{computerId}/install/apply"]!.post!["x-error-codes-by-status"]!["409"] = ["conflict", "expired", "replay_detected"];
    expect(() => assertRequiredRuntimeResponses(missingRuntimeCode)).toThrow("POST /v1/computers/{computerId}/install/apply error-code matrix 409 mismatch");
  });

  test("every mutable REST route maps an unexpected implementation failure to canonical 500 storage_error", async () => {
    const service = new Proxy({} as ComputersService, {
      get: () => () => { throw new Error("sensitive implementation failure"); },
    });
    const app = createApp(service, { loopbackDevelopmentMode: true });
    const packageSpec = {
      manager: "bun", name: "example", version: "1.0.0", digest: `sha256:${"a".repeat(64)}`,
      registry: "https://registry.example.invalid/", dependencyClosure: [], allowLifecycleScripts: false,
    };
    const fixtures: Record<string, { body?: unknown; idempotency?: string }> = {
      "POST /v1/computers": { body: { slug: "route", provider: "local_machine", ownerPrincipalId: "principal_route" }, idempotency: "route-create-001" },
      "POST /v1/computers/adopt": { body: { slug: "adopt", ownerPrincipalId: "principal_route", adoptionId: "adoption_route", profileId: "profile_route" }, idempotency: "route-adopt-001" },
      "POST /v1/computer-create-grants": { body: {} },
      "POST /v1/computers/{computerId}/start": { idempotency: "route-start-001" },
      "POST /v1/computers/{computerId}/stop": { idempotency: "route-stop-001" },
      "POST /v1/computers/{computerId}/quarantine": { idempotency: "route-quarantine-001" },
      "POST /v1/computers/{computerId}/delete": { idempotency: "route-delete-001" },
      "POST /v1/computers/{computerId}/exec": { body: { argv: ["/usr/bin/true"] }, idempotency: "route-exec-001" },
      "POST /v1/computers/{computerId}/install/plan": { body: { spec: packageSpec } },
      "POST /v1/computers/{computerId}/install/apply": { body: { ticket: "ticket" }, idempotency: "route-apply-001" },
      "POST /v1/computers/{computerId}/install/policy": { body: { rules: [{ effect: "deny" }] } },
      "POST /v1/computers/{computerId}/snapshots": {},
      "POST /v1/profiles": { body: {} },
      "POST /v1/sandboxes": {},
    };
    for (const [route, fixture] of Object.entries(fixtures)) {
      const path = route.slice(route.indexOf(" ") + 1).replace("{computerId}", "cmp_route");
      const headers: Record<string, string> = { "x-request-id": "req_route_500" };
      if (fixture.body !== undefined) headers["content-type"] = "application/json";
      if (fixture.idempotency !== undefined) headers["idempotency-key"] = fixture.idempotency;
      const response = await app(new Request(`http://127.0.0.1${path}`, {
        method: "POST", headers, body: fixture.body === undefined ? undefined : JSON.stringify(fixture.body),
      }));
      expect(response.status, route).toBe(500);
      expect(await response.json(), route).toEqual({
        error: { code: "storage_error", message: "Internal server error", requestId: "req_route_500" },
      });
    }
  });

  test("authenticated GET response matrices declare route-specific authorization and stale-generation outcomes", () => {
    const api = JSON.parse(readFileSync("schemas/openapi.json", "utf8")) as Parameters<typeof assertAuthenticatedGetResponses>[0];
    assertAuthenticatedGetResponses(api);
    expect(REQUIRED_AUTHENTICATED_GET_RESPONSES["GET /v1/computers/{computerId}"]).toEqual({
      statuses: ["200", "401", "403", "404", "500"],
      errorCodes: {
        "401": ["authentication_required"],
        "403": ["authorization_denied", "policy_generation_mismatch"],
        "404": ["not_found"],
        "500": ["storage_error"],
      },
    });
    for (const route of [
      "GET /v1/computers/{computerId}",
      "GET /v1/computers/{computerId}/install/policy",
      "GET /v1/computers/{computerId}/snapshots",
      "GET /v1/operations",
    ] as const) {
      expect(REQUIRED_AUTHENTICATED_GET_RESPONSES[route].errorCodes["403"]).toContain("policy_generation_mismatch");
    }
    const missingStale = structuredClone(api);
    const operation = missingStale.paths["/v1/computers/{computerId}"]?.get;
    if (operation !== undefined) operation["x-error-codes-by-status"] = { ...operation["x-error-codes-by-status"], "403": ["authorization_denied"] };
    expect(() => assertAuthenticatedGetResponses(missingStale)).toThrow("GET /v1/computers/{computerId} error-code matrix 403 mismatch");
  });

  test("public, sandbox, CORS-preflight, and fallthrough matrices are exact and executable", () => {
    const api = JSON.parse(readFileSync("schemas/openapi.json", "utf8")) as Parameters<typeof assertPublicResponses>[0];
    assertPublicResponses(api);
    assertSandboxResponses(api);
    assertNonOperationResponses(api);
    expect(REQUIRED_PUBLIC_RUNTIME_RESPONSES).toEqual({
      "GET /health": { statuses: ["200", "403"], errorCodes: { "403": ["authorization_denied"] } },
      "GET /ready": {
        statuses: ["200", "403", "500", "503"],
        errorCodes: { "403": ["authorization_denied"], "500": ["storage_error"], "503": ["storage_error"] },
      },
      "GET /version": { statuses: ["200", "403"], errorCodes: { "403": ["authorization_denied"] } },
      "GET /openapi.json": {
        statuses: ["200", "403", "500"], errorCodes: { "403": ["authorization_denied"], "500": ["storage_error"] },
      },
    });
    expect(REQUIRED_SANDBOX_RUNTIME_RESPONSES["GET /v1/sandboxes"])
      .toEqual(REQUIRED_SANDBOX_RUNTIME_RESPONSES["POST /v1/sandboxes"]);
    expect(api["x-runtime-response-matrix"]).toEqual(REST_NON_OPERATION_RESPONSE_MANIFEST);

    const missingPublicStatus = structuredClone(api);
    delete missingPublicStatus.paths["/ready"]?.get?.responses?.["503"];
    expect(() => assertPublicResponses(missingPublicStatus)).toThrow("GET /ready response status matrix mismatch");
    const extraSandboxCode = structuredClone(api);
    extraSandboxCode.paths["/v1/sandboxes"]!.get!["x-error-codes-by-status"]!["501"] = ["sandbox_disabled", "not_found"];
    expect(() => assertSandboxResponses(extraSandboxCode)).toThrow("GET /v1/sandboxes error-code matrix 501 mismatch");
    const staleFallthrough = structuredClone(api);
    staleFallthrough["x-runtime-response-matrix"] = {};
    expect(() => assertNonOperationResponses(staleFallthrough)).toThrow("CORS preflight/fallthrough response matrix mismatch");
  });

  test("resource matrix is executable coverage, including intentional MCP omissions", () => {
    const manifest = JSON.parse(readFileSync("schemas/surface-parity.json", "utf8"));
    assertResourceSurfaceMatrix(manifest);
    const policy = manifest.resources.installPolicy as { rest: string[]; sdk: string[]; cli: string[]; mcp: string[]; mcpOmission: string };
    expect(policy).toEqual({
      rest: ["GET /v1/computers/{computerId}/install/policy", "POST /v1/computers/{computerId}/install/policy"],
      sdk: ["getInstallPolicy", "createInstallPolicy"],
      cli: ["policies list", "policies set"],
      mcp: [],
      mcpOmission: "Policy read and mutation remain outside the reviewed safe MCP subset.",
    });
    const missingSdk = structuredClone(manifest);
    missingSdk.resources.installPolicy.sdk = ["getInstallPolicy"];
    expect(() => assertResourceSurfaceMatrix(missingSdk)).toThrow("SDK resource surface mismatch");
  });

  test("lifecycle runtime emits exact closed authentication, authorization, missing, and conflict envelopes", async () => {
    const storage = new SQLiteStorage(":memory:");
    storage.migrate();
    try {
      const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
      const adminCredential = randomBytes(32).toString("base64url");
      const readerCredential = randomBytes(32).toString("base64url");
      const admin: AuthorizationContext = { tenantId: "tenant_parity", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };
      const reader: AuthorizationContext = { tenantId: "tenant_parity", principalId: "principal_reader", scopes: ["computers:read"], authMethod: "bearer" };
      const computer = service.createComputer(admin, {
        slug: "parity", provider: "local_machine", ownerPrincipalId: reader.principalId, idempotencyKey: "parity-create-001",
      });
      const app = createApp(service, { principals: [
        { tokenHash: await hashBearerToken(adminCredential), context: admin },
        { tokenHash: await hashBearerToken(readerCredential), context: reader },
      ] });
      const request = (id: string, requestId: string, credential?: string) => app(new Request(`http://127.0.0.1/v1/computers/${id}/start`, {
        method: "POST", headers: {
          "idempotency-key": `parity-${id}`,
          "x-request-id": requestId,
          ...(credential === undefined ? {} : { authorization: `Bearer ${credential}` }),
        },
      }));
      for (const [response, status, error] of [
        [await request(computer.id, "req_lifecycle_auth"), 401, {
          code: "authentication_required", message: "Authentication required", requestId: "req_lifecycle_auth",
        }],
        [await request(computer.id, "req_lifecycle_authorization", readerCredential), 403, {
          code: "authorization_denied", message: "Authorization denied", requestId: "req_lifecycle_authorization",
        }],
        [await request("cmp_missing", "req_lifecycle_missing", adminCredential), 404, {
          code: "not_found", message: "Computer not found", requestId: "req_lifecycle_missing",
        }],
        [await request(computer.id, "req_lifecycle_conflict", adminCredential), 409, {
          code: "conflict", message: "Computer already has an active lifecycle operation", requestId: "req_lifecycle_conflict",
        }],
      ] as const) {
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ error });
      }
    } finally {
      storage.close();
    }
  });

  test("separate API services return the bounded lifecycle conflict envelope and preserve replay", async () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-api-lifecycle-conflict-"));
    const database = join(directory, "controller.db");
    const firstStorage = new SQLiteStorage(database); firstStorage.migrate();
    const admin: AuthorizationContext = { tenantId: "tenant_api_collision", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };
    const firstService = new ComputersService(firstStorage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const computer = firstService.createComputer(admin, {
      slug: "api-collision", provider: "local_machine", ownerPrincipalId: "principal_owner", idempotencyKey: "api-collision-create",
    });
    const create = firstStorage.listOperations(admin.tenantId, computer.id)[0];
    if (create === undefined) throw new Error("Missing create operation");
    firstStorage.completeProviderOperation(create, firstStorage.beginProviderAttempt(create), {
      kind: "success", resource: { resourceId: "resource_api_collision" }, result: { lifecycle: "stopped" },
    });
    const secondStorage = new SQLiteStorage(database);
    const secondService = new ComputersService(secondStorage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    try {
      const firstApp = createApp(firstService, { loopbackDevelopmentMode: true, loopbackContext: admin });
      const secondApp = createApp(secondService, { loopbackDevelopmentMode: true, loopbackContext: admin });
      const lifecycle = (app: ReturnType<typeof createApp>, kind: "quarantine" | "delete", key: string, requestId: string) => app(new Request(
        `http://127.0.0.1/v1/computers/${computer.id}/${kind}`,
        { method: "POST", headers: { "idempotency-key": key, "x-request-id": requestId } },
      ));
      const accepted = await lifecycle(firstApp, "quarantine", "api-collision-first", "req_api_collision_first");
      expect(accepted.status).toBe(202);
      const acceptedBody = await accepted.json() as { id: string };
      const replay = await lifecycle(secondApp, "quarantine", "api-collision-first", "req_api_collision_replay");
      expect(replay.status).toBe(202);
      expect((await replay.json() as { id: string }).id).toBe(acceptedBody.id);
      const collision = await lifecycle(secondApp, "delete", "api-collision-second", "req_api_collision_second");
      expect(collision.status).toBe(409);
      expect(await collision.json()).toEqual({
        error: {
          code: "conflict", message: "Computer already has an active lifecycle operation", requestId: "req_api_collision_second",
        },
      });
    } finally {
      secondStorage.close(); firstStorage.close(); rmSync(directory, { recursive: true, force: true });
    }
  });

  test("delegated API denials do not disclose existing versus missing profiles", async () => {
    const storage = new SQLiteStorage(":memory:"); storage.migrate();
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    try {
      const admin: AuthorizationContext = { tenantId: "tenant_api_oracle", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };
      const parent = service.createComputer(admin, {
        slug: "api-oracle-parent", provider: "local_machine", ownerPrincipalId: "principal_api_owner", idempotencyKey: "api-oracle-parent-create",
      });
      const existingProfileId = "profile_api_oracle_existing";
      const missingProfileId = "profile_api_oracle_missing";
      service.createProfile(admin, {
        id: existingProfileId, name: "API oracle existing",
        document: {
          provider: "local_vm", cpus: 2, memoryGiB: 4, rootDiskGiB: 16, homeDiskGiB: 32,
          imageLocation: "https://images.example.invalid/api-oracle.qcow2", imageDigest: `sha256:${"e".repeat(64)}`,
        },
      });
      const grant = service.createComputerGrant(admin, {
        principalId: parent.ownerPrincipalId, ownerPrincipalId: parent.ownerPrincipalId, parentComputerId: parent.id,
        allowedProviders: ["local_vm"], allowedChildOwnerPrincipalIds: ["principal_api_child"], allowedRegions: ["local"],
        allowedProfileIds: [existingProfileId, missingProfileId], maxStorageGiB: 32, maxUptimeSeconds: 600, maxBudgetMicros: 1000, limit: 8,
      } as never);
      const credential = randomBytes(32).toString("base64url");
      const delegated: AuthorizationContext = {
        tenantId: admin.tenantId, principalId: parent.ownerPrincipalId, scopes: ["computers:create"], authMethod: "bearer",
        boundComputerId: parent.id, policyGeneration: parent.policyGeneration,
      };
      const app = createApp(service, { principals: [{ tokenHash: await hashBearerToken(credential), context: delegated }] });
      const create = async (profileId: string, grantId: string, ownerPrincipalId: string, suffix: string) => {
        const response = await app(new Request("https://api.example.invalid/v1/computers", {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential}`, "content-type": "application/json", "idempotency-key": `api-oracle-${suffix}`,
            "x-request-id": `req_api_oracle_${suffix}`,
          },
          body: JSON.stringify({
            slug: `api-oracle-${suffix.replaceAll("_", "-")}`, provider: "local_vm", ownerPrincipalId, parentComputerId: parent.id, grantId,
            region: "local", profileId, storageGiB: 16, uptimeSeconds: 300, budgetMicros: 500,
          }),
        }));
        const body = await response.json() as { error: { code: string; message: string; requestId: string } };
        return { status: response.status, error: { code: body.error.code, message: body.error.message }, requestId: body.error.requestId };
      };
      const expectSameDenied = async (grantId: string, ownerPrincipalId: string, label: string) => {
        const existing = await create(existingProfileId, grantId, ownerPrincipalId, `${label}_existing`);
        const missing = await create(missingProfileId, grantId, ownerPrincipalId, `${label}_missing`);
        expect(existing).toMatchObject({ status: 403, error: { code: "authorization_denied", message: "Authorization denied" } });
        expect(missing).toMatchObject({ status: existing.status, error: existing.error });
        expect(existing.requestId.length).toBeGreaterThanOrEqual(8);
        expect(missing.requestId.length).toBeGreaterThanOrEqual(8);
      };

      await expectSameDenied("grt_api_oracle_invalid", "principal_api_child", "invalid");
      storage.database.query("UPDATE computer_create_grants SET expires_at = ? WHERE tenant_id = ? AND id = ?")
        .run("1970-01-01T00:00:00.000Z", admin.tenantId, grant.id);
      await expectSameDenied(grant.id, "principal_api_child", "expired");
      storage.database.query("UPDATE computer_create_grants SET expires_at = NULL WHERE tenant_id = ? AND id = ?")
        .run(admin.tenantId, grant.id);
      await expectSameDenied(grant.id, "principal_api_denied", "unauthorized");
      expect(await create(missingProfileId, grant.id, "principal_api_child", "authorized_missing")).toMatchObject({
        status: 400, error: { code: "invalid_request", message: "Computer profile is not available" },
      });
    } finally { storage.close(); }
  });

  test("OpenAPI reuses a closed and scalar-bounded error envelope", () => {
    const api = JSON.parse(readFileSync("schemas/openapi.json", "utf8")) as Parameters<typeof assertBoundedErrorSchema>[0];
    assertBoundedErrorSchema(api);
    const schemas = api.components?.schemas as Record<string, Record<string, unknown>>;
    expect(schemas.ErrorCode?.enum).toEqual([...RUNTIME_ERROR_CODES]);
    expect(schemas.ErrorDetail).toMatchObject({
      type: "object",
      required: ["code", "message", "requestId"],
      additionalProperties: false,
      properties: {
        code: { $ref: "#/components/schemas/ErrorCode" },
        message: { type: "string", minLength: 1, maxLength: 512 },
        requestId: { type: "string", minLength: 8, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" },
      },
    });
    expect(schemas.Error).toEqual({
      type: "object", required: ["error"], properties: { error: { $ref: "#/components/schemas/ErrorDetail" } }, additionalProperties: false,
    });
    const unbounded = structuredClone(api);
    const detail = unbounded.components?.schemas?.ErrorDetail as { properties?: { message?: { maxLength?: number } } };
    delete detail.properties?.message?.maxLength;
    expect(() => assertBoundedErrorSchema(unbounded)).toThrow("ErrorDetail.message must be bounded");
  });
});
