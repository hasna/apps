/**
 * PostgreSQL-backed Hono app for @hasna/logs.
 *
 * Serves the standard operational probes (`/health`, `/ready`, `/version`) and
 * the versioned, API-key-authenticated `/v1` surface backed directly by
 * PostgreSQL. Used when the serve runs with HASNA_LOGS_DATABASE_URL set, i.e.
 * the deployed ECS service.
 */

import { hasScope, honoApiKey, type ApiKeyStatus } from "@hasna/contracts/auth";
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
  /** Lifecycle lookup for the presented key (ApiKeyStore.keyStatus). Anything other than "active" denies. */
  keyStatus?: (kid: string) => ApiKeyStatus | Promise<ApiKeyStatus>;
  /** Per-request auth audit hook. */
  audit?: (event: unknown) => void;
}

const BACKEND = "postgresql";

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
    c.json({ status: "ok", version: options.version, backend: BACKEND }),
  );

  app.get("/health", async (c) => {
    const health = await checkHealth(options.client);
    return c.json(
      {
        status: health.ok ? "ok" : "error",
        version: options.version,
        backend: BACKEND,
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
          backend: BACKEND,
          pending_migrations: pending,
        },
        ok ? 200 : 503,
      );
    } catch (error) {
      return c.json(
        {
          status: "not_ready",
          version: options.version,
          backend: BACKEND,
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
      backend: BACKEND,
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
      ...(options.keyStatus ? { keyStatus: options.keyStatus } : {}),
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
      ...(q.offset ? { offset: Number(q.offset) } : {}),
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
    // Forward the FULL LogEntry shape (mirroring ApiStore.ingestLog's compact()
    // field set at src/store/api.ts): the client's deterministic id and the
    // run/process/privacy/page linkage must reach createLog, or every per-line
    // log from `logs run` loses its id (a retry inserts a duplicate instead of
    // deduping like local ingest) and its identity linkage on the hosted path.
    const log = await store.createLog({
      id: typeof body.id === "string" ? body.id : undefined,
      level: body.level,
      message: body.message,
      project_id: body.project_id ?? null,
      page_id: body.page_id ?? null,
      source: body.source ?? null,
      service: body.service ?? null,
      trace_id: body.trace_id ?? null,
      session_id: body.session_id ?? null,
      agent: body.agent ?? null,
      url: body.url ?? null,
      stack_trace: body.stack_trace ?? null,
      metadata: body.metadata ?? null,
      timestamp: body.timestamp ?? null,
      source_event_id: body.source_event_id ?? null,
      machine_id: body.machine_id ?? null,
      repo_id: body.repo_id ?? null,
      app_id: body.app_id ?? null,
      process_id: body.process_id ?? null,
      run_id: body.run_id ?? null,
      span_id: body.span_id ?? null,
      parent_span_id: body.parent_span_id ?? null,
      release_id: body.release_id ?? null,
      environment: body.environment ?? null,
      privacy: body.privacy ?? null,
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

  // Scan-run + maintenance surface (hosted equivalents of the local-only
  // CLI operations: `scan`, `watch --events` runbook support).
  v1.get("/jobs/:id", requireScope("logs:read"), async (c) => {
    const job = await store.getJob(c.req.param("id") ?? "");
    return job ? c.json(job) : c.json({ error: "not found" }, 404);
  });

  v1.put("/jobs/:id", requireScope("logs:write"), async (c) => {
    const body = await c.req.json().catch(() => null);
    const allowed: Record<string, unknown> = {};
    if (body && typeof body === "object") {
      for (const key of ["enabled", "schedule", "last_run_at"]) {
        if (key in (body as Record<string, unknown>))
          allowed[key] = (body as Record<string, unknown>)[key];
      }
    }
    if (allowed.enabled !== undefined && typeof allowed.enabled !== "boolean") {
      return c.json({ error: "Field 'enabled' must be a boolean." }, 400);
    }
    if (
      allowed.schedule !== undefined &&
      typeof allowed.schedule !== "string"
    ) {
      return c.json({ error: "Field 'schedule' must be a string." }, 400);
    }
    if (
      allowed.last_run_at !== undefined &&
      typeof allowed.last_run_at !== "string"
    ) {
      return c.json({ error: "Field 'last_run_at' must be a string." }, 400);
    }
    const job = await store.updateJob(c.req.param("id") ?? "", {
      enabled: allowed.enabled as boolean | undefined,
      schedule: allowed.schedule as string | undefined,
      last_run_at: allowed.last_run_at as string | undefined,
    });
    return job ? c.json(job) : c.json({ error: "not found" }, 404);
  });

  v1.post("/jobs/:id/runs", requireScope("logs:write"), async (c) => {
    const body = await c.req.json().catch(() => null);
    const pageId =
      body && typeof body.page_id === "string" ? body.page_id : undefined;
    const run = await store.createScanRun({
      job_id: c.req.param("id") ?? "",
      page_id: pageId,
    });
    return c.json(run, 201);
  });

  v1.patch("/jobs/:id/runs/:runId", requireScope("logs:write"), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      (body.status !== "completed" && body.status !== "failed") ||
      typeof body.logs_collected !== "number" ||
      typeof body.errors_found !== "number"
    ) {
      return c.json(
        {
          error:
            "Fields 'status' (completed|failed), 'logs_collected' and 'errors_found' are required.",
        },
        400,
      );
    }
    const run = await store.finishScanRun(c.req.param("runId") ?? "", {
      status: body.status,
      logs_collected: body.logs_collected,
      errors_found: body.errors_found,
      perf_score:
        typeof body.perf_score === "number" ? body.perf_score : undefined,
    });
    return run ? c.json(run) : c.json({ error: "not found" }, 404);
  });

  // Pages by id (hosted `scan` lookup + last_scanned_at bookkeeping)
  v1.get("/pages/:id", requireScope("logs:read"), async (c) => {
    const page = await store.getPage(c.req.param("id") ?? "");
    return page ? c.json(page) : c.json({ error: "not found" }, 404);
  });

  v1.patch("/pages/:id", requireScope("logs:write"), async (c) => {
    const body = await c.req.json().catch(() => null);
    const lastScannedAt =
      body && typeof body.last_scanned_at === "string"
        ? body.last_scanned_at
        : null;
    if (lastScannedAt === null) {
      return c.json({ error: "Field 'last_scanned_at' is required." }, 400);
    }
    const page = await store.touchPage(c.req.param("id") ?? "", lastScannedAt);
    return page ? c.json(page) : c.json({ error: "not found" }, 404);
  });

  // Performance snapshot writes (hosted `scan` perf bookkeeping)
  v1.post("/perf/snapshot", requireScope("logs:write"), async (c) => {
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
    const snapshot = await store.savePerfSnapshot({
      project_id: body.project_id,
      page_id: typeof body.page_id === "string" ? body.page_id : undefined,
      url: body.url,
      lcp: typeof body.lcp === "number" ? body.lcp : undefined,
      fcp: typeof body.fcp === "number" ? body.fcp : undefined,
      cls: typeof body.cls === "number" ? body.cls : undefined,
      tti: typeof body.tti === "number" ? body.tti : undefined,
      ttfb: typeof body.ttfb === "number" ? body.ttfb : undefined,
      score: typeof body.score === "number" ? body.score : undefined,
      raw_audit:
        typeof body.raw_audit === "string" ? body.raw_audit : undefined,
    });
    return c.json(snapshot, 201);
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
    "after_time",
    "after_id",
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
  if (q.order === "asc" || q.order === "desc") query.order = q.order;
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
