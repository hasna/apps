/**
 * Cloud (PURE REMOTE, Amendment A1) Hono app for @hasna/logs.
 *
 * Serves the standard operational probes (`/health`, `/ready`, `/version`) and
 * the versioned, API-key-authenticated `/v1` surface backed directly by the
 * shared cloud Postgres. Used when the serve runs in `cloud` storage mode
 * (`HASNA_LOGS_STORAGE_MODE=cloud`), i.e. the deployed ECS service.
 */

import { hasScope, honoApiKey } from "@hasna/contracts/auth";
import { type Context, Hono, type Next } from "hono";
import { cors } from "hono/cors";
import { logsCloudMigrations } from "../../db/pg-migrate.ts";
import {
  type PoolQueryClient,
  type TypedQueryClient,
  checkHealth,
} from "../../generated/storage-kit/index.ts";
import { buildOpenApiDocument } from "./openapi.ts";
import { CloudLogStore, LOG_LEVELS, type LogLevel } from "./store.ts";

export interface CloudAppOptions {
  client: TypedQueryClient;
  version: string;
  signingSecret: string;
  /** Revocation check (usually ApiKeyStore.isRevoked). */
  isRevoked?: (kid: string) => boolean | Promise<boolean>;
  /** Per-request auth audit hook. */
  audit?: (event: unknown) => void;
}

const MODE = "cloud";

function isLogLevel(value: unknown): value is LogLevel {
  return (
    typeof value === "string" &&
    (LOG_LEVELS as readonly string[]).includes(value)
  );
}

