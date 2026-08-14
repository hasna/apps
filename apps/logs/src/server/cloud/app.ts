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
import type { EventCatalogQuery } from "../../lib/events.ts";
import type { TestReportQuery } from "../../lib/test-reports.ts";
import type { UniversalEventInput } from "../../lib/universal-ingest.ts";
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

  // Trace/context window around a single log id.
  v1.get("/logs/:id/context", requireScope("logs:read"), async (c) => {
    const id = c.req.param("id") ?? "";
    const window = Number(c.req.query("window") ?? 0);
    return c.json({
      logs: await store.logContextFromId(
        id,
        Number.isFinite(window) ? window : 0,
      ),
    });
  });

  // Pages
  v1.get("/pages", requireScope("logs:read"), async (c) => {
    const projectId = c.req.query("project_id");
    if (!projectId) return c.json({ error: "project_id is required." }, 400);
    return c.json({ pages: await store.listPages(projectId) });
  });

  v1.post("/pages", requireScope("logs:write"), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.project_id !== "string" ||
      typeof body.url !== "string"
    ) {
      return c.json(
        { error: "Fields 'project_id' and 'url' are required." },
        400,
      );
    }
    const page = await store.createPage({
      project_id: body.project_id,
      url: body.url,
      ...(body.path ? { path: body.path } : {}),
      ...(body.name ? { name: body.name } : {}),
    });
    return c.json(page, 201);
  });

  // Scan jobs
  v1.get("/jobs", requireScope("logs:read"), async (c) => {
    const projectId = c.req.query("project_id");
    return c.json({ jobs: await store.listJobs(projectId || undefined) });
  });

  v1.post("/jobs", requireScope("logs:write"), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.project_id !== "string" ||
      typeof body.schedule !== "string"
    ) {
      return c.json(
        { error: "Fields 'project_id' and 'schedule' are required." },
        400,
      );
    }
    const job = await store.createJob({
      project_id: body.project_id,
      schedule: body.schedule,
      ...(body.page_id ? { page_id: body.page_id } : {}),
    });
    return c.json(job, 201);
  });

  // Events catalog (raw envelope is local-only)
  // Ingest one universal telemetry event, or a `{ events: [...] }` batch — the
  // data-plane path for `logs run` capture, `events push`, and the SDK/MCP.
  v1.post("/events", requireScope("logs:write"), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "body must be a JSON object" }, 400);
    }
    const batch = Array.isArray((body as { events?: unknown }).events);
    const inputs = (
      batch ? (body as { events: unknown[] }).events : [body]
    ) as UniversalEventInput[];
    if (inputs.length === 0) {
      return c.json({ error: "body must contain at least one event" }, 400);
    }
    try {
      const results = [];
      for (const event of inputs) results.push(await store.createEvent(event));
      if (!batch) {
        const [only] = results;
        if (!only) return c.json({ error: "no event ingested" }, 422);
        return c.json(only.event, only.inserted ? 201 : 200);
      }
      return c.json(
        {
          inserted: results.filter((r) => r.inserted).length,
          events: results.map((r) => r.event),
        },
        201,
      );
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        422,
      );
    }
  });

  v1.get("/events", requireScope("logs:read"), async (c) =>
    c.json({
      events: await store.searchEvents(parseEventQuery(c.req.query())),
    }),
  );

  v1.get("/events/:id", requireScope("logs:read"), async (c) => {
    const event = await store.getEvent(c.req.param("id") ?? "");
    if (!event) return c.json({ error: "Event not found." }, 404);
    return c.json(event);
  });

  // Test reports
  v1.get("/test-reports", requireScope("logs:read"), async (c) =>
    c.json({
      reports: await store.searchTestReports(
        parseTestReportQuery(c.req.query()),
      ),
    }),
  );

  v1.get("/test-reports/:id", requireScope("logs:read"), async (c) => {
    const includeCases = c.req.query("include_cases") !== "false";
    const report = await store.getTestReport(
      c.req.param("id") ?? "",
      includeCases,
    );
    if (!report) return c.json({ error: "Test report not found." }, 404);
    return c.json(report);
  });

  // Performance snapshots
  v1.get("/perf/latest", requireScope("logs:read"), async (c) => {
    const projectId = c.req.query("project_id");
    if (!projectId) return c.json({ error: "project_id is required." }, 400);
    return c.json({
      snapshot: await store.latestPerfSnapshot(
        projectId,
        c.req.query("page_id") || undefined,
      ),
    });
  });

  v1.get("/perf/trend", requireScope("logs:read"), async (c) => {
    const projectId = c.req.query("project_id");
    if (!projectId) return c.json({ error: "project_id is required." }, 400);
    const limit = Number(c.req.query("limit") ?? 50);
    return c.json({
      snapshots: await store.perfTrend(
        projectId,
        c.req.query("page_id") || undefined,
        c.req.query("since") || undefined,
        Number.isFinite(limit) ? limit : 50,
      ),
    });
  });

  // Issues
  v1.get("/issues", requireScope("logs:read"), async (c) => {
    const limit = Number(c.req.query("limit") ?? 50);
    return c.json({
      issues: await store.listIssues(
        c.req.query("project_id") || undefined,
        c.req.query("status") || undefined,
        Number.isFinite(limit) ? limit : 50,
      ),
    });
  });

  v1.patch("/issues/:id", requireScope("logs:write"), async (c) => {
    const body = await c.req.json().catch(() => null);
    const status = body?.status;
    if (status !== "open" && status !== "resolved" && status !== "ignored") {
      return c.json(
        { error: "Field 'status' must be one of open, resolved, ignored." },
        400,
      );
    }
    const updated = await store.updateIssueStatus(
      c.req.param("id") ?? "",
      status,
    );
    if (!updated) return c.json({ error: "Issue not found." }, 404);
    return c.json(updated);
  });

  // Alert rules
  v1.get("/alert-rules", requireScope("logs:read"), async (c) =>
    c.json({
      rules: await store.listAlertRules(c.req.query("project_id") || undefined),
    }),
  );

  v1.post("/alert-rules", requireScope("logs:write"), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.project_id !== "string" ||
      typeof body.name !== "string"
    ) {
      return c.json(
        { error: "Fields 'project_id' and 'name' are required." },
        400,
      );
    }
    const rule = await store.createAlertRule({
      project_id: body.project_id,
      name: body.name,
      ...(body.service ? { service: body.service } : {}),
      ...(body.level ? { level: body.level } : {}),
      ...(body.threshold_count !== undefined
        ? { threshold_count: Number(body.threshold_count) }
        : {}),
      ...(body.window_seconds !== undefined
        ? { window_seconds: Number(body.window_seconds) }
        : {}),
      ...(body.action ? { action: body.action } : {}),
      ...(body.webhook_url ? { webhook_url: body.webhook_url } : {}),
    });
    return c.json(rule, 201);
  });

  v1.delete("/alert-rules/:id", requireScope("logs:write"), async (c) => {
    const id = c.req.param("id") ?? "";
    await store.deleteAlertRule(id);
    return c.json({ deleted: true, id });
  });

  // Feedback
  v1.post("/feedback", requireScope("logs:write"), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.message !== "string" ||
      body.message.trim() === ""
    ) {
      return c.json({ error: "Field 'message' is required." }, 400);
    }
    await store.recordFeedback(
      body.message,
      typeof body.email === "string" ? body.email : null,
      typeof body.category === "string" ? body.category : "general",
      typeof body.version === "string" ? body.version : "",
    );
    return c.json({ ok: true }, 201);
  });

  // Session context
  v1.get("/sessions/:id/context", requireScope("logs:read"), async (c) =>
    c.json(await store.sessionContext(c.req.param("id") ?? "")),
  );

  // Diagnose / compare analytics
  v1.get("/diagnose", requireScope("logs:read"), async (c) => {
    const projectId = c.req.query("project_id");
    if (!projectId) return c.json({ error: "project_id is required." }, 400);
    const includeRaw = c.req.query("include");
    const include = includeRaw
      ? (includeRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean) as never[])
      : undefined;
    return c.json(
      await store.diagnose(
        projectId,
        c.req.query("since") || undefined,
        include,
      ),
    );
  });

  v1.get("/compare", requireScope("logs:read"), async (c) => {
    const q = c.req.query();
    if (!q.project_id || !q.a_since || !q.a_until || !q.b_since || !q.b_until) {
      return c.json(
        {
          error:
            "Fields 'project_id', 'a_since', 'a_until', 'b_since', 'b_until' are required.",
        },
        400,
      );
    }
    return c.json(
      await store.compare(
        q.project_id,
        q.a_since,
        q.a_until,
        q.b_since,
        q.b_until,
      ),
    );
  });

  app.route("/v1", v1);
  return app;
}

