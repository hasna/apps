import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import { getTaskRunLedger } from "../db/task-runs.js";
import { resetConfig } from "./config.js";
import { upsertRunnerSandboxProfile } from "./runner-sandbox.js";
import { upsertWorkspaceTrustProfile } from "./workspace-trust.js";
import {
  cancelAgentRunDispatch,
  listAgentRunAdapters,
  listAgentRunQueue,
  queueAgentRun,
  removeAgentRunAdapter,
  retryAgentRunDispatch,
  runNextAgentDispatch,
  upsertAgentRunAdapter,
} from "./agent-run-dispatcher.js";

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-agent-dispatcher-home-"));
  process.env["HOME"] = home;
  resetConfig();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  resetConfig();
  rmSync(home, { recursive: true, force: true });
});

describe("agent run dispatcher", () => {
  test("queues and executes local adapter commands with run ledger evidence", async () => {
    const db = getDatabase();
    const root = join(home, "project");
    mkdirSync(root, { recursive: true });
    upsertWorkspaceTrustProfile({ root, preset: "standard", command_allowlist: ["bun"], write_scopes: ["src"] });
    upsertRunnerSandboxProfile({ name: "codex", root, command_allowlist: ["bun"], write_scopes: ["src"] });
    const task = createTask({ title: "Dispatch me" }, db);
    upsertAgentRunAdapter({
      name: "codex",
      command: "bun --eval 'console.log(\"run {task_id} {run_id}\")'",
      sandbox: "codex",
      cwd: root,
    });

    const queued = queueAgentRun({ task_id: task.id, adapter: "codex", agent_id: "codex" }, db);
    expect(queued.dispatcher.state).toBe("queued");
    expect(listAgentRunQueue(db)).toHaveLength(1);

    const result = await runNextAgentDispatch({}, db);
    expect(result?.status).toBe("completed");
    expect(result?.exit_code).toBe(0);
    expect(result?.output_summary).toContain(task.id);
    const ledger = getTaskRunLedger(queued.run.id, db);
    expect(ledger.run.status).toBe("completed");
    expect(ledger.commands[0]!.status).toBe("passed");
  });

  test("supports dry-run, cancellation, retry, and adapter removal", async () => {
    const db = getDatabase();
    const task = createTask({ title: "Retry me" }, db);
    const adapter = upsertAgentRunAdapter({ name: "custom", command: "echo ok" });
    expect(adapter.name).toBe("custom");
    expect(listAgentRunAdapters()).toHaveLength(1);

    const queued = queueAgentRun({ task_id: task.id, adapter: "custom", agent_id: "codex" }, db);
    const dryRun = await runNextAgentDispatch({ dry_run: true }, db);
    expect(dryRun?.dry_run).toBe(true);
    expect(getTaskRunLedger(queued.run.id, db).run.status).toBe("running");

    const cancelled = cancelAgentRunDispatch(queued.run.id, db);
    expect(cancelled.dispatcher.state).toBe("cancelled");
    expect(getTaskRunLedger(queued.run.id, db).run.status).toBe("cancelled");

    const retry = retryAgentRunDispatch(queued.run.id, db);
    expect(retry.dispatcher.state).toBe("queued");
    expect(retry.run.metadata.retry_of).toBe(queued.run.id);
    expect(removeAgentRunAdapter("custom")).toBe(true);
  });
});
