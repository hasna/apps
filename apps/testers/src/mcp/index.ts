#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createScenario, getScenario, getScenarioByShortId, listScenarios, updateScenario, deleteScenario, findStaleScenarios } from "../db/scenarios.js";
import { getRun, listRuns, updateRun } from "../db/runs.js";
import { listResults, getResultsByRun } from "../db/results.js";
import { listScreenshots } from "../db/screenshots.js";
import { createProject, ensureProject, listProjects } from "../db/projects.js";
import { registerAgent, listAgents } from "../db/agents.js";
import { startRunAsync } from "../lib/runner.js";
import { loadConfig } from "../lib/config.js";
import { importFromTodos } from "../lib/todos-connector.js";
import { createSchedule, listSchedules, updateSchedule, deleteSchedule } from "../db/schedules.js";
import { getNextRunTime } from "../lib/scheduler.js";
import { getDatabase } from "../db/database.js";
import { VersionConflictError } from "../types/index.js";

// ─── Response Helpers ────────────────────────────────────────────────────────

function json(data: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function notFoundErr(id: string, label = "Resource"): Error {
  return Object.assign(new Error(`${label} not found: ${id}`), { name: "NotFoundError" });
}

function errorResponse(
  e: unknown,
  context?: { fetchCurrent?: () => unknown }
): { content: [{ type: "text"; text: string }]; isError: true } {
  const err = e instanceof Error ? e : new Error(String(e));

  if (e instanceof VersionConflictError) {
    const payload: {
      error: {
        code: string;
        message: string;
        retryable: boolean;
        hint: string;
        currentVersion: number | null;
      };
    } = {
      error: {
        code: "VERSION_CONFLICT",
        message: err.message,
        retryable: true,
        hint: "Fetch the scenario with get_scenario to get the current version, then retry.",
        currentVersion: null,
      },
    };

    if (context?.fetchCurrent) {
      try {
        const current = context.fetchCurrent() as { version?: number } | null;
        if (current && typeof current.version === "number") {
          payload.error.currentVersion = current.version;
          payload.error.hint = `Retry with version: ${current.version}`;
        }
      } catch {
        // ignore — return base conflict error
      }
    }

    return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }], isError: true };
  }

  const name = err.name ?? "Error";
  const msg = err.message ?? String(e);

  let code = "INTERNAL_ERROR";
  let retryable = false;
  let hint: string | undefined;

  if (name === "NotFoundError" || name === "ScenarioNotFoundError" || msg.toLowerCase().includes("not found")) {
    code = "NOT_FOUND";
    retryable = false;
    hint = "Check the ID or short ID and try again.";
  } else if (msg.toLowerCase().includes("timeout")) {
    code = "TIMEOUT";
    retryable = true;
    hint = "The operation timed out. Try again.";
  } else if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("already exists")) {
    code = "CONFLICT";
    retryable = false;
    hint = "A resource with this identifier already exists.";
  }

  const payload: { error: { code: string; message: string; retryable: boolean; hint?: string } } = {
    error: { code, message: msg, retryable },
  };
  if (hint) payload.error.hint = hint;

  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }], isError: true };
}

const ID_DESC = "Accepts either the full UUID (e.g. 'abc123...') or the short ID (e.g. 'sc-1').";
const MODEL_DESC =
  "Model to use. Values: 'quick' (claude-haiku-4-5, cheapest), 'thorough' (claude-sonnet-4-6, balanced), 'deep' (claude-opus-4-6, most capable). Default: 'quick'.";

const server = new McpServer({
  name: "testers",
  version: "0.0.1",
});

// ─── 1. create_scenario ─────────────────────────────────────────────────────