/** Map a flat query string bag into an {@link EventCatalogQuery}. */
function parseEventQuery(q: Record<string, string>): EventCatalogQuery {
  const query: EventCatalogQuery = {};
  const scalars: (keyof EventCatalogQuery)[] = [
    "event_id",
    "event_type",
    "source",
    "severity",
    "project_id",
    "page_id",
    "machine_id",
    "repo_id",
    "app_id",
    "process_id",
    "run_id",
    "trace_id",
    "span_id",
    "session_id",
    "release_id",
    "environment",
    "since",
    "until",
    "text",
  ];
  for (const key of scalars) {
    const value = q[key as string];
    if (value) (query as Record<string, unknown>)[key as string] = value;
  }
  if (q.limit) query.limit = Number(q.limit);
  if (q.offset) query.offset = Number(q.offset);
  if (q.max_limit) query.max_limit = Number(q.max_limit);
  if (q.exclude_mcp_tool_telemetry === "true")
    query.exclude_mcp_tool_telemetry = true;
  return query;
}

/** Map a flat query string bag into a {@link TestReportQuery}. */
function parseTestReportQuery(q: Record<string, string>): TestReportQuery {
  const query: TestReportQuery = {};
  const scalars: (keyof TestReportQuery)[] = [
    "report_id",
    "event_id",
    "project_id",
    "machine_id",
    "repo_id",
    "app_id",
    "process_id",
    "run_id",
    "environment",
    "source",
    "parser",
    "parse_status",
    "path",
    "case_status",
    "since",
    "until",
    "text",
  ];
  for (const key of scalars) {
    const value = q[key as string];
    if (value) (query as Record<string, unknown>)[key as string] = value;
  }
  if (q.outcome) query.outcome = q.outcome as TestReportQuery["outcome"];
  if (q.min_failures) query.min_failures = Number(q.min_failures);
  if (q.min_errors) query.min_errors = Number(q.min_errors);
  if (q.min_skipped) query.min_skipped = Number(q.min_skipped);
  if (q.limit) query.limit = Number(q.limit);
  if (q.offset) query.offset = Number(q.offset);
  if (q.include_cases === "true") query.include_cases = true;
  return query;
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
