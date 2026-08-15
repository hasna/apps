/**
 * domains-serve HTTP application — framework-agnostic request handler.
 *
 * Surfaces:
 *   GET /health   — liveness ({status,version,mode})
 *   GET /ready    — readiness (DB reachable + schema migrated)
 *   GET /version  — {status,version,mode}
 *   GET /openapi.json — the OpenAPI 3.1 document
 *   /v1/*         — API-key authenticated CRUD over the portfolio
 *
 * Auth is delegated to @hasna/contracts `verifyApiKey` (stateless HMAC tokens,
 * scope grammar `domains:<action>`, revocation via the ApiKeyStore). Reads need
 * `domains:read`; writes need `domains:write`. A `domains:*` key covers both.
 *
 * PURE REMOTE (Amendment A1): every request reads/writes the cloud Postgres
 * directly. No cache, no local mirror.
 */

import { verifyApiKey, type ApiKeyVerifier, type AuthAuditEvent } from "@hasna/contracts/auth";
import type { TypedQueryClient } from "../generated/storage-kit/index.js";
import { checkHealth } from "../generated/storage-kit/index.js";
import { DomainsRepo, HttpError } from "./repo.js";
import { buildMigrations } from "./migrations.js";
import { buildOpenApiSpec } from "./openapi.js";

/**
 * Read-only readiness check. The service runs as the DML-only app role, which
 * (by design of the per-DB isolation) cannot run DDL — so we must NOT try to
 * create the ledger here. Instead we read the applied migration ids and compare
 * against the migrations this binary knows about. A missing ledger table means
 * migrations have not been run yet -> not ready.
 */
