import { beforeEach, describe, expect, test } from "bun:test";
import { spec } from "../fixtures.js";
import { handleRequest, type RouteDeps } from "../../src/http/routes.js";
import { InMemoryControlPlaneStore } from "../../src/http/store-memory.js";
import { MemoryBlobStore } from "../../src/http/blobstore.js";
import { ROOT_TENANT_ID } from "../../src/http/context.js";
import type { AdapterId } from "../../src/http/store.js";

const BOOTSTRAP = "boot-secret-key";

async function makeDeps(): Promise<RouteDeps> {
  const store = new InMemoryControlPlaneStore();
  await store.migrate();
  return {
    store,
    blobStore: new MemoryBlobStore(),
    auth: { bootstrapKey: BOOTSTRAP },
    version: "test",
    liveAdapters: new Set<AdapterId>(),
  };
}

interface Call {
  status: number;
  body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
}

async function call(
  deps: RouteDeps,
  method: string,
  path: string,
  opts?: { token?: string; body?: unknown },
): Promise<Call> {
  const headers: Record<string, string> = {};
  if (opts?.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts?.body !== undefined) headers["Content-Type"] = "application/json";
  const req = new Request(`http://sandboxes.test${path}`, {
    method,
    headers,
    ...(opts?.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const res = await handleRequest(req, deps);
  const body = (await res.json()) as Call["body"];
  return { status: res.status, body };
}

describe("sandboxes /v1 auth + tenancy", () => {
  let deps: RouteDeps;
  beforeEach(async () => {
    deps = await makeDeps();
  });

  test("public /health needs no auth and reports self_hosted mode", async () => {
    const res = await call(deps, "GET", "/health");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "ok", name: "sandboxes", mode: "self_hosted" });
  });

  test("/v1 fails closed with no credential (401)", async () => {
    const res = await call(deps, "GET", "/v1/health");
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("unauthenticated");
  });

  test("unknown token is rejected (401), never defaulted to a tenant", async () => {
    const res = await call(deps, "GET", "/v1/whoami", { token: "not-a-real-key" });
    expect(res.status).toBe(401);
  });

  test("bootstrap key resolves the ROOT tenant with admin scope", async () => {
    const res = await call(deps, "GET", "/v1/whoami", { token: BOOTSTRAP });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ tenant_id: ROOT_TENANT_ID, via: "bootstrap", principal_type: "service" });
    expect(res.body.data?.["scopes"]).toEqual(["sandboxes:*"]);
  });

  test("admin can mint a tenant-bound key, which resolves that tenant (kid bridge)", async () => {
    const minted = await call(deps, "POST", "/v1/admin/api-keys", {
      token: BOOTSTRAP,
      body: { scopes: ["sandboxes:read"] },
    });
    expect(minted.status).toBe(201);
    const apiKey = minted.body.data?.["api_key"] as string;
    expect(apiKey).toStartWith("hsx_");
    const who = await call(deps, "GET", "/v1/whoami", { token: apiKey });
    expect(who.status).toBe(200);
    expect(who.body.data).toMatchObject({ tenant_id: ROOT_TENANT_ID, via: "api_key" });
  });

  test("cross-tenant reads return 404 (never leak another tenant's row)", async () => {
    // tenant A = root (bootstrap mints an operator key for it)
    const keyA = (
      await call(deps, "POST", "/v1/admin/api-keys", {
        token: BOOTSTRAP,
        body: { scopes: ["sandboxes:allocate", "sandboxes:read"] },
      })
    ).body.data?.["api_key"] as string;

    // tenant B
    const tenantB = "11111111-2222-3333-4444-555555555555";
    await call(deps, "POST", "/v1/admin/tenants", { token: BOOTSTRAP, body: { tenant_id: tenantB, slug: "beta" } });
    const keyB = (
      await call(deps, "POST", "/v1/admin/api-keys", {
        token: BOOTSTRAP,
        body: { tenant_id: tenantB, scopes: ["sandboxes:allocate", "sandboxes:read"] },
      })
    ).body.data?.["api_key"] as string;

    const alloc = await call(deps, "POST", "/v1/sandboxes", { token: keyA, body: { adapter: "fake", spec: spec() } });
    expect(alloc.status).toBe(201);
    const allocation = alloc.body.data?.["allocation"] as { allocation_id: string; state: string; tenant_id: string };
    expect(allocation.state).toBe("active");
    expect(allocation.tenant_id).toBe(ROOT_TENANT_ID);

    // owner (tenant A) can read it
    const ownRead = await call(deps, "GET", `/v1/sandboxes/${allocation.allocation_id}`, { token: keyA });
    expect(ownRead.status).toBe(200);

    // tenant B cannot — 404, not 403, not the row
    const crossRead = await call(deps, "GET", `/v1/sandboxes/${allocation.allocation_id}`, { token: keyB });
    expect(crossRead.status).toBe(404);
    expect(crossRead.body.error?.code).toBe("not_found");

    // tenant B's list never includes tenant A's allocation
    const listB = await call(deps, "GET", "/v1/sandboxes", { token: keyB });
    expect((listB.body.data?.["allocations"] as unknown[]).length).toBe(0);
  });

  test("a non-root admin key cannot mint into another tenant (no cross-tenant escalation)", async () => {
    // Create tenant B and give it its own admin-scoped key.
    const tenantB = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    await call(deps, "POST", "/v1/admin/tenants", { token: BOOTSTRAP, body: { tenant_id: tenantB, slug: "b-admin" } });
    const bAdmin = (
      await call(deps, "POST", "/v1/admin/api-keys", {
        token: BOOTSTRAP,
        body: { tenant_id: tenantB, scopes: ["sandboxes:admin"] },
      })
    ).body.data?.["api_key"] as string;

    // B's admin minting into its OWN tenant is fine.
    const ownMint = await call(deps, "POST", "/v1/admin/api-keys", { token: bAdmin, body: { tenant_id: tenantB } });
    expect(ownMint.status).toBe(201);

    // B's admin minting into the ROOT tenant is forbidden.
    const crossMint = await call(deps, "POST", "/v1/admin/api-keys", { token: bAdmin, body: { tenant_id: ROOT_TENANT_ID } });
    expect(crossMint.status).toBe(403);
    expect(crossMint.body.error?.code).toBe("forbidden");

    // B's admin cannot create brand-new tenants at all (root-only).
    const crossTenant = await call(deps, "POST", "/v1/admin/tenants", { token: bAdmin, body: { slug: "sneaky" } });
    expect(crossTenant.status).toBe(403);
  });

  test("revoke hides another tenant's key existence: cross-tenant kid is 404, not 403", async () => {
    // A root-tenant key to be targeted.
    const rootKey = await call(deps, "POST", "/v1/admin/api-keys", {
      token: BOOTSTRAP,
      body: { scopes: ["sandboxes:read"] },
    });
    const rootKid = rootKey.body.data?.["kid"] as string;

    // A non-root tenant B with its own admin key.
    const tenantB = "cccccccc-dddd-eeee-ffff-000000000000";
    await call(deps, "POST", "/v1/admin/tenants", { token: BOOTSTRAP, body: { tenant_id: tenantB, slug: "b-revoke" } });
    const bAdmin = (
      await call(deps, "POST", "/v1/admin/api-keys", {
        token: BOOTSTRAP,
        body: { tenant_id: tenantB, scopes: ["sandboxes:admin"] },
      })
    ).body.data?.["api_key"] as string;

    // B's admin trying to revoke a ROOT key must not learn it exists: 404, never 403.
    const crossRevoke = await call(deps, "POST", `/v1/admin/api-keys/${rootKid}/revoke`, { token: bAdmin });
    expect(crossRevoke.status).toBe(404);
    expect(crossRevoke.body.error?.code).toBe("not_found");

    // A truly unknown kid is likewise 404 (indistinguishable from the cross-tenant case).
    const unknownRevoke = await call(deps, "POST", "/v1/admin/api-keys/key_does_not_exist/revoke", { token: bAdmin });
    expect(unknownRevoke.status).toBe(404);

    // Root can still revoke the key it owns.
    const rootRevoke = await call(deps, "POST", `/v1/admin/api-keys/${rootKid}/revoke`, { token: BOOTSTRAP });
    expect(rootRevoke.status).toBe(200);
    expect(rootRevoke.body.data?.["revoked"]).toBe(true);
  });

  test("scope is enforced: a read-only key cannot allocate (403 insufficient_scope)", async () => {
    const keyRO = (
      await call(deps, "POST", "/v1/admin/api-keys", { token: BOOTSTRAP, body: { scopes: ["sandboxes:read"] } })
    ).body.data?.["api_key"] as string;
    const res = await call(deps, "POST", "/v1/sandboxes", { token: keyRO, body: { adapter: "fake", spec: spec() } });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("insufficient_scope");
  });

  test("real providers are fail-closed: e2b allocation is recorded but gated, never faked active", async () => {
    const res = await call(deps, "POST", "/v1/sandboxes", { token: BOOTSTRAP, body: { adapter: "e2b", spec: spec() } });
    expect(res.status).toBe(201);
    const allocation = res.body.data?.["allocation"] as { state: string; state_reason: string };
    expect(allocation.state).toBe("requested");
    expect(allocation.state_reason).toBe("provider_credentials_not_provisioned");
  });

  test("revoked key is rejected on the next request", async () => {
    const minted = await call(deps, "POST", "/v1/admin/api-keys", { token: BOOTSTRAP, body: { scopes: ["sandboxes:read"] } });
    const apiKey = minted.body.data?.["api_key"] as string;
    const kid = minted.body.data?.["kid"] as string;
    expect((await call(deps, "GET", "/v1/whoami", { token: apiKey })).status).toBe(200);
    await call(deps, "POST", `/v1/admin/api-keys/${kid}/revoke`, { token: BOOTSTRAP });
    expect((await call(deps, "GET", "/v1/whoami", { token: apiKey })).status).toBe(401);
  });

  test("quota ceiling blocks over-allocation (429)", async () => {
    await call(deps, "POST", "/v1/admin/quota", { token: BOOTSTRAP, body: { adapter: "fake", max_concurrent: 1 } });
    const first = await call(deps, "POST", "/v1/sandboxes", { token: BOOTSTRAP, body: { adapter: "fake", spec: spec() } });
    expect(first.status).toBe(201);
    const second = await call(deps, "POST", "/v1/sandboxes", { token: BOOTSTRAP, body: { adapter: "fake", spec: spec() } });
    expect(second.status).toBe(429);
    expect(second.body.error?.code).toBe("resource_limit_exceeded");
  });

  test("checkpoint create + list is tenant-scoped and stores under the tenant S3 prefix", async () => {
    const alloc = await call(deps, "POST", "/v1/sandboxes", { token: BOOTSTRAP, body: { adapter: "fake", spec: spec() } });
    const allocationId = (alloc.body.data?.["allocation"] as { allocation_id: string }).allocation_id;
    const payload = Buffer.from("checkpoint-bytes").toString("base64");
    const created = await call(deps, "POST", `/v1/sandboxes/${allocationId}/checkpoints`, {
      token: BOOTSTRAP,
      body: { label: "snap-1", payload_base64: payload },
    });
    expect(created.status).toBe(201);
    const checkpoint = created.body.data?.["checkpoint"] as { s3_key: string; size_bytes: number };
    expect(checkpoint.s3_key).toBe(`sandboxes/${ROOT_TENANT_ID}/checkpoints/${(created.body.data?.["checkpoint"] as { checkpoint_id: string }).checkpoint_id}.blob`);
    expect(checkpoint.size_bytes).toBe(16);
    const listed = await call(deps, "GET", `/v1/sandboxes/${allocationId}/checkpoints`, { token: BOOTSTRAP });
    expect((listed.body.data?.["count"] as number)).toBe(1);
  });

  test("validate rejects a malformed spec and accepts a valid one", async () => {
    const good = await call(deps, "POST", "/v1/validate/sandbox-spec", { token: BOOTSTRAP, body: { document: spec() } });
    expect(good.status).toBe(200);
    expect(good.body.data).toMatchObject({ valid: true });
    const bad = await call(deps, "POST", "/v1/validate/sandbox-spec", { token: BOOTSTRAP, body: { document: { nope: true } } });
    expect(bad.status).toBe(400);
    expect(bad.body.error?.code).toBe("validation_failed");
  });

  test("destroy marks the allocation destroyed", async () => {
    const alloc = await call(deps, "POST", "/v1/sandboxes", { token: BOOTSTRAP, body: { adapter: "fake", spec: spec() } });
    const allocationId = (alloc.body.data?.["allocation"] as { allocation_id: string }).allocation_id;
    const destroyed = await call(deps, "POST", `/v1/sandboxes/${allocationId}/destroy`, { token: BOOTSTRAP });
    expect(destroyed.status).toBe(200);
    expect((destroyed.body.data?.["allocation"] as { state: string }).state).toBe("destroyed");
  });
});
