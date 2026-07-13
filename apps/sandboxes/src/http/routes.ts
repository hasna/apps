/**
 * /v1 route handlers for the self-hosted sandboxes API. Every /v1 handler runs
 * behind resolveContext (fail-closed auth + tenant binding) and scopes every
 * store read/write to ctx.tenantId. Cross-tenant ids return 404 (don't leak
 * existence). Live provider allocation (Daytona/E2B dispatch) is intentionally
 * GATED here (R2 / STOP boundary): real adapters create a `requested` record but
 * are never dispatched; the `fake` adapter drives the record lifecycle for tests.
 */
import { canonicalDigest, createOpaqueId, nowRfc3339, sha256 } from "../canonical.js";
import { SandboxError } from "../errors.js";
import { validateDocument, validateSandboxSpec, type ValidationKind } from "../validation.js";
import { E2BRunnerPendingV1, DaytonaCloudRunnerPendingV1 } from "../runner.js";
import { hasScope, ROOT_TENANT_ID, SCOPES, type AuthContext } from "./context.js";
import { resolveContext, hashToken, type AuthConfig } from "./auth.js";
import { HttpError, successEnvelope, toErrorResponse, type Envelope } from "./envelope.js";
import type { BlobStore } from "./blobstore.js";
import type { AdapterId, ControlPlaneStore } from "./store.js";

export interface RouteDeps {
  store: ControlPlaneStore;
  blobStore: BlobStore;
  auth: AuthConfig;
  version: string;
  /** Which provider adapters have live credentials wired (server-side only). */
  liveAdapters: ReadonlySet<AdapterId>;
}

const VALIDATION_KINDS: ValidationKind[] = [
  "sandbox-spec",
  "create-sandbox",
  "fence",
  "capability",
  "activation-grant",
  "cleanup-grant",
  "checkpoint-receipt",
];

const ADAPTER_IDS: AdapterId[] = ["fake", "e2b", "daytona_cloud"];