server.tool(
  "create_scenario",
  "Create a new test scenario",
  {
    name: z.string().describe("Scenario name"),
    description: z.string().describe("What this scenario tests"),
    steps: z.array(z.string()).optional().describe("Ordered test steps"),
    tags: z.array(z.string()).optional().describe("Tags for filtering"),
    priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Scenario priority"),
    model: z.string().optional().describe(MODEL_DESC),
    targetPath: z.string().optional().describe("URL path to navigate to"),
    requiresAuth: z.boolean().optional().describe("Whether scenario requires authentication"),
  },
  async ({ name, description, steps, tags, priority, model, targetPath, requiresAuth }) => {
    try {
      const scenario = createScenario({ name, description, steps, tags, priority, model, targetPath, requiresAuth });
      return json(scenario);
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 2. get_scenario ─────────────────────────────────────────────────────────

server.tool(
  "get_scenario",
  `Get a scenario by ID or short ID. ${ID_DESC}`,
  {
    id: z.string().describe(`Scenario ID or short ID. ${ID_DESC}`),
  },
  async ({ id }) => {
    try {
      const scenario = getScenario(id) ?? getScenarioByShortId(id);
      if (!scenario) return errorResponse(notFoundErr(id, "Scenario"));
      return json(scenario);
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 3. list_scenarios ───────────────────────────────────────────────────────

server.tool(
  "list_scenarios",
  "List test scenarios with optional filters",
  {
    projectId: z.string().optional().describe("Filter by project ID"),
    tags: z.array(z.string()).optional().describe("Filter by tags"),
    priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Filter by priority"),
    limit: z.number().optional().describe("Max results to return"),
  },
  async ({ projectId, tags, priority, limit }) => {
    try {
      const scenarios = listScenarios({ projectId, tags, priority, limit });
      return json({ items: scenarios, total: scenarios.length });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 4. update_scenario ──────────────────────────────────────────────────────

server.tool(
  "update_scenario",
  `Update an existing scenario (requires version for optimistic locking). ${ID_DESC}`,
  {
    id: z.string().describe(`Scenario ID or short ID. ${ID_DESC}`),
    name: z.string().optional().describe("New name"),
    description: z.string().optional().describe("New description"),
    steps: z.array(z.string()).optional().describe("New steps"),
    tags: z.array(z.string()).optional().describe("New tags"),
    priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("New priority"),
    model: z.string().optional().describe("New model"),
    version: z.number().describe("Current version (for optimistic locking)"),
  },
  async ({ id, name, description, steps, tags, priority, model, version }) => {
    try {
      const scenario = updateScenario(id, { name, description, steps, tags, priority, model }, version);
      return json(scenario);
    } catch (error) {
      return errorResponse(error, {
        fetchCurrent: () => getScenario(id) ?? getScenarioByShortId(id),
      });
    }
  },
);

// ─── 5. delete_scenario ──────────────────────────────────────────────────────

server.tool(
  "delete_scenario",
  `Delete a scenario by ID. ${ID_DESC}`,
  {
    id: z.string().describe(`Scenario ID or short ID. ${ID_DESC}`),
  },
  async ({ id }) => {
    try {
      const deleted = deleteScenario(id);
      if (!deleted) return errorResponse(notFoundErr(id, "Scenario"));
      return json({ deleted: true, id });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 6. run_scenarios ────────────────────────────────────────────────────────

server.tool(
  "run_scenarios",
  "Run test scenarios against a URL",
  {
    url: z.string().describe("Target URL to test against"),
    tags: z.array(z.string()).optional().describe("Filter scenarios by tags"),
    scenarioIds: z.array(z.string()).optional().describe("Run specific scenario IDs"),
    priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Filter by priority"),
    model: z.string().optional().describe(MODEL_DESC),
    headed: z.boolean().optional().describe("Run browser in headed mode"),
    parallel: z.number().optional().describe("Number of parallel workers"),
  },
  async ({ url, tags, scenarioIds, priority, model, headed, parallel }) => {
    try {
      const { runId, scenarioCount } = startRunAsync({ url, tags, scenarioIds, priority, model, headed, parallel });
      return json({ runId, scenarioCount, url, status: "running", message: "Poll with get_run to check progress." });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 7. get_run ──────────────────────────────────────────────────────────────

server.tool(
  "get_run",
  `Get details of a test run. ${ID_DESC}`,
  {
    id: z.string().describe(`Run ID. ${ID_DESC}`),
  },
  async ({ id }) => {
    try {
      const run = getRun(id);
      if (!run) return errorResponse(notFoundErr(id, "Run"));
      return json(run);
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 8. list_runs ────────────────────────────────────────────────────────────

server.tool(
  "list_runs",
  "List test runs with optional filters",
  {
    status: z.enum(["pending", "running", "passed", "failed", "cancelled"]).optional().describe("Filter by status"),
    limit: z.number().optional().describe("Max results to return"),
  },
  async ({ status, limit }) => {
    try {
      const runs = listRuns({ status, limit });
      return json({ items: runs, total: runs.length });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 9. get_results ──────────────────────────────────────────────────────────

server.tool(
  "get_results",
  `Get test results for a run. Optionally filter by status and/or scenarioId. Each result includes AI reasoning when available. ${ID_DESC}`,
  {
    runId: z.string().describe(`Run ID. ${ID_DESC}`),
    status: z.enum(["passed", "failed", "error", "running"]).optional().describe("Filter by result status"),
    scenarioId: z.string().optional().describe("Filter by scenario ID (full or partial)"),
  },
  async ({ runId, status, scenarioId }) => {
    try {
      let results = listResults(runId);
      if (status) {
        results = results.filter((r) => r.status === status);
      }
      if (scenarioId) {
        results = results.filter((r) => r.scenarioId === scenarioId || r.scenarioId.startsWith(scenarioId));
      }
      return json({ items: results, total: results.length });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 10. get_screenshots ─────────────────────────────────────────────────────

const MAX_BASE64_SCREENSHOTS = 5;

server.tool(
  "get_screenshots",
  `Get screenshots for a test result. Returns base64-encoded image data for up to 5 screenshots. If more than 5 exist, only metadata is returned with truncated:true. ${ID_DESC}`,
  {
    resultId: z.string().describe(`Result ID. ${ID_DESC}`),
  },
  async ({ resultId }) => {
    try {
      const screenshots = listScreenshots(resultId);
      if (screenshots.length === 0) {
        return json({ items: [], total: 0 });
      }

      const truncated = screenshots.length > MAX_BASE64_SCREENSHOTS;
      const withBase64 = await Promise.all(
        screenshots.map(async (s, index) => {
          let base64: string | null = null;
          let note: string | undefined;
          if (!truncated || index < MAX_BASE64_SCREENSHOTS) {
            try {
              const file = Bun.file(s.filePath);
              const exists = await file.exists();
              if (exists) {
                const buffer = await file.arrayBuffer();
                base64 = `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`;
              } else {
                note = `File not found on disk: ${s.filePath}`;
              }
            } catch {
              note = `Failed to read file: ${s.filePath}`;
            }
          }
          return { id: s.id, stepNumber: s.stepNumber, description: s.description, pageUrl: s.pageUrl, filePath: s.filePath, base64, note, width: s.width, height: s.height, createdAt: s.timestamp };
        })
      );

      return json({ truncated, total: screenshots.length, items: withBase64 });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 11. register_project ────────────────────────────────────────────────────

server.tool(
  "register_project",
  "Register or ensure a project exists",
  {
    name: z.string().describe("Project name"),
    path: z.string().describe("Project path on disk"),
    description: z.string().optional().describe("Project description"),
  },
  async ({ name, path, description }) => {
    try {
      const project = description
        ? createProject({ name, path, description })
        : ensureProject(name, path);
      return json(project);
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 12. list_projects ───────────────────────────────────────────────────────

server.tool(
  "list_projects",
  "List all registered projects",
  {},
  async () => {
    try {
      const projects = listProjects();
      return json({ items: projects, total: projects.length });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 13. register_agent ──────────────────────────────────────────────────────

server.tool(
  "register_agent",
  "Register an agent (idempotent — returns existing if name matches)",
  {
    name: z.string().describe("Agent name"),
    description: z.string().optional().describe("Agent description"),
    role: z.string().optional().describe("Agent role"),
  },
  async ({ name, description, role }) => {
    try {
      const agent = registerAgent({ name, description, role });
      return json(agent);
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 14. list_agents ─────────────────────────────────────────────────────────

server.tool(
  "list_agents",
  "List all registered agents",
  {},
  async () => {
    try {
      const agents = listAgents();
      return json({ items: agents, total: agents.length });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 15. import_from_todos ───────────────────────────────────────────────────

server.tool(
  "import_from_todos",
  "Import test scenarios from the todos database",
  {
    projectName: z.string().optional().describe("Todos project name to filter by"),
    tags: z.array(z.string()).optional().describe("Tags to filter todos tasks"),
    projectId: z.string().optional().describe("Target project ID for imported scenarios"),
  },
  async ({ projectName, tags, projectId }) => {
    try {
      const result = importFromTodos({ projectName, tags, projectId });
      return json(result);
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 16. get_status ──────────────────────────────────────────────────────────

server.tool(
  "get_status",
  "Get system status: DB path, API key, scenario and run counts",
  {},
  async () => {
    try {
      const config = loadConfig();
      const db = getDatabase();
      const scenarioCount = (db.query("SELECT COUNT(*) as count FROM scenarios").get() as { count: number }).count;
      const runCount = (db.query("SELECT COUNT(*) as count FROM runs").get() as { count: number }).count;
      const hasApiKey = !!(config.anthropicApiKey || process.env["ANTHROPIC_API_KEY"]);
      return json({
        dbPath: process.env["TESTERS_DB_PATH"] || "~/.testers/testers.db",
        apiKey: hasApiKey ? "configured" : "not set",
        scenarioCount,
        runCount,
        defaultModel: config.defaultModel,
      });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── scenario_exists ─────────────────────────────────────────────────────────

server.tool(
  "scenario_exists",
  "Check whether a scenario with the given name exists (exact match). Returns { exists, scenario }.",
  {
    name: z.string().describe("Scenario name to look up (exact match)"),
    projectId: z.string().optional().describe("Restrict search to a specific project ID"),
  },
  async ({ name, projectId }) => {
    try {
      const scenarios = listScenarios({ projectId });
      const scenario = scenarios.find((s) => s.name === name) ?? null;
      return json({ exists: scenario !== null, scenario });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── Schedule Tools ──────────────────────────────────────────────────────────

server.tool(
  "create_schedule",
  {
    name: z.string().describe("Schedule name"),
    cronExpression: z.string().describe("Cron expression (5-field)"),
    url: z.string().describe("Target URL to test"),
    tags: z.array(z.string()).optional().describe("Filter scenarios by tags"),
    priority: z.string().optional().describe("Filter scenarios by priority"),
    model: z.string().optional().describe(MODEL_DESC),
    headed: z.boolean().optional().describe("Run headed"),
    parallel: z.number().optional().describe("Parallel count"),
    projectId: z.string().optional().describe("Project ID"),
  },
  async (params) => {
    try {
      const schedule = createSchedule({
        name: params.name,
        cronExpression: params.cronExpression,
        url: params.url,
        scenarioFilter: { tags: params.tags, priority: params.priority as "low" | "medium" | "high" | "critical" | undefined },
        model: params.model,
        headed: params.headed,
        parallel: params.parallel,
        projectId: params.projectId,
      });
      const nextRun = getNextRunTime(schedule.cronExpression);
      return json({ ...schedule, nextRunAt: nextRun.toISOString() });
    } catch (e) {
      return errorResponse(e);
    }
  },
);

server.tool(
  "list_schedules",
  {
    projectId: z.string().optional(),
    enabled: z.boolean().optional(),
    limit: z.number().optional(),
  },
  async (params) => {
    try {
      const schedules = listSchedules({ projectId: params.projectId, enabled: params.enabled, limit: params.limit });
      return json({ items: schedules, total: schedules.length });
    } catch (e) {
      return errorResponse(e);
    }
  },
);

server.tool(
  "enable_schedule",
  { id: z.string().describe("Schedule ID") },
  async (params) => {
    try {
      const schedule = updateSchedule(params.id, { enabled: true });
      return json(schedule);
    } catch (e) {
      return errorResponse(e);
    }
  },
);

server.tool(
  "disable_schedule",
  { id: z.string().describe("Schedule ID") },
  async (params) => {
    try {
      const schedule = updateSchedule(params.id, { enabled: false });
      return json(schedule);
    } catch (e) {
      return errorResponse(e);
    }
  },
);

server.tool(
  "delete_schedule",
  { id: z.string().describe("Schedule ID") },
  async (params) => {
    try {
      const deleted = deleteSchedule(params.id);
      if (!deleted) return errorResponse(notFoundErr(params.id, "Schedule"));
      return json({ deleted: true, id: params.id });
    } catch (e) {
      return errorResponse(e);
    }
  },
);

// ─── 17. wait_for_run ────────────────────────────────────────────────────────

server.tool(
  "wait_for_run",
  "Poll a run until it reaches a terminal status (passed, failed, error, or cancelled). Blocks until done or timeout.",
  {
    runId: z.string().describe("Run ID to wait for"),
    timeoutMs: z.number().optional().describe("Max wait time in ms (default 300000)"),
    pollIntervalMs: z.number().optional().describe("Poll interval in ms (default 3000)"),
  },
  async ({ runId, timeoutMs = 300000, pollIntervalMs = 3000 }) => {
    try {
      const terminalStatuses = new Set(["passed", "failed", "error", "cancelled"]);
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        const run = getRun(runId);
        if (!run) return errorResponse(notFoundErr(runId, "Run"));

        if (terminalStatuses.has(run.status)) {
          const results = getResultsByRun(runId);
          const passed = results.filter((r) => r.status === "passed").length;
          const failed = results.filter((r) => r.status === "failed" || r.status === "error").length;
          return json({ ...run, passedCount: passed, failedCount: failed });
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      return errorResponse(Object.assign(new Error(`Run ${runId} did not complete within ${timeoutMs}ms`), { name: "TimeoutError" }));
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 18. get_run_stats ───────────────────────────────────────────────────────

server.tool(
  "get_run_stats",
  "Get aggregate statistics for a run: pass rate, cost, token usage, duration",
  {
    runId: z.string().describe("Run ID"),
  },
  async ({ runId }) => {
    try {
      const run = getRun(runId);
      if (!run) return errorResponse(notFoundErr(runId, "Run"));

      const results = getResultsByRun(runId);
      const total = results.length;
      const passed = results.filter((r) => r.status === "passed").length;
      const failed = results.filter((r) => r.status === "failed").length;
      const errors = results.filter((r) => r.status === "error").length;
      const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
      const totalCostCents = results.reduce((sum, r) => sum + (r.costCents ?? 0), 0);
      const totalTokens = results.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0);
      const durations = results.filter((r) => r.durationMs != null && r.durationMs > 0).map((r) => r.durationMs!);
      const avgDurationMs = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

      return json({ runId, status: run.status, total, passed, failed, errors, passRate, totalCostCents, totalTokens, avgDurationMs, startedAt: run.startedAt, completedAt: run.finishedAt ?? null });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 19. get_run_costs ───────────────────────────────────────────────────────

server.tool(
  "get_run_costs",
  "Get cost breakdown for a run, with per-scenario detail",
  {
    runId: z.string().describe("Run ID"),
  },
  async ({ runId }) => {
    try {
      const run = getRun(runId);
      if (!run) return errorResponse(notFoundErr(runId, "Run"));

      const results = getResultsByRun(runId);
      const totalCostCents = results.reduce((sum, r) => sum + (r.costCents ?? 0), 0);
      const totalTokens = results.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0);
      const byScenario = results.map((r) => {
        const scenario = getScenario(r.scenarioId);
        return { scenarioId: r.scenarioId, scenarioName: scenario?.name ?? r.scenarioId, costCents: r.costCents ?? 0, tokens: r.tokensUsed ?? 0, status: r.status };
      });

      return json({ runId, totalCostCents, totalTokens, byScenario });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 20. batch_create_scenarios ──────────────────────────────────────────────

server.tool(
  "batch_create_scenarios",
  "Create multiple scenarios in a single call. Returns created scenarios and any failures.",
  {
    scenarios: z.array(
      z.object({
        name: z.string().describe("Scenario name"),
        url: z.string().optional().describe("Target URL (stored as targetPath)"),
        description: z.string().optional().describe("What this scenario tests"),
        steps: z.array(z.string()).optional().describe("Ordered test steps"),
        tags: z.array(z.string()).optional().describe("Tags for filtering"),
        priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Scenario priority"),
      })
    ).describe("Array of scenarios to create"),
  },
  async ({ scenarios }) => {
    const created: ReturnType<typeof createScenario>[] = [];
    const failed: { index: number; name: string; error: string }[] = [];

    for (let i = 0; i < scenarios.length; i++) {
      const input = scenarios[i];
      try {
        const scenario = createScenario({
          name: input.name,
          description: input.description ?? input.name,
          steps: input.steps,
          tags: input.tags,
          priority: input.priority,
          targetPath: input.url,
        });
        created.push(scenario);
      } catch (error) {
        const e = error instanceof Error ? error : new Error(String(error));
        failed.push({ index: i, name: input.name, error: e.message });
      }
    }

    const lines = [
      `Created: ${created.length} scenario(s)`,
      ...created.map((s) => `  [${s.shortId}] ${s.name}`),
    ];
    return json({ created, failed });
  },
);

// ─── 21. cancel_run ──────────────────────────────────────────────────────────

server.tool(
  "cancel_run",
  "Mark a run as cancelled in the database. In-flight browser processes may still complete but results will be ignored.",
  {
    runId: z.string().describe("Run ID to cancel"),
  },
  async ({ runId }) => {
    try {
      const run = getRun(runId);
      if (!run) return errorResponse(notFoundErr(runId, "Run"));

      updateRun(runId, { status: "cancelled", finished_at: new Date().toISOString() });
      return json({ cancelled: true, runId });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 22. get_tags ────────────────────────────────────────────────────────────

server.tool(
  "get_tags",
  "List all unique tags across scenarios, optionally filtered by project",
  {
    projectId: z.string().optional().describe("Filter by project ID"),
  },
  async ({ projectId }) => {
    try {
      const scenarios = listScenarios({ projectId });
      const tagSet = new Set<string>();
      for (const s of scenarios) {
        for (const tag of s.tags) {
          tagSet.add(tag);
        }
      }
      const tags = Array.from(tagSet).sort();
      return json({ tags, total: tags.length });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 23. get_stale_scenarios ─────────────────────────────────────────────────

server.tool(
  "get_stale_scenarios",
  "List scenarios that have not been run recently (or never run)",
  {
    days: z.number().optional().describe("Scenarios not run in this many days are considered stale (default 7)"),
    projectId: z.string().optional().describe("Filter by project ID"),
  },
  async ({ days = 7, projectId }) => {
    try {
      let scenarios = findStaleScenarios(days);
      if (projectId) {
        scenarios = scenarios.filter((s) => s.projectId === projectId);
      }
      return json({ items: scenarios, total: scenarios.length });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── Connect ─────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start testers:", error);
  process.exit(1);
});
