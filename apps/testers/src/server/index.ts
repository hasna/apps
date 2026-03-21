#!/usr/bin/env bun
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { z } from "zod";
import { listScenarios, createScenario, getScenario, getScenarioByShortId, updateScenario, deleteScenario, countScenarios } from "../db/scenarios.js";
import { listRuns, getRun, countRuns } from "../db/runs.js";
import { getResult, getResultsByRun, countResultsByRun } from "../db/results.js";
import { listScreenshots, getScreenshot, countScreenshots } from "../db/screenshots.js";
import { runByFilter } from "../lib/runner.js";
import { loadConfig } from "../lib/config.js";
import { VersionConflictError } from "../types/index.js";
import { getDatabase } from "../db/database.js";
import { createSchedule, getSchedule, listSchedules, updateSchedule, deleteSchedule } from "../db/schedules.js";
import { getNextRunTime } from "../lib/scheduler.js";
import { createApiCheck, getApiCheck, listApiChecks, updateApiCheck, deleteApiCheck, countApiChecks, listApiCheckResults, countApiCheckResults } from "../db/api-checks.js";
import { runApiCheck, runApiChecksByFilter } from "../lib/api-runner.js";
import { listProjects, createProject, getProject, updateProject } from "../db/projects.js";
import { listEnvironments, createEnvironment, updateEnvironment, deleteEnvironmentById } from "../db/environments.js";
import { createPersona, getPersona, listPersonas, updatePersona, deletePersona, countPersonas } from "../db/personas.js";
import { PersonaNotFoundError } from "../types/index.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseUrl(req: Request): { pathname: string; searchParams: URLSearchParams } {
  const url = new URL(req.url);
  return { pathname: url.pathname, searchParams: url.searchParams };
}

function jsonResponse(data: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      ...extra,
    },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// ─── Content-type map for static files ──────────────────────────────────────

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

function getContentType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

// ─── Zod schemas ────────────────────────────────────────────────────────────

const CreateScenarioSchema = z.object({
  name: z.string().min(1, "name is required"),
  description: z.string().default(""),
  steps: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  model: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  targetPath: z.string().optional(),
  requiresAuth: z.boolean().optional(),
  authConfig: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  assertions: z.array(z.record(z.unknown())).optional(),
  projectId: z.string().optional(),
});

const UpdateScenarioSchema = z.object({
  version: z.number().int().nonnegative("version is required"),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  steps: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  model: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  targetPath: z.string().optional(),
  requiresAuth: z.boolean().optional(),
  authConfig: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  assertions: z.array(z.record(z.unknown())).optional(),
});

const CreateApiCheckSchema = z.object({
  name: z.string().min(1, "name is required"),
  description: z.string().default(""),
  method: z.enum(["GET","POST","PUT","PATCH","DELETE","HEAD"]).default("GET"),
  url: z.string().min(1, "url is required"),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  expectedStatus: z.number().int().min(100).max(599).default(200),
  expectedBodyContains: z.string().optional(),
  expectedResponseTimeMs: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().default(10000),
  tags: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  projectId: z.string().optional(),
});

const UpdateApiCheckSchema = z.object({
  version: z.number().int().nonnegative("version is required"),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  method: z.enum(["GET","POST","PUT","PATCH","DELETE","HEAD"]).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  expectedStatus: z.number().int().min(100).max(599).optional(),
  expectedBodyContains: z.string().optional(),
  expectedResponseTimeMs: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const CreatePersonaSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  description: z.string().default(""),
  instructions: z.string().default(""),
  traits: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  projectId: z.string().optional(),
  enabled: z.boolean().default(true),
});

