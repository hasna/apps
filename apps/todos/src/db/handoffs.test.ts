import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { registerAgent } from "./agents.js";
import { createTask, startTask } from "./tasks.js";
import { addTaskFile } from "./task-files.js";
import { startTaskRun } from "./task-runs.js";
import {
  acknowledgeHandoff,
  createHandoff,
  createSessionRecoveryHandoff,
  exportHandoffBundle,
  getHandoff,
  getLatestHandoff,
  importHandoffBundle,
  listHandoffs,
} from "./handoffs.js";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("createHandoff", () => {
  it("should create a handoff with all fields", () => {
    const h = createHandoff({
      agent_id: "brutus",
      summary: "Built 8 commands",
      completed: ["week", "overdue", "blocked"],
      in_progress: ["handoff MCP tool"],
      blockers: ["needs review"],
      next_steps: ["publish"],
      session_id: "session-1",
      task_ids: ["task-1"],
      relevant_files: ["src/cli.ts"],
      run_ids: ["run-1"],
    }, db);
    expect(h.id).toBeDefined();
    expect(h.agent_id).toBe("brutus");
    expect(h.summary).toBe("Built 8 commands");
    expect(h.completed).toEqual(["week", "overdue", "blocked"]);
    expect(h.in_progress).toEqual(["handoff MCP tool"]);
    expect(h.blockers).toEqual(["needs review"]);
    expect(h.next_steps).toEqual(["publish"]);
    expect(h.session_id).toBe("session-1");
    expect(h.task_ids).toEqual(["task-1"]);
    expect(h.relevant_files).toEqual(["src/cli.ts"]);
    expect(h.run_ids).toEqual(["run-1"]);
    expect(h.acknowledged_by).toEqual([]);
  });

  it("should create a minimal handoff", () => {
    const h = createHandoff({ summary: "Quick session" }, db);
    expect(h.summary).toBe("Quick session");
    expect(h.agent_id).toBeNull();
    expect(h.completed).toBeNull();
  });
});

describe("listHandoffs", () => {
  it("rejects a raw caller-created database before querying it", () => {
    const raw = new Database(":memory:");
    try {
      expect(() => listHandoffs(undefined, 10, raw))
        .toThrow("UNTRUSTED_SQLITE_PROVENANCE");
    } finally {
      raw.close();
    }
  });

  it("should list handoffs in reverse chronological order", () => {
    createHandoff({ summary: "First", agent_id: "a" }, db);
    createHandoff({ summary: "Second", agent_id: "b" }, db);
    const list = listHandoffs(undefined, 10, db);
    expect(list.length).toBe(2);
    expect(list[0].summary).toBe("Second");
    expect(list[1].summary).toBe("First");
  });

  it("should respect limit", () => {
    for (let i = 0; i < 5; i++) createHandoff({ summary: `H${i}` }, db);
    const list = listHandoffs(undefined, 3, db);
    expect(list.length).toBe(3);
  });

  it("should filter unread handoffs per receiving agent", () => {
    const first = createHandoff({ summary: "Read me", agent_id: "brutus" }, db);
    createHandoff({ summary: "Unread", agent_id: "brutus" }, db);

    acknowledgeHandoff(first.id, "claudia", db);

    const unread = listHandoffs({ unread_for: "claudia", limit: 10 }, db);
    expect(unread.map((handoff) => handoff.summary)).toEqual(["Unread"]);
  });
});

describe("getLatestHandoff", () => {
  it("should return latest handoff by agent", () => {
    createHandoff({ summary: "Old", agent_id: "brutus" }, db);
    createHandoff({ summary: "New", agent_id: "brutus" }, db);
    createHandoff({ summary: "Other", agent_id: "maximus" }, db);
    const latest = getLatestHandoff("brutus", undefined, db);
    expect(latest).not.toBeNull();
    expect(latest!.summary).toBe("New");
  });

  it("should return null when no handoffs exist", () => {
    const latest = getLatestHandoff("nobody", undefined, db);
    expect(latest).toBeNull();
  });
});

