/**
 * Shortlinks serve HTTP app.
 *
 * Surfaces the standard health/ready/version probes plus a versioned `/v1`
 * REST API guarded by @hasna/contracts API-key auth. All reads/writes go
 * through the injected Postgres store — there is no sync engine or cache in
 * the service.
 */

import { Hono, type Context } from "hono";
import { verifyApiKey, type ApiKeyVerifier } from "@hasna/contracts/auth";
import type { ShortlinksKeyStatusResolver } from "../client-types.js";
import type { PoolQueryClient } from "../generated/storage-kit/query.js";
import { checkHealth, checkReady } from "../generated/storage-kit/health.js";
import { PgShortlinksStore } from "../pg-store.js";
import { SHORTLINKS_MIGRATIONS } from "../db/migrations.js";
import { buildOpenApiDocument } from "./openapi.js";

const APP_SLUG = "shortlinks";

export interface ServeAppDeps {
  client: PoolQueryClient;
  store: PgShortlinksStore;
  version: string;
  /** Server data backend label (`sqlite` | `postgresql`) for probe payloads. */
  backend: string;
  signingSecret: string;
  /** Lifecycle lookup for presented API keys (wire `store.keyStatus`). */
  keyStatus?: ShortlinksKeyStatusResolver;
  audit?: (event: unknown) => void;
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export function createServeApp(deps: ServeAppDeps): Hono {
  const app = new Hono();
  const { store, client, version, backend } = deps;

  const verifier: ApiKeyVerifier = verifyApiKey({
    app: APP_SLUG,
    signingSecret: deps.signingSecret,
    ...(deps.keyStatus ? { keyStatus: deps.keyStatus } : {}),
    ...(deps.audit ? { audit: deps.audit as never } : {}),
  });

  app.use("*", async (c, next) => {
    await next();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.header(k, v);
  });

  // Authenticate + enforce scopes for a /v1 request. Returns a Response on
  // failure (caller should return it), or null on success.
  async function requireScopes(c: Context, scopes: string[]): Promise<Response | null> {
    const decision = await verifier.authenticate(c.req.raw.headers, {
      method: c.req.method,
      path: c.req.path,
      requiredScopes: scopes,
    });
    if (!decision.ok) {
      return c.json({ error: decision.message, reason: decision.reason }, decision.status);
    }
    c.set("apiKey", decision.principal);
    return null;
  }

  function handleError(c: Context, error: unknown): Response {
    const message = error instanceof Error ? error.message : String(error);
    const notFound = /not found/i.test(message);
    return c.json({ error: message }, notFound ? 404 : 400);
  }

  // ── Health / ready / version ────────────────────────────────────────────
  app.get("/health", async (c) => {
    const health = await checkHealth(client);
    return c.json(
      { status: health.ok ? "ok" : "degraded", version, backend, db_latency_ms: health.latencyMs },
      health.ok ? 200 : 503,
    );
  });

  app.get("/ready", async (c) => {
    const ready = await checkReady(client, SHORTLINKS_MIGRATIONS);
    return c.json(
      {
        status: ready.ok ? "ready" : "not_ready",
        version,
        backend,
        pending_migrations: ready.pendingMigrations,
        ...(ready.error ? { error: ready.error } : {}),
      },
      ready.ok ? 200 : 503,
    );
  });

  app.get("/version", (c) => c.json({ status: "ok", version, backend, name: `@hasna/${APP_SLUG}` }));

  app.get("/openapi.json", (c) => c.json(buildOpenApiDocument(version)));

  // ── /v1 API ──────────────────────────────────────────────────────────────
  app.get("/v1/stats", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:read`]);
    if (denied) return denied;
    return c.json(await store.totalStats());
  });

  app.get("/v1/domains", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:read`]);
    if (denied) return denied;
    return c.json(await store.listDomains());
  });

  app.post("/v1/domains", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:write`]);
    if (denied) return denied;
    const body = (await c.req.json().catch(() => null)) as
      | {
          hostname?: string;
          provider?: string;
          default?: boolean;
          origin_url?: string;
          notes?: string;
          metadata?: Record<string, unknown>;
        }
      | null;
    if (!body?.hostname) return c.json({ error: "hostname is required" }, 400);
    try {
      const domain = await store.addDomain({
        hostname: body.hostname,
        ...(body.provider !== undefined ? { provider: body.provider } : {}),
        ...(body.default !== undefined ? { defaultDomain: body.default } : {}),
        ...(body.origin_url !== undefined ? { originUrl: body.origin_url } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
      });
      return c.json(domain, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete("/v1/domains/:hostname", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:write`]);
    if (denied) return denied;
    const hostname = c.req.param("hostname");
    try {
      const domain = await store.deleteDomain(hostname);
      return c.json({ deleted: true, hostname: domain.hostname });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get("/v1/links", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:read`]);
    if (denied) return denied;
    const domain = c.req.query("domain");
    const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : 100;
    const activeOnly = c.req.query("active") === "true";
    const links = await store.listLinks({
      ...(domain ? { domain } : {}),
      activeOnly,
      limit,
    });
    return c.json(links);
  });

  app.post("/v1/links", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:write`]);
    if (denied) return denied;
    const body = (await c.req.json().catch(() => null)) as
      | {
          url?: string;
          domain?: string;
          slug?: string;
          title?: string;
          expires_at?: string;
          length?: number;
          metadata?: Record<string, unknown>;
        }
      | null;
    if (!body?.url) return c.json({ error: "url is required" }, 400);
    try {
      const link = await store.createLink({
        destinationUrl: body.url,
        ...(body.domain !== undefined ? { domain: body.domain } : {}),
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.expires_at !== undefined ? { expiresAt: body.expires_at } : {}),
        ...(body.length !== undefined ? { slugLength: body.length } : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
      });
      return c.json(link, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get("/v1/links/:slug", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:read`]);
    if (denied) return denied;
    const slug = c.req.param("slug");
    const domain = c.req.query("domain");
    const link = domain ? await store.getLink(domain, slug) : await store.getLink(slug);
    if (!link) return c.json({ error: "Link not found." }, 404);
    return c.json(link);
  });

  app.delete("/v1/links/:slug", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:write`]);
    if (denied) return denied;
    const slug = c.req.param("slug");
    const domain = c.req.query("domain");
    try {
      const link = domain ? await store.deleteLink(domain, slug) : await store.deleteLink(slug);
      return c.json({ deleted: true, slug: link.slug });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/v1/links/:slug/enable", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:write`]);
    if (denied) return denied;
    const slug = c.req.param("slug");
    const domain = c.req.query("domain");
    try {
      const link = domain ? await store.setLinkActive(domain, slug, true) : await store.setLinkActive(slug, true);
      return c.json(link);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/v1/links/:slug/disable", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:write`]);
    if (denied) return denied;
    const slug = c.req.param("slug");
    const domain = c.req.query("domain");
    try {
      const link = domain ? await store.setLinkActive(domain, slug, false) : await store.setLinkActive(slug, false);
      return c.json(link);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get("/v1/links/:slug/stats", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:read`]);
    if (denied) return denied;
    const slug = c.req.param("slug");
    const domain = c.req.query("domain");
    try {
      const stats = domain ? await store.getStats(domain, slug) : await store.getStats(slug);
      return c.json(stats);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get("/v1/resolve/:slug", async (c) => {
    const denied = await requireScopes(c, [`${APP_SLUG}:read`]);
    if (denied) return denied;
    const slug = c.req.param("slug");
    const domain = c.req.query("domain");
    const link = domain ? await store.getLink(domain, slug) : await store.getLink(slug);
    if (!link) return c.json({ error: "Link not found." }, 404);
    return c.json(link);
  });

  return app;
}
