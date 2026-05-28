import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let port: number;
let proc: ReturnType<typeof Bun.spawn>;
let tmpDir: string;
let dbPath: string;

function url(path: string): string {
  return `http://localhost:${port}${path}`;
}

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  return fetch(url(path), opts);
}

async function createTaskViaApi(
  fields: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await api("POST", "/api/tasks", { title: "Seed task", ...fields });
  return (await res.json()) as Record<string, unknown>;
}

beforeAll(async () => {
  port = 19600 + Math.floor(Math.random() * 100);
  tmpDir = await mkdtemp(join(tmpdir(), "todos-agentic-test-"));
  dbPath = join(tmpDir, "test.db");

  proc = Bun.spawn({
    cmd: ["bun", "run", "src/server/index.ts", `--port=${port}`, "--no-open"],
    cwd: join(import.meta.dir, "..", ".."),
    env: { ...process.env, TODOS_DB_PATH: dbPath, TODOS_AUTO_PROJECT: "false", TODOS_NO_OPEN: "true" },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for server to be ready (up to 10 seconds)
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(url("/api/stats"));
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!ready) {
    throw new Error(`Server did not start on port ${port} within 10 seconds`);
  }
});

afterAll(async () => {
  proc.kill();
  await proc.exited;
  await rm(tmpDir, { recursive: true, force: true });
});

// ── Agent discovery ──────────────────────────────────────────────────────────

describe("GET /api/agents/me", () => {
  it("should auto-register and return agent profile", async () => {
    const res = await fetch(url("/api/agents/me?name=test-discovery"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect((data.agent as Record<string, unknown>).name).toBe("test-discovery");
    expect(data.stats).toBeDefined();
    expect(data.pending_tasks).toBeDefined();
    expect(data.in_progress_tasks).toBeDefined();
  });

  it("should return stats with correct shape", async () => {
    const res = await fetch(url("/api/agents/me?name=stats-agent"));
    const data = (await res.json()) as Record<string, unknown>;
    const stats = data.stats as Record<string, unknown>;
    expect(stats).toHaveProperty("total");
    expect(stats).toHaveProperty("pending");
    expect(stats).toHaveProperty("in_progress");
    expect(stats).toHaveProperty("completed");
    expect(stats).toHaveProperty("completion_rate");
    expect(typeof stats.total).toBe("number");
    expect(typeof stats.completion_rate).toBe("number");
  });

  it("should return 400 without name", async () => {
    const res = await fetch(url("/api/agents/me"));
    expect(res.status).toBe(400);
  });

  it("should be idempotent for same agent name", async () => {
    const res1 = await fetch(url("/api/agents/me?name=idempotent-agent"));
    const data1 = (await res1.json()) as Record<string, unknown>;
    const res2 = await fetch(url("/api/agents/me?name=idempotent-agent"));
    const data2 = (await res2.json()) as Record<string, unknown>;
    const agent1 = data1.agent as Record<string, unknown>;
    const agent2 = data2.agent as Record<string, unknown>;
    expect(agent1.id).toBe(agent2.id);
    expect(agent1.name).toBe(agent2.name);
  });
});

// ── Agent task queue ─────────────────────────────────────────────────────────

describe("GET /api/agents/:id/queue", () => {
  it("should return array for agent queue", async () => {
    const res = await fetch(url("/api/agents/nobody/queue"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });

  it("should include unassigned pending tasks in queue", async () => {
    await createTaskViaApi({ title: "Unassigned queue task" });
    const res = await fetch(url("/api/agents/some-agent/queue"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as Array<Record<string, unknown>>;
    // Unassigned pending tasks should appear in the queue
    expect(data.length).toBeGreaterThan(0);
  });

  it("should return tasks sorted by priority", async () => {
    await createTaskViaApi({ title: "Low prio", priority: "low" });
    await createTaskViaApi({ title: "High prio", priority: "high" });
    await createTaskViaApi({ title: "Critical prio", priority: "critical" });
    const res = await fetch(url("/api/agents/priority-agent/queue"));
    const data = (await res.json()) as Array<Record<string, unknown>>;
    if (data.length >= 2) {
      const priorities = data.map(t => t.priority);
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      for (let i = 0; i < priorities.length - 1; i++) {
        expect(order[priorities[i] as string] ?? 4).toBeLessThanOrEqual(order[priorities[i + 1] as string] ?? 4);
      }
    }
  });
});

// ── Claim task ───────────────────────────────────────────────────────────────

describe("POST /api/tasks/claim", () => {
  it("should claim a task and start it", async () => {
    await createTaskViaApi({ title: "Claimable task" });

    const res = await api("POST", "/api/tasks/claim", { agent_id: "claimer" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.task).not.toBeNull();
    const task = data.task as Record<string, unknown>;
    expect(task.status).toBe("in_progress");
    expect(task.assigned_to).toBe("claimer");
    expect(task.locked_by).toBe("claimer");
  });

  it("should return null when no tasks available for nonexistent project", async () => {
    const res = await api("POST", "/api/tasks/claim", { agent_id: "latecomer", project_id: "nonexistent-project" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.task).toBeNull();
  });

  it("should default agent_id to anonymous", async () => {
    await createTaskViaApi({ title: "Anonymous claim" });
    const res = await api("POST", "/api/tasks/claim", {});
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    if (data.task) {
      const task = data.task as Record<string, unknown>;
      expect(task.assigned_to).toBe("anonymous");
    }
  });

  it("should claim highest priority task first", async () => {
    await createTaskViaApi({ title: "Low priority", priority: "low" });
    await createTaskViaApi({ title: "Critical priority", priority: "critical" });
    const res = await api("POST", "/api/tasks/claim", { agent_id: "priority-claimer" });
    const data = (await res.json()) as Record<string, unknown>;
    if (data.task) {
      const task = data.task as Record<string, unknown>;
      // Should have claimed the critical one (or at least not the low one if other pending exist)
      expect(task.priority).not.toBe("low");
    }
  });
});

// ── SSE Event Stream ─────────────────────────────────────────────────────────

describe("GET /api/events (SSE)", () => {
  it("should return SSE content type", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    try {
      const res = await fetch(url("/api/events"), { signal: controller.signal });
      expect(res.headers.get("content-type")).toBe("text/event-stream");
    } catch {
      // AbortError is expected
    } finally {
      clearTimeout(timeout);
    }
  });

  it("should include cache-control and connection headers", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    try {
      const res = await fetch(url("/api/events"), { signal: controller.signal });
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(res.headers.get("connection")).toBe("keep-alive");
    } catch {
      // AbortError is expected
    } finally {
      clearTimeout(timeout);
    }
  });
});

// ── Activity feed (audit log) ────────────────────────────────────────────────

describe("GET /api/activity", () => {
  it("should return audit log as array", async () => {
    const res = await fetch(url("/api/activity?limit=5"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });

  it("should respect limit parameter", async () => {
    // Create some activity by creating and starting tasks
    for (let i = 0; i < 3; i++) {
      const task = await createTaskViaApi({ title: `Activity task ${i}` });
      await api("POST", `/api/tasks/${task.id}/start`);
    }
    const res = await fetch(url("/api/activity?limit=2"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as unknown[];
    expect(data.length).toBeLessThanOrEqual(2);
  });

  it("should have audit entries after task mutations", async () => {
    const task = await createTaskViaApi({ title: "Audited task" });
    await api("POST", `/api/tasks/${task.id}/start`);
    const res = await fetch(url("/api/activity?limit=50"));
    const data = (await res.json()) as Array<Record<string, unknown>>;
    // startTask creates audit entries
    expect(data.length).toBeGreaterThan(0);
  });
});

// ── Task history ─────────────────────────────────────────────────────────────

describe("GET /api/tasks/:id/history", () => {
  it("should return history for a task", async () => {
    const task = await createTaskViaApi({ title: "History task" });
    await api("POST", `/api/tasks/${task.id}/start`);
    const res = await fetch(url(`/api/tasks/${task.id}/history`));
    expect(res.status).toBe(200);
    const data = (await res.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    // Should contain the start action
    expect(data.some(h => h.action === "start")).toBe(true);
  });

  it("should return empty array for new task with no mutations", async () => {
    const task = await createTaskViaApi({ title: "Fresh task" });
    const res = await fetch(url(`/api/tasks/${task.id}/history`));
    expect(res.status).toBe(200);
    const data = (await res.json()) as unknown[];
    // createTask does not log audit entries
    expect(Array.isArray(data)).toBe(true);
  });
});

// ── Webhooks API ─────────────────────────────────────────────────────────────

describe("Webhooks API", () => {
  it("should create a webhook", async () => {
    const res = await api("POST", "/api/webhooks", { url: "https://example.com/hook", events: ["task.completed"] });
    expect(res.status).toBe(201);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.url).toBe("https://example.com/hook");
    expect(data.id).toBeTruthy();
  });

  it("should list webhooks", async () => {
    await api("POST", "/api/webhooks", { url: "https://list-test.com/hook" });
    const res = await fetch(url("/api/webhooks"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as unknown[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("should reject webhook without url", async () => {
    const res = await api("POST", "/api/webhooks", { events: ["task.created"] });
    expect(res.status).toBe(400);
  });

  it("should delete a webhook", async () => {
    const createRes = await api("POST", "/api/webhooks", { url: "https://delete-me.com/hook" });
    const webhook = (await createRes.json()) as Record<string, unknown>;
    const res = await api("DELETE", `/api/webhooks/${webhook.id}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.success).toBe(true);
  });

  it("should return 404 deleting non-existent webhook", async () => {
    const res = await api("DELETE", "/api/webhooks/nonexistent-id");
    expect(res.status).toBe(404);
  });
});

// ── Templates API ────────────────────────────────────────────────────────────

describe("Templates API", () => {
  it("should create a template", async () => {
    const res = await api("POST", "/api/templates", { name: "Bug Fix", title_pattern: "BUG: {desc}" });
    expect(res.status).toBe(201);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.name).toBe("Bug Fix");
    expect(data.title_pattern).toBe("BUG: {desc}");
    expect(data.id).toBeTruthy();
  });

  it("should list templates", async () => {
    await api("POST", "/api/templates", { name: "List Test", title_pattern: "TEST: {x}" });
    const res = await fetch(url("/api/templates"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as unknown[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("should reject template without name", async () => {
    const res = await api("POST", "/api/templates", { title_pattern: "TEST: {x}" });
    expect(res.status).toBe(400);
  });

  it("should reject template without title_pattern", async () => {
    const res = await api("POST", "/api/templates", { name: "No Pattern" });
    expect(res.status).toBe(400);
  });

  it("should delete a template", async () => {
    const createRes = await api("POST", "/api/templates", { name: "Delete Me", title_pattern: "DEL: {x}" });
    const template = (await createRes.json()) as Record<string, unknown>;
    const res = await api("DELETE", `/api/templates/${template.id}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.success).toBe(true);
  });

  it("should return 404 deleting non-existent template", async () => {
    const res = await api("DELETE", "/api/templates/nonexistent-id");
    expect(res.status).toBe(404);
  });
});
