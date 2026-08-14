import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logTaskChange } from "../db/audit.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createHandoff } from "../db/handoffs.js";
import { createProject } from "../db/projects.js";
import {
  addTaskRunArtifact,
  addTaskRunCommand,
  addTaskRunEvent,
  finishTaskRun,
  startTaskRun,
} from "../db/task-runs.js";
import { createTask } from "../db/tasks.js";
import { addTaskVerification } from "../db/task-commits.js";
import { approveApprovalGate, requestApprovalGate } from "./approval-gates.js";
import {
  getLocalAuditLedger,
  listLocalAuditLedgerCheckpoints,
  sealLocalAuditLedger,
  verifyLocalAuditLedger,
} from "./audit-ledger.js";
import { resetConfig } from "./config.js";

let previousDbPath: string | undefined;
let previousHome: string | undefined;
let home: string;

beforeEach(() => {
  previousDbPath = process.env["TODOS_DB_PATH"];
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-audit-ledger-"));
  process.env["HOME"] = home;
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetConfig();
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  resetConfig();
  if (previousDbPath === undefined) delete process.env["TODOS_DB_PATH"];
  else process.env["TODOS_DB_PATH"] = previousDbPath;
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe("local audit ledger", () => {
  test("seals and verifies local evidence hash chains", () => {
    const db = getDatabase();
    const project = createProject({ name: "Ledger Project", path: "/tmp/ledger-project" }, db);
    const task = createTask({ title: "Ledger task", project_id: project.id, assigned_to: "codex" }, db);
    logTaskChange(task.id, "custom.audit", "status", "pending", "in_progress", "codex", db);
    const run = startTaskRun({ task_id: task.id, agent_id: "codex", title: "Agent run" }, db);
    addTaskRunEvent({ run_id: run.id, event_type: "progress", message: "half done", agent_id: "codex" }, db);
    addTaskRunCommand({ run_id: run.id, command: "bun test", status: "passed", output_summary: "1 pass", agent_id: "codex" }, db);
    addTaskRunArtifact({ run_id: run.id, path: "logs/test.txt", sha256: "abc123", store_content: false, agent_id: "codex" }, db);
    finishTaskRun({ run_id: run.id, status: "completed", summary: "done", agent_id: "codex" }, db);
    addTaskVerification({ task_id: task.id, command: "bun run typecheck", status: "passed", agent_id: "codex" }, db);
    requestApprovalGate({ task_id: task.id, gate: "release", requester: "codex", reviewer: "reviewer", run_id: run.id }, db);
    approveApprovalGate({ task_id: task.id, gate: "release", reviewer: "reviewer", note: "ok" }, db);
    createHandoff({ agent_id: "codex", project_id: project.id, summary: "handoff", task_ids: [task.id], run_ids: [run.id] }, db);

    const ledger = getLocalAuditLedger({ project_id: project.id }, db);
    expect(ledger.local_only).toBe(true);
    expect(ledger.entry_count).toBeGreaterThanOrEqual(8);
    expect(ledger.source_counts["task_history"]).toBeGreaterThan(0);
    expect(ledger.source_counts["task_verification"]).toBeGreaterThan(0);
    expect(ledger.source_counts["run_event"]).toBeGreaterThan(0);
    expect(ledger.source_counts["run_command"]).toBeGreaterThan(0);
    expect(ledger.source_counts["run_artifact"]).toBe(1);
    expect(ledger.source_counts["approval_gate"]).toBe(1);
    expect(ledger.source_counts["handoff"]).toBe(1);

    const checkpoint = sealLocalAuditLedger({ name: "release", project_id: project.id, agent_id: "codex" }, db);
    expect(listLocalAuditLedgerCheckpoints()).toHaveLength(1);
    expect(verifyLocalAuditLedger(checkpoint.id, db).ok).toBe(true);

    addTaskRunCommand({ run_id: run.id, command: "bun test src/new.test.ts", status: "failed", output_summary: "1 fail", agent_id: "codex" }, db);
    const tampered = verifyLocalAuditLedger(checkpoint.id, db);
    expect(tampered.ok).toBe(false);
    expect(tampered.issues.join(" ")).toContain("entry_count changed");
  });

  test("scopes audit ledgers to a run", () => {
    const db = getDatabase();
    const task = createTask({ title: "Run scoped" }, db);
    const firstRun = startTaskRun({ task_id: task.id, agent_id: "codex" }, db);
    const secondRun = startTaskRun({ task_id: task.id, agent_id: "claude" }, db);
    addTaskRunCommand({ run_id: firstRun.id, command: "bun test a", status: "passed" }, db);
    addTaskRunCommand({ run_id: secondRun.id, command: "bun test b", status: "passed" }, db);

    const firstLedger = getLocalAuditLedger({ run_id: firstRun.id }, db);
    expect(firstLedger.run_id).toBe(firstRun.id);
    expect(firstLedger.entries?.some((entry) => entry.payload["command"] === "bun test a")).toBe(true);
    expect(firstLedger.entries?.some((entry) => entry.payload["command"] === "bun test b")).toBe(false);
  });
});
