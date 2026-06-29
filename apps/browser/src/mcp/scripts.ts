// ─── Script and dataset tools ────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { clampLimit, compactList, truncateText } from "./compact.js";
import {
  registerTool,
  z,
  json,
  err,
  resolveSessionId,
  createSession,
  getSessionPage,
} from "./helpers.js";
import type { BrowserEngine } from "./helpers.js";

export function register(server: McpServer) {

// ── Scripts (browser + connector + AI steps, SQLite-backed) ──────────────────

registerTool(server,
  "browser_script_run",
  "Run a saved script asynchronously. Returns run_id immediately — poll with browser_script_status for step-by-step progress. Scripts combine browser actions + connector calls + AI reasoning. Works with any engine (Bun.WebView, Playwright, CDP).",
  {
    name: z.string().describe("Script name"),
    session_id: z.string().optional(),
    engine: z.enum(["playwright", "cdp", "lightpanda", "bun", "tui", "kernel", "auto"]).optional().default("auto"),
    variables: z.record(z.string()).optional().describe("Override script variables"),
  },
  async ({ name, session_id, engine, variables }) => {
    try {
      const { getScriptByName, migrateJsonScripts, getSteps } = await import("../db/scripts.js");
      const { executeScript } = await import("../lib/script-engine.js");

      // Auto-migrate JSON scripts on first use
      migrateJsonScripts();

      const script = getScriptByName(name);
      if (!script) return err(new Error(`Script '${name}' not found. Use browser_script_list to see available scripts.`));

      let sid: string;
      let page: import("playwright").Page;
      if (session_id) {
        sid = resolveSessionId(session_id);
        page = getSessionPage(sid);
      } else {
        const result = await createSession({ engine: (engine ?? "auto") as BrowserEngine, headless: true });
        sid = result.session.id;
        page = result.page;
      }

      const steps = getSteps(script.id);
      const runId = executeScript(script.id, page, variables ?? {});
      return json({ run_id: runId, session_id: sid, script: name, total_steps: steps.length, message: "Script running. Poll with browser_script_status." });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_script_status",
  "Check progress of a running script. Shows current step, step-by-step log with durations, and final result when complete.",
  { run_id: z.string(), verbose: z.boolean().optional().default(false), limit: z.number().optional().default(25) },
  async ({ run_id, verbose, limit }) => {
    try {
      const rowLimit = clampLimit(limit, 25);
      const { getRun } = await import("../db/scripts.js");
      const run = getRun(run_id);
      if (!run) return err(new Error(`Run '${run_id}' not found`));
      const stepsLog = verbose ? run.steps_log : run.steps_log.slice(0, rowLimit).map((step) => ({
        step: step.step,
        type: step.type,
        status: step.status,
        duration_ms: step.duration_ms,
        description: truncateText(step.description, 120),
        error: truncateText(step.error, 160) || undefined,
      }));
      return json({
        status: run.status,
        progress: `${run.current_step}/${run.total_steps}`,
        current_step: truncateText(run.current_description, verbose ? 500 : 160),
        steps_log: stepsLog,
        steps_log_truncated: !verbose && run.steps_log.length > rowLimit,
        limit: rowLimit,
        errors: run.errors.length > 0 ? run.errors.map((error) => truncateText(error, verbose ? 1000 : 200)) : undefined,
        duration_ms: run.duration_ms,
        completed: run.completed_at,
        hint: !verbose && run.steps_log.length > rowLimit ? "Set verbose=true or a larger limit for the full step log." : undefined,
      });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_script_list",
  "List saved scripts. Compact by default; set verbose=true for longer descriptions.",
  { limit: z.number().optional().default(25), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ limit, offset, verbose }) => {
    try {
      const { listScripts, migrateJsonScripts } = await import("../db/scripts.js");
      migrateJsonScripts();
      const scripts = listScripts();
      if (verbose) {
        const page = compactList(scripts, limit, (script) => script, { offset });
        return json({ scripts: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(scripts, limit, (script) => ({
        name: script.name,
        domain: script.domain,
        description: truncateText(script.description, 120),
        run_count: script.run_count,
        last_run: script.last_run,
      }), {
        offset,
        hint: "Call browser_script_run by name, or use CLI `browser script show <name>` for step details.",
      });
      return json({ scripts: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_script_save",
  "Save a script. Steps are stored in SQLite. Each step has a type (browser/connector/extract/wait/condition/save_state), config, and optional AI config for intelligent fallbacks.",
  {
    name: z.string(),
    domain: z.string().optional().default(""),
    description: z.string().optional().default(""),
    variables: z.record(z.string()).optional().default({}),
    steps: z.array(z.object({
      type: z.enum(["browser", "connector", "extract", "wait", "condition", "save_state"]),
      config: z.record(z.unknown()).default({}),
      description: z.string().optional().default(""),
      ai_enabled: z.boolean().optional().default(false),
      ai_config: z.record(z.unknown()).optional().default({}),
    })),
  },
  async ({ name, domain, description, variables, steps }) => {
    try {
      const { upsertScript, getSteps } = await import("../db/scripts.js");
      const script = upsertScript({ name, domain, description, variables, steps });
      const savedSteps = getSteps(script.id);
      return json({ id: script.id, name: script.name, steps: savedSteps.length });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_script_delete",
  "Delete a saved script",
  { name: z.string() },
  async ({ name }) => {
    try {
      const { deleteScriptByName } = await import("../db/scripts.js");
      return json({ deleted: deleteScriptByName(name) });
    } catch (e) { return err(e); }
  }
);

// ── Data Extraction Tools ────────────────────────────────────────────────────

registerTool(server,
  "browser_detect_apis",
  "Scan network traffic for JSON API endpoints. Returns discovered endpoints with methods, status codes, and URLs.",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const { detectAPIs } = await import("../lib/api-detector.js");
      const apis = detectAPIs(sid);
      return json({ apis, count: apis.length });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_dataset_save",
  "Save extracted data as a named dataset for later use",
  { name: z.string(), data: z.array(z.record(z.unknown())), source_url: z.string().optional() },
  async ({ name, data, source_url }) => {
    try {
      const { saveDataset } = await import("../lib/datasets.js");
      const dataset = saveDataset({ name, rows: data, sourceUrl: source_url });
      return json({ id: dataset.id, name: dataset.name, row_count: dataset.row_count });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_dataset_list",
  "List saved datasets. Compact by default; export one dataset for full rows.",
  { limit: z.number().optional().default(25), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ limit, offset, verbose }) => {
    try {
      const { listDatasets } = await import("../lib/datasets.js");
      const datasets = listDatasets();
      if (verbose) {
        const page = compactList(datasets, limit, (dataset: any) => dataset, { offset });
        return json({ datasets: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(datasets, limit, (dataset: any) => ({
        id: dataset.id,
        name: dataset.name,
        row_count: dataset.row_count,
        source_url: truncateText(dataset.source_url, 140) || undefined,
        created_at: dataset.created_at,
      }), {
        offset,
        hint: "Use verbose=true for metadata or browser_dataset_export for full dataset rows.",
      });
      return json({ datasets: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_dataset_export",
  "Export a dataset as JSON or CSV file",
  { name: z.string(), format: z.enum(["json", "csv"]).optional().default("json") },
  async ({ name, format }) => {
    try {
      const { exportDataset } = await import("../lib/datasets.js");
      return json(exportDataset(name, format));
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_dataset_delete",
  "Delete a saved dataset",
  { name: z.string() },
  async ({ name }) => {
    try {
      const { deleteDataset } = await import("../lib/datasets.js");
      return json({ deleted: deleteDataset(name) });
    } catch (e) { return err(e); }
  }
);

} // end register