describe("acknowledgeHandoff", () => {
  it("should mark handoffs read per agent without hiding them from others", () => {
    const handoff = createHandoff({ summary: "Needs pickup", agent_id: "brutus" }, db);

    const acked = acknowledgeHandoff(handoff.id, "claudia", db);

    expect(acked.acknowledged_by).toEqual(["claudia"]);
    expect(listHandoffs({ unread_for: "claudia" }, db)).toHaveLength(0);
    expect(listHandoffs({ unread_for: "livia" }, db)).toHaveLength(1);
    expect(getHandoff(handoff.id, db)?.acknowledged_by).toEqual(["claudia"]);
  });
});

describe("createSessionRecoveryHandoff", () => {
  it("should capture active stale session context for continuation", () => {
    registerAgent({ name: "brutus", session_id: "stale-session", working_dir: "/repo" }, db);
    const task = createTask({
      title: "Continue feature",
      assigned_to: "brutus",
      agent_id: "brutus",
      session_id: "stale-session",
    }, db);
    startTask(task.id, "brutus", db);
    addTaskFile({ task_id: task.id, path: "src/feature.ts", agent_id: "brutus" }, db);
    const run = startTaskRun({ task_id: task.id, agent_id: "brutus", title: "Feature run" }, db);

    const handoff = createSessionRecoveryHandoff({
      agent_id: "brutus",
      session_id: "stale-session",
      recovered_by: "claudia",
      reason: "stale agent recovery",
    }, db);

    expect(handoff.summary).toContain("stale agent recovery");
    expect(handoff.in_progress).toEqual([`${task.id.slice(0, 8)} Continue feature`]);
    expect(handoff.task_ids).toEqual([task.id]);
    expect(handoff.relevant_files).toEqual(["src/feature.ts"]);
    expect(handoff.run_ids).toEqual([run.id]);
    expect(handoff.next_steps?.[0]).toContain("Review active task");
  });
});

describe("handoff import/export bundles", () => {
  it("should export and import deterministic local handoff bundles", () => {
    const task = createTask({ title: "Bundle task", assigned_to: "brutus", session_id: "session-bundle" }, db);
    addTaskFile({ task_id: task.id, path: "src/bundle.ts", agent_id: "brutus" }, db);
    const run = startTaskRun({ task_id: task.id, agent_id: "brutus", title: "Bundle run" }, db);
    const handoff = createHandoff({
      agent_id: "brutus",
      session_id: "session-bundle",
      summary: "Bundle summary",
      in_progress: ["Finish bundle"],
      blockers: ["Needs import test"],
      next_steps: ["Apply bundle"],
      task_ids: [task.id],
      relevant_files: ["src/bundle.ts"],
      run_ids: [run.id],
    }, db);
    acknowledgeHandoff(handoff.id, "claudia", db);

    const bundle = exportHandoffBundle(handoff.id, db, new Date("2026-05-21T12:00:00.000Z"));
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.handoff.id).toBe(handoff.id);
    expect(bundle.references.tasks[0]!.title).toBe("Bundle task");
    expect(bundle.references.files[0]!.path).toBe("src/bundle.ts");
    expect(bundle.references.runs[0]!.id).toBe(run.id);

    closeDatabase();
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    db = getDatabase();

    const preview = importHandoffBundle(bundle, { apply: false }, db);
    expect(preview.applied).toBe(false);
    expect(preview.created).toBe(false);
    expect(preview.handoff_id).toBe(handoff.id);
    expect(getHandoff(handoff.id, db)).toBeNull();

    const applied = importHandoffBundle(bundle, { apply: true }, db);
    expect(applied.applied).toBe(true);
    expect(applied.created).toBe(true);
    expect(getHandoff(handoff.id, db)?.acknowledged_by).toEqual(["claudia"]);
  });
});
