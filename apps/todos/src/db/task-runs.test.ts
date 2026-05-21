import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createTask, getTask } from "./tasks.js";
import { listComments } from "./comments.js";
import { getTaskVerifications } from "./task-commits.js";
import { artifactStorePath } from "../lib/artifact-store.js";
import {
  addTaskRunArtifact,
  addTaskRunCommand,
  addTaskRunEvent,
  addTaskRunFile,
  finishTaskRun,
  getTaskRunLedger,
  listTaskRuns,
  redactEvidenceText,
  startTaskRun,
  verifyTaskRunArtifacts,
} from "./task-runs.js";

let db: Database;
let artifactDir: string;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  artifactDir = mkdtempSync(join(tmpdir(), "todos-artifacts-test-"));
  process.env["HASNA_TODOS_ARTIFACTS_DIR"] = artifactDir;
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  delete process.env["HASNA_TODOS_ARTIFACTS_DIR"];
  rmSync(artifactDir, { recursive: true, force: true });
});

function setupTask(title = "Run task") {
  const projId = "proj-" + Math.random().toString(36).slice(2, 10);
  db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
  return createTask({ title, project_id: projId }, db);
}

describe("task run ledger", () => {
  it("captures a full local run with claim, comments, command evidence, files, artifacts, and finish state", () => {
    const task = setupTask();
    const run = startTaskRun({
      task_id: task.id,
      agent_id: "codex",
      title: "Implement ledger",
      summary: "starting run",
      metadata: { source: "local" },
      claim: true,
    }, db);

    expect(run.status).toBe("running");
    expect(run.metadata.source).toBe("local");
    expect(getTask(task.id, db)!.status).toBe("in_progress");

    addTaskRunEvent({ run_id: run.id, event_type: "comment", message: "Working through tests", agent_id: "codex" }, db);
    const command = addTaskRunCommand({
      run_id: run.id,
      command: "bun test src/db/task-runs.test.ts",
      status: "passed",
      exit_code: 0,
      output_summary: "1 pass",
      artifact_path: "logs/task-runs.txt",
      agent_id: "codex",
    }, db);
    const file = addTaskRunFile({ run_id: run.id, path: "src/db/task-runs.ts", status: "modified", note: "ledger storage", agent_id: "codex" }, db);
    const artifact = addTaskRunArtifact({
      run_id: run.id,
      path: "logs/task-runs.txt",
      artifact_type: "log",
      description: "Focused test output",
      size_bytes: 123,
      sha256: "abc123",
      metadata: { local_only: true },
      agent_id: "codex",
    }, db);
    const finished = finishTaskRun({ run_id: run.id, status: "completed", summary: "done", agent_id: "codex" }, db);

    expect(command.status).toBe("passed");
    expect(file.path).toBe("src/db/task-runs.ts");
    expect(artifact.path).toBe("logs/task-runs.txt");
    expect(finished.status).toBe("completed");

    const ledger = getTaskRunLedger(run.id, db);
    expect(ledger.events.map(event => event.event_type)).toEqual([
      "started",
      "claim",
      "comment",
      "command",
      "file",
      "artifact",
      "completed",
    ]);
    expect(ledger.commands).toHaveLength(1);
    expect(ledger.artifacts).toHaveLength(1);
    expect(ledger.files[0]!.path).toBe("src/db/task-runs.ts");
    expect(listTaskRuns(task.id, db)[0]!.id).toBe(run.id);
    expect(listComments(task.id, db)[0]!.content).toBe("Working through tests");
    expect(getTaskVerifications(task.id, db)[0]!.command).toBe("bun test src/db/task-runs.test.ts");
  });

  it("redacts likely secrets from stored evidence text and metadata", () => {
    const task = setupTask();
    const run = startTaskRun({
      task_id: task.id,
      agent_id: "codex",
      summary: "TOKEN=super-secret-token-value",
      metadata: { api_key: "secret-value", nested: { text: "bearer abcdefghijklmnopqrstuvwxyz" } },
    }, db);

    const fakeAwsKey = "AKIA" + "1234567890ABCDEF";
    addTaskRunCommand({
      run_id: run.id,
      command: "OPENAI_API_KEY=sk-testsecret123456789 bun test",
      output_summary: `AWS key ${fakeAwsKey} leaked`,
    }, db);

    const ledger = getTaskRunLedger(run.id, db);
    expect(ledger.run.summary).toBe("TOKEN=[REDACTED]");
    expect(ledger.run.metadata.api_key).toBe("[REDACTED]");
    expect(JSON.stringify(ledger.run.metadata)).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(ledger.commands[0]!.command).not.toContain("sk-testsecret");
    expect(ledger.commands[0]!.output_summary).not.toContain(fakeAwsKey);
    expect(redactEvidenceText("password=abc123456789")).toBe("password=[REDACTED]");
  });

  it("stores run artifact content in the local content-addressed store and verifies integrity", () => {
    const task = setupTask();
    const run = startTaskRun({ task_id: task.id, agent_id: "codex" }, db);
    const logPath = join(artifactDir, "run.log");
    writeFileSync(logPath, "ok\nOPENAI_API_KEY=sk-testsecret123456789\n");

    const artifact = addTaskRunArtifact({
      run_id: run.id,
      path: logPath,
      artifact_type: "log",
      retention_days: 7,
      store_content: true,
      agent_id: "codex",
    }, db);

    const store = artifact.metadata["artifact_store"] as Record<string, any>;
    expect(store.stored).toBe(true);
    expect(store.redaction.status).toBe("redacted");
    expect(store.retention.days).toBe(7);
    expect(artifact.sha256).toBe(store.sha256);
    expect(artifact.size_bytes).toBe(store.size_bytes);
    const storedText = readFileSync(artifactStorePath(store.relative_path), "utf8");
    expect(storedText).toContain("OPENAI_API_KEY=[REDACTED]");
    expect(storedText).not.toContain("sk-testsecret");

    expect(verifyTaskRunArtifacts(run.id, db)).toMatchObject([
      {
        id: artifact.id,
        status: "ok",
        expected_sha256: artifact.sha256,
        expected_size_bytes: artifact.size_bytes,
      },
    ]);
  });

  it("keeps metadata-only artifacts explicit when local content is not stored", () => {
    const task = setupTask();
    const run = startTaskRun({ task_id: task.id, agent_id: "codex" }, db);
    const artifact = addTaskRunArtifact({
      run_id: run.id,
      path: "logs/missing.log",
      artifact_type: "log",
      store_content: false,
      size_bytes: 12,
      sha256: "abc123",
    }, db);

    expect(artifact.metadata["artifact_store"]).toBeUndefined();
    expect(verifyTaskRunArtifacts(run.id, db)[0]).toMatchObject({
      status: "metadata_only",
      expected_sha256: "abc123",
      expected_size_bytes: 12,
    });
  });
});