function json(envelope: Envelope, status: number): Response {
  return new Response(JSON.stringify(envelope), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function ok(operation: string, data: unknown, status = 200): Response {
  return json(successEnvelope(operation, data), status);
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.length > 1_048_576) throw new SandboxError("resource_limit_exceeded", "Request body exceeds 1 MiB");
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SandboxError("validation_failed", "Request body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SandboxError) throw error;
    throw new SandboxError("validation_failed", "Request body is not valid JSON");
  }
}

function requireScope(ctx: AuthContext, scope: (typeof SCOPES)[keyof typeof SCOPES]): void {
  if (!hasScope(ctx, scope)) {
    throw new HttpError(403, "insufficient_scope", `Requires scope ${scope}`, { required: scope });
  }
}

/**
 * Admin acting on a tenant OTHER than its own is a fleet-admin operation and is
 * restricted to the ROOT tenant. Prevents a tenant-scoped admin key from
 * provisioning/minting into a different tenant (cross-tenant privilege escalation).
 */
function assertAdminTenantScope(ctx: AuthContext, targetTenantId: string): void {
  if (targetTenantId !== ctx.tenantId && ctx.tenantId !== ROOT_TENANT_ID) {
    throw new HttpError(403, "forbidden", "Cross-tenant admin requires the root tenant", {
      target_tenant_id: targetTenantId,
    });
  }
}

function requireAdapter(value: unknown): AdapterId {
  if (typeof value !== "string" || !ADAPTER_IDS.includes(value as AdapterId)) {
    throw new SandboxError("validation_failed", "adapter must be one of fake, e2b, daytona_cloud");
  }
  return value as AdapterId;
}

function newApiKeyPlaintext(): string {
  return `hsx_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

/** Handle an already-authenticated /v1 request. */
async function handleV1(
  req: Request,
  url: URL,
  segments: string[],
  ctx: AuthContext,
  deps: RouteDeps,
): Promise<Response> {
  const method = req.method.toUpperCase();
  const { store, blobStore } = deps;
  const [head, id, sub, subId] = segments;

  // GET /v1/health
  if (head === "health" && segments.length === 1 && method === "GET") {
    const health = await store.health();
    return ok("v1.health", { status: "ok", backend: health.backend, tenant_id: ctx.tenantId });
  }

  // GET /v1/whoami
  if (head === "whoami" && segments.length === 1 && method === "GET") {
    return ok("v1.whoami", {
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      principal_type: ctx.principalType,
      scopes: ctx.scopes,
      via: ctx.via,
    });
  }

  // POST /v1/validate/:kind
  if (head === "validate" && segments.length === 2 && method === "POST") {
    requireScope(ctx, SCOPES.read);
    const kind = id as ValidationKind;
    if (!VALIDATION_KINDS.includes(kind)) throw new SandboxError("validation_failed", "Unknown validation kind");
    const body = await readJson(req);
    const document = body["document"] ?? body;
    const validated = validateDocument(kind, document);
    return ok(`v1.validate.${kind}`, { valid: true, document_sha256: canonicalDigest(validated) });
  }

  // GET /v1/adapters
  if (head === "adapters" && segments.length === 1 && method === "GET") {
    requireScope(ctx, SCOPES.read);
    const descriptors = await Promise.all([
      new E2BRunnerPendingV1().descriptor(),
      new DaytonaCloudRunnerPendingV1().descriptor(),
    ]);
    return ok("v1.adapters", {
      adapters: descriptors,
      live_adapters: [...deps.liveAdapters],
      note: "Live provider dispatch is gated for R2; adapters listed as live have server-side credentials.",
    });
  }

  // /v1/sandboxes ...
  if (head === "sandboxes") {
    // POST /v1/sandboxes  (allocate)
    if (segments.length === 1 && method === "POST") {
      requireScope(ctx, SCOPES.allocate);
      const body = await readJson(req);
      const adapter = requireAdapter(body["adapter"]);
      const specInput = body["spec"];
      if (specInput === undefined) throw new SandboxError("validation_failed", "spec is required");
      const spec = validateSandboxSpec(specInput);

      // Quota (transactional overshoot guard is a Postgres refinement; the
      // count+insert here is the R1 shared-pool ceiling).
      const quotas = await store.listQuota(ctx.tenantId);
      const quota = quotas.find((q) => q.adapter_id === adapter);
      if (quota) {
        const active = await store.countActiveAllocations(ctx.tenantId, adapter);
        if (active >= quota.max_concurrent) {
          throw new SandboxError("resource_limit_exceeded", "Tenant concurrent allocation quota reached", {
            adapter_id: adapter,
            max_concurrent: quota.max_concurrent,
          });
        }
      }

      const live = deps.liveAdapters.has(adapter) && adapter !== "fake";
      // Fail-closed on real providers: never fake a live allocation. `fake`
      // drives the record lifecycle for tests/dev.
      const state = adapter === "fake" ? "active" : "requested";
      const reason =
        adapter === "fake"
          ? "fake_adapter_active"
          : live
            ? "provider_dispatch_gated_r2"
            : "provider_credentials_not_provisioned";
      const now = nowRfc3339();
      const allocation = await store.createAllocation({
        allocation_id: createOpaqueId("sbx"),
        tenant_id: ctx.tenantId,
        adapter_id: adapter,
        spec_sha256: canonicalDigest(spec),
        spec,
        requested_by_user_id: ctx.userId,
        state,
        state_reason: reason,
        expires_at: spec.expires_at,
        created_at: now,
      });
      return ok("v1.sandboxes.allocate", { allocation }, 201);
    }

    // GET /v1/sandboxes  (list)
    if (segments.length === 1 && method === "GET") {
      requireScope(ctx, SCOPES.read);
      const stateParam = url.searchParams.get("state") ?? undefined;
      const limitParam = url.searchParams.get("limit");
      const allocations = await store.listAllocations(ctx.tenantId, {
        ...(stateParam ? { state: stateParam as never } : {}),
        ...(limitParam ? { limit: Number(limitParam) } : {}),
      });
      return ok("v1.sandboxes.list", { allocations, count: allocations.length });
    }

    // GET /v1/sandboxes/:id
    if (segments.length === 2 && id !== undefined && method === "GET") {
      requireScope(ctx, SCOPES.read);
      const allocation = await store.getAllocation(ctx.tenantId, id);
      if (!allocation) throw new SandboxError("not_found", "Sandbox not found");
      return ok("v1.sandboxes.get", { allocation });
    }

    // POST /v1/sandboxes/:id/destroy
    if (segments.length === 3 && id !== undefined && sub === "destroy" && method === "POST") {
      requireScope(ctx, SCOPES.destroy);
      const existing = await store.getAllocation(ctx.tenantId, id);
      if (!existing) throw new SandboxError("not_found", "Sandbox not found");
      const now = nowRfc3339();
      const updated = await store.updateAllocation(
        ctx.tenantId,
        id,
        { state: "destroyed", state_reason: "destroyed_by_request", destroyed_at: now },
        now,
      );
      return ok("v1.sandboxes.destroy", { allocation: updated });
    }

    // POST /v1/sandboxes/:id/checkpoints
    if (segments.length === 3 && id !== undefined && sub === "checkpoints" && method === "POST") {
      requireScope(ctx, SCOPES.checkpoint);
      const allocation = await store.getAllocation(ctx.tenantId, id);
      if (!allocation) throw new SandboxError("not_found", "Sandbox not found");
      const body = await readJson(req);
      const label = typeof body["label"] === "string" ? (body["label"] as string) : null;
      const checkpointId = createOpaqueId("ckpt");
      let s3Key: string | null = null;
      let sizeBytes = 0;
      let digest = sha256("");
      const payload = body["payload_base64"];
      if (typeof payload === "string" && payload.length > 0) {
        const data = new Uint8Array(Buffer.from(payload, "base64"));
        const put = await blobStore.put(ctx.tenantId, `checkpoints/${checkpointId}.blob`, data);
        s3Key = put.key;
        sizeBytes = put.size_bytes;
        digest = put.sha256 as typeof digest;
      }
      const now = nowRfc3339();
      const checkpoint = await store.createCheckpoint({
        checkpoint_id: checkpointId,
        tenant_id: ctx.tenantId,
        allocation_id: id,
        s3_key: s3Key,
        size_bytes: sizeBytes,
        sha256: digest,
        label,
        created_at: now,
      });
      return ok("v1.sandboxes.checkpoint", { checkpoint }, 201);
    }

    // GET /v1/sandboxes/:id/checkpoints
    if (segments.length === 3 && id !== undefined && sub === "checkpoints" && method === "GET") {
      requireScope(ctx, SCOPES.read);
      const allocation = await store.getAllocation(ctx.tenantId, id);
      if (!allocation) throw new SandboxError("not_found", "Sandbox not found");
      const checkpoints = await store.listCheckpoints(ctx.tenantId, id);
      return ok("v1.sandboxes.checkpoints.list", { checkpoints, count: checkpoints.length });
    }
  }

  // GET /v1/checkpoints/:id
  if (head === "checkpoints" && segments.length === 2 && id !== undefined && method === "GET") {
    requireScope(ctx, SCOPES.read);
    const checkpoint = await store.getCheckpoint(ctx.tenantId, id);
    if (!checkpoint) throw new SandboxError("not_found", "Checkpoint not found");
    return ok("v1.checkpoints.get", { checkpoint });
  }

  // ----- admin (scope sandboxes:admin) -----
  if (head === "admin") {
    requireScope(ctx, SCOPES.admin);

    // POST /v1/admin/tenants
    if (id === "tenants" && sub === undefined && method === "POST") {
      const body = await readJson(req);
      const tenantId = typeof body["tenant_id"] === "string" ? (body["tenant_id"] as string) : crypto.randomUUID();
      // Creating a NEW tenant is a fleet-admin (root) operation.
      if (ctx.tenantId !== ROOT_TENANT_ID) {
        throw new HttpError(403, "forbidden", "Creating tenants requires the root tenant");
      }
      const slug = String(body["slug"] ?? tenantId);
      const name = String(body["name"] ?? slug);
      const kind = String(body["kind"] ?? "org");
      const tenant = await store.upsertTenant({
        tenant_id: tenantId,
        slug,
        name,
        kind,
        status: "active",
        created_at: nowRfc3339(),
      });
      return ok("v1.admin.tenants.create", { tenant }, 201);
    }

    // POST /v1/admin/quota
    if (id === "quota" && sub === undefined && method === "POST") {
      const body = await readJson(req);
      const tenantId = String(body["tenant_id"] ?? ctx.tenantId);
      assertAdminTenantScope(ctx, tenantId);
      const adapter = requireAdapter(body["adapter"]);
      const maxConcurrent = Number(body["max_concurrent"] ?? 0);
      if (!Number.isInteger(maxConcurrent) || maxConcurrent < 0) {
        throw new SandboxError("validation_failed", "max_concurrent must be a non-negative integer");
      }
      const quota = await store.upsertQuota({
        tenant_id: tenantId,
        adapter_id: adapter,
        max_concurrent: maxConcurrent,
        max_monthly_alloc: body["max_monthly_alloc"] === undefined ? null : Number(body["max_monthly_alloc"]),
        max_monthly_cost_micros:
          body["max_monthly_cost_micros"] === undefined ? null : Number(body["max_monthly_cost_micros"]),
      });
      return ok("v1.admin.quota.set", { quota }, 201);
    }

    // POST /v1/admin/api-keys  -> mint a sandboxes key bound to a tenant (kid bridge)
    if (id === "api-keys" && sub === undefined && method === "POST") {
      const body = await readJson(req);
      const tenantId = String(body["tenant_id"] ?? ctx.tenantId);
      assertAdminTenantScope(ctx, tenantId);
      const tenant = await store.getTenant(tenantId);
      if (!tenant) throw new SandboxError("not_found", "Tenant not found");
      const userId = typeof body["user_id"] === "string" ? (body["user_id"] as string) : null;
      const principalType = body["principal_type"] === "user" ? "user" : "service";
      const scopes = Array.isArray(body["scopes"])
        ? (body["scopes"] as unknown[]).map((s) => String(s))
        : ["sandboxes:read", "sandboxes:allocate", "sandboxes:checkpoint", "sandboxes:destroy"];
      const plaintext = newApiKeyPlaintext();
      const kid = `key_${crypto.randomUUID().replaceAll("-", "")}`;
      const binding = await store.putApiKey({
        kid,
        app: "sandboxes",
        token_hash: hashToken(plaintext),
        tenant_id: tenantId,
        user_id: userId,
        principal_type: principalType,
        scopes,
        issued_at: nowRfc3339(),
        expires_at: null,
        revoked_at: null,
      });
      return ok(
        "v1.admin.api-keys.create",
        { kid: binding.kid, api_key: plaintext, tenant_id: tenantId, scopes: binding.scopes },
        201,
      );
    }

    // POST /v1/admin/api-keys/:kid/revoke
    if (id === "api-keys" && sub !== undefined && subId === "revoke" && method === "POST") {
      const existing = await store.getApiKeyByKid(sub);
      // A cross-tenant kid must look identical to a non-existent one (404,
      // never 403) so a non-root admin cannot probe another tenant's key ids
      // (fail-closed existence hiding, _AUTH-TENANCY-STANDARD-v2 §11.3). The
      // root/fleet tenant is the only caller allowed to revoke across tenants.
      if (!existing || (existing.tenant_id !== ctx.tenantId && ctx.tenantId !== ROOT_TENANT_ID)) {
        throw new SandboxError("not_found", "Key not found");
      }
      await store.revokeApiKey(sub, nowRfc3339());
      return ok("v1.admin.api-keys.revoke", { kid: sub, revoked: true });
    }
  }

  throw new HttpError(404, "not_found", "No such route");
}

/** Top-level request handler (public routes + authed /v1). */
export async function handleRequest(req: Request, deps: RouteDeps): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();

  // Public health/version (no auth) — used by the ALB target-group health check.
  if ((path === "/health" || path === "/") && method === "GET") {
    return ok("health", { status: "ok", name: "sandboxes", version: deps.version, mode: "self_hosted" });
  }
  if (path === "/version" && method === "GET") {
    return ok("version", { name: "@hasnaxyz/sandboxes", version: deps.version });
  }

  if (!path.startsWith("/v1")) {
    return json(toErrorResponse("request", new HttpError(404, "not_found", "No such route")).envelope, 404);
  }

  const segments = path.slice("/v1".length).split("/").filter(Boolean);
  const operation = `v1.${segments.join(".") || "root"}`;

  let ctx: AuthContext;
  try {
    ctx = await resolveContext(req, deps.store, deps.auth);
  } catch (error) {
    const { status, envelope } = toErrorResponse(operation, error);
    const headers = status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined;
    return new Response(JSON.stringify(envelope), {
      status,
      headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", ...(headers ?? {}) },
    });
  }

  try {
    return await handleV1(req, url, segments, ctx, deps);
  } catch (error) {
    const { status, envelope } = toErrorResponse(operation, error);
    return json(envelope, status);
  }
}
