import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createTask } from "./tasks.js";
import { saveSnapshot, getLatestSnapshot, listSnapshots } from "./snapshots.js";
import type { Database } from "bun:sqlite";

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

function setupTask(title = "Test") {
  const projId = "proj-" + Math.random().toString(36).slice(2, 10);
  db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
  return createTask({ title, project_id: projId }, db);
}

describe("saveSnapshot", () => {
  it("should save a snapshot with minimal fields", () => {
    const snap = saveSnapshot({ snapshot_type: "checkpoint" });
    expect(snap.id).toBeTruthy();
    expect(snap.snapshot_type).toBe("checkpoint");
    expect(snap.files_open).toEqual([]);
    expect(snap.attempts).toEqual([]);
    expect(snap.blockers).toEqual([]);
    expect(snap.metadata).toEqual({});
    expect(snap.created_at).toBeTruthy();
  });

  it("should save a snapshot with agent_id and metadata only", () => {
    const snap = saveSnapshot({
      agent_id: "agent-1",
      snapshot_type: "interrupt",
      plan_summary: "Working on auth module",
      files_open: ["src/auth.ts", "src/login.ts"],
      attempts: ["attempt-1", "attempt-2"],
      blockers: ["Waiting for API key"],
      next_steps: "Implement OAuth flow",
      metadata: { priority: "high" },
    });
    expect(snap.agent_id).toBe("agent-1");
    expect(snap.snapshot_type).toBe("interrupt");
    expect(snap.plan_summary).toBe("Working on auth module");
    expect(snap.files_open).toEqual(["src/auth.ts", "src/login.ts"]);
    expect(snap.attempts).toEqual(["attempt-1", "attempt-2"]);
    expect(snap.blockers).toEqual(["Waiting for API key"]);
    expect(snap.next_steps).toBe("Implement OAuth flow");
    expect(snap.metadata).toEqual({ priority: "high" });
  });

  it("should handle all snapshot types", () => {
    for (const type of ["interrupt", "complete", "handoff", "checkpoint"] as const) {
      const snap = saveSnapshot({ snapshot_type: type });
      expect(snap.snapshot_type).toBe(type);
    }
  });
});

describe("getLatestSnapshot", () => {
  it("should return null when no filters provided", () => {
    saveSnapshot({ snapshot_type: "checkpoint", agent_id: "agent-1" });
    expect(getLatestSnapshot()).toBeNull();
  });

  it("should return the latest snapshot by agent_id", () => {
    saveSnapshot({ snapshot_type: "checkpoint", agent_id: "agent-1", plan_summary: "old" });
    Bun.sleepSync(1100);
    saveSnapshot({ snapshot_type: "checkpoint", agent_id: "agent-1", plan_summary: "new" });
    const snap = getLatestSnapshot("agent-1");
    expect(snap).not.toBeNull();
    expect(snap!.plan_summary).toBe("new");
  });

  it("should return the latest snapshot by task_id", () => {
    const task = setupTask();
    saveSnapshot({ snapshot_type: "handoff", task_id: task.id, plan_summary: "first" });
    Bun.sleepSync(1100);
    saveSnapshot({ snapshot_type: "handoff", task_id: task.id, plan_summary: "second" });
    const snap = getLatestSnapshot(undefined, task.id);
    expect(snap).not.toBeNull();
    expect(snap!.plan_summary).toBe("second");
  });

  it("should filter by both agent_id and task_id", () => {
    const task = setupTask();
    saveSnapshot({ snapshot_type: "checkpoint", agent_id: "agent-1", task_id: task.id, plan_summary: "match" });
    saveSnapshot({ snapshot_type: "checkpoint", agent_id: "agent-2", task_id: task.id, plan_summary: "no-match" });
    const snap = getLatestSnapshot("agent-1", task.id);
    expect(snap).not.toBeNull();
    expect(snap!.plan_summary).toBe("match");
  });

  it("should return null if no snapshots match", () => {
    saveSnapshot({ snapshot_type: "checkpoint", agent_id: "agent-1" });
    expect(getLatestSnapshot("agent-2")).toBeNull();
  });
});

describe("listSnapshots", () => {
  it("should list all snapshots with no filters", () => {
    saveSnapshot({ snapshot_type: "checkpoint", agent_id: "agent-1" });
    saveSnapshot({ snapshot_type: "handoff", agent_id: "agent-2" });
    const snaps = listSnapshots({});
    expect(snaps).toHaveLength(2);
  });

  it("should filter by agent_id", () => {
    saveSnapshot({ snapshot_type: "checkpoint", agent_id: "agent-1" });
    saveSnapshot({ snapshot_type: "checkpoint", agent_id: "agent-2" });
    const snaps = listSnapshots({ agent_id: "agent-1" });
    expect(snaps).toHaveLength(1);
    expect(snaps[0].agent_id).toBe("agent-1");
  });

  it("should respect limit", () => {
    for (let i = 0; i < 5; i++) {
      saveSnapshot({ snapshot_type: "checkpoint", agent_id: `agent-${i}` });
      Bun.sleepSync(10); // small delay for ordering
    }
    const snaps = listSnapshots({ limit: 3 });
    expect(snaps).toHaveLength(3);
  });

  it("should return snapshots ordered by recency (DESC)", () => {
    saveSnapshot({ snapshot_type: "checkpoint", agent_id: "agent-1", plan_summary: "oldest" });
    Bun.sleepSync(1100);
    saveSnapshot({ snapshot_type: "checkpoint", agent_id: "agent-2", plan_summary: "middle" });
    Bun.sleepSync(1100);
    saveSnapshot({ snapshot_type: "checkpoint", agent_id: "agent-3", plan_summary: "newest" });
    const snaps = listSnapshots({});
    expect(snaps[0].plan_summary).toBe("newest");
  });
});
