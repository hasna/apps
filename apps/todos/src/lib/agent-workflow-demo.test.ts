import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import {
  AGENT_WORKFLOW_DEMO_SCHEMA,
  DEMO_DEFAULT_AGENT,
  DEMO_DEFAULT_PROJECT,
  DEMO_PROJECT_PATH,
  runAgentWorkflowDemo,
  normalizeAgentWorkflowDemoResult,
  formatAgentWorkflowDemoReport,
  getAgentWorkflowDemoDocs,
  setupEphemeralDemoDb,
} from "./agent-workflow-demo.js";
import { resetAgentAdapterCache } from "./agent-run-dispatcher.js";

const FIXED_AT = "2026-01-01T00:00:00.000Z";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-workflow-demo-"));
  process.env["TODOS_DB_PATH"] = ":memory:";
  process.env["TODOS_AGENT_ADAPTERS_PATH"] = join(tempDir, "adapters.json");
  resetDatabase();
  resetAgentAdapterCache();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  resetDatabase();
  resetAgentAdapterCache();
  delete process.env["TODOS_DB_PATH"];
  delete process.env["TODOS_AGENT_ADAPTERS_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("agent workflow demo", () => {
  it("runs full local workflow in provided db", () => {
    const db = getDatabase();
    const result = runAgentWorkflowDemo({
      db,
      ephemeral: false,
      agent_name: DEMO_DEFAULT_AGENT,
      project_name: DEMO_DEFAULT_PROJECT,
      project_path: DEMO_PROJECT_PATH,
      exported_at: FIXED_AT,
    });

    expect(result.schema_version).toBe(AGENT_WORKFLOW_DEMO_SCHEMA);
    expect(result.agent.name).toBe(DEMO_DEFAULT_AGENT);
    expect(result.project.name).toBe(DEMO_DEFAULT_PROJECT);
    expect(result.project.path).toBe(DEMO_PROJECT_PATH);
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks.every((t) => t.status === "completed")).toBe(true);
    expect(result.agent_run.status).toBe("completed");
    expect(result.run_record.status).toBe("completed");
    expect(result.status_summary.completed).toBe(3);
    expect(result.status_summary.pending).toBe(0);
    expect(result.steps.length).toBeGreaterThanOrEqual(10);
    expect(result.completed_at).toBe(FIXED_AT);
  });

  it("uses ephemeral in-memory db by default and restores env", () => {
    const originalPath = process.env["TODOS_DB_PATH"];
    const result = runAgentWorkflowDemo({ exported_at: FIXED_AT });
    expect(result.ephemeral).toBe(true);
    expect(result.db_path).toBe(":memory:");
    expect(process.env["TODOS_DB_PATH"]).toBe(originalPath);
  });

  it("normalizes result for deterministic snapshots", () => {
    const db = getDatabase();
    const result = runAgentWorkflowDemo({
      db,
      ephemeral: false,
      exported_at: FIXED_AT,
    });
    const normalized = normalizeAgentWorkflowDemoResult(result, FIXED_AT);

    expect(normalized).toMatchSnapshot();
    expect(normalized.completed_at).toBe(FIXED_AT);
    expect(normalized.agent).toEqual({ id: "<id-1>", name: DEMO_DEFAULT_AGENT });
    expect(normalized.status_summary).toEqual({
      pending: 0,
      in_progress: 0,
      completed: 3,
      total: 3,
    });
  });

  it("formats human-readable report with fixed timestamp", () => {
    const db = getDatabase();
    const result = runAgentWorkflowDemo({ db, ephemeral: false, exported_at: FIXED_AT });
    const report = formatAgentWorkflowDemoReport(result, FIXED_AT, { deterministic: true });

    expect(report).toContain("=== Agent Workflow Demo (local-only) ===");
    expect(report).toContain(`Completed: ${FIXED_AT}`);
    expect(report).toContain(DEMO_DEFAULT_PROJECT);
    expect(report).toContain("3/3 completed");
    expect(report).toMatchSnapshot();
  });

  it("documents quickstart locally", () => {
    const docs = getAgentWorkflowDemoDocs();
    expect(docs).toContain(AGENT_WORKFLOW_DEMO_SCHEMA);
    expect(docs).toContain("todos demo run");
    expect(docs).toContain("run_agent_workflow_demo");
    expect(docs).not.toContain("https://");
  });

  it("setupEphemeralDemoDb isolates database path", () => {
    const handle = setupEphemeralDemoDb();
    expect(handle.db_path).toBe(":memory:");
    handle.restore();
  });
});
