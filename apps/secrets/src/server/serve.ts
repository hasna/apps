/**
 * secrets-serve — the deployed HTTP API.
 *
 * Surfaces:
 *   GET /health   -> { status, version }             (no auth)
 *   GET /ready    -> { status, version, pendingMigrations }  (no auth)
 *   GET /version  -> { status, version }             (no auth)
 *   GET /openapi.json                                (no auth)
 *   /v1/*         -> strict API-key auth (@hasna/contracts) + scope checks
 *
 * Auth is stateless HMAC verification (no DB round-trip to prove authenticity)
 * plus a per-request revocation check against the api_keys table. Every secret
 * value is encrypted at rest server-side. Reads/writes hit PostgreSQL directly
 * (HASNA_SECRETS_DATABASE_URL present -> PostgreSQL, else SQLite); there is no
 * cache or local mirror.
 */

import { ApiKeyStore, verifyApiKey, type ApiKeyVerifier } from "@hasna/contracts/auth";
import {
  createServerPoolFromEnv,
  checkHealth,
  type PoolQueryClient,
} from "../generated/storage-kit/index.js";
import { APP_NAME, bootstrapCloudEnv, resolvePort, resolveSigningSecret } from "./cloud-env.js";
import { CloudSecretsStore } from "./cloud-store.js";
import { buildOpenApiDocument } from "./openapi.js";
import { getCloudMasterKey, VaultDecryptionError } from "./cloud-crypto.js";
import { VERSION } from "../version.js";
import type { SecretType, VaultItemKind } from "../types.js";
import { MetadataValidationError, VersionConflictError, VersionNotFoundError } from "../store/types.js";

