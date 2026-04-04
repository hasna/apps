#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerCloudTools } from "@hasna/cloud";

import { createScenario, getScenario, getScenarioByShortId, listScenarios, updateScenario, deleteScenario, findStaleScenarios } from "../db/scenarios.js";
import { getRun, listRuns, updateRun } from "../db/runs.js";
import { listResults, getResultsByRun } from "../db/results.js";
import { listScreenshots } from "../db/screenshots.js";
import { createProject, ensureProject, listProjects } from "../db/projects.js";
import { registerAgent, listAgents, heartbeatAgent, setAgentFocus } from "../db/agents.js";
import { startRunAsync } from "../lib/runner.js";
import { matchFilesToScenarios } from "../lib/affected.js";
import { listScanIssues, getScanIssue, resolveScanIssue } from "../db/scan-issues.js";
import { loadConfig } from "../lib/config.js";
import { importFromTodos } from "../lib/todos-connector.js";
import { createSchedule, listSchedules, updateSchedule, deleteSchedule } from "../db/schedules.js";
import { getNextRunTime } from "../lib/scheduler.js";
import { getDatabase } from "../db/database.js";
import { VersionConflictError } from "../types/index.js";
import { createApiCheck, getApiCheck, listApiChecks, updateApiCheck, deleteApiCheck, getLatestApiCheckResult, listApiCheckResults } from "../db/api-checks.js";
import { runApiCheck, runApiChecksByFilter } from "../lib/api-runner.js";
import { createPersona, getPersona, listPersonas, updatePersona, deletePersona } from "../db/personas.js";
import { PersonaNotFoundError } from "../types/index.js";
import { getTestersDir } from "../lib/paths.js";

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
    projectId: z.string().optional().describe("Project ID to scope this scenario to"),
  },
  async ({ name, description, steps, tags, priority, model, targetPath, requiresAuth, projectId }) => {
    try {
      const scenario = createScenario({ name, description, steps, tags, priority, model, targetPath, requiresAuth, projectId });
      return json(scenario);
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 1b. batch_create_scenarios ──────────────────────────────────────────────

server.tool(
  "batch_create_scenarios",
  "Create multiple test scenarios in a single call. Each item requires name and description.",
  {
    scenarios: z.array(z.object({
      name: z.string().describe("Scenario name"),
      description: z.string().describe("What this scenario tests"),
      steps: z.array(z.string()).optional().describe("Ordered test steps"),
      tags: z.array(z.string()).optional().describe("Tags for filtering"),
      priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Scenario priority"),
      model: z.string().optional().describe(MODEL_DESC),
      targetPath: z.string().optional().describe("URL path to navigate to"),
      requiresAuth: z.boolean().optional().describe("Whether scenario requires authentication"),
    })).min(1).max(100).describe("Array of scenarios to create"),
    projectId: z.string().optional().describe("Project ID to scope all scenarios to"),
  },
  async ({ scenarios, projectId }) => {
    try {
      const results: { id: string; name: string; shortId: string; error?: string }[] = [];
      for (const s of scenarios) {
        try {
          const scenario = createScenario({ ...s, projectId });
          results.push({ id: scenario.id, name: scenario.name, shortId: scenario.shortId });
        } catch (e) {
          results.push({ id: "", name: s.name, shortId: "", error: e instanceof Error ? e.message : String(e) });
        }
      }
      const created = results.filter((r) => !r.error).length;
      const failed = results.filter((r) => r.error).length;
      return json({ created, failed, total: scenarios.length, results });
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
    flakyOnly: z.boolean().optional().describe("Return only scenarios with flakinessScore < 0.8 (have recent failures)"),
  },
  async ({ projectId, tags, priority, limit, flakyOnly }) => {
    try {
      let scenarios = listScenarios({ projectId, tags, priority, limit });
      if (flakyOnly) {
        scenarios = scenarios.filter((s) => s.flakinessScore !== null && s.flakinessScore !== undefined && s.flakinessScore < 0.8);
      }
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
  "Run test scenarios against a URL. Provide url directly, or use env to look up a named environment's URL.",
  {
    url: z.string().optional().describe("Target URL to test against (omit if using env)"),
    env: z.string().optional().describe("Named environment to use for the URL (from environments table)"),
    tags: z.array(z.string()).optional().describe("Filter scenarios by tags"),
    scenarioIds: z.array(z.string()).optional().describe("Run specific scenario IDs"),
    priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Filter by priority"),
    model: z.string().optional().describe(MODEL_DESC),
    headed: z.boolean().optional().describe("Run browser in headed mode"),
    parallel: z.number().optional().describe("Number of parallel workers"),
    personaId: z.string().optional().describe("Override persona ID for this run"),
    personaIds: z.array(z.string()).optional().describe("Run with multiple personas for divergence testing (each persona runs all scenarios)"),
    samples: z.number().int().min(1).max(20).optional().describe("Run each scenario N times for flakiness detection (default 1)"),
    flakinessThreshold: z.number().min(0).max(1).optional().describe("Pass rate below which scenario is marked flaky (default 0.95)"),
    maxCostCents: z.number().optional().describe("Hard budget cap in cents — run is rejected before starting if estimated cost exceeds this"),
    cacheMaxAgeMs: z.number().optional().describe("Skip scenarios that passed at the same URL within this many ms (0 = disabled)"),
    minimal: z.boolean().optional().describe("Fastest mode: cheapest model, max parallelism, min turns — ideal for CI smoke checks"),
    timeoutMs: z.number().optional().describe("Per-scenario timeout in ms (default 120000)"),
  },
  async ({ url, env, tags, scenarioIds, priority, model, headed, parallel, personaId, personaIds, samples, flakinessThreshold, maxCostCents, cacheMaxAgeMs, minimal, timeoutMs }) => {
    try {
      let resolvedUrl = url;
      if (!resolvedUrl && env) {
        const { getEnvironment } = await import("./db/environments.js").catch(() => import("../db/environments.js"));
        const environment = getEnvironment(env);
        if (!environment) return errorResponse(notFoundErr(env, "Environment"));
        resolvedUrl = environment.url;
      }
      if (!resolvedUrl) {
        const { getDefaultEnvironment } = await import("./db/environments.js").catch(() => import("../db/environments.js"));
        const defaultEnv = getDefaultEnvironment();
        if (defaultEnv) resolvedUrl = defaultEnv.url;
      }
      if (!resolvedUrl) return errorResponse(new Error("No URL provided and no default environment set. Pass url or env."));
      const { runId, scenarioCount } = startRunAsync({ url: resolvedUrl, tags, scenarioIds, priority, model, headed, parallel, personaId, personaIds, samples, flakinessThreshold, maxCostCents, cacheMaxAgeMs, minimal, timeout: timeoutMs });
      return json({ runId, scenarioCount, url: resolvedUrl, status: "running", message: "Poll with get_run to check progress." });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 6b. retry_failed ────────────────────────────────────────────────────────

server.tool(
  "retry_failed",
  "Re-run only failed/errored scenarios from a previous run. Creates a new run with only the failing scenarios.",
  {
    runId: z.string().describe("Previous run ID to retry failures from"),
    url: z.string().optional().describe("Target URL (overrides original run URL)"),
    model: z.string().optional().describe(MODEL_DESC),
    headed: z.boolean().optional().describe("Run browser in headed mode"),
    parallel: z.number().optional().describe("Number of parallel workers"),
    maxRetries: z.number().int().min(0).max(3).optional().describe("Max retries per failed scenario"),
    maxCostCents: z.number().optional().describe("Hard budget cap in cents"),
  },
  async ({ runId, url, model, headed, parallel, maxRetries, maxCostCents }) => {
    try {
      const run = getRun(runId);
      if (!run) return errorResponse(notFoundErr(runId, "Run"));
      if (run.status !== "failed") return errorResponse(new Error("Run is not in failed state. Can only retry failures from a failed run."));

      const results = getResultsByRun(runId);
      const failedResultIds = results.filter((r: any) => r.status === "failed" || r.status === "error").map((r: any) => r.scenarioId);
      if (failedResultIds.length === 0) return errorResponse(new Error("No failed results found in this run."));

      const resolvedUrl = url ?? run.url;
      const { runId: newRunId, scenarioCount } = startRunAsync({
        url: resolvedUrl,
        scenarioIds: failedResultIds,
        model,
        headed,
        parallel,
        retry: maxRetries ?? 0,
        maxCostCents,
      });
      return json({
        runId: newRunId,
        originalRunId: runId,
        scenarioCount,
        retriedScenarioIds: failedResultIds,
        url: resolvedUrl,
        status: "running",
        message: "Poll with get_run to check progress.",
      });
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
    projectId: z.string().optional().describe("Filter by project ID"),
    status: z.enum(["pending", "running", "passed", "failed", "cancelled"]).optional().describe("Filter by status"),
    since: z.string().optional().describe("Filter runs started at or after this ISO date"),
    until: z.string().optional().describe("Filter runs started at or before this ISO date"),
    sort: z.enum(["date", "duration", "cost"]).optional().describe("Sort field"),
    desc: z.boolean().optional().describe("Sort descending (default true)"),
    limit: z.number().optional().describe("Max results to return"),
    offset: z.number().optional().describe("Number of results to skip"),
  },
  async ({ projectId, status, since, until, sort, desc, limit, offset }) => {
    try {
      const runs = listRuns({ projectId, status, since, until, sort, desc, limit, offset });
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
        dbPath: process.env["HASNA_TESTERS_DB_PATH"] || process.env["TESTERS_DB_PATH"] || `${getTestersDir()}/testers.db`,
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

// ─── 24. run_affected_scenarios ──────────────────────────────────────────────

server.tool(
  "run_affected_scenarios",
  "Run only the scenarios relevant to a set of changed files. Matches files to scenarios via explicit glob→tag rules, targetPath keywords, and name/tag inference. Returns immediately — poll with get_run.",
  {
    url: z.string().describe("Target URL to test against"),
    filePaths: z.array(z.string()).describe("Changed file paths (relative or absolute)"),
    mappings: z
      .array(
        z.object({
          glob: z.string().describe("File glob pattern (supports * and **)"),
          tags: z.array(z.string()).describe("Run scenarios tagged with these if glob matches"),
        }),
      )
      .optional()
      .describe("Explicit file glob → scenario tag mappings"),
    projectId: z.string().optional().describe("Restrict to scenarios in this project"),
    model: z.string().optional().describe(MODEL_DESC),
    headed: z.boolean().optional().describe("Run browser in headed mode"),
    parallel: z.number().optional().describe("Number of parallel workers"),
  },
  async ({ url, filePaths, mappings, projectId, model, headed, parallel }) => {
    try {
      const allScenarios = listScenarios({ projectId });
      const matched = matchFilesToScenarios(filePaths, allScenarios, mappings ?? []);
      if (matched.length === 0) {
        return json({ runId: null, scenarioCount: 0, matchedScenarios: [], message: "No scenarios matched the provided file paths." });
      }
      const scenarioIds = matched.map((s) => s.id);
      const { runId, scenarioCount } = startRunAsync({ url, scenarioIds, model, headed, parallel, projectId });
      return json({
        runId,
        scenarioCount,
        url,
        status: "running",
        matchedScenarios: matched.map((s) => ({ id: s.id, shortId: s.shortId, name: s.name, tags: s.tags })),
        message: "Poll with get_run to check progress.",
      });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 25. heartbeat ───────────────────────────────────────────────────────────

server.tool(
  "heartbeat",
  "Update an agent's last_seen_at timestamp. Call regularly to signal the agent is alive.",
  {
    agentId: z.string().describe("Agent ID to heartbeat"),
  },
  async ({ agentId }) => {
    try {
      const agent = heartbeatAgent(agentId);
      if (!agent) return errorResponse(notFoundErr(agentId, "Agent"));
      return json({ ok: true, agentId: agent.id, lastSeenAt: agent.lastSeenAt });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 26. set_focus ───────────────────────────────────────────────────────────

server.tool(
  "set_focus",
  "Set (or clear) an agent's current focus scenario. Stored in agent metadata.",
  {
    agentId: z.string().describe("Agent ID"),
    scenarioId: z.string().nullable().describe("Scenario ID the agent is working on, or null to clear"),
  },
  async ({ agentId, scenarioId }) => {
    try {
      const agent = setAgentFocus(agentId, scenarioId);
      if (!agent) return errorResponse(notFoundErr(agentId, "Agent"));
      return json({ ok: true, agentId: agent.id, focus: (agent.metadata as Record<string, unknown> | null)?.focus ?? null });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 27. scan_console_errors ─────────────────────────────────────────────────

server.tool(
  "scan_console_errors",
  "Visit pages headlessly and collect JS/React console errors, uncaught exceptions, and unhandled promise rejections.",
  {
    url: z.string().describe("Root URL to scan"),
    pages: z.array(z.string()).optional().describe("Specific paths to visit (e.g. ['/login', '/dashboard']). Defaults to root URL only."),
    projectId: z.string().optional().describe("Project ID for deduplication tracking"),
    headed: z.boolean().optional().describe("Run browser in headed mode"),
    timeoutMs: z.number().optional().describe("Navigation timeout per page (default 15000)"),
  },
  async ({ url, pages, projectId, headed, timeoutMs }) => {
    try {
      const { scanConsoleErrors } = await import("../lib/scanners/console.js");
      const { upsertScanIssue } = await import("../db/scan-issues.js");
      const result = await scanConsoleErrors({ url, pages, headed, timeoutMs });
      const deduped = result.issues.map((issue) => {
        const { outcome } = upsertScanIssue(issue, projectId);
        return { ...issue, outcome };
      });
      return json({ ...result, issues: deduped });
    } catch (e) { return errorResponse(e); }
  },
);

// ─── 28. scan_network_errors ──────────────────────────────────────────────────

server.tool(
  "scan_network_errors",
  "Visit pages and intercept network requests, flagging 5xx errors, 4xx on API routes, CORS failures, and request timeouts.",
  {
    url: z.string().describe("Root URL to scan"),
    pages: z.array(z.string()).optional().describe("Specific paths to visit"),
    projectId: z.string().optional().describe("Project ID for deduplication tracking"),
    headed: z.boolean().optional(),
    timeoutMs: z.number().optional(),
  },
  async ({ url, pages, projectId, headed, timeoutMs }) => {
    try {
      const { scanNetworkErrors } = await import("../lib/scanners/network.js");
      const { upsertScanIssue } = await import("../db/scan-issues.js");
      const result = await scanNetworkErrors({ url, pages, headed, timeoutMs });
      const deduped = result.issues.map((issue) => {
        const { outcome } = upsertScanIssue(issue, projectId);
        return { ...issue, outcome };
      });
      return json({ ...result, issues: deduped });
    } catch (e) { return errorResponse(e); }
  },
);

// ─── 29. scan_broken_links ────────────────────────────────────────────────────

server.tool(
  "scan_broken_links",
  "Crawl app from root URL and flag any links that return 404 or fail to load.",
  {
    url: z.string().describe("Root URL to crawl from"),
    maxPages: z.number().optional().describe("Max pages to crawl (default 30)"),
    projectId: z.string().optional().describe("Project ID for deduplication tracking"),
    headed: z.boolean().optional(),
    timeoutMs: z.number().optional(),
  },
  async ({ url, maxPages, projectId, headed, timeoutMs }) => {
    try {
      const { scanBrokenLinks } = await import("../lib/scanners/links.js");
      const { upsertScanIssue } = await import("../db/scan-issues.js");
      const result = await scanBrokenLinks({ url, maxPages, headed, timeoutMs });
      const deduped = result.issues.map((issue) => {
        const { outcome } = upsertScanIssue(issue, projectId);
        return { ...issue, outcome };
      });
      return json({ ...result, issues: deduped });
    } catch (e) { return errorResponse(e); }
  },
);

// ─── 30. scan_performance ────────────────────────────────────────────────────

server.tool(
  "scan_performance",
  "Visit pages and measure load time, DOMContentLoaded, and LCP using the Web Performance API. Flags slow pages.",
  {
    url: z.string().describe("Root URL to scan"),
    pages: z.array(z.string()).optional().describe("Specific paths to visit"),
    projectId: z.string().optional().describe("Project ID for deduplication tracking"),
    headed: z.boolean().optional(),
    timeoutMs: z.number().optional(),
    thresholds: z.object({
      loadTimeMs: z.number().optional(),
      domContentLoadedMs: z.number().optional(),
      lcpMs: z.number().optional(),
    }).optional().describe("Override default thresholds"),
  },
  async ({ url, pages, projectId, headed, timeoutMs, thresholds }) => {
    try {
      const { scanPerformance } = await import("../lib/scanners/performance.js");
      const { upsertScanIssue } = await import("../db/scan-issues.js");
      const result = await scanPerformance({ url, pages, headed, timeoutMs, thresholds });
      const deduped = result.issues.map((issue) => {
        const { outcome } = upsertScanIssue(issue, projectId);
        return { ...issue, outcome };
      });
      return json({ ...result, issues: deduped });
    } catch (e) { return errorResponse(e); }
  },
);

// ─── 31. run_health_scan ─────────────────────────────────────────────────────

server.tool(
  "run_health_scan",
  "Run all scanners (console, network, links, performance) against a URL. Deduplicates issues, creates todo tasks for new/regressed issues, and posts to conversations space.",
  {
    url: z.string().describe("URL to scan"),
    pages: z.array(z.string()).optional().describe("Specific paths to include"),
    projectId: z.string().optional().describe("Project ID"),
    scanners: z.array(z.enum(["console", "network", "links", "performance", "a11y"])).optional().describe("Which scanners to run (default: console, network, links)"),
    maxPages: z.number().optional().describe("Max pages for link crawl (default 20)"),
    wcagLevel: z.enum(["A", "AA", "AAA"]).optional().describe("WCAG compliance level for a11y scanner (default: AA)"),
    headed: z.boolean().optional(),
    timeoutMs: z.number().optional(),
  },
  async ({ url, pages, projectId, scanners, maxPages, headed, timeoutMs, wcagLevel }) => {
    try {
      const { runHealthScan } = await import("../lib/health-scan.js");
      const summary = await runHealthScan({ url, pages, projectId, scanners, maxPages, headed, timeoutMs, wcagLevel });
      return json(summary);
    } catch (e) { return errorResponse(e); }
  },
);

// ─── 32. list_scan_issues ────────────────────────────────────────────────────

server.tool(
  "list_scan_issues",
  "List persisted scan issues with optional filters.",
  {
    status: z.enum(["open", "resolved", "regressed"]).optional(),
    type: z.enum(["console_error", "network_error", "broken_link", "performance"]).optional(),
    projectId: z.string().optional(),
    limit: z.number().optional(),
  },
  async ({ status, type, projectId, limit }) => {
    try {
      const issues = listScanIssues({ status, type, projectId, limit });
      return json({ items: issues, total: issues.length });
    } catch (e) { return errorResponse(e); }
  },
);

// ─── 33. resolve_scan_issue ──────────────────────────────────────────────────

server.tool(
  "resolve_scan_issue",
  "Mark a scan issue as resolved.",
  { id: z.string().describe("Scan issue ID") },
  async ({ id }) => {
    try {
      const ok = resolveScanIssue(id);
      if (!ok) return errorResponse(notFoundErr(id, "ScanIssue"));
      return json({ resolved: true, id });
    } catch (e) { return errorResponse(e); }
  },
);

// ─── API Check Tools ─────────────────────────────────────────────────────────

// ─── 34. create_api_check ────────────────────────────────────────────────────

server.tool(
  "create_api_check",
  "Create a new API health check",
  {
    name: z.string().describe("Check name"),
    url: z.string().describe("URL to check (absolute or relative path)"),
    method: z.enum(["GET","POST","PUT","PATCH","DELETE","HEAD"]).optional().describe("HTTP method (default GET)"),
    headers: z.record(z.string()).optional().describe("Request headers"),
    body: z.string().optional().describe("Request body (for POST/PUT/PATCH)"),
    expectedStatus: z.number().optional().describe("Expected HTTP status code (default 200)"),
    expectedBodyContains: z.string().optional().describe("String that must appear in the response body"),
    expectedResponseTimeMs: z.number().optional().describe("Max acceptable response time in ms"),
    timeoutMs: z.number().optional().describe("Request timeout in ms (default 10000)"),
    tags: z.array(z.string()).optional().describe("Tags for filtering"),
    description: z.string().optional().describe("Check description"),
    projectId: z.string().optional().describe("Project ID"),
    enabled: z.boolean().optional().describe("Whether the check is enabled (default true)"),
  },
  async (params) => {
    try {
      const check = createApiCheck({
        name: params.name,
        url: params.url,
        method: params.method,
        headers: params.headers,
        body: params.body,
        expectedStatus: params.expectedStatus,
        expectedBodyContains: params.expectedBodyContains,
        expectedResponseTimeMs: params.expectedResponseTimeMs,
        timeoutMs: params.timeoutMs,
        tags: params.tags,
        description: params.description,
        projectId: params.projectId,
        enabled: params.enabled,
      });
      return json(check);
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 35. list_api_checks ─────────────────────────────────────────────────────

server.tool(
  "list_api_checks",
  "List API checks with optional filters",
  {
    projectId: z.string().optional().describe("Filter by project ID"),
    enabled: z.boolean().optional().describe("Filter by enabled status"),
    tags: z.array(z.string()).optional().describe("Filter by tags"),
    limit: z.number().optional().describe("Max results to return (default 20)"),
  },
  async ({ projectId, enabled, tags, limit = 20 }) => {
    try {
      const checks = listApiChecks({ projectId, enabled, tags, limit });
      return json({ items: checks, total: checks.length });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 36. get_api_check ───────────────────────────────────────────────────────

server.tool(
  "get_api_check",
  `Get an API check by ID or short ID. ${ID_DESC}`,
  {
    id: z.string().describe(`API check ID or short ID. ${ID_DESC}`),
  },
  async ({ id }) => {
    try {
      const check = getApiCheck(id);
      if (!check) return errorResponse(notFoundErr(id, "ApiCheck"));
      const lastResult = getLatestApiCheckResult(check.id);
      return json({ ...check, lastResult });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 37. update_api_check ────────────────────────────────────────────────────

server.tool(
  "update_api_check",
  `Update an existing API check (requires version for optimistic locking). ${ID_DESC}`,
  {
    id: z.string().describe(`API check ID or short ID. ${ID_DESC}`),
    version: z.number().describe("Current version (for optimistic locking)"),
    name: z.string().optional().describe("New name"),
    description: z.string().optional().describe("New description"),
    method: z.enum(["GET","POST","PUT","PATCH","DELETE","HEAD"]).optional().describe("New HTTP method"),
    url: z.string().optional().describe("New URL"),
    headers: z.record(z.string()).optional().describe("New request headers"),
    body: z.string().optional().describe("New request body"),
    expectedStatus: z.number().optional().describe("New expected status code"),
    expectedBodyContains: z.string().optional().describe("New expected body string"),
    expectedResponseTimeMs: z.number().optional().describe("New max response time in ms"),
    timeoutMs: z.number().optional().describe("New timeout in ms"),
    tags: z.array(z.string()).optional().describe("New tags"),
    enabled: z.boolean().optional().describe("Enable or disable the check"),
  },
  async ({ id, version, ...updates }) => {
    try {
      const check = updateApiCheck(id, updates, version);
      return json(check);
    } catch (error) {
      return errorResponse(error, {
        fetchCurrent: () => getApiCheck(id),
      });
    }
  },
);

// ─── 38. delete_api_check ────────────────────────────────────────────────────

server.tool(
  "delete_api_check",
  `Delete an API check by ID. ${ID_DESC}`,
  {
    id: z.string().describe(`API check ID or short ID. ${ID_DESC}`),
  },
  async ({ id }) => {
    try {
      const deleted = deleteApiCheck(id);
      if (!deleted) return errorResponse(notFoundErr(id, "ApiCheck"));
      return json({ deleted: true, id });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 39. run_api_check ───────────────────────────────────────────────────────

server.tool(
  "run_api_check",
  `Run a single API check immediately and return the result. ${ID_DESC}`,
  {
    id: z.string().describe(`API check ID or short ID. ${ID_DESC}`),
    baseUrl: z.string().optional().describe("Base URL to prepend to relative check URLs"),
  },
  async ({ id, baseUrl }) => {
    try {
      const check = getApiCheck(id);
      if (!check) return errorResponse(notFoundErr(id, "ApiCheck"));
      const result = await runApiCheck(check, { baseUrl });
      return json(result);
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 40. run_api_checks ──────────────────────────────────────────────────────

server.tool(
  "run_api_checks",
  "Run multiple API checks filtered by project/tags and return aggregated results",
  {
    baseUrl: z.string().describe("Base URL to prepend to relative check URLs"),
    projectId: z.string().optional().describe("Filter checks by project ID"),
    tags: z.array(z.string()).optional().describe("Filter checks by tags"),
    parallel: z.number().optional().describe("Number of parallel requests (default 5)"),
  },
  async ({ baseUrl, projectId, tags, parallel = 5 }) => {
    try {
      const startTime = Date.now();
      const { results, passed, failed, errors } = await runApiChecksByFilter({ baseUrl, projectId, tags, parallel });
      const durationMs = Date.now() - startTime;
      return json({ results, passed, failed, errors, durationMs });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 41. get_api_check_results ───────────────────────────────────────────────

server.tool(
  "get_api_check_results",
  `Get recent results for an API check. ${ID_DESC}`,
  {
    checkId: z.string().describe(`API check ID or short ID. ${ID_DESC}`),
    limit: z.number().optional().describe("Max results to return (default 10)"),
  },
  async ({ checkId, limit = 10 }) => {
    try {
      const check = getApiCheck(checkId);
      if (!check) return errorResponse(notFoundErr(checkId, "ApiCheck"));
      const results = listApiCheckResults(check.id, { limit });
      return json({ items: results, total: results.length });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── Persona Tools ───────────────────────────────────────────────────────────

// ─── 42. create_persona ──────────────────────────────────────────────────────

server.tool(
  "create_persona",
  "Create a new test persona with optional auth credentials for multi-user testing. Leave projectId null to create a global persona.",
  {
    name: z.string().describe("Persona name"),
    role: z.string().describe("Persona role (e.g. first-time user, admin, power user, security auditor)"),
    description: z.string().optional().describe("Short description of the persona"),
    instructions: z.string().optional().describe("Detailed behavior instructions for the AI when acting as this persona"),
    traits: z.array(z.string()).optional().describe("Personality traits (e.g. impatient, curious, detail-oriented)"),
    goals: z.array(z.string()).optional().describe("Goals the persona is trying to accomplish"),
    projectId: z.string().nullable().optional().describe("Project ID (null = global persona)"),
    authEmail: z.string().optional().describe("Login email for multi-user session pool"),
    authPassword: z.string().optional().describe("Login password for multi-user session pool"),
    authLoginPath: z.string().optional().describe("Login page path (default: /login)"),
  },
  async ({ name, role, description, instructions, traits, goals, projectId, authEmail, authPassword, authLoginPath }) => {
    try {
      const persona = createPersona({
        name,
        role,
        description,
        instructions,
        traits,
        goals,
        projectId: projectId ?? undefined,
        authEmail,
        authPassword,
        authLoginPath,
      });
      return json(persona);
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 43. list_personas ───────────────────────────────────────────────────────

server.tool(
  "list_personas",
  "List personas with optional filters",
  {
    projectId: z.string().optional().describe("Filter by project ID (includes global personas)"),
    enabled: z.boolean().optional().describe("Filter by enabled status"),
    globalOnly: z.boolean().optional().describe("Return only global personas (no project)"),
  },
  async ({ projectId, enabled, globalOnly }) => {
    try {
      const personas = listPersonas({ projectId, enabled, globalOnly });
      return json({ items: personas, total: personas.length });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 44. get_persona ─────────────────────────────────────────────────────────

server.tool(
  "get_persona",
  `Get a persona by ID or short ID, including the scenario IDs that use it. ${ID_DESC}`,
  {
    id: z.string().describe(`Persona ID or short ID. ${ID_DESC}`),
  },
  async ({ id }) => {
    try {
      const persona = getPersona(id);
      if (!persona) return errorResponse(notFoundErr(id, "Persona"));

      const db = getDatabase();
      const scenarioRows = db
        .query("SELECT id, short_id, name FROM scenarios WHERE persona_id = ?")
        .all(persona.id) as { id: string; short_id: string; name: string }[];

      return json({
        ...persona,
        usedByScenarios: scenarioRows.map((r) => ({ id: r.id, shortId: r.short_id, name: r.name })),
      });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 45. update_persona ──────────────────────────────────────────────────────

server.tool(
  "update_persona",
  `Update an existing persona (requires version for optimistic locking). ${ID_DESC}`,
  {
    id: z.string().describe(`Persona ID or short ID. ${ID_DESC}`),
    version: z.number().describe("Current version (for optimistic locking)"),
    name: z.string().optional().describe("New name"),
    role: z.string().optional().describe("New role"),
    description: z.string().optional().describe("New description"),
    instructions: z.string().optional().describe("New instructions"),
    traits: z.array(z.string()).optional().describe("New traits"),
    goals: z.array(z.string()).optional().describe("New goals"),
    enabled: z.boolean().optional().describe("Enable or disable the persona"),
    authEmail: z.string().optional().describe("Login email for multi-user session pool"),
    authPassword: z.string().optional().describe("Login password for multi-user session pool"),
    authLoginPath: z.string().optional().describe("Login page path (default: /login)"),
  },
  async ({ id, version, ...updates }) => {
    try {
      const persona = updatePersona(id, updates, version);
      return json(persona);
    } catch (error) {
      return errorResponse(error, {
        fetchCurrent: () => getPersona(id),
      });
    }
  },
);

// ─── 46. delete_persona ──────────────────────────────────────────────────────

server.tool(
  "delete_persona",
  `Delete a persona by ID. ${ID_DESC}`,
  {
    id: z.string().describe(`Persona ID or short ID. ${ID_DESC}`),
  },
  async ({ id }) => {
    try {
      const deleted = deletePersona(id);
      if (!deleted) return errorResponse(notFoundErr(id, "Persona"));
      return json({ deleted: true, id });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 47. attach_persona ──────────────────────────────────────────────────────

server.tool(
  "attach_persona",
  "Attach a persona to a scenario. The scenario will use this persona's role and instructions during test runs.",
  {
    personaId: z.string().describe("Persona ID or short ID"),
    scenarioId: z.string().describe("Scenario ID or short ID"),
  },
  async ({ personaId, scenarioId }) => {
    try {
      const persona = getPersona(personaId);
      if (!persona) return errorResponse(notFoundErr(personaId, "Persona"));

      const scenario = getScenario(scenarioId) ?? getScenarioByShortId(scenarioId);
      if (!scenario) return errorResponse(notFoundErr(scenarioId, "Scenario"));

      const updated = updateScenario(scenario.id, { personaId: persona.id } as Parameters<typeof updateScenario>[1], scenario.version);
      return json({ ...updated, attachedPersona: persona });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 48. detach_persona ──────────────────────────────────────────────────────

server.tool(
  "detach_persona",
  "Remove the persona from a scenario (set persona_id to null).",
  {
    scenarioId: z.string().describe("Scenario ID or short ID"),
  },
  async ({ scenarioId }) => {
    try {
      const scenario = getScenario(scenarioId) ?? getScenarioByShortId(scenarioId);
      if (!scenario) return errorResponse(notFoundErr(scenarioId, "Scenario"));

      const updated = updateScenario(scenario.id, { personaId: null } as Parameters<typeof updateScenario>[1], scenario.version);
      return json(updated);
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 49. quick_check ─────────────────────────────────────────────────────────

server.tool(
  "quick_check",
  "Single-call health check — runs smoke-tagged scenarios + API checks and returns pass/fail immediately (synchronous, waits for completion)",
  {
    url: z.string().optional().describe("Target URL to test against"),
    env: z.string().optional().describe("Environment name to resolve URL from"),
    tags: z.array(z.string()).optional().default(["smoke"]).describe("Tags to filter scenarios (default: ['smoke'])"),
    timeoutPerScenarioMs: z.number().optional().default(60000).describe("Timeout per scenario in ms (default 60000)"),
    includeApiChecks: z.boolean().optional().default(true).describe("Whether to run API checks (default true)"),
    projectId: z.string().optional().describe("Filter by project ID"),
  },
  async ({ url, env, tags, timeoutPerScenarioMs, includeApiChecks, projectId }) => {
    try {
      // Resolve URL
      let resolvedUrl = url;
      if (!resolvedUrl && env) {
        const { getEnvironment } = await import("../db/environments.js");
        const environment = getEnvironment(env);
        if (environment) resolvedUrl = environment.url;
      }
      if (!resolvedUrl) {
        const { getDefaultEnvironment } = await import("../db/environments.js");
        const defaultEnv = getDefaultEnvironment(projectId);
        if (defaultEnv) resolvedUrl = defaultEnv.url;
      }
      if (!resolvedUrl) return errorResponse(new Error("No URL provided. Pass url or env parameter."));

      const startTime = Date.now();
      const resolvedTags = tags ?? ["smoke"];

      // Run browser scenarios (smoke-tagged, max 10, synchronously)
      const smokeScenarios = listScenarios({ tags: resolvedTags, projectId, limit: 10 });
      let browserPassed = 0;
      let browserFailed = 0;
      const failedScenarios: Array<{ name: string; shortId: string; error: string }> = [];

      if (smokeScenarios.length > 0) {
        const { runBatch } = await import("../lib/runner.js");
        const { run, results } = await runBatch(smokeScenarios, {
          url: resolvedUrl,
          model: "quick",
          parallel: 3,
          timeout: timeoutPerScenarioMs ?? 60000,
          projectId,
        });
        browserPassed = run.passed;
        browserFailed = run.failed;
        for (const r of results.filter((r) => r.status !== "passed")) {
          const scenario = smokeScenarios.find((s) => s.id === r.scenarioId);
          failedScenarios.push({
            name: scenario?.name ?? r.scenarioId,
            shortId: r.id.slice(0, 8),
            error: r.error ?? r.reasoning ?? "failed",
          });
        }
      }

      // Run API checks
      let apiPassed = 0;
      let apiFailed = 0;
      const failedApiChecks: Array<{ name: string; url: string; statusCode: number | null; error: string }> = [];
      if (includeApiChecks ?? true) {
        const apiResult = await runApiChecksByFilter({ baseUrl: resolvedUrl, projectId, enabled: true });
        apiPassed = apiResult.passed;
        apiFailed = apiResult.failed + apiResult.errors;
        const allChecks = listApiChecks({ projectId, enabled: true });
        for (const r of apiResult.results.filter((r) => r.status !== "passed")) {
          const check = allChecks.find((c) => c.id === r.checkId);
          failedApiChecks.push({
            name: check?.name ?? r.checkId,
            url: check?.url ?? "",
            statusCode: r.statusCode,
            error: r.error ?? r.assertionsFailed.join("; ") ?? "failed",
          });
        }
      }

      const total = smokeScenarios.length + apiPassed + apiFailed;
      const passed = browserPassed + apiPassed;
      const failed = browserFailed + apiFailed;
      const status = failed === 0 ? "healthy" : total > 0 && failed / total > 0.2 ? "down" : "degraded";

      return json({
        status,
        passed,
        failed,
        total,
        durationMs: Date.now() - startTime,
        failedScenarios,
        failedApiChecks,
        summary: `${passed}/${total} passing${failedApiChecks.length > 0 ? `, ${apiFailed} API checks failing` : ""}`,
      });
    } catch (e) {
      return errorResponse(e);
    }
  },
);

// ─── 50. explain_failure ─────────────────────────────────────────────────────

server.tool(
  "explain_failure",
  "Explain why a test scenario failed and suggest a fix",
  {
    resultId: z.string().describe("Result ID to explain"),
  },
  async ({ resultId }) => {
    try {
      const { explainFailure } = await import("../lib/failure-explainer.js");
      const explanation = explainFailure(resultId);
      return json(explanation);
    } catch (e) {
      return errorResponse(e);
    }
  },
);

// ─── 51. run_for_diff ────────────────────────────────────────────────────────

server.tool(
  "run_for_diff",
  "Run only scenarios relevant to changed files — auto-detects from git diff",
  {
    url: z.string().optional().describe("Target URL to test against (omit if using env)"),
    env: z.string().optional().describe("Named environment to use for the URL"),
    baseRef: z.string().optional().default("HEAD").describe("Git ref to diff against (default: HEAD)"),
    projectId: z.string().optional().describe("Filter scenarios to this project"),
    model: z.string().optional().describe(MODEL_DESC),
    parallel: z.number().optional().describe("Number of parallel workers"),
  },
  async ({ url, env, baseRef, projectId, model, parallel }) => {
    try {
      // Resolve URL
      let resolvedUrl = url;
      if (!resolvedUrl && env) {
        const { getEnvironment } = await import("../db/environments.js");
        const environment = getEnvironment(env);
        if (!environment) return errorResponse(notFoundErr(env, "Environment"));
        resolvedUrl = environment.url;
      }
      if (!resolvedUrl) {
        const { getDefaultEnvironment } = await import("../db/environments.js");
        const defaultEnv = getDefaultEnvironment();
        if (defaultEnv) resolvedUrl = defaultEnv.url;
      }
      if (!resolvedUrl) return errorResponse(new Error("No URL provided and no default environment set. Pass url or env."));

      // Detect changed files from git diff
      const { execSync } = await import("child_process");
      let diffOutput = "";
      try {
        const ref = baseRef ?? "HEAD";
        const stagedOut = execSync(`git diff --cached --name-only`, { cwd: process.cwd(), encoding: "utf-8" }).trim();
        const unstagedOut = execSync(`git diff --name-only ${ref}`, { cwd: process.cwd(), encoding: "utf-8" }).trim();
        diffOutput = [stagedOut, unstagedOut].filter(Boolean).join("\n");
      } catch {
        return json({ skipped: true, reason: "git diff failed — not a git repository or git not available" });
      }

      if (!diffOutput.trim()) {
        return json({ skipped: true, reason: "No changed files detected in git diff" });
      }

      const filePaths = [...new Set(diffOutput.split("\n").filter(Boolean))];

      // Match files to scenarios
      const allScenarios = listScenarios({ projectId });
      const matched = matchFilesToScenarios(filePaths, allScenarios, []);

      if (matched.length === 0) {
        return json({ skipped: true, reason: "No scenarios match changed files", changedFiles: filePaths });
      }

      const { runId, scenarioCount } = startRunAsync({
        url: resolvedUrl,
        scenarioIds: matched.map((s) => s.id),
        model,
        parallel,
        projectId,
      });

      const matchedFiles = filePaths.filter((f) =>
        matched.some((s) => s.targetPath && f.includes(s.targetPath.replace(/^\//, "")))
      );

      return json({
        runId,
        scenarioCount,
        changedFiles: filePaths,
        matchedFiles,
        url: resolvedUrl,
        status: "running",
        matchedScenarios: matched.map((s) => ({ id: s.id, shortId: s.shortId, name: s.name, tags: s.tags })),
        message: "Poll with get_run to check progress.",
      });
    } catch (error) {
      return errorResponse(error);
    }
  },
);

// ─── 52. estimate_run_cost ───────────────────────────────────────────────────

server.tool(
  "estimate_run_cost",
  "Estimate the cost in cents of running a set of scenarios before actually running them",
  {
    scenarioIds: z.array(z.string()).optional().describe("Specific scenario IDs to estimate (default: all matching tags/projectId)"),
    tags: z.array(z.string()).optional().describe("Filter scenarios by tags"),
    projectId: z.string().optional().describe("Filter by project ID"),
    model: z.string().optional().describe(MODEL_DESC),
    samples: z.number().int().min(1).optional().default(1).describe("Number of samples per scenario (for flakiness testing)"),
  },
  async ({ scenarioIds, tags, projectId, model, samples }) => {
    try {
      const { estimateRunCostCents } = await import("../lib/costs.js");
      const { resolveModel } = await import("../lib/ai-client.js");
      const { loadConfig } = await import("../lib/config.js");
      const config = loadConfig();
      const resolvedModel = resolveModel(model ?? config.defaultModel);

      let scenarios;
      if (scenarioIds && scenarioIds.length > 0) {
        const allScenarios = listScenarios({ projectId });
        scenarios = allScenarios.filter((s) => scenarioIds.includes(s.id) || scenarioIds.includes(s.shortId));
      } else {
        scenarios = listScenarios({ tags, projectId });
      }

      const count = scenarios.length;
      const resolvedSamples = samples ?? 1;
      const totalCents = estimateRunCostCents(count, resolvedModel, resolvedSamples);

      return json({
        scenarioCount: count,
        model: resolvedModel,
        samples: resolvedSamples,
        estimatedCostCents: totalCents,
        estimatedCostDollars: (totalCents / 100).toFixed(4),
        perScenarioCents: count > 0 ? totalCents / count : 0,
        scenarios: scenarios.map((s) => ({ id: s.id, shortId: s.shortId, name: s.name })),
      });
    } catch (e) {
      return errorResponse(e);
    }
  },
);

// ─── 53. get_run_insight ─────────────────────────────────────────────────────

server.tool(
  "get_run_insight",
  "Get a structured insight summary for a run — failure type breakdown, likely cause, and recommended action",
  {
    runId: z.string().describe("Run ID to analyze"),
  },
  async ({ runId }) => {
    try {
      const run = getRun(runId);
      if (!run) return errorResponse(notFoundErr(runId, "Run"));
      const results = getResultsByRun(runId);

      // Group failures by type
      const failureGroups: Record<string, { count: number; examples: string[] }> = {};
      for (const r of results.filter((r) => r.status !== "passed" && r.status !== "skipped")) {
        const type = (r.failureAnalysis?.type as string) ?? "unknown";
        if (!failureGroups[type]) failureGroups[type] = { count: 0, examples: [] };
        failureGroups[type]!.count++;
        if (failureGroups[type]!.examples.length < 3) {
          failureGroups[type]!.examples.push(r.scenarioId.slice(0, 8) + (r.error ? `: ${r.error.slice(0, 80)}` : ""));
        }
      }

      const blockingIssues = Object.entries(failureGroups).map(([type, data]) => ({
        type,
        count: data.count,
        examples: data.examples,
      })).sort((a, b) => b.count - a.count);

      const dominantType = blockingIssues[0]?.type ?? "unknown";
      const allSameType = blockingIssues.length === 1;
      const likelyCause = allSameType
        ? `All failures are ${dominantType.replace(/_/g, " ")}`
        : `Mixed failure types (most common: ${dominantType.replace(/_/g, " ")})`;

      const ACTION_MAP: Record<string, string> = {
        selector_not_found: "Check for recent UI changes that may have renamed or removed elements",
        timeout: "Check app responsiveness and consider increasing timeout",
        auth_error: "Verify the auth flow and credentials are working",
        network_error: "Verify the app is running and accessible at the URL",
        assertion_failed: "Review recent code changes that may have altered the expected output",
        eval_failed: "Review scenario evaluation criteria for ambiguity",
        unknown: "Review full error messages and app logs for more context",
      };

      const recommendedAction = ACTION_MAP[dominantType] ?? ACTION_MAP.unknown!;

      // Quick fix hint
      const selectorFailure = blockingIssues.find((b) => b.type === "selector_not_found");
      const failedResult = results.find((r) => r.failureAnalysis?.type === "selector_not_found");
      const quickFix = selectorFailure && failedResult?.failureAnalysis?.affectedElement
        ? `Update selector "${failedResult.failureAnalysis.affectedElement}" — it was not found during the run`
        : undefined;

      return json({
        runId,
        status: run.status,
        passed: run.passed,
        failed: run.failed,
        total: run.total,
        blockingIssues,
        likelyCause,
        recommendedAction,
        quickFix,
      });
    } catch (e) {
      return errorResponse(e);
    }
  },
);

// ─── 54. get_scenario_coverage ───────────────────────────────────────────────

server.tool(
  "get_scenario_coverage",
  "Check which changed files have scenario coverage and which don't",
  {
    filePaths: z.array(z.string()).describe("File paths to check coverage for"),
    projectId: z.string().optional().describe("Filter scenarios by project ID"),
    includeAutoDetect: z.boolean().optional().describe("Also check git diff HEAD for changed files"),
  },
  async ({ filePaths, projectId, includeAutoDetect }) => {
    try {
      let allFiles = [...filePaths];

      if (includeAutoDetect) {
        try {
          const { execSync } = await import("child_process");
          const diffOutput = execSync("git diff --name-only HEAD", { encoding: "utf-8", cwd: process.cwd() }).trim();
          const gitFiles = diffOutput.split("\n").filter(Boolean);
          allFiles = [...new Set([...allFiles, ...gitFiles])];
        } catch {
          // git diff failed — continue with provided files only
        }
      }

      const allScenarios = listScenarios({ projectId });
      const covered: Array<{ file: string; scenarios: Array<{ id: string; shortId: string; name: string }> }> = [];
      const uncovered: string[] = [];

      for (const file of allFiles) {
        const matched = matchFilesToScenarios([file], allScenarios, []);
        if (matched.length > 0) {
          covered.push({ file, scenarios: matched.map((s) => ({ id: s.id, shortId: s.shortId, name: s.name })) });
        } else {
          uncovered.push(file);
        }
      }

      const coverageRate = allFiles.length > 0 ? covered.length / allFiles.length : 0;
      const recommendation = uncovered.length === 0
        ? "All changed files have scenario coverage."
        : `${uncovered.length} file(s) have no coverage. Consider adding scenarios for: ${uncovered.slice(0, 3).join(", ")}${uncovered.length > 3 ? "..." : ""}`;

      return json({
        summary: { total: allFiles.length, covered: covered.length, uncovered: uncovered.length, coverageRate: Math.round(coverageRate * 100) },
        covered,
        uncovered,
        recommendation,
      });
    } catch (e) {
      return errorResponse(e);
    }
  },
);

// ─── 55. run_matrix ──────────────────────────────────────────────────────────

server.tool(
  "run_matrix",
  "Run scenarios × personas matrix — tests each scenario under each persona and returns divergence analysis",
  {
    url: z.string().describe("Target URL to test against"),
    scenarioIds: z.array(z.string()).optional().describe("Scenario IDs to include (default: all)"),
    personaIds: z.array(z.string()).optional().describe("Persona IDs to test with (default: all global personas)"),
    model: z.string().optional().describe(MODEL_DESC),
    parallel: z.number().optional().default(2).describe("Parallel workers per persona run (default 2)"),
    projectId: z.string().optional().describe("Filter scenarios/personas by project ID"),
  },
  async ({ url, scenarioIds, personaIds, model, parallel, projectId }) => {
    try {
      // Resolve scenarios
      let scenarios;
      if (scenarioIds && scenarioIds.length > 0) {
        const all = listScenarios({ projectId });
        scenarios = all.filter((s) => scenarioIds.includes(s.id) || scenarioIds.includes(s.shortId));
      } else {
        scenarios = listScenarios({ projectId, limit: 20 });
      }
      if (scenarios.length === 0) return json({ runs: [], message: "No scenarios found." });

      // Resolve personas
      let personas;
      if (personaIds && personaIds.length > 0) {
        personas = personaIds.map((id) => getPersona(id)).filter(Boolean);
      } else {
        personas = listPersonas({ globalOnly: true, enabled: true });
      }
      if (personas.length === 0) return json({ runs: [], message: "No personas found. Seed defaults with persona seed command." });

      // Run each persona sequentially (scenarios in parallel within each)
      const matrixResults: Array<{
        personaId: string;
        personaName: string;
        runId: string;
        passed: number;
        failed: number;
        total: number;
      }> = [];

      for (const persona of personas) {
        if (!persona) continue;
        const { runId, scenarioCount } = startRunAsync({
          url,
          scenarioIds: scenarios.map((s) => s.id),
          model,
          parallel: parallel ?? 2,
          projectId,
          personaId: persona.id,
        });
        matrixResults.push({
          personaId: persona.id,
          personaName: persona.name,
          runId,
          passed: 0,
          failed: 0,
          total: scenarioCount,
        });
      }

      return json({
        matrix: matrixResults,
        scenarioCount: scenarios.length,
        personaCount: personas.length,
        totalRuns: matrixResults.length,
        message: `Started ${matrixResults.length} runs (${scenarios.length} scenarios × ${personas.length} personas). Poll each runId with get_run.`,
      });
    } catch (e) {
      return errorResponse(e);
    }
  },
);

// ─── 56. duplicate_scenario_for_persona ──────────────────────────────────────

server.tool(
  "duplicate_scenario_for_persona",
  "Clone a scenario with a persona attached. The duplicate name gets the persona name as a suffix.",
  {
    scenarioId: z.string().describe("Scenario ID or short ID to clone"),
    personaId: z.string().describe("Persona ID or short ID to attach"),
    nameSuffix: z.string().optional().describe("Custom name suffix (default: persona name)"),
  },
  async ({ scenarioId, personaId, nameSuffix }) => {
    try {
      const scenario = getScenario(scenarioId) ?? getScenarioByShortId(scenarioId);
      if (!scenario) return errorResponse(notFoundErr(scenarioId, "Scenario"));

      const persona = getPersona(personaId);
      if (!persona) return errorResponse(notFoundErr(personaId, "Persona"));

      const suffix = nameSuffix ?? persona.name;
      const clone = createScenario({
        name: `${scenario.name} [${suffix}]`,
        description: scenario.description,
        steps: scenario.steps,
        tags: [...scenario.tags, "persona-variant"],
        priority: scenario.priority,
        model: scenario.model ?? undefined,
        targetPath: scenario.targetPath ?? undefined,
        requiresAuth: scenario.requiresAuth,
        authConfig: scenario.authConfig ?? undefined,
        assertions: scenario.assertions,
        metadata: { ...scenario.metadata, clonedFrom: scenario.id },
        projectId: scenario.projectId ?? undefined,
        personaId: persona.id,
      });

      return json({ ...clone, attachedPersona: persona, clonedFrom: scenario.id });
    } catch (e) {
      return errorResponse(e);
    }
  },
);

// ─── 57. create_persona_test_matrix ──────────────────────────────────────────

server.tool(
  "create_persona_test_matrix",
  "Create N×M scenario clones — one per (scenario, persona) combination",
  {
    scenarioIds: z.array(z.string()).describe("Scenario IDs to clone"),
    personaIds: z.array(z.string()).describe("Persona IDs to attach"),
    tagPrefix: z.string().optional().default("matrix").describe("Tag prefix for generated scenarios"),
  },
  async ({ scenarioIds, personaIds, tagPrefix }) => {
    try {
      const created: Array<{ scenarioId: string; personaId: string; name: string; shortId: string }> = [];

      for (const scenarioId of scenarioIds) {
        const scenario = getScenario(scenarioId) ?? getScenarioByShortId(scenarioId);
        if (!scenario) continue;

        for (const personaId of personaIds) {
          const persona = getPersona(personaId);
          if (!persona) continue;

          const clone = createScenario({
            name: `${scenario.name} [${persona.name}]`,
            description: scenario.description,
            steps: scenario.steps,
            tags: [...scenario.tags, tagPrefix ?? "matrix", "persona-variant"],
            priority: scenario.priority,
            model: scenario.model ?? undefined,
            targetPath: scenario.targetPath ?? undefined,
            requiresAuth: scenario.requiresAuth,
            authConfig: scenario.authConfig ?? undefined,
            assertions: scenario.assertions,
            metadata: { ...scenario.metadata, clonedFrom: scenario.id, matrixPersonaId: persona.id },
            projectId: scenario.projectId ?? undefined,
            personaId: persona.id,
          });

          created.push({ scenarioId: clone.id, personaId: persona.id, name: clone.name, shortId: clone.shortId });
        }
      }

      return json({
        created,
        total: created.length,
        message: `Created ${created.length} scenario variants (${scenarioIds.length} scenarios × ${personaIds.length} personas).`,
      });
    } catch (e) {
      return errorResponse(e);
    }
  },
);

// ─── 58. create_scenario_from_error ──────────────────────────────────────────

server.tool(
  "create_scenario_from_error",
  "Create a regression scenario from a bug report or error message",
  {
    url: z.string().describe("URL where the error occurred"),
    error: z.string().describe("Error message or bug description"),
    context: z.string().optional().describe("Additional context about the error"),
    projectId: z.string().optional().describe("Project ID"),
    autoRun: z.boolean().optional().describe("Start a run immediately after creating the scenario"),
  },
  async ({ url, error, context, projectId, autoRun }) => {
    try {
      const name = `Regression: ${error.slice(0, 50)}${error.length > 50 ? "..." : ""}`;
      const steps = [
        `Navigate to ${url}`,
        "Verify no errors occur on the page",
        "Check that the reported issue is resolved",
        ...(context ? [`Context: ${context}`] : []),
      ];

      const scenario = createScenario({
        name,
        description: `Regression test for: ${error}${context ? `\n\nContext: ${context}` : ""}`,
        steps,
        tags: ["regression", "error"],
        priority: "high",
        targetPath: new URL(url).pathname !== "/" ? new URL(url).pathname : undefined,
        projectId,
      });

      let runInfo = null;
      if (autoRun) {
        const { runId, scenarioCount } = startRunAsync({ url, scenarioIds: [scenario.id], projectId });
        runInfo = { runId, scenarioCount };
      }

      return json({ scenario, runInfo, message: autoRun ? "Scenario created and run started." : "Scenario created. Use run_scenarios to run it." });
    } catch (e) {
      return errorResponse(e);
    }
  },
);

// ─── 59. get_har ──────────────────────────────────────────────────────────────

server.tool(
  "get_har",
  `Get HAR (HTTP Archive) file for a test result. Returns metadata by default, or full HAR content when includeContent is true. Useful for debugging network requests, API calls, and CORS issues. ${ID_DESC}`,
  {
    resultId: z.string().describe(`Result ID. ${ID_DESC}`),
    includeContent: z.boolean().optional().describe("Return full HAR JSON content (default: false)"),
  },
  async ({ resultId, includeContent }) => {
    try {
      const result = getResult(resultId);
      if (!result) return errorResponse(notFoundErr(resultId, "Result"));

      const harPath = (result as { harPath?: string | null }).harPath ?? (result.metadata as { harPath?: string } | null)?.harPath;
      if (!harPath) return json({ resultId, harAvailable: false, message: "No HAR file recorded for this result." });

      const harFile = Bun.file(harPath);
      const exists = await harFile.exists();
      if (!exists) return json({ resultId, harPath, harAvailable: false, message: "HAR file was recorded but has been cleaned up." });

      if (!includeContent) {
        const size = await harFile.size();
        return json({ resultId, harPath, harAvailable: true, sizeBytes: size, message: "HAR file available. Use includeContent: true to retrieve." });
      }

      const harContent = await harFile.text();
      return json({ resultId, harPath, harAvailable: true, har: JSON.parse(harContent) });
    } catch (e) {
      return errorResponse(e);
    }
  },
);

// ─── Cloud ────────────────────────────────────────────────────────────────────

registerCloudTools(server, "testers");

// ─── Connect ─────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start testers:", error);
  process.exit(1);
});
