/**
 * secrets-serve — the deployed HTTP API (PURE REMOTE, Amendment A1).
 *
 * Surfaces:
 *   GET /health   -> { status, version, mode }             (no auth)
 *   GET /ready    -> { status, version, mode, pendingMigrations }  (no auth)
 *   GET /version  -> { status, version, mode }             (no auth)
 *   GET /openapi.json                                       (no auth)
 *   /v1/*         -> strict API-key auth (@hasna/contracts) + scope checks
 *
 * Auth is stateless HMAC verification (no DB round-trip to prove authenticity)
 * plus a per-request revocation check against the api_keys table. Every secret
 * value is encrypted at rest (cloud-crypto). Reads/writes hit cloud Postgres
 * directly; there is no cache or local mirror.
 */

import { ApiKeyStore, verifyApiKey, type ApiKeyVerifier } from "@hasna/contracts/auth";
import {
  createCloudPoolFromEnv,
  checkHealth,
  checkReady,
  type PoolQueryClient,
} from "../generated/storage-kit/index.js";
import { APP_NAME, bootstrapCloudEnv, resolvePort, resolveSigningSecret } from "./cloud-env.js";
import { CloudSecretsStore } from "./cloud-store.js";
import { SECRETS_MIGRATIONS } from "./cloud-migrations.js";
import { buildOpenApiDocument } from "./openapi.js";
import { getCloudMasterKey } from "./cloud-crypto.js";
import { VERSION } from "../version.js";
import type { SecretType, VaultItemKind } from "../types.js";

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
    { ok: true; actor: string } | { ok: false; res: Response }
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
    return { ok: true, actor };
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // ---- unauthenticated probes ----
      if (path === "/health" && method === "GET") {
        const health = await checkHealth(client);
        return json({ status: health.ok ? "ok" : "degraded", version: VERSION, mode: "cloud", latencyMs: health.latencyMs }, health.ok ? 200 : 503);
      }
      if (path === "/version" && method === "GET") {
        return json({ status: "ok", version: VERSION, mode: "cloud" });
      }
      if (path === "/ready" && method === "GET") {
        const ready = await checkReady(client, SECRETS_MIGRATIONS);
        return json(
          { status: ready.ok ? "ok" : "not_ready", version: VERSION, mode: "cloud", pendingMigrations: ready.pendingMigrations },
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
          | { key?: string; value?: string; type?: string; label?: string; ttl?: string }
          | null;
        if (!body?.key || typeof body.value !== "string") return json({ error: "key and value are required" }, 400);
        const type = (body.type && SECRET_TYPES.includes(body.type as SecretType) ? body.type : "other") as SecretType;
        const expiresAt = body.ttl ? parseTtl(body.ttl) : undefined;
        const entry = await store.setSecret(body.key, body.value, type, body.label, expiresAt, a.actor);
        const { value, ...meta } = entry;
        return json(meta, 200);
      }
      if (path === "/v1/secrets" && method === "DELETE") {
        const a = await auth(req, WRITE);
        if (!a.ok) return a.res;
        const key = url.searchParams.get("key");
        if (!key) return json({ error: "Missing key" }, 400);
        const ok = await store.deleteSecret(key, a.actor);
        return json({ deleted: ok }, ok ? 200 : 404);
      }
      if (path === "/v1/secrets/get" && method === "GET") {
        const a = await auth(req, READ);
        if (!a.ok) return a.res;
        const key = url.searchParams.get("key");
        if (!key) return json({ error: "Missing key" }, 400);
        const entry = await store.getSecret(key, a.actor);
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
          const item = await store.getVaultItem(id, a.actor);
          if (!item) return json({ error: "Not found" }, 404);
          return json(item);
        }
        if (method === "DELETE") {
          const a = await auth(req, WRITE);
          if (!a.ok) return a.res;
          const ok = await store.deleteVaultItem(id, a.actor);
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
        return json(await store.registerUser(body.id, body.name, body.type ?? "human"));
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
        await store.addFeedback(body.message, body.email, body.category ?? "general", VERSION);
        return json({ ok: true });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
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

  const { client } = createCloudPoolFromEnv(APP_NAME, { applicationName: "secrets-serve" });
  const store = new CloudSecretsStore(client);
  const keyStore = new ApiKeyStore(client);
  const verifier = verifyApiKey({
    app: APP_NAME,
    signingSecret,
    isRevoked: keyStore.isRevoked,
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

  console.log(`secrets-serve listening on 0.0.0.0:${port} (mode=cloud, version=${VERSION})`);
  await new Promise<never>(() => {});
}
