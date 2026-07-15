import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { hashBearerToken } from "../src/auth";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import type { AuthorizationContext } from "../src/contracts";
import { createApp, MAX_REQUEST_BYTES } from "../src/server";
import { ComputersService } from "../src/service";
import { SQLiteStorage } from "../src/storage";

describe("REST authentication and input boundaries", () => {
  let storage: SQLiteStorage;
  let app: (request: Request) => Promise<Response>;
  let ownerCredential: string;
  let adminCredential: string;
  let ownerContext: AuthorizationContext;

  beforeEach(async () => {
    storage = new SQLiteStorage(":memory:"); storage.migrate();
    ownerCredential = randomBytes(32).toString("base64url");
    adminCredential = randomBytes(32).toString("base64url");
    ownerContext = { tenantId: "tenant_test", principalId: "principal_owner", scopes: ["computers:read", "computers:create", "computers:operate", "computers:exec", "computers:install"], authMethod: "bearer" };
    const adminContext: AuthorizationContext = { tenantId: "tenant_test", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };
    app = createApp(new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) }), { principals: [
      { tokenHash: await hashBearerToken(ownerCredential), context: ownerContext },
      { tokenHash: await hashBearerToken(adminCredential), context: adminContext },
    ], allowedOrigins: ["https://console.example.invalid"] });
  });
  afterEach(() => storage.close());

  const call = (path: string, init: RequestInit = {}) => app(new Request(`http://127.0.0.1${path}`, init));

  test("allows public probes but fails closed for unauthenticated and invalid bearer requests", async () => {
    expect((await call("/health")).status).toBe(200);
    expect((await call("/v1/computers")).status).toBe(401);
    expect((await call("/v1/computers", { headers: { authorization: `Bearer ${randomBytes(32).toString("base64url")}` } })).status).toBe(401);
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

  test("returns deterministic Sandbox disabled and disallows unlisted CORS origins", async () => {
    const sandbox = await call("/v1/sandboxes", { headers: { authorization: `Bearer ${ownerCredential}` } });
    expect(sandbox.status).toBe(501);
    expect((await sandbox.json() as { error: { code: string } }).error.code).toBe("sandbox_disabled");
    const cors = await call("/v1/computers", { headers: { authorization: `Bearer ${ownerCredential}`, origin: "https://attacker.example.invalid" } });
    expect(cors.status).toBe(403);
    expect(cors.headers.get("access-control-allow-origin")).toBeNull();
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
