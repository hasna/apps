import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addComment } from "./comments.js";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { createDispatch, createDispatchLog, getDispatch, listDispatchLogs } from "./dispatches.js";
import { createInboxItem } from "./inbox.js";
import { addTaskVerification, getTaskVerifications } from "./task-commits.js";
import { completeTask, startTask } from "./task-lifecycle.js";
import { addTaskRunArtifact, getTaskRunLedger, startTaskRun } from "./task-runs.js";
import { createTask, getTask, updateTask } from "./tasks.js";
import { getTaskHistory } from "./audit.js";
import { listActivity } from "../lib/activity-audit.js";

const FAKE_TOKEN = ["ghp", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"].join("_");
const FAKE_OPENAI = ["sk", "invalidprewritetest000000"].join("-");
let artifactRoot: string | null = null;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  delete process.env["HASNA_TODOS_ARTIFACTS_DIR"];
  if (artifactRoot) rmSync(artifactRoot, { recursive: true, force: true });
  artifactRoot = null;
});

describe("pre-write secret sanitation", () => {
  test("redacts task title, description, metadata, history, and activity before persistence", () => {
    const task = createTask({
      title: `Investigate ${FAKE_TOKEN}`,
      description: `error included ${FAKE_OPENAI}`,
      metadata: { api_key: FAKE_OPENAI, note: `token ${FAKE_TOKEN}` },
    });

    expect(JSON.stringify(task)).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(task)).not.toContain(FAKE_OPENAI);

    const updated = updateTask(task.id, {
      version: task.version,
      title: `Rotated ${FAKE_OPENAI}`,
      description: `old ${FAKE_TOKEN}`,
      metadata: { nested: { token: FAKE_TOKEN } },
    });

    const persisted = getTask(task.id)!;
    const history = getTaskHistory(task.id);
    const activity = listActivity({ entity_id: task.id });

    expect(JSON.stringify(updated)).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(persisted)).not.toContain(FAKE_OPENAI);
    expect(JSON.stringify(history)).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(activity)).not.toContain(FAKE_OPENAI);
  });

  test("redacts comments, verification, dispatch, and inbox payloads before persistence", () => {
    const task = createTask({ title: "Write boundary" });

    const comment = addComment({ task_id: task.id, content: `comment ${FAKE_TOKEN}` });
    const verification = addTaskVerification({
      task_id: task.id,
      command: `curl -H "Authorization: Bearer ${FAKE_OPENAI}"`,
      output_summary: `failed with ${FAKE_TOKEN}`,
    });
    const dispatch = createDispatch({
      target_window: "main",
      title: `dispatch ${FAKE_TOKEN}`,
      message: `send ${FAKE_OPENAI}`,
    });
    createDispatchLog({
      dispatch_id: dispatch.id,
      target_window: "main",
      message: `log ${FAKE_TOKEN}`,
      delay_ms: 0,
      status: "failed",
      error: `error ${FAKE_OPENAI}`,
    });
    const inbox = createInboxItem({
      title: `inbox ${FAKE_TOKEN}`,
      body: `stack ${FAKE_OPENAI}`,
      create_task: true,
      metadata: { token: FAKE_TOKEN },
    });

    const persisted = {
      comment,
      verification,
      verifications: getTaskVerifications(task.id),
      dispatch: getDispatch(dispatch.id),
      dispatch_logs: listDispatchLogs(dispatch.id),
      inbox,
    };

    expect(JSON.stringify(persisted)).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(persisted)).not.toContain(FAKE_OPENAI);
    expect(JSON.stringify(persisted)).toContain("[REDACTED]");
  });

  test("redacts completion evidence and artifact source paths before persistence", () => {
    const db = getDatabase();
    artifactRoot = mkdtempSync(join(tmpdir(), "todos-prewrite-artifacts-"));
    process.env["HASNA_TODOS_ARTIFACTS_DIR"] = join(artifactRoot, "store");

    const task = createTask({ title: "Evidence boundary" }, db);
    startTask(task.id, "agent", db);
    completeTask(task.id, "agent", db, {
      notes: `note ${FAKE_TOKEN}`,
      test_results: `test ${FAKE_OPENAI}`,
      files_changed: [`src/${FAKE_TOKEN}.ts`],
    });
    const persistedTask = getTask(task.id, db)!;

    const secretDir = join(artifactRoot, FAKE_TOKEN);
    mkdirSync(secretDir, { recursive: true });
    const artifactPath = join(secretDir, "evidence.log");
    writeFileSync(artifactPath, "artifact contents are clean\n");
    const run = startTaskRun({ task_id: task.id, agent_id: "agent" }, db);
    addTaskRunArtifact({ run_id: run.id, path: artifactPath, store_content: true }, db);
    const ledger = getTaskRunLedger(run.id, db);

    const persisted = JSON.stringify({ task: persistedTask, ledger });
    expect(persisted).not.toContain(FAKE_TOKEN);
    expect(persisted).not.toContain(FAKE_OPENAI);
    expect(persisted).toContain("[REDACTED]");
  });
});
