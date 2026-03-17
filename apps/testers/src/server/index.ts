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
      version: "0.0.1",
    });
  }

  // ── Scenarios ─────────────────────────────────────────────────────────

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