const UpdatePersonaSchema = z.object({
  version: z.number().int().nonnegative(),
  name: z.string().min(1).optional(),
  role: z.string().optional(),
  description: z.string().optional(),
  instructions: z.string().optional(),
  traits: z.array(z.string()).optional(),
  goals: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const CreateRunSchema = z.object({
  url: z.string().url("url must be a valid URL"),
  scenarioIds: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  model: z.string().optional(),
  headed: z.boolean().optional(),
  parallel: z.number().int().positive().optional(),
  projectId: z.string().optional(),
});

function validationError(issues: z.ZodIssue[]): Response {
  return new Response(
    JSON.stringify({
      error: "Validation failed",
      issues: issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    }),
    {
      status: 400,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

// ─── Route handler ──────────────────────────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  const { pathname, searchParams } = parseUrl(req);
  const method = req.method;

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  // ── API Routes ──────────────────────────────────────────────────────────

  // GET /api/stats — aggregated metrics for dashboard
  if (pathname === "/api/stats" && method === "GET") {
    const db = getDatabase();
    const days = parseInt(searchParams.get("days") ?? "30", 10);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    // Last N runs for trend (up to 50)
    const trendRows = db.query(
      `SELECT date(started_at) as date, status, passed, total
       FROM runs WHERE started_at >= ? ORDER BY started_at ASC LIMIT 50`
    ).all(since) as { date: string; status: string; passed: number; total: number }[];

    // Aggregate by date
    const byDate = new Map<string, { passed: number; total: number }>();
    for (const r of trendRows) {
      const existing = byDate.get(r.date) ?? { passed: 0, total: 0 };
      byDate.set(r.date, { passed: existing.passed + r.passed, total: existing.total + r.total });
    }
    const trend = Array.from(byDate.entries()).map(([date, { passed, total }]) => ({
      date,
      passRate: total > 0 ? Math.round((passed / total) * 100) : null,
      runs: trendRows.filter((r) => r.date === date).length,
    }));

    // Last 7 days summary
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
    const recent = db.query(
      `SELECT COUNT(*) as count, SUM(passed) as passed, SUM(total) as total
       FROM runs WHERE started_at >= ?`
    ).get(since7d) as { count: number; passed: number; total: number };

    // API check pass rate (last 100 results)
    const apiStats = db.query(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status='passed' THEN 1 ELSE 0 END) as passed
       FROM api_check_results ORDER BY created_at DESC LIMIT 100`
    ).get() as { total: number; passed: number };

    return jsonResponse({
      trend,
      last7d: {
        runs: recent.count ?? 0,
        passRate: (recent.total ?? 0) > 0 ? Math.round(((recent.passed ?? 0) / recent.total) * 100) : null,
      },
      apiChecks: {
        total: apiStats.total ?? 0,
        passRate: (apiStats.total ?? 0) > 0 ? Math.round(((apiStats.passed ?? 0) / apiStats.total) * 100) : null,
      },
    });
  }

  // GET /api/status
  if (pathname === "/api/status" && method === "GET") {
    const config = loadConfig();
    // Force DB init to get the path
    getDatabase();
    const dbPath = process.env["TESTERS_DB_PATH"] ?? join(homedir(), ".testers", "testers.db");
    const scenarios = listScenarios();
    const runs = listRuns();
    return jsonResponse({
      dbPath,
      apiKeySet: !!config.anthropicApiKey,
      scenarioCount: scenarios.length,
      runCount: runs.length,
      apiCheckCount: countApiChecks(),
      personaCount: countPersonas(),
      version: "0.0.1",
    });
  }

  // ── Scenarios ─────────────────────────────────────────────────────────

  // GET /api/scenarios/search?q=
  if (pathname === "/api/scenarios/search" && method === "GET") {
    const q = searchParams.get("q") ?? "";
    const projectId = searchParams.get("projectId") ?? undefined;
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");
    const sort = searchParams.get("sort") as "date" | "priority" | "name" | null;
    const asc = searchParams.get("asc");

    const scenarios = listScenarios({
      search: q,
      projectId,
      sort: sort ?? undefined,
      desc: asc === "true" ? false : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return jsonResponse(scenarios);
  }

  // GET /api/scenarios
  if (pathname === "/api/scenarios" && method === "GET") {
    const tag = searchParams.get("tag");
    const priority = searchParams.get("priority");
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");

    const filter = {
      tags: tag ? [tag] : undefined,
      priority: priority as "low" | "medium" | "high" | "critical" | undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    };
    const scenarios = listScenarios(filter);
    const total = countScenarios(filter);
    return jsonResponse(scenarios, 200, { "X-Total-Count": String(total) });
  }

  // POST /api/scenarios
  if (pathname === "/api/scenarios" && method === "POST") {
    try {
      const body = await req.json();
      const parsed = CreateScenarioSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error.issues);
      const scenario = createScenario(parsed.data as Parameters<typeof createScenario>[0]);
      return jsonResponse(scenario, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(msg, 400);
    }
  }

  // GET /api/scenarios/:id
  const scenarioGetMatch = pathname.match(/^\/api\/scenarios\/([^/]+)$/);
  if (scenarioGetMatch && method === "GET") {
    const id = scenarioGetMatch[1]!;
    const scenario = getScenario(id) ?? getScenarioByShortId(id);
    if (!scenario) return errorResponse("Scenario not found", 404);
    return jsonResponse(scenario);
  }

  // PUT /api/scenarios/:id
  const scenarioUpdateMatch = pathname.match(/^\/api\/scenarios\/([^/]+)$/);
  if (scenarioUpdateMatch && method === "PUT") {
    const id = scenarioUpdateMatch[1]!;
    try {
      const body = await req.json();
      const parsed = UpdateScenarioSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error.issues);
      const { version, ...updates } = parsed.data;
      const scenario = updateScenario(id, updates as Parameters<typeof updateScenario>[1], version);
      return jsonResponse(scenario);
    } catch (err) {
      if (err instanceof VersionConflictError) {
        return errorResponse(err.message, 409);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(msg, 400);
    }
  }

  // DELETE /api/scenarios/:id
  const scenarioDeleteMatch = pathname.match(/^\/api\/scenarios\/([^/]+)$/);
  if (scenarioDeleteMatch && method === "DELETE") {
    const id = scenarioDeleteMatch[1]!;
    const deleted = deleteScenario(id);
    if (!deleted) return errorResponse("Scenario not found", 404);
    return jsonResponse({ deleted: true });
  }

  // PUT /api/scenarios/bulk
  if (pathname === "/api/scenarios/bulk" && method === "PUT") {
    const BulkUpdateSchema = z.object({
      ids: z.array(z.string()).min(1, "ids must be a non-empty array"),
      updates: z.object({
        tags: z.array(z.string()).optional(),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      }),
    });

    try {
      const body = await req.json();
      const parsed = BulkUpdateSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error.issues);

      const { ids, updates } = parsed.data;
      const updated: ReturnType<typeof getScenario>[] = [];
      const notFound: string[] = [];

      for (const id of ids) {
        const scenario = getScenario(id) ?? getScenarioByShortId(id);
        if (!scenario) {
          notFound.push(id);
          continue;
        }
        const result = updateScenario(scenario.id, updates, scenario.version);
        updated.push(result);
      }

      return jsonResponse({
        updated: updated.length,
        notFound,
        scenarios: updated,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(msg, 400);
    }
  }

  // ── Runs ──────────────────────────────────────────────────────────────

  // POST /api/runs — trigger a run (async: return run ID immediately)
  if (pathname === "/api/runs" && method === "POST") {
    try {
      const raw = await req.json();
      const parsed = CreateRunSchema.safeParse(raw);
      if (!parsed.success) return validationError(parsed.error.issues);
      const body = parsed.data;

      // Start the run asynchronously
      const runPromise = runByFilter(body);

      // We need to return the run ID immediately, but runByFilter creates the run internally.
      // To handle this, we start the run and return once we have the run object.
      // Since runByFilter is async and creates the run first, we let it run in the background.
      runPromise.then(() => {
        // Run completed — results are already persisted in DB
      }).catch((err) => {
        console.error("Run failed:", err);
      });

      // Give a brief moment for the run to be created in the DB
      // Then return a response indicating the run has been started
      // For truly async, we return immediately with a pending status
      return jsonResponse({ status: "running", message: "Run started. Poll GET /api/runs to check status." }, 202);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(msg, 400);
    }
  }

  // GET /api/runs
  if (pathname === "/api/runs" && method === "GET") {
    const status = searchParams.get("status");
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");

    const runFilter = {
      status: status as "pending" | "running" | "passed" | "failed" | "cancelled" | undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    };
    const runs = listRuns(runFilter);
    const total = countRuns(runFilter);
    return jsonResponse(runs, 200, { "X-Total-Count": String(total) });
  }

  // GET /api/runs/:id
  const runGetMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runGetMatch && method === "GET") {
    const id = runGetMatch[1]!;
    const run = getRun(id);
    if (!run) return errorResponse("Run not found", 404);
    const results = getResultsByRun(id);
    const total = countResultsByRun(id);
    return jsonResponse({ ...run, results }, 200, { "X-Total-Count": String(total) });
  }

  // ── Results ───────────────────────────────────────────────────────────

  // GET /api/scenarios/:id/history — last N results for a scenario (sparkline data)
  const scenarioHistoryMatch = pathname.match(/^\/api\/scenarios\/([^/]+)\/history$/);
  if (scenarioHistoryMatch && method === "GET") {
    const id = scenarioHistoryMatch[1]!;
    const limit = parseInt(searchParams.get("limit") ?? "10", 10);
    const db = getDatabase();
    const rows = db
      .query(
        `SELECT r.status, r.created_at FROM results r
         JOIN runs run ON r.run_id = run.id
         WHERE r.scenario_id = ? OR r.scenario_id IN (
           SELECT id FROM scenarios WHERE short_id = ?
         )
         ORDER BY r.created_at DESC LIMIT ?`,
      )
      .all(id, id, limit) as { status: string; created_at: string }[];
    return jsonResponse(rows.reverse());
  }

  // GET /api/results/:id
  const resultGetMatch = pathname.match(/^\/api\/results\/([^/]+)$/);
  if (resultGetMatch && method === "GET") {
    const id = resultGetMatch[1]!;
    const result = getResult(id);
    if (!result) return errorResponse("Result not found", 404);
    const screenshots = listScreenshots(id);
    const total = countScreenshots(id);
    return jsonResponse({ ...result, screenshots }, 200, { "X-Total-Count": String(total) });
  }

  // GET /api/results/:id/explain
  const resultExplainMatch = pathname.match(/^\/api\/results\/([^/]+)\/explain$/);
  if (resultExplainMatch && method === "GET") {
    const id = resultExplainMatch[1]!;
    try {
      const { explainFailure } = await import("../lib/failure-explainer.js");
      const explanation = explainFailure(id);
      return jsonResponse(explanation);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) return errorResponse(msg, 404);
      return errorResponse(msg, 500);
    }
  }

  // ── Screenshots ───────────────────────────────────────────────────────

  // GET /api/screenshots/:id/file
  const screenshotFileMatch = pathname.match(/^\/api\/screenshots\/([^/]+)\/file$/);
  if (screenshotFileMatch && method === "GET") {
    const id = screenshotFileMatch[1]!;
    const screenshot = getScreenshot(id);
    if (!screenshot) return errorResponse("Screenshot not found", 404);

    if (!existsSync(screenshot.filePath)) {
      return errorResponse("Screenshot file not found on disk", 404);
    }

    const file = Bun.file(screenshot.filePath);
    return new Response(file, {
      headers: {
        "Content-Type": "image/png",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // ── Schedules ──────────────────────────────────────────────────────────

  // GET /api/schedules
  if (pathname === "/api/schedules" && method === "GET") {
    const projectId = searchParams.get("projectId") ?? undefined;
    const enabled = searchParams.get("enabled");
    const limit = searchParams.get("limit");
    const schedules = listSchedules({
      projectId,
      enabled: enabled !== null ? enabled === "true" : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return jsonResponse(schedules);
  }

  // POST /api/schedules
  if (pathname === "/api/schedules" && method === "POST") {
    try {
      const body = await req.json();
      const schedule = createSchedule(body);
      const nextRun = getNextRunTime(schedule.cronExpression);
      return jsonResponse({ ...schedule, nextRunAt: nextRun.toISOString() }, 201);
    } catch (e) {
      return errorResponse(e instanceof Error ? e.message : String(e), 400);
    }
  }

  // GET /api/schedules/:id
  const scheduleMatch = pathname.match(/^\/api\/schedules\/([^/]+)$/);
  if (scheduleMatch && method === "GET") {
    const schedule = getSchedule(scheduleMatch[1]!);
    if (!schedule) return errorResponse("Schedule not found", 404);
    return jsonResponse(schedule);
  }

  // PUT /api/schedules/:id
  if (scheduleMatch && method === "PUT") {
    try {
      const body = await req.json();
      const schedule = updateSchedule(scheduleMatch[1]!, body);
      return jsonResponse(schedule);
    } catch (e) {
      return errorResponse(e instanceof Error ? e.message : String(e), 400);
    }
  }

  // DELETE /api/schedules/:id
  if (scheduleMatch && method === "DELETE") {
    const deleted = deleteSchedule(scheduleMatch[1]!);
    if (!deleted) return errorResponse("Schedule not found", 404);
    return jsonResponse({ deleted: true });
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  // GET /api/projects
  if (pathname === "/api/projects" && method === "GET") {
    return jsonResponse(listProjects());
  }

  // POST /api/projects
  if (pathname === "/api/projects" && method === "POST") {
    try {
      const body = await req.json();
      if (!body.name || typeof body.name !== "string") return errorResponse("name is required", 400);
      const project = createProject({
        name: body.name.trim(),
        description: body.description ?? undefined,
        baseUrl: body.baseUrl ?? undefined,
        port: body.port ?? undefined,
      });
      return jsonResponse(project, 201);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // GET /api/projects/:id
  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && method === "GET") {
    const project = getProject(projectMatch[1]!);
    if (!project) return errorResponse("Project not found", 404);
    const environments = listEnvironments(project.id);
    return jsonResponse({ ...project, environments });
  }

  // PUT /api/projects/:id
  if (projectMatch && method === "PUT") {
    try {
      const body = await req.json();
      const project = updateProject(projectMatch[1]!, {
        name: body.name ?? undefined,
        description: body.description ?? undefined,
        baseUrl: body.baseUrl ?? undefined,
        port: body.port ?? undefined,
        settings: body.settings ?? undefined,
      });
      return jsonResponse(project);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // GET /api/projects/:id/environments
  const projectEnvsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/environments$/);
  if (projectEnvsMatch && method === "GET") {
    const project = getProject(projectEnvsMatch[1]!);
    if (!project) return errorResponse("Project not found", 404);
    return jsonResponse(listEnvironments(project.id));
  }

  // POST /api/projects/:id/environments
  if (projectEnvsMatch && method === "POST") {
    try {
      const project = getProject(projectEnvsMatch[1]!);
      if (!project) return errorResponse("Project not found", 404);
      const body = await req.json();
      if (!body.name || !body.url) return errorResponse("name and url are required", 400);
      const env = createEnvironment({
        name: body.name.trim(),
        url: body.url.trim(),
        projectId: project.id,
        isDefault: body.isDefault ?? false,
        variables: body.variables ?? {},
      });
      return jsonResponse(env, 201);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // PUT /api/environments/:id
  const envUpdateMatch = pathname.match(/^\/api\/environments\/([^/]+)$/);
  if (envUpdateMatch && method === "PUT") {
    try {
      const body = await req.json();
      const env = updateEnvironment(envUpdateMatch[1]!, {
        name: body.name ?? undefined,
        url: body.url ?? undefined,
        isDefault: body.isDefault ?? undefined,
        variables: body.variables ?? undefined,
      });
      return jsonResponse(env);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // DELETE /api/environments/:id
  if (envUpdateMatch && method === "DELETE") {
    const deleted = deleteEnvironmentById(envUpdateMatch[1]!);
    if (!deleted) return errorResponse("Environment not found", 404);
    return jsonResponse({ deleted: true });
  }

  // ── API Checks ────────────────────────────────────────────────────────────

  // POST /api/api-checks/run-all — must be before /:id pattern
  if (pathname === "/api/api-checks/run-all" && method === "POST") {
    try {
      const body = await req.json();
      const { baseUrl, projectId, tags, parallel } = body as {
        baseUrl: string;
        projectId?: string;
        tags?: string[];
        parallel?: number;
      };
      if (!baseUrl) return errorResponse("baseUrl is required", 400);
      const result = await runApiChecksByFilter({ baseUrl, projectId, tags, parallel });
      return jsonResponse(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(msg, 400);
    }
  }

  // GET /api/api-checks
  if (pathname === "/api/api-checks" && method === "GET") {
    const projectId = searchParams.get("projectId") ?? undefined;
    const enabledParam = searchParams.get("enabled");
    const tagsParam = searchParams.get("tags");
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");

    const filter = {
      projectId,
      enabled: enabledParam !== null ? enabledParam === "true" : undefined,
      tags: tagsParam ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    };
    const checks = listApiChecks(filter);
    const total = countApiChecks(filter);
    return jsonResponse(checks, 200, { "X-Total-Count": String(total) });
  }

  // POST /api/api-checks
  if (pathname === "/api/api-checks" && method === "POST") {
    try {
      const body = await req.json();
      const parsed = CreateApiCheckSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error.issues);
      const check = createApiCheck(parsed.data as Parameters<typeof createApiCheck>[0]);
      return jsonResponse(check, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(msg, 400);
    }
  }

  // POST /api/api-checks/:id/run
  const apiCheckRunMatch = pathname.match(/^\/api\/api-checks\/([^/]+)\/run$/);
  if (apiCheckRunMatch && method === "POST") {
    const id = apiCheckRunMatch[1]!;
    try {
      const check = getApiCheck(id);
      if (!check) return errorResponse("API check not found", 404);
      const body = await req.json().catch(() => ({})) as { baseUrl?: string };
      const result = await runApiCheck(check, { baseUrl: body.baseUrl });
      return jsonResponse(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(msg, 400);
    }
  }

  // GET /api/api-checks/:id/results
  const apiCheckResultsMatch = pathname.match(/^\/api\/api-checks\/([^/]+)\/results$/);
  if (apiCheckResultsMatch && method === "GET") {
    const id = apiCheckResultsMatch[1]!;
    const check = getApiCheck(id);
    if (!check) return errorResponse("API check not found", 404);
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");
    const results = listApiCheckResults(check.id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    const total = countApiCheckResults(check.id);
    return jsonResponse(results, 200, { "X-Total-Count": String(total) });
  }

  // GET /api/api-checks/:id
  const apiCheckGetMatch = pathname.match(/^\/api\/api-checks\/([^/]+)$/);
  if (apiCheckGetMatch && method === "GET") {
    const id = apiCheckGetMatch[1]!;
    const check = getApiCheck(id);
    if (!check) return errorResponse("API check not found", 404);
    return jsonResponse(check);
  }

  // PUT /api/api-checks/:id
  const apiCheckUpdateMatch = pathname.match(/^\/api\/api-checks\/([^/]+)$/);
  if (apiCheckUpdateMatch && method === "PUT") {
    const id = apiCheckUpdateMatch[1]!;
    try {
      const body = await req.json();
      const parsed = UpdateApiCheckSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error.issues);
      const { version, ...updates } = parsed.data;
      const check = updateApiCheck(id, updates as Parameters<typeof updateApiCheck>[1], version);
      return jsonResponse(check);
    } catch (err) {
      if (err instanceof VersionConflictError) {
        return errorResponse(err.message, 409);
      }
      const e = err as { name?: string };
      if (e.name === "ApiCheckNotFoundError" || (err instanceof Error && err.message.includes("not found"))) {
        return errorResponse(err instanceof Error ? err.message : String(err), 404);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(msg, 400);
    }
  }

  // DELETE /api/api-checks/:id
  const apiCheckDeleteMatch = pathname.match(/^\/api\/api-checks\/([^/]+)$/);
  if (apiCheckDeleteMatch && method === "DELETE") {
    const id = apiCheckDeleteMatch[1]!;
    const deleted = deleteApiCheck(id);
    if (!deleted) return errorResponse("API check not found", 404);
    return jsonResponse({ deleted: true });
  }

  // ── SSE: live run result streaming ────────────────────────────────────

  // GET /api/runs/:id/stream — Server-Sent Events for live run updates
  const runStreamMatch = pathname.match(/^\/api\/runs\/([^/]+)\/stream$/);
  if (runStreamMatch && method === "GET") {
    const runId = runStreamMatch[1]!;
    const run = getRun(runId);
    if (!run) return errorResponse("Run not found", 404);

    // If already finished, return a single "done" event and close
    if (run.status !== "pending" && run.status !== "running") {
      const results = getResultsByRun(runId);
      const body = `data: ${JSON.stringify({ type: "done", run, results })}\n\n`;
      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Stream live updates by polling every second
    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream({
      start(controller) {
        const send = (data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            closed = true;
          }
        };

        const poll = async () => {
          if (closed) return;
          try {
            const current = getRun(runId);
            const results = getResultsByRun(runId);
            send({ type: "update", run: current, results });

            if (!current || current.status === "passed" || current.status === "failed" || current.status === "cancelled") {
              send({ type: "done", run: current, results });
              closed = true;
              controller.close();
              return;
            }
          } catch {
            closed = true;
            controller.close();
            return;
          }
          setTimeout(poll, 1000);
        };

        setTimeout(poll, 500);
      },
      cancel() {
        closed = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ── Scan Issues ───────────────────────────────────────────────────────

  // GET /api/scan-issues
  if (pathname === "/api/scan-issues" && method === "GET") {
    const { listScanIssues } = await import("../db/scan-issues.js");
    const status = searchParams.get("status") ?? undefined;
    const type = searchParams.get("type") ?? undefined;
    const projectId = searchParams.get("projectId") ?? undefined;
    const limit = searchParams.get("limit");
    const issues = listScanIssues({ status, type, projectId, limit: limit ? parseInt(limit, 10) : 100 });
    return jsonResponse(issues, 200, { "X-Total-Count": String(issues.length) });
  }

  // PUT /api/scan-issues/:id/resolve
  const scanResolveMatch = pathname.match(/^\/api\/scan-issues\/([^/]+)\/resolve$/);
  if (scanResolveMatch && method === "PUT") {
    const { resolveScanIssue } = await import("../db/scan-issues.js");
    const ok = resolveScanIssue(scanResolveMatch[1]!);
    if (!ok) return errorResponse("Scan issue not found", 404);
    return jsonResponse({ resolved: true });
  }

  // ── Personas ──────────────────────────────────────────────────────────

  // GET /api/personas
  if (pathname === "/api/personas" && method === "GET") {
    const projectId = searchParams.get("projectId") ?? undefined;
    const enabledParam = searchParams.get("enabled");
    const globalOnly = searchParams.get("globalOnly") === "true";
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");

    const filter = {
      projectId,
      enabled: enabledParam !== null ? enabledParam === "true" : undefined,
      globalOnly,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    };
    const personas = listPersonas(filter);
    const total = countPersonas(filter);
    return jsonResponse(personas, 200, { "X-Total-Count": String(total) });
  }

  // POST /api/personas
  if (pathname === "/api/personas" && method === "POST") {
    try {
      const body = await req.json();
      const parsed = CreatePersonaSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error.issues);
      const persona = createPersona(parsed.data as Parameters<typeof createPersona>[0]);
      return jsonResponse(persona, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(msg, 400);
    }
  }

  // GET /api/personas/:id
  const personaGetMatch = pathname.match(/^\/api\/personas\/([^/]+)$/);
  if (personaGetMatch && method === "GET") {
    const id = personaGetMatch[1]!;
    const persona = getPersona(id);
    if (!persona) return errorResponse("Persona not found", 404);
    return jsonResponse(persona);
  }

  // PUT /api/personas/:id
  const personaUpdateMatch = pathname.match(/^\/api\/personas\/([^/]+)$/);
  if (personaUpdateMatch && method === "PUT") {
    const id = personaUpdateMatch[1]!;
    try {
      const body = await req.json();
      const parsed = UpdatePersonaSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error.issues);
      const { version, ...updates } = parsed.data;
      const persona = updatePersona(id, updates as Parameters<typeof updatePersona>[1], version);
      return jsonResponse(persona);
    } catch (err) {
      if (err instanceof VersionConflictError) return errorResponse(err.message, 409);
      if (err instanceof PersonaNotFoundError) return errorResponse(err.message, 404);
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(msg, 400);
    }
  }

  // DELETE /api/personas/:id
  const personaDeleteMatch = pathname.match(/^\/api\/personas\/([^/]+)$/);
  if (personaDeleteMatch && method === "DELETE") {
    const id = personaDeleteMatch[1]!;
    const deleted = deletePersona(id);
    if (!deleted) return errorResponse("Persona not found", 404);
    return jsonResponse({ deleted: true });
  }

  // ── Coverage Map ──────────────────────────────────────────────────────

  // GET /api/coverage — which routes/pages have scenarios vs are uncovered
  if (pathname === "/api/coverage" && method === "GET") {
    const projectId = searchParams.get("projectId") ?? undefined;
    const db = getDatabase();

    // Collect scenario target paths
    const scenarios = listScenarios({ projectId });
    const coverageMap = new Map<string, { scenarioCount: number; scenarios: string[]; lastPassRate: number | null }>();

    for (const s of scenarios) {
      const path = s.targetPath ?? "(no path)";
      const existing = coverageMap.get(path) ?? { scenarioCount: 0, scenarios: [], lastPassRate: null };
      existing.scenarioCount++;
      existing.scenarios.push(s.name);
      coverageMap.set(path, existing);
    }

    // Get last pass rate per scenario from most recent result
    for (const s of scenarios) {
      const path = s.targetPath ?? "(no path)";
      const entry = coverageMap.get(path)!;
      const lastResult = db.query(
        `SELECT status FROM results WHERE scenario_id = ? ORDER BY created_at DESC LIMIT 1`
      ).get(s.id) as { status: string } | null;
      if (lastResult) {
        const currentRate = entry.lastPassRate ?? 0;
        const passed = lastResult.status === "passed" ? 1 : 0;
        entry.lastPassRate = (currentRate + passed) / 2; // rolling avg
      }
      coverageMap.set(path, entry);
    }

    // Collect api_check URLs as separate coverage entries
    const apiChecks = db.query(
      `SELECT url, COUNT(*) as count FROM api_checks ${projectId ? "WHERE project_id = ?" : ""} GROUP BY url ORDER BY count DESC`
    ).all(...(projectId ? [projectId] : [])) as { url: string; count: number }[];

    const routes = Array.from(coverageMap.entries()).map(([path, data]) => ({
      path,
      type: "scenario" as const,
      scenarioCount: data.scenarioCount,
      scenarios: data.scenarios,
      lastPassRate: data.lastPassRate != null ? Math.round(data.lastPassRate * 100) : null,
    })).sort((a, b) => b.scenarioCount - a.scenarioCount);

    const apiRoutes = apiChecks.map((r) => ({
      path: r.url,
      type: "api_check" as const,
      checkCount: r.count,
    }));

    return jsonResponse({ routes, apiRoutes, totalCovered: coverageMap.size });
  }

  // ── Static file serving (dashboard SPA) ───────────────────────────────

  if (!pathname.startsWith("/api")) {
    const dashboardDir = join(import.meta.dir, "..", "..", "dashboard", "dist");

    if (!existsSync(dashboardDir)) {
      return new Response(
        `<!DOCTYPE html>
<html>
<head><title>Open Testers</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa;">
  <div style="text-align: center;">
    <h1>Dashboard not built yet</h1>
    <p>Run: <code style="background: #1a1a1a; padding: 4px 8px; border-radius: 4px;">cd dashboard && bun run build</code></p>
  </div>
</body>
</html>`,
        {
          status: 200,
          headers: {
            "Content-Type": "text/html",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    // Try to serve the requested file
    const filePath = join(dashboardDir, pathname === "/" ? "index.html" : pathname);
    if (existsSync(filePath)) {
      const file = Bun.file(filePath);
      return new Response(file, {
        headers: {
          "Content-Type": getContentType(filePath),
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // SPA fallback — serve index.html for any unmatched route
    const indexPath = join(dashboardDir, "index.html");
    if (existsSync(indexPath)) {
      const file = Bun.file(indexPath);
      return new Response(file, {
        headers: {
          "Content-Type": "text/html",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  }

  return errorResponse("Not found", 404);
}

// ─── Server ─────────────────────────────────────────────────────────────────

const port = parseInt(process.env["TESTERS_PORT"] ?? "19450", 10);

const server = Bun.serve({
  port,
  fetch: handleRequest,
});

console.log(`Open Testers server running at http://localhost:${server.port}`);
