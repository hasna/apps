import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { enqueueAgentRun } from "./agent-run-dispatcher.js";
import {
  RUN_RECORD_SCHEMA,
  createRunRecord,
  appendRunCommand,
  recordFilesTouched,
  linkRunVerification,
  linkRunArtifact,
  completeRunRecord,
  failRunRecord,
  listRunRecords,
  buildRunReplayBundle,
  exportRunReplay,
  formatRunRecordMarkdown,
} from "./run-records.js";
import { createTask } from "../db/tasks.js";

let db: Database;
let tempDir: string;

beforeEach(() => {
  tempDir = join("/tmp", `run-records-${Date.now()}`);
  process.env["TODOS_DB_PATH"] = ":memory:";
  process.env["TODOS_AGENT_ADAPTERS_PATH"] = join(tempDir, "adapters.json");
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  delete process.env["TODOS_AGENT_ADAPTERS_PATH"];
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("run records", () => {
  it("creates a run record with active status", () => {
    const record = createRunRecord({ agent_id: "agent-1", objective: "Fix tests" }, db);
    expect(record.schema_version).toBe(RUN_RECORD_SCHEMA);
    expect(record.status).toBe("active");
    expect(record.status_transitions).toHaveLength(1);
  });

  it("appends commands and redacts secrets in output", () => {
    const record = createRunRecord({ objective: "Deploy" }, db);
    const updated = appendRunCommand(record.id, "bun test", {
      exit_code: 0,
      stdout: "ok",
      stderr: "api_key=secretvalue123456789",
    }, db);

    expect(updated.commands).toHaveLength(1);
    expect(updated.stderr_summary).not.toContain("secretvalue123456789");
    expect(updated.stderr_summary).toContain("[REDACTED]");
  });

  it("tracks files, verification, and artifacts", () => {
    const record = createRunRecord({}, db);
    recordFilesTouched(record.id, ["src/a.ts", "src/b.ts"], db);
    linkRunVerification(record.id, { record_id: "ver-1", provider: "shell", status: "passed" }, db);
    linkRunArtifact(record.id, "art-12345678", db);

    const full = completeRunRecord(record.id, "done", db);
    expect(full.files_touched).toEqual(["src/a.ts", "src/b.ts"]);
    expect(full.verification_results).toHaveLength(1);
    expect(full.artifact_ids).toContain("art-12345678");
    expect(full.status).toBe("completed");
  });

  it("fails run record with error note", () => {
    const record = createRunRecord({}, db);
    const failed = failRunRecord(record.id, "Tests failed", db);
    expect(failed.status).toBe("failed");
    expect(failed.stderr_summary).toContain("Tests failed");
  });

  it("exports replay bundle to local path", () => {
    const task = createTask({ title: "Run task" }, db);
    const agentRun = enqueueAgentRun({ task_id: task.id, adapter: "codex" }, db);
    const record = createRunRecord({ agent_run_id: agentRun.id, claimed_task_ids: [task.id] }, db);

    const outPath = join(tempDir, "replay.json");
    const { path, bundle } = exportRunReplay(record.id, outPath, db);
    expect(path).toBe(outPath);
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8")).record.id).toBe(record.id);
    expect(bundle.record.claimed_task_ids).toContain(task.id);
  });

  it("lists and formats markdown", () => {
    createRunRecord({ agent_id: "a1" }, db);
    createRunRecord({ agent_id: "a2" }, db);
    const records = listRunRecords({ agent_id: "a1" }, db);
    expect(records).toHaveLength(1);

    const md = formatRunRecordMarkdown(records[0]!);
    expect(md).toContain("# Run Record");
    expect(md).toContain("## Commands");
  });

  it("builds replay bundle deterministically", () => {
    const record = createRunRecord({ objective: "x" }, db);
    const bundle = buildRunReplayBundle(record.id, db);
    expect(bundle.schema_version).toBe(RUN_RECORD_SCHEMA);
    expect(bundle.record.objective).toBe("x");
  });
});