async function readReadiness(
  db: TypedQueryClient,
  knownIds: string[],
): Promise<{ ok: boolean; pendingMigrations: string[]; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const rows = await db.many<{ id: string }>("SELECT id FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.id));
    const pending = knownIds.filter((id) => !applied.has(id));
    return { ok: pending.length === 0, pendingMigrations: pending, latencyMs: Date.now() - start };
  } catch (e) {
    return {
      ok: false,
      pendingMigrations: knownIds,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface ServeAppOptions {
  db: TypedQueryClient;
  signingSecret: string;
  version: string;
  mode?: string;
  /** Revocation predicate (return true to DENY). Typically store.isRevoked. */
  isRevoked?: (kid: string) => boolean | Promise<boolean>;
  audit?: (e: AuthAuditEvent) => void;
}

export interface ServeApp {
  handle(req: Request): Promise<Response>;
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
  });
}

export function createServeApp(options: ServeAppOptions): ServeApp {
  const { db, version } = options;
  const mode = options.mode ?? "self_hosted";
  const repo = new DomainsRepo(db);
  const migrationIds = buildMigrations().map((m) => m.id);
  const spec = buildOpenApiSpec(version);

  const verifier: ApiKeyVerifier = verifyApiKey({
    app: "domains",
    signingSecret: options.signingSecret,
    ...(options.isRevoked ? { isRevoked: options.isRevoked } : {}),
    ...(options.audit ? { audit: options.audit } : {}),
  });

  async function readBody(req: Request): Promise<any> {
    const text = await req.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, "invalid JSON body");
    }
  }

  /** Authenticate + enforce scopes; returns a Response on failure, null on success. */
  async function auth(req: Request, path: string, scopes: string[]): Promise<Response | null> {
    const decision = await verifier.authenticate(req.headers, {
      method: req.method,
      path,
      requiredScopes: scopes,
    });
    if (decision.ok) return null;
    return json({ error: decision.message, reason: decision.reason }, decision.status);
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // ── public probes ─────────────────────────────────────────────────
      if (method === "GET" && path === "/health") {
        const h = await checkHealth(db);
        return json(
          { status: h.ok ? "ok" : "error", version, mode, latencyMs: h.latencyMs, ...(h.error ? { error: h.error } : {}) },
          h.ok ? 200 : 503,
        );
      }
      if (method === "GET" && path === "/ready") {
        const r = await readReadiness(db, migrationIds);
        return json(
          {
            status: r.ok ? "ok" : "not_ready",
            version,
            mode,
            pendingMigrations: r.pendingMigrations,
            ...(r.error ? { error: r.error } : {}),
          },
          r.ok ? 200 : 503,
        );
      }
      if (method === "GET" && (path === "/version" || path === "/v1/version")) {
        return json({ status: "ok", version, mode });
      }
      if (method === "GET" && (path === "/openapi.json" || path === "/v1/openapi.json")) {
        return json(spec);
      }

      // ── /v1 authenticated surface ─────────────────────────────────────
      if (path === "/v1/domains") {
        if (method === "GET") {
          const denied = await auth(req, path, ["domains:read"]);
          if (denied) return denied;
          const domains = await repo.listDomains({
            search: url.searchParams.get("search") ?? undefined,
            status: url.searchParams.get("status") ?? undefined,
            limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
            offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
          });
          return json({ domains, count: domains.length });
        }
        if (method === "POST") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          const domain = await repo.createDomain(await readBody(req));
          return json(domain, 201);
        }
      }

      if (method === "GET" && path === "/v1/stats") {
        const denied = await auth(req, path, ["domains:read"]);
        if (denied) return denied;
        return json(await repo.getStats());
      }

      let m = path.match(/^\/v1\/domains\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (method === "GET") {
          const denied = await auth(req, path, ["domains:read"]);
          if (denied) return denied;
          const domain = await repo.getDomain(id);
          return domain ? json(domain) : json({ error: "domain not found" }, 404);
        }
        if (method === "PATCH" || method === "PUT") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          const domain = await repo.updateDomain(id, await readBody(req));
          return domain ? json(domain) : json({ error: "domain not found" }, 404);
        }
        if (method === "DELETE") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          const deleted = await repo.deleteDomain(id);
          return json({ id, deleted });
        }
      }

      m = path.match(/^\/v1\/domains\/([^/]+)\/dns$/);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (method === "GET") {
          const denied = await auth(req, path, ["domains:read"]);
          if (denied) return denied;
          const records = await repo.listDnsRecords(id);
          return json({ records, count: records.length });
        }
        if (method === "POST") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          const record = await repo.createDnsRecord(id, await readBody(req));
          return json(record, 201);
        }
      }

      m = path.match(/^\/v1\/dns\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (method === "GET") {
          const denied = await auth(req, path, ["domains:read"]);
          if (denied) return denied;
          const record = await repo.getDnsRecord(id);
          return record ? json(record) : json({ error: "dns record not found" }, 404);
        }
        if (method === "PATCH" || method === "PUT") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          const record = await repo.updateDnsRecord(id, await readBody(req));
          return record ? json(record) : json({ error: "dns record not found" }, 404);
        }
        if (method === "DELETE") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          const deleted = await repo.deleteDnsRecord(id);
          return json({ id, deleted });
        }
      }

      m = path.match(/^\/v1\/domains\/([^/]+)\/offers$/);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (method === "GET") {
          const denied = await auth(req, path, ["domains:read"]);
          if (denied) return denied;
          const offers = await repo.listOffers(id);
          return json({ offers, count: offers.length });
        }
        if (method === "POST") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          const offer = await repo.createOffer(id, await readBody(req));
          return json(offer, 201);
        }
      }

      // ── alerts ────────────────────────────────────────────────────────
      m = path.match(/^\/v1\/domains\/([^/]+)\/alerts$/);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (method === "GET") {
          const denied = await auth(req, path, ["domains:read"]);
          if (denied) return denied;
          const alerts = await repo.listAlerts(id);
          return json({ alerts, count: alerts.length });
        }
        if (method === "POST") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          return json(await repo.createAlert(id, await readBody(req)), 201);
        }
      }
      m = path.match(/^\/v1\/alerts\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (method === "GET") {
          const denied = await auth(req, path, ["domains:read"]);
          if (denied) return denied;
          const alert = await repo.getAlert(id);
          return alert ? json(alert) : json({ error: "alert not found" }, 404);
        }
        if (method === "DELETE") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          return json({ id, deleted: await repo.deleteAlert(id) });
        }
      }

      // ── email links ───────────────────────────────────────────────────
      m = path.match(/^\/v1\/domains\/([^/]+)\/emails$/);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (method === "GET") {
          const denied = await auth(req, path, ["domains:read"]);
          if (denied) return denied;
          const emails = await repo.listEmailLinks(id);
          return json({ emails, count: emails.length });
        }
        if (method === "POST") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          return json(await repo.linkEmail(id, await readBody(req)), 201);
        }
      }
      m = path.match(/^\/v1\/emails\/([^/]+)$/);
      if (m && method === "GET") {
        const denied = await auth(req, path, ["domains:read"]);
        if (denied) return denied;
        const link = await repo.getEmailLink(decodeURIComponent(m[1]!));
        return link ? json(link) : json({ error: "email link not found" }, 404);
      }

      // ── offers by id ──────────────────────────────────────────────────
      m = path.match(/^\/v1\/offers\/([^/]+)$/);
      if (m && method === "GET") {
        const denied = await auth(req, path, ["domains:read"]);
        if (denied) return denied;
        const offer = await repo.getOffer(decodeURIComponent(m[1]!));
        return offer ? json(offer) : json({ error: "offer not found" }, 404);
      }

      // ── owners ────────────────────────────────────────────────────────
      if (path === "/v1/owners-portfolio" && method === "GET") {
        const denied = await auth(req, path, ["domains:read"]);
        if (denied) return denied;
        const domains = await repo.listDomainsWithOwners();
        return json({ domains, count: domains.length });
      }
      m = path.match(/^\/v1\/domains\/([^/]+)\/owners$/);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (method === "GET") {
          const denied = await auth(req, path, ["domains:read"]);
          if (denied) return denied;
          const owners = await repo.listOwnersForDomain(id);
          return json({ owners, count: owners.length });
        }
        if (method === "POST") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          return json(await repo.createOwner(id, await readBody(req)), 201);
        }
      }
      if (path === "/v1/owners" && method === "GET") {
        const denied = await auth(req, path, ["domains:read"]);
        if (denied) return denied;
        const owners = await repo.listOwners({
          search: url.searchParams.get("search") ?? undefined,
          source: url.searchParams.get("source") ?? undefined,
          verified: url.searchParams.has("verified") ? url.searchParams.get("verified") === "true" : undefined,
        });
        return json({ owners, count: owners.length });
      }
      m = path.match(/^\/v1\/owners\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (method === "GET") {
          const denied = await auth(req, path, ["domains:read"]);
          if (denied) return denied;
          const owner = await repo.getOwner(id);
          return owner ? json(owner) : json({ error: "owner not found" }, 404);
        }
        if (method === "PATCH" || method === "PUT") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          const owner = await repo.updateOwner(id, await readBody(req));
          return owner ? json(owner) : json({ error: "owner not found" }, 404);
        }
        if (method === "DELETE") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          return json({ id, deleted: await repo.deleteOwner(id) });
        }
      }

      // ── history ───────────────────────────────────────────────────────
      if (path === "/v1/history-changes" && method === "GET") {
        const denied = await auth(req, path, ["domains:read"]);
        if (denied) return denied;
        const domains = await repo.listHistoryChanges();
        return json({ domains, count: domains.length });
      }
      if (path === "/v1/history" && method === "GET") {
        const denied = await auth(req, path, ["domains:read"]);
        if (denied) return denied;
        const start = url.searchParams.get("start");
        const end = url.searchParams.get("end");
        if (!start || !end) return json({ error: "start and end are required" }, 400);
        const hist = await repo.listHistoryByDateRange(start, end, url.searchParams.get("domain") ?? undefined);
        return json({ history: hist, count: hist.length });
      }
      m = path.match(/^\/v1\/domains\/([^/]+)\/history$/);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (method === "GET") {
          const denied = await auth(req, path, ["domains:read"]);
          if (denied) return denied;
          const hist = await repo.listHistory(id, {
            type: url.searchParams.get("type") ?? undefined,
            limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
          });
          return json({ history: hist, count: hist.length });
        }
        if (method === "POST") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          return json(await repo.createHistory(id, await readBody(req)), 201);
        }
        if (method === "DELETE") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          return json({ id, deleted: await repo.deleteHistoryByDomain(id) });
        }
      }
      m = path.match(/^\/v1\/history\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (method === "GET") {
          const denied = await auth(req, path, ["domains:read"]);
          if (denied) return denied;
          const entry = await repo.getHistory(id);
          return entry ? json(entry) : json({ error: "history entry not found" }, 404);
        }
        if (method === "DELETE") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          return json({ id, deleted: await repo.deleteHistory(id) });
        }
      }

      // ── reputation ────────────────────────────────────────────────────
      if (path === "/v1/reputation" && method === "GET") {
        const denied = await auth(req, path, ["domains:read"]);
        if (denied) return denied;
        const reputation = await repo.listReputation({
          blacklisted: url.searchParams.get("blacklisted") === "true",
          threshold: url.searchParams.get("threshold") ? Number(url.searchParams.get("threshold")) : undefined,
        });
        return json({ reputation, count: reputation.length });
      }
      m = path.match(/^\/v1\/domains\/([^/]+)\/reputation$/);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (method === "GET") {
          const denied = await auth(req, path, ["domains:read"]);
          if (denied) return denied;
          const rep = await repo.getReputation(id);
          return rep ? json(rep) : json({ error: "reputation not found" }, 404);
        }
        if (method === "PUT" || method === "PATCH") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          return json(await repo.upsertReputation(id, await readBody(req)));
        }
      }
      m = path.match(/^\/v1\/reputation\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]!);
        if (method === "PATCH" || method === "PUT") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          const rep = await repo.updateReputation(id, await readBody(req));
          return rep ? json(rep) : json({ error: "reputation not found" }, 404);
        }
        if (method === "DELETE") {
          const denied = await auth(req, path, ["domains:write"]);
          if (denied) return denied;
          return json({ id, deleted: await repo.deleteReputation(id) });
        }
      }

      return json({ error: "Not found" }, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      const message = e instanceof Error ? e.message : String(e);
      return json({ error: message }, 500);
    }
  }

  return { handle };
}
