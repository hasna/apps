#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createScenario, getScenario, getScenarioByShortId, listScenarios, updateScenario, deleteScenario } from "../db/scenarios.js";
import { getRun, listRuns } from "../db/runs.js";
import { listResults } from "../db/results.js";
import { listScreenshots } from "../db/screenshots.js";
import { createProject, ensureProject, listProjects } from "../db/projects.js";
import { registerAgent, listAgents } from "../db/agents.js";
import { runByFilter } from "../lib/runner.js";
import { loadConfig } from "../lib/config.js";
import { importFromTodos } from "../lib/todos-connector.js";
import { createSchedule, listSchedules, updateSchedule, deleteSchedule } from "../db/schedules.js";
import { getNextRunTime } from "../lib/scheduler.js";
import { getDatabase } from "../db/database.js";

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
    model: z.string().optional().describe("AI model to use"),
    targetPath: z.string().optional().describe("URL path to navigate to"),
    requiresAuth: z.boolean().optional().describe("Whether scenario requires authentication"),
  },
  async ({ name, description, steps, tags, priority, model, targetPath, requiresAuth }) => {
    try {
      const scenario = createScenario({ name, description, steps, tags, priority, model, targetPath, requiresAuth });
      return { content: [{ type: "text" as const, text: `Created scenario ${scenario.shortId}: "${scenario.name}" (id: ${scenario.id})` }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
    }
  },
);

// ─── 2. get_scenario ─────────────────────────────────────────────────────────

server.tool(
  "get_scenario",
  "Get a scenario by ID or short ID",
  {
    id: z.string().describe("Scenario ID or short ID"),
  },
  async ({ id }) => {
    try {
      const scenario = getScenario(id) ?? getScenarioByShortId(id);
      if (!scenario) {
        return { content: [{ type: "text" as const, text: `ScenarioNotFoundError: Scenario not found: ${id}` }], isError: true };
      }
      const text = [
        `Scenario: ${scenario.name} (${scenario.shortId})`,
        `ID: ${scenario.id}`,
        `Description: ${scenario.description}`,
        `Priority: ${scenario.priority}`,
        `Tags: ${scenario.tags.join(", ") || "none"}`,
        `Steps: ${scenario.steps.length > 0 ? "\n  " + scenario.steps.map((s, i) => `${i + 1}. ${s}`).join("\n  ") : "none"}`,
        `Model: ${scenario.model ?? "default"}`,
        `Target path: ${scenario.targetPath ?? "none"}`,
        `Requires auth: ${scenario.requiresAuth}`,
        `Version: ${scenario.version}`,
        `Created: ${scenario.createdAt}`,
        `Updated: ${scenario.updatedAt}`,
      ].join("\n");
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
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
      if (scenarios.length === 0) {
        return { content: [{ type: "text" as const, text: "No scenarios found." }] };
      }
      const lines = scenarios.map((s) =>
        `[${s.shortId}] ${s.name} — ${s.priority} — tags: ${s.tags.join(", ") || "none"}`
      );
      return { content: [{ type: "text" as const, text: `${scenarios.length} scenario(s):\n${lines.join("\n")}` }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
    }
  },
);

// ─── 4. update_scenario ──────────────────────────────────────────────────────

server.tool(
  "update_scenario",
  "Update an existing scenario (requires version for optimistic locking)",
  {
    id: z.string().describe("Scenario ID or short ID"),
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
      return { content: [{ type: "text" as const, text: `Updated scenario ${scenario.shortId}: "${scenario.name}" (version: ${scenario.version})` }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
    }
  },
);

// ─── 5. delete_scenario ──────────────────────────────────────────────────────

server.tool(
  "delete_scenario",
  "Delete a scenario by ID",
  {
    id: z.string().describe("Scenario ID or short ID"),
  },
  async ({ id }) => {
    try {
      const deleted = deleteScenario(id);
      if (!deleted) {
        return { content: [{ type: "text" as const, text: `ScenarioNotFoundError: Scenario not found: ${id}` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: `Deleted scenario: ${id}` }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
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
    model: z.string().optional().describe("AI model to use"),
    headed: z.boolean().optional().describe("Run browser in headed mode"),
    parallel: z.number().optional().describe("Number of parallel workers"),
  },
  async ({ url, tags, scenarioIds, priority, model, headed, parallel }) => {
    try {
      const { run, results } = await runByFilter({ url, tags, scenarioIds, priority, model, headed, parallel });
      const passed = results.filter((r) => r.status === "passed").length;
      const failed = results.filter((r) => r.status === "failed" || r.status === "error").length;
      const skipped = results.filter((r) => r.status === "skipped").length;
      const text = [
        `Run ${run.id} — ${run.status}`,
        `URL: ${run.url}`,
        `Total: ${results.length} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`,
        `Model: ${run.model}`,
        `Started: ${run.startedAt}`,
        run.finishedAt ? `Finished: ${run.finishedAt}` : null,
      ].filter(Boolean).join("\n");
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
    }
  },
);

// ─── 7. get_run ──────────────────────────────────────────────────────────────

server.tool(
  "get_run",
  "Get details of a test run",
  {
    id: z.string().describe("Run ID"),
  },
  async ({ id }) => {
    try {
      const run = getRun(id);
      if (!run) {
        return { content: [{ type: "text" as const, text: `RunNotFoundError: Run not found: ${id}` }], isError: true };
      }
      const text = [
        `Run: ${run.id}`,
        `Status: ${run.status}`,
        `URL: ${run.url}`,
        `Model: ${run.model}`,
        `Total: ${run.total} | Passed: ${run.passed} | Failed: ${run.failed}`,
        `Parallel: ${run.parallel} | Headed: ${run.headed}`,
        `Started: ${run.startedAt}`,
        run.finishedAt ? `Finished: ${run.finishedAt}` : "Finished: in progress",
      ].join("\n");
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
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
      if (runs.length === 0) {
        return { content: [{ type: "text" as const, text: "No runs found." }] };
      }
      const lines = runs.map((r) =>
        `[${r.id.slice(0, 8)}] ${r.status} — ${r.total} scenarios — ${r.passed} passed, ${r.failed} failed — ${r.startedAt}`
      );
      return { content: [{ type: "text" as const, text: `${runs.length} run(s):\n${lines.join("\n")}` }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
    }
  },
);

// ─── 9. get_results ──────────────────────────────────────────────────────────

server.tool(
  "get_results",
  "Get test results for a run",
  {
    runId: z.string().describe("Run ID"),
  },
  async ({ runId }) => {
    try {
      const results = listResults(runId);
      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: `No results found for run: ${runId}` }] };
      }
      const lines = results.map((r) =>
        `[${r.status}] scenario:${r.scenarioId.slice(0, 8)} — ${r.stepsCompleted}/${r.stepsTotal} steps — ${r.durationMs}ms — ${r.model}${r.error ? ` — error: ${r.error}` : ""}`
      );
      return { content: [{ type: "text" as const, text: `${results.length} result(s) for run ${runId.slice(0, 8)}:\n${lines.join("\n")}` }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
    }
  },
);

// ─── 10. get_screenshots ─────────────────────────────────────────────────────

server.tool(
  "get_screenshots",
  "Get screenshots for a test result",
  {
    resultId: z.string().describe("Result ID"),
  },
  async ({ resultId }) => {
    try {
      const screenshots = listScreenshots(resultId);
      if (screenshots.length === 0) {
        return { content: [{ type: "text" as const, text: `No screenshots found for result: ${resultId}` }] };
      }
      const lines = screenshots.map((s) =>
        `Step ${s.stepNumber}: ${s.action} — ${s.width}x${s.height} — ${s.filePath}`
      );
      return { content: [{ type: "text" as const, text: `${screenshots.length} screenshot(s):\n${lines.join("\n")}` }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
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
      return { content: [{ type: "text" as const, text: `Project "${project.name}" registered (id: ${project.id})` }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
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
      if (projects.length === 0) {
        return { content: [{ type: "text" as const, text: "No projects registered." }] };
      }
      const lines = projects.map((p) =>
        `[${p.id.slice(0, 8)}] ${p.name}${p.path ? ` — ${p.path}` : ""}${p.description ? ` — ${p.description}` : ""}`
      );
      return { content: [{ type: "text" as const, text: `${projects.length} project(s):\n${lines.join("\n")}` }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
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
      return { content: [{ type: "text" as const, text: `Agent "${agent.name}" registered (id: ${agent.id})` }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
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
      if (agents.length === 0) {
        return { content: [{ type: "text" as const, text: "No agents registered." }] };
      }
      const lines = agents.map((a) =>
        `[${a.id.slice(0, 8)}] ${a.name}${a.role ? ` (${a.role})` : ""} — last seen: ${a.lastSeenAt}`
      );
      return { content: [{ type: "text" as const, text: `${agents.length} agent(s):\n${lines.join("\n")}` }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
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
      return { content: [{ type: "text" as const, text: `Imported ${result.imported} scenario(s), skipped ${result.skipped} duplicate(s)` }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
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
      const text = [
        `DB: ${process.env["TESTERS_DB_PATH"] || "~/.testers/testers.db"}`,
        `API key: ${hasApiKey ? "configured" : "not set"}`,
        `Scenarios: ${scenarioCount}`,
        `Runs: ${runCount}`,
        `Default model: ${config.defaultModel}`,
      ].join("\n");
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      return { content: [{ type: "text" as const, text: `${e.name}: ${e.message}` }], isError: true };
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
    model: z.string().optional().describe("AI model"),
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
      return { content: [{ type: "text" as const, text: `Schedule created: ${schedule.id.slice(0, 8)} | ${schedule.name} | cron: ${schedule.cronExpression} | next: ${nextRun.toISOString()}` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
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
    const schedules = listSchedules({ projectId: params.projectId, enabled: params.enabled, limit: params.limit });
    if (schedules.length === 0) return { content: [{ type: "text" as const, text: "No schedules found." }] };
    const lines = schedules.map((s) =>
      `${s.id.slice(0, 8)} | ${s.name} | ${s.cronExpression} | ${s.url} | ${s.enabled ? "enabled" : "disabled"} | next: ${s.nextRunAt ?? "N/A"}`
    );
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

server.tool(
  "enable_schedule",
  { id: z.string().describe("Schedule ID") },
  async (params) => {
    try {
      const schedule = updateSchedule(params.id, { enabled: true });
      return { content: [{ type: "text" as const, text: `Schedule ${schedule.name} enabled.` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.tool(
  "disable_schedule",
  { id: z.string().describe("Schedule ID") },
  async (params) => {
    try {
      const schedule = updateSchedule(params.id, { enabled: false });
      return { content: [{ type: "text" as const, text: `Schedule ${schedule.name} disabled.` }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.tool(
  "delete_schedule",
  { id: z.string().describe("Schedule ID") },
  async (params) => {
    try {
      const deleted = deleteSchedule(params.id);
      return { content: [{ type: "text" as const, text: deleted ? "Schedule deleted." : "Schedule not found." }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
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