const READ = ["secrets:read"];
const WRITE = ["secrets:write"];
const SECRET_TYPES: SecretType[] = ["api_key", "password", "token", "credential", "other"];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseTtl(ttl: string): string {
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid TTL: ${ttl}. Use e.g. 30d, 24h, 60m`);
  const [, num, unit] = match;
  const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as string]!;
  return new Date(Date.now() + parseInt(num, 10) * ms).toISOString();
}

export interface ServeDeps {
  client: PoolQueryClient;
  store: CloudSecretsStore;
  verifier: ApiKeyVerifier;
}

/** Build the request handler. Exposed for tests (inject a shim client). */
export function createHandler(deps: ServeDeps): (req: Request) => Promise<Response> {
  const { client, store, verifier } = deps;

  async function auth(req: Request, requiredScopes: string[]): Promise<
    { ok: true; actor: string; tenantId: string } | { ok: false; res: Response }
  > {
    const url = new URL(req.url);
    const decision = await verifier.authenticate((name: string) => req.headers.get(name), {
      method: req.method,
      path: url.pathname,
      requiredScopes,
    });
    if (!decision.ok) {
      return { ok: false, res: json({ error: decision.message, reason: decision.reason }, decision.status) };
    }
    const actor = decision.principal.agent ?? decision.principal.kid;
    const assignment = await client.get<{ tenant_id: string | null }>(
      "SELECT tenant_id FROM api_keys WHERE kid = $1",
      [decision.principal.kid],
    );
    if (!assignment?.tenant_id) {
      return { ok: false, res: json({ error: "API key has no tenant assignment" }, 403) };
    }
    return { ok: true, actor, tenantId: assignment.tenant_id };
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // ---- unauthenticated probes ----
      if (path === "/health" && method === "GET") {
        const health = await checkHealth(client);
        return json({ status: health.ok ? "ok" : "degraded", version: VERSION, latencyMs: health.latencyMs }, health.ok ? 200 : 503);
      }
      if (path === "/version" && method === "GET") {
        return json({ status: "ok", version: VERSION });
      }
      if (path === "/ready" && method === "GET") {
        // The one-shot secrets-prod-migrate task owns schema changes and its
        // migration ledger. The service role must not need DDL or
        // schema_migrations read access just to pass its liveness gate.
        const ready = await checkHealth(client);
        return json(
          { status: ready.ok ? "ok" : "not_ready", version: VERSION, pendingMigrations: [] },
          ready.ok ? 200 : 503,
        );
      }
      if (path === "/openapi.json" && method === "GET") {
        return json(buildOpenApiDocument(VERSION));
      }

      // ---- /v1 secrets ----
      if (path === "/v1/secrets" && method === "GET") {
        const a = await auth(req, READ);
        if (!a.ok) return a.res;
        const namespace = url.searchParams.get("namespace") ?? undefined;
        return json({ secrets: await store.listSecretMetadata(namespace) });
      }
      if (path === "/v1/secrets" && method === "POST") {
        const a = await auth(req, WRITE);
        if (!a.ok) return a.res;
        const body = (await req.json().catch(() => null)) as
          | {
              key?: string;
              value?: string;
              type?: string;
              label?: string;
              ttl?: string;
              expires_at?: string;
              reason?: string;
              change_kind?: string;
              batch_id?: string;
            }
          | null;
        if (!body?.key || typeof body.value !== "string") return json({ error: "key and value are required" }, 400);
        const type = (body.type && SECRET_TYPES.includes(body.type as SecretType) ? body.type : "other") as SecretType;
        // Accept either an absolute ISO `expires_at` (Store-contract clients) or a `ttl` duration like "30d" (raw API).
        let expiresAt: string | undefined;
        if (body.expires_at) {
          const parsed = Date.parse(body.expires_at);
          if (Number.isNaN(parsed)) return json({ error: `Invalid expires_at: ${body.expires_at}` }, 400);
          expiresAt = new Date(parsed).toISOString();
        } else if (body.ttl) {
          try {
            expiresAt = parseTtl(body.ttl);
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : "Invalid ttl" }, 400);
          }
        }
        const CHANGE_KINDS = ["initial", "set", "rotation", "import", "restore", "migration"];
        const entry = await store.setSecret(
          body.key,
          body.value,
          type,
          body.label,
          expiresAt,
          a.actor,
          a.tenantId,
          {
            ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
            ...(typeof body.change_kind === "string" && CHANGE_KINDS.includes(body.change_kind)
              ? { changeKind: body.change_kind as "initial" | "set" | "rotation" | "import" | "restore" | "migration" }
              : {}),
            ...(typeof body.batch_id === "string" ? { batchId: body.batch_id } : {}),
          },
        );
        const { value, ...meta } = entry;
        return json({ ...meta, version: entry.version, unchanged: entry.unchanged }, 200);
      }
      if (path === "/v1/secrets" && method === "DELETE") {
        const a = await auth(req, WRITE);
        if (!a.ok) return a.res;
        const key = url.searchParams.get("key");
        if (!key) return json({ error: "Missing key" }, 400);
        const ok = await store.deleteSecret(key, a.actor, a.tenantId);
        return json({ deleted: ok }, ok ? 200 : 404);
      }
      if (path === "/v1/secrets/get" && method === "GET") {
        const a = await auth(req, READ);
        if (!a.ok) return a.res;
        const key = url.searchParams.get("key");
        if (!key) return json({ error: "Missing key" }, 400);
        const entry = await store.getSecret(key, a.actor, a.tenantId);
        if (!entry) return json({ error: "Not found" }, 404);
        return json(entry);
      }
      if (path === "/v1/secrets/search" && method === "GET") {
        const a = await auth(req, READ);
        if (!a.ok) return a.res;
        const q = url.searchParams.get("q");
        if (!q) return json({ error: "Missing q" }, 400);
        return json({ results: await store.searchSecretMetadata(q) });
      }

      // ---- /v1 secret versioning (metadata-only; values never leave the server) ----
      if (path === "/v1/secrets/versions" && method === "GET") {
        const a = await auth(req, READ);
        if (!a.ok) return a.res;
        const key = url.searchParams.get("key");
        if (!key) return json({ error: "Missing key" }, 400);
        const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 20;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          return json({ error: "Invalid limit (1..100)" }, 400);
        }
        return json({ versions: await store.listVersions(key, a.actor, a.tenantId, limit) });
      }
      if (path === "/v1/secrets/versions/check" && method === "GET") {
        const a = await auth(req, READ);
        if (!a.ok) return a.res;
        const key = url.searchParams.get("key");
        const version = url.searchParams.get("version");
        if (!key || !version) return json({ error: "key and version are required" }, 400);
        const versionNum = Number(version);
        if (!Number.isInteger(versionNum) || versionNum < 1) return json({ error: "Invalid version" }, 400);
        return json({ check: await store.checkVersion(key, versionNum, a.actor, a.tenantId) });
      }
      if (path === "/v1/secrets/restore" && method === "POST") {
        const a = await auth(req, WRITE);
        if (!a.ok) return a.res;
        const body = (await req.json().catch(() => null)) as
          | { key?: string; version?: number; reason?: string; expected_current_version?: number }
          | null;
        if (!body?.key || typeof body.version !== "number") {
          return json({ error: "key and version are required" }, 400);
        }
        if (!Number.isInteger(body.version) || body.version < 1) return json({ error: "Invalid version" }, 400);
        if (!body.reason?.trim()) return json({ error: "reason is required for restore" }, 400);
        if (
          typeof body.expected_current_version !== "number" ||
          !Number.isInteger(body.expected_current_version) ||
          body.expected_current_version < 1
        ) {
          // CAS is mandatory at the API boundary (spec §2.2/§2.7.8): a restore
          // without the expected current version would be a blind overwrite of
          // a possibly newer rotation. The CLI always submits it.
          return json({ error: "expected_current_version is required and must be a positive integer" }, 400);
        }
        const restored = await store.restoreVersion(
          body.key,
          body.version,
          { reason: body.reason, expectCurrent: body.expected_current_version },
          a.actor,
          a.tenantId,
        );
        return json({ restored });
      }

      // ---- /v1 vault items ----
      if (path === "/v1/items" && method === "GET") {
        const a = await auth(req, READ);
        if (!a.ok) return a.res;
        const kind = (url.searchParams.get("kind") as VaultItemKind) || undefined;
        return json({ items: await store.listVaultItemMetadata(kind) });
      }
      if (path === "/v1/items" && method === "POST") {
        const a = await auth(req, WRITE);
        if (!a.ok) return a.res;
        const body = (await req.json().catch(() => null)) as
          | { kind?: VaultItemKind; title?: string; data?: Record<string, unknown>; id?: string; subtitle?: string; domains?: string[]; tags?: string[]; favorite?: boolean }
          | null;
        if (!body?.kind || !body.title) return json({ error: "kind and title are required" }, 400);
        const item = await store.setVaultItem(
          { kind: body.kind, title: body.title, data: body.data ?? {}, id: body.id, subtitle: body.subtitle, domains: body.domains, tags: body.tags, favorite: body.favorite },
          a.actor,
          a.tenantId,
        );
        return json(item);
      }
      if (path === "/v1/items/search" && method === "GET") {
        const a = await auth(req, READ);
        if (!a.ok) return a.res;
        const q = url.searchParams.get("q");
        if (!q) return json({ error: "Missing q" }, 400);
        return json({ results: await store.searchVaultItemMetadata(q) });
      }
      const itemMatch = path.match(/^\/v1\/items\/([^/]+)$/);
      if (itemMatch) {
        const id = decodeURIComponent(itemMatch[1]!);
        if (method === "GET") {
          const a = await auth(req, READ);
          if (!a.ok) return a.res;
          const item = await store.getVaultItem(id, a.actor, a.tenantId);
          if (!item) return json({ error: "Not found" }, 404);
          return json(item);
        }
        if (method === "DELETE") {
          const a = await auth(req, WRITE);
          if (!a.ok) return a.res;
          const ok = await store.deleteVaultItem(id, a.actor, a.tenantId);
          return json({ deleted: ok }, ok ? 200 : 404);
        }
      }

      // ---- /v1 audit + users ----
      if (path === "/v1/audit" && method === "GET") {
        const a = await auth(req, READ);
        if (!a.ok) return a.res;
        const key = url.searchParams.get("key") ?? undefined;
        const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 50;
        return json({ entries: await store.getAuditLog(key, limit) });
      }
      if (path === "/v1/users" && method === "GET") {
        const a = await auth(req, READ);
        if (!a.ok) return a.res;
        const type = (url.searchParams.get("type") as "human" | "agent") || undefined;
        return json({ users: await store.listUsers(type) });
      }
      if (path === "/v1/users" && method === "POST") {
        const a = await auth(req, WRITE);
        if (!a.ok) return a.res;
        const body = (await req.json().catch(() => null)) as { id?: string; name?: string; type?: "human" | "agent" } | null;
        if (!body?.id || !body.name) return json({ error: "id and name are required" }, 400);
        return json(await store.registerUser(body.id, body.name, body.type ?? "human", a.tenantId));
      }
      const userMatch = path.match(/^\/v1\/users\/([^/]+)$/);
      if (userMatch && method === "DELETE") {
        const a = await auth(req, WRITE);
        if (!a.ok) return a.res;
        const id = decodeURIComponent(userMatch[1]!);
        const ok = await store.deleteUser(id);
        return json({ deleted: ok }, ok ? 200 : 404);
      }

      // ---- /v1 feedback ----
      if (path === "/v1/feedback" && method === "POST") {
        const a = await auth(req, WRITE);
        if (!a.ok) return a.res;
        const body = (await req.json().catch(() => null)) as { message?: string; email?: string; category?: string } | null;
        if (!body?.message) return json({ error: "message is required" }, 400);
        await store.addFeedback(body.message, body.email, body.category ?? "general", VERSION, a.tenantId);
        return json({ ok: true });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof VaultDecryptionError) {
        return json(
          { error: error.message, code: error.code, recovery: error.recovery },
          422,
        );
      }
      if (error instanceof VersionNotFoundError) {
        return json({ error: error.message }, 404);
      }
      if (error instanceof VersionConflictError) {
        return json({ error: error.message }, 409);
      }
      if (error instanceof MetadataValidationError) {
        return json({ error: error.message }, 400);
      }
      const message = error instanceof Error ? error.message : String(error);
      return json({ error: message }, 500);
    }
  };
}

/** Boot the cloud service: resolve env, open the pool, build auth + routes. */
export async function startCloudServer(): Promise<void> {
  bootstrapCloudEnv();
  // Fail-closed: refuse to boot without a master key or signing secret.
  getCloudMasterKey();
  const signingSecret = resolveSigningSecret();
  const port = resolvePort();

  const { client } = createServerPoolFromEnv(APP_NAME, { applicationName: "secrets-serve" });
  const store = new CloudSecretsStore(client);
  // Idempotent version baseline: every existing value becomes version 1
  // (change_kind=migration) exactly once. Runs at boot before serving; a second
  // run is a no-op (UNIQUE(key, version)).
  const backfilled = await store.runVersionBackfill();
  if (backfilled > 0) console.log(`secrets-serve: version baseline backfilled ${backfilled} key(s)`);
  const keyStore = new ApiKeyStore(client);
  const verifier = verifyApiKey({
    app: APP_NAME,
    signingSecret,
    keyStatus: keyStore.keyStatus,
    audit: (e) => {
      // Structured, value-free audit line (never logs the token or secret).
      console.log(JSON.stringify({ evt: "api_auth", ...e }));
    },
  });

  const handle = createHandler({ client, store, verifier });

  Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: handle,
    error(e: unknown) {
      console.error("serve error:", e);
      return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { "Content-Type": "application/json" } });
    },
  });

  console.log(`secrets-serve listening on 0.0.0.0:${port} (version=${VERSION})`);
  await new Promise<never>(() => {});
}
