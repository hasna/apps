import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import {
  upsertCheckpoint,
  getCheckpoint,
  getTaskCheckpoints,
  emitHeartbeat,
  getTaskHeartbeats,
  getLastHeartbeat,
  getTaskProgress,
} from "./checkpoints.js";
import { createTask } from "./tasks.js";
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

describe("upsertCheckpoint", () => {
  it("should create a new checkpoint", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    const task = createTask({ title: "Test", project_id: projId }, db);
    const cp = upsertCheckpoint(task.id, "step-1", { status: "running", agent_id: "agent-1" });
    expect(cp.step).toBe("step-1");
    expect(cp.status).toBe("running");
    expect(cp.agent_id).toBe("agent-1");
    expect(cp.task_id).toBe(task.id);
  });

  it("should update an existing checkpoint", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    const task = createTask({ title: "Test", project_id: projId }, db);
    upsertCheckpoint(task.id, "step-1", { status: "pending" });
    const updated = upsertCheckpoint(task.id, "step-1", { status: "completed", data: { result: "ok" } });
    expect(updated.status).toBe("completed");
    expect(updated.data).toEqual({ result: "ok" });
  });

  it("should handle error and attempt fields", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    const task = createTask({ title: "Test", project_id: projId }, db);
    const cp = upsertCheckpoint(task.id, "step-err", {
      status: "failed",
      error: "Something went wrong",
      attempt: 3,
      max_attempts: 5,
    });
    expect(cp.status).toBe("failed");
    expect(cp.error).toBe("Something went wrong");
    expect(cp.attempt).toBe(3);
    expect(cp.max_attempts).toBe(5);
  });

  it("should handle started_at and completed_at timestamps", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    const task = createTask({ title: "Test", project_id: projId }, db);
    const now = new Date().toISOString();
    const cp = upsertCheckpoint(task.id, "timed-step", { status: "completed", started_at: now, completed_at: now });
    expect(cp.started_at).toBe(now);
    expect(cp.completed_at).toBe(now);
  });
});

describe("getCheckpoint", () => {
  it("should return null for non-existent checkpoint", () => {
    expect(getCheckpoint("fake-id", "fake-step")).toBeNull();
  });

  it("should return a checkpoint by task and step", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    const task = createTask({ title: "Test", project_id: projId }, db);
    upsertCheckpoint(task.id, "the-step", { status: "running" });
    const cp = getCheckpoint(task.id, "the-step");
    expect(cp).not.toBeNull();
    expect(cp!.step).toBe("the-step");
  });
});

describe("getTaskCheckpoints", () => {
  it("should return empty array for no checkpoints", () => {
    expect(getTaskCheckpoints("fake-id")).toEqual([]);
  });

  it("should return all checkpoints for a task", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    const task = createTask({ title: "Test", project_id: projId }, db);
    upsertCheckpoint(task.id, "step-1", { status: "pending" });
    upsertCheckpoint(task.id, "step-2", { status: "completed" });
    upsertCheckpoint(task.id, "step-3", { status: "running" });
    const checkpoints = getTaskCheckpoints(task.id);
    expect(checkpoints).toHaveLength(3);
    expect(checkpoints.map(c => c.step)).toContain("step-1");
    expect(checkpoints.map(c => c.step)).toContain("step-2");
    expect(checkpoints.map(c => c.step)).toContain("step-3");
  });
});

describe("emitHeartbeat", () => {
  it("should create a heartbeat", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    const task = createTask({ title: "Test", project_id: projId }, db);
    const hb = emitHeartbeat(task.id, { agent_id: "agent-1", step: "step-1", message: "working", progress: 0.5 });
    expect(hb.task_id).toBe(task.id);
    expect(hb.progress).toBe(0.5);
    expect(hb.meta).toEqual({});
  });

  it("should store meta as JSON", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    const task = createTask({ title: "Test", project_id: projId }, db);
    const hb = emitHeartbeat(task.id, { meta: { cpu: 0.8, mem: "2GB" } });
    expect(hb.meta).toEqual({ cpu: 0.8, mem: "2GB" });
  });
});

describe("getTaskHeartbeats", () => {
  it("should return empty array for no heartbeats", () => {
    expect(getTaskHeartbeats("fake-id")).toEqual([]);
  });

  it("should return heartbeats ordered by recency", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    const task = createTask({ title: "Test", project_id: projId }, db);
    emitHeartbeat(task.id, { message: "first" });
    // Small delay so created_at timestamps differ — SQLite datetime('now') has 1s resolution
    Bun.sleepSync(1100);
    emitHeartbeat(task.id, { message: "second" });
    Bun.sleepSync(1100);
    emitHeartbeat(task.id, { message: "third" });
    const hbs = getTaskHeartbeats(task.id);
    expect(hbs).toHaveLength(3);
    expect(hbs[0].message).toBe("third");
  });

  it("should respect the limit parameter", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    const task = createTask({ title: "Test", project_id: projId }, db);
    for (let i = 0; i < 5; i++) emitHeartbeat(task.id, { message: `msg-${i}` });
    const hbs = getTaskHeartbeats(task.id, 2);
    expect(hbs).toHaveLength(2);
  });
});

describe("getLastHeartbeat", () => {
  it("should return null for no heartbeats", () => {
    expect(getLastHeartbeat("fake-id")).toBeNull();
  });

  it("should return the latest heartbeat", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    const task = createTask({ title: "Test", project_id: projId }, db);
    emitHeartbeat(task.id, { message: "old" });
    Bun.sleepSync(1100);
    emitHeartbeat(task.id, { message: "latest" });
    const hb = getLastHeartbeat(task.id);
    expect(hb).not.toBeNull();
    expect(hb!.message).toBe("latest");
  });
});

describe("getTaskProgress", () => {
  it("should return zero counts for no checkpoints", () => {
    const progress = getTaskProgress("fake-id");
    expect(progress.total_steps).toBe(0);
    expect(progress.completed_steps).toBe(0);
    expect(progress.failed_steps).toBe(0);
    expect(progress.pending_steps).toBe(0);
  });

  it("should count checkpoint statuses correctly", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    const task = createTask({ title: "Test", project_id: projId }, db);
    upsertCheckpoint(task.id, "step-1", { status: "completed" });
    upsertCheckpoint(task.id, "step-2", { status: "failed" });
    upsertCheckpoint(task.id, "step-3", { status: "pending" });
    upsertCheckpoint(task.id, "step-4", { status: "completed" });
    const progress = getTaskProgress(task.id);
    expect(progress.total_steps).toBe(4);
    expect(progress.completed_steps).toBe(2);
    expect(progress.failed_steps).toBe(1);
    expect(progress.pending_steps).toBe(1);
  });

  it("should include last heartbeat when available", () => {
    const projId = "proj-" + Math.random().toString(36).slice(2, 10);
    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
    const task = createTask({ title: "Test", project_id: projId }, db);
    emitHeartbeat(task.id, { message: "active", progress: 0.75 });
    const progress = getTaskProgress(task.id);
    expect(progress.last_heartbeat).not.toBeNull();
    expect(progress.last_heartbeat!.progress).toBe(0.75);
  });
});