/** Build the cloud Hono app. Does not start a listener. */
export function buildCloudApp(options: CloudAppOptions): Hono {
  const store = new CloudLogStore(options.client);
  const migrations = logsCloudMigrations();
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization", "x-api-key"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  // --- operational probes (unauthenticated) --------------------------------
  app.get("/version", (c) =>
    c.json({ status: "ok", version: options.version, mode: MODE }),
  );

  app.get("/health", async (c) => {
    const health = await checkHealth(options.client);
    return c.json(
      {
        status: health.ok ? "ok" : "error",
        version: options.version,
        mode: MODE,
        db: {
          ok: health.ok,
          latency_ms: health.latencyMs,
          ...(health.error ? { error: health.error } : {}),
        },
      },
      health.ok ? 200 : 503,
    );
  });

  // Readiness: reachable AND fully migrated. Read-only (no DDL) so it runs
  // under the least-privileged app role, which cannot CREATE in schema public.
  const expectedMigrationIds = migrations.map((m) => m.id);
  app.get("/ready", async (c) => {
    try {
      const rows = await options.client.many<{ id: string }>(
        "SELECT id FROM schema_migrations",
      );
      const applied = new Set(rows.map((r) => r.id));
      const pending = expectedMigrationIds.filter((id) => !applied.has(id));
      const ok = pending.length === 0;
      return c.json(
        {
          status: ok ? "ok" : "not_ready",
          version: options.version,
          mode: MODE,
          pending_migrations: pending,
        },
        ok ? 200 : 503,
      );
    } catch (error) {
      return c.json(
        {
          status: "not_ready",
          version: options.version,
          mode: MODE,
          pending_migrations: expectedMigrationIds,
          error: error instanceof Error ? error.message : String(error),
        },
        503,
      );
    }
  });

  app.get("/openapi.json", (c) =>
    c.json(buildOpenApiDocument(options.version)),
  );

  app.get("/", (c) =>
    c.json({
      service: "@hasna/logs",
      status: "ok",
      version: options.version,
      mode: MODE,
      endpoints: ["/health", "/ready", "/version", "/openapi.json", "/v1"],
    }),
  );

  // --- authenticated /v1 ---------------------------------------------------
  const v1 = new Hono();
  v1.use(
    "*",
    honoApiKey({
      app: "logs",
      signingSecret: options.signingSecret,
      ...(options.isRevoked ? { isRevoked: options.isRevoked } : {}),
      ...(options.audit ? { audit: options.audit as never } : {}),
    }),
  );

  // Per-route scope guard using the wildcard-aware matcher from the auth kit.
  const requireScope = (scope: string) => async (c: Context, next: Next) => {
    const principal = c.get("apiKey") as { scopes?: string[] } | undefined;
    const scopes = principal?.scopes ?? [];
    if (!hasScope(scopes, scope)) {
      return c.json(
        {
          error: `Missing required scope '${scope}'.`,
          reason: "insufficient_scope",
        },
        403,
      );
    }
    return next();
  };

  // Projects
  v1.get("/projects", requireScope("logs:read"), async (c) => {
    const projects = await store.listProjects();
    return c.json({ projects });
  });

  v1.post("/projects", requireScope("logs:write"), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.name !== "string" || body.name.trim() === "") {
      return c.json({ error: "Field 'name' is required." }, 400);
    }
    const existing = await store.getProjectByName(body.name);
    if (existing) return c.json(existing, 200);
    const project = await store.createProject({
      name: body.name,
      github_repo: body.github_repo ?? null,
      base_url: body.base_url ?? null,
      description: body.description ?? null,
    });
    return c.json(project, 201);
  });

  v1.get("/projects/:id", requireScope("logs:read"), async (c) => {
    const project = await store.getProject(c.req.param("id") ?? "");
    if (!project) return c.json({ error: "Project not found." }, 404);
    return c.json(project);
  });

  // Logs
  v1.get("/logs", requireScope("logs:read"), async (c) => {
    const q = c.req.query();
    const level = q.level && isLogLevel(q.level) ? q.level : undefined;
    const logs = await store.listLogs({
      ...(q.project_id ? { project_id: q.project_id } : {}),
      ...(level ? { level } : {}),
      ...(q.service ? { service: q.service } : {}),
      ...(q.trace_id ? { trace_id: q.trace_id } : {}),
      ...(q.q ? { q: q.q } : {}),
      ...(q.limit ? { limit: Number(q.limit) } : {}),
    });
    return c.json({ logs });
  });

  v1.post("/logs", requireScope("logs:write"), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.message !== "string" || body.message === "") {
      return c.json({ error: "Field 'message' is required." }, 400);
    }
    if (!isLogLevel(body.level)) {
      return c.json(
        { error: `Field 'level' must be one of ${LOG_LEVELS.join(", ")}.` },
        400,
      );
    }
    const log = await store.createLog({
      level: body.level,
      message: body.message,
      project_id: body.project_id ?? null,
      source: body.source ?? null,
      service: body.service ?? null,
      trace_id: body.trace_id ?? null,
      session_id: body.session_id ?? null,
      agent: body.agent ?? null,
      url: body.url ?? null,
      stack_trace: body.stack_trace ?? null,
      metadata: body.metadata ?? null,
      timestamp: body.timestamp ?? null,
    });
    return c.json(log, 201);
  });

  // Aggregates — feed the CLI/MCP data-plane (ApiStore) over /v1.
  // Registered before "/logs/:id" so "count"/"summary" are not swallowed as ids.
  v1.get("/logs/count", requireScope("logs:read"), async (c) => {
    const q = c.req.query();
    const group_by = q.group_by === "service" ? "service" : undefined;
    return c.json(
      await store.countLogsBreakdown({
        ...(q.project_id ? { project_id: q.project_id } : {}),
        ...(q.service ? { service: q.service } : {}),
        ...(q.level && isLogLevel(q.level) ? { level: q.level } : {}),
        ...(q.since ? { since: q.since } : {}),
        ...(q.until ? { until: q.until } : {}),
        ...(group_by ? { group_by } : {}),
      }),
    );
  });

  v1.get("/logs/summary", requireScope("logs:read"), async (c) => {
    const q = c.req.query();
    const summary = await store.summarize(q.project_id, q.since, q.until);
    return c.json({ summary });
  });

  v1.get("/logs/:id", requireScope("logs:read"), async (c) => {
    const log = await store.getLog(c.req.param("id") ?? "");
    if (!log) return c.json({ error: "Log not found." }, 404);
    return c.json(log);
  });

  // Health summary (HealthResult-shaped) for the ApiStore.
  v1.get("/health", requireScope("logs:read"), async (c) => {
    const uptime = Math.floor(process.uptime());
    return c.json(await store.healthSummary(uptime));
  });

  v1.delete("/logs/:id", requireScope("logs:write"), async (c) => {
    const id = c.req.param("id") ?? "";
    const deleted = await store.deleteLog(id);
    return c.json({ deleted, id });
  });

  app.route("/v1", v1);
  return app;
}

/** Close a pool-backed client if it exposes `close()`. */
export async function closeCloudClient(
  client: TypedQueryClient | PoolQueryClient,
): Promise<void> {
  if (
    "close" in client &&
    typeof (client as PoolQueryClient).close === "function"
  ) {
    await (client as PoolQueryClient).close();
  }
}
