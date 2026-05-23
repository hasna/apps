import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import {
  enqueueAgentRun,
  claimNextAgentRun,
  completeAgentRun,
  failAgentRun,
  cancelAgentRun,
  retryAgentRun,
  listAgentRuns,
  loadAgentAdapters,
  getDefaultAgentAdapters,
  resetAgentAdapterCache,
} from "./agent-run-dispatcher.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-run-test-"));
  mkdirSync(join(tempDir, ".todos"), { recursive: true });
  process.env["TODOS_DB_PATH"] = ":memory:";
  process.env["TODOS_AGENT_ADAPTERS_PATH"] = join(tempDir, ".todos", "agent-adapters.json");
  resetDatabase();
  resetAgentAdapterCache();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  delete process.env["TODOS_AGENT_ADAPTERS_PATH"];
  resetAgentAdapterCache();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("agent run dispatcher", () => {
  it("enqueues and lists runs for a task", () => {
    const project = createProject({ name: "test-proj", path: tempDir });
    const task = createTask({ title: "Run me", project_id: project.id });
    const run = enqueueAgentRun({ task_id: task.id, adapter: "claude" });
    expect(run.status).toBe("queued");
    expect(run.adapter).toBe("claude");
    const listed = listAgentRuns({ task_id: task.id });
    expect(listed).toHaveLength(1);
  });

  it("claims oldest queued run atomically", () => {
    const project = createProject({ name: "test-proj", path: tempDir });
    const t1 = createTask({ title: "First", project_id: project.id });
    const t2 = createTask({ title: "Second", project_id: project.id });
    enqueueAgentRun({ task_id: t1.id, adapter: "codex" });
    enqueueAgentRun({ task_id: t2.id, adapter: "codex" });

    const claimed = claimNextAgentRun("agent-a");
    expect(claimed?.status).toBe("running");
    expect(claimed?.agent_id).toBe("agent-a");
    expect(claimed?.task_id).toBe(t1.id);

    const second = claimNextAgentRun("agent-b");
    expect(second?.task_id).toBe(t2.id);
    expect(claimNextAgentRun("agent-c")).toBeNull();
  });

  it("filters claim by adapter", () => {
    const project = createProject({ name: "test-proj", path: tempDir });
    const task = createTask({ title: "T", project_id: project.id });
    enqueueAgentRun({ task_id: task.id, adapter: "cursor" });
    expect(claimNextAgentRun("a1", { adapter: "claude" })).toBeNull();
    expect(claimNextAgentRun("a1", { adapter: "cursor" })?.adapter).toBe("cursor");
  });

  it("completes run with merged evidence", () => {
    const project = createProject({ name: "test-proj", path: tempDir });
    const task = createTask({ title: "T", project_id: project.id });
    const run = enqueueAgentRun({ task_id: task.id, adapter: "claude" });
    const claimed = claimNextAgentRun("worker")!;
    expect(claimed.id).toBe(run.id);

    const done = completeAgentRun(run.id, { commit_hash: "abc123" });
    expect(done.status).toBe("completed");
    expect(done.evidence.commit_hash).toBe("abc123");
    expect(done.completed_at).not.toBeNull();
  });

  it("auto-retries failed runs up to max_retries", () => {
    const project = createProject({ name: "test-proj", path: tempDir });
    const task = createTask({ title: "T", project_id: project.id });
    const run = enqueueAgentRun({ task_id: task.id, adapter: "claude", max_retries: 1 });
    claimNextAgentRun("worker");

    const retried = failAgentRun(run.id, "transient error");
    expect(retried.status).toBe("queued");
    expect(retried.retry_count).toBe(1);

    claimNextAgentRun("worker");
    const final = failAgentRun(run.id, "still broken");
    expect(final.status).toBe("failed");
  });

  it("cancels queued or running runs", () => {
    const project = createProject({ name: "test-proj", path: tempDir });
    const task = createTask({ title: "T", project_id: project.id });
    const run = enqueueAgentRun({ task_id: task.id, adapter: "claude" });
    const cancelled = cancelAgentRun(run.id);
    expect(cancelled.status).toBe("cancelled");
  });

  it("manual retry re-queues failed run", () => {
    const project = createProject({ name: "test-proj", path: tempDir });
    const task = createTask({ title: "T", project_id: project.id });
    const run = enqueueAgentRun({ task_id: task.id, adapter: "claude", max_retries: 0 });
    claimNextAgentRun("worker");
    failAgentRun(run.id, "boom", { retry: false });
    expect(() => retryAgentRun(run.id)).toThrow(/Max retries/);
  });

  it("default adapters are local-only", () => {
    for (const a of getDefaultAgentAdapters()) {
      expect(JSON.stringify(a)).not.toMatch(/platform-todos|cloudflare|aws|todos\.md/i);
    }
    expect(loadAgentAdapters().length).toBeGreaterThan(0);
  });
});
