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

/**
 * Helper: create a task via API and return the parsed JSON body.
 */
async function createTaskViaApi(
  fields: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await api("POST", "/api/tasks", { title: "Seed task", ...fields });
  return (await res.json()) as Record<string, unknown>;
}

beforeAll(async () => {
  port = 19400 + Math.floor(Math.random() * 100);
  tmpDir = await mkdtemp(join(tmpdir(), "todos-server-test-"));
  dbPath = join(tmpDir, "test.db");

  proc = Bun.spawn({
    cmd: ["bun", "run", "src/server/index.ts", `--port=${port}`],
    cwd: join(import.meta.dir, "..", ".."),
    env: { ...process.env, TODOS_DB_PATH: dbPath, TODOS_AUTO_PROJECT: "false" },
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

// ── GET /api/stats ──────────────────────────────────────────────────────────

describe("GET /api/stats", () => {
  it("should return stats object with correct shape", async () => {
    const res = await api("GET", "/api/stats");
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data).toHaveProperty("total_tasks");
    expect(data).toHaveProperty("pending");
    expect(data).toHaveProperty("in_progress");
    expect(data).toHaveProperty("completed");
    expect(data).toHaveProperty("failed");
    expect(data).toHaveProperty("cancelled");
    expect(data).toHaveProperty("projects");
    expect(data).toHaveProperty("agents");
    expect(typeof data.total_tasks).toBe("number");
    expect(typeof data.pending).toBe("number");
  });

  it("should reflect newly created tasks in counts", async () => {
    const before = (await (await api("GET", "/api/stats")).json()) as Record<string, number>;
    await createTaskViaApi({ title: "Stats counter test" });
    const after = (await (await api("GET", "/api/stats")).json()) as Record<string, number>;
    expect(after.total_tasks).toBe(before.total_tasks + 1);
    expect(after.pending).toBe(before.pending + 1);
  });
});

// ── GET /api/tasks ──────────────────────────────────────────────────────────

describe("GET /api/tasks", () => {
  it("should return an array of tasks", async () => {
    const res = await api("GET", "/api/tasks");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("should filter tasks by status", async () => {
    // Create a task that is pending
    await createTaskViaApi({ title: "Pending filter test" });

    const res = await api("GET", "/api/tasks?status=pending");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Array<Record<string, unknown>>;
    expect(data.length).toBeGreaterThan(0);
    for (const task of data) {
      expect(task.status).toBe("pending");
    }
  });

  it("should respect limit parameter", async () => {
    // Ensure at least 3 tasks exist
    await createTaskViaApi({ title: "Limit test 1" });
    await createTaskViaApi({ title: "Limit test 2" });
    await createTaskViaApi({ title: "Limit test 3" });

    const res = await api("GET", "/api/tasks?limit=2");
    expect(res.status).toBe(200);
    const data = (await res.json()) as Array<Record<string, unknown>>;
    expect(data.length).toBeLessThanOrEqual(2);
  });

  it("should return task summary fields", async () => {
    await createTaskViaApi({ title: "Field check task" });
    const res = await api("GET", "/api/tasks?limit=1");
    const data = (await res.json()) as Array<Record<string, unknown>>;
    expect(data.length).toBeGreaterThan(0);
    const task = data[0]!;
    // Verify summary shape from taskToSummary
    expect(task).toHaveProperty("id");
    expect(task).toHaveProperty("title");
    expect(task).toHaveProperty("status");
    expect(task).toHaveProperty("priority");
    expect(task).toHaveProperty("version");
    expect(task).toHaveProperty("created_at");
    expect(task).toHaveProperty("updated_at");
  });
});

// ── POST /api/tasks ─────────────────────────────────────────────────────────

describe("POST /api/tasks", () => {
  it("should create a task with a title", async () => {
    const res = await api("POST", "/api/tasks", { title: "Brand new task" });
    expect(res.status).toBe(201);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.title).toBe("Brand new task");
    expect(data.status).toBe("pending");
    expect(data.priority).toBe("medium");
    expect(data.id).toBeTruthy();
    expect(data.version).toBe(1);
  });

  it("should create a task with optional fields", async () => {
    const res = await api("POST", "/api/tasks", {
      title: "Full task",
      description: "A thorough description",
      priority: "high",
    });
    expect(res.status).toBe(201);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.title).toBe("Full task");
    expect(data.description).toBe("A thorough description");
    expect(data.priority).toBe("high");
  });

  it("should return 400 when title is missing", async () => {
    const res = await api("POST", "/api/tasks", { description: "no title" });
    expect(res.status).toBe(400);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe("Missing 'title'");
  });

  it("should return 400 when title is empty string", async () => {
    const res = await api("POST", "/api/tasks", { title: "" });
    expect(res.status).toBe(400);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe("Missing 'title'");
  });
});

// ── GET /api/tasks/:id ──────────────────────────────────────────────────────

describe("GET /api/tasks/:id", () => {
  it("should return a single task by id", async () => {
    const created = await createTaskViaApi({ title: "Get by ID" });
    const id = created.id as string;

    const res = await api("GET", `/api/tasks/${id}`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.id).toBe(id);
    expect(data.title).toBe("Get by ID");
  });

  it("should return 404 for non-existent task id", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await api("GET", `/api/tasks/${fakeId}`);
    expect(res.status).toBe(404);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe("Task not found");
  });
});

// ── PATCH /api/tasks/:id ────────────────────────────────────────────────────

describe("PATCH /api/tasks/:id", () => {
  it("should update task fields", async () => {
    const created = await createTaskViaApi({ title: "To be updated" });
    const id = created.id as string;

    const res = await api("PATCH", `/api/tasks/${id}`, {
      title: "Updated title",
      priority: "high",
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.title).toBe("Updated title");
    expect(data.priority).toBe("high");
    expect(data.version).toBe(2);
  });

  it("should update task status", async () => {
    const created = await createTaskViaApi({ title: "Status update test" });
    const id = created.id as string;

    const res = await api("PATCH", `/api/tasks/${id}`, {
      status: "cancelled",
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe("cancelled");
  });

  it("should return 404 for non-existent task", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await api("PATCH", `/api/tasks/${fakeId}`, {
      title: "Nope",
    });
    expect(res.status).toBe(404);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe("Task not found");
  });
});

// ── DELETE /api/tasks/:id ───────────────────────────────────────────────────

describe("DELETE /api/tasks/:id", () => {
  it("should delete a task and return success", async () => {
    const created = await createTaskViaApi({ title: "Delete me" });
    const id = created.id as string;

    const res = await api("DELETE", `/api/tasks/${id}`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.success).toBe(true);

    // Verify the task is gone
    const check = await api("GET", `/api/tasks/${id}`);
    expect(check.status).toBe(404);
  });

  it("should return 404 for non-existent task", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await api("DELETE", `/api/tasks/${fakeId}`);
    expect(res.status).toBe(404);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe("Task not found");
  });
});

// ── POST /api/tasks/:id/start ───────────────────────────────────────────────

describe("POST /api/tasks/:id/start", () => {
  it("should start a task and set status to in_progress", async () => {
    const created = await createTaskViaApi({ title: "Start me" });
    const id = created.id as string;

    const res = await api("POST", `/api/tasks/${id}/start`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe("in_progress");
    expect(data.assigned_to).toBe("dashboard");
    expect(data.locked_by).toBe("dashboard");
  });

  it("should return 500 for non-existent task", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await api("POST", `/api/tasks/${fakeId}/start`);
    // startTask throws TaskNotFoundError, caught as 500 in the server
    expect(res.status).toBe(500);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBeTruthy();
  });
});

// ── POST /api/tasks/:id/complete ────────────────────────────────────────────

describe("POST /api/tasks/:id/complete", () => {
  it("should complete a started task", async () => {
    const created = await createTaskViaApi({ title: "Complete me" });
    const id = created.id as string;

    // Must start the task first
    await api("POST", `/api/tasks/${id}/start`);

    const res = await api("POST", `/api/tasks/${id}/complete`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe("completed");
    expect(data.completed_at).toBeTruthy();
    expect(data.locked_by).toBeNull();
  });

  it("should return 500 for non-existent task", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await api("POST", `/api/tasks/${fakeId}/complete`);
    expect(res.status).toBe(500);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBeTruthy();
  });
});

// ── GET /api/projects ───────────────────────────────────────────────────────

describe("GET /api/projects", () => {
  it("should return an array of projects", async () => {
    const res = await api("GET", "/api/projects");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});

// ── GET /api/agents ─────────────────────────────────────────────────────────

describe("GET /api/agents", () => {
  it("should return an array of agents", async () => {
    const res = await api("GET", "/api/agents");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});

// ── CORS (OPTIONS) ──────────────────────────────────────────────────────────

describe("OPTIONS (CORS)", () => {
  it("should return CORS headers on OPTIONS request", async () => {
    const res = await fetch(url("/api/tasks"), { method: "OPTIONS" });
    expect(res.status).toBe(200);

    const headers = res.headers;
    expect(headers.get("Access-Control-Allow-Origin")).toBe(`http://localhost:${port}`);
    expect(headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(headers.get("Access-Control-Allow-Methods")).toContain("PATCH");
    expect(headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
    expect(headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
  });
});

// ── 404 for unknown paths ───────────────────────────────────────────────────

describe("Unknown routes", () => {
  it("should return 404 for unknown API path via non-GET method", async () => {
    // GET on unknown paths may fall through to SPA static file serving,
    // so we use POST on a non-existent API path to hit the 404 handler.
    const res = await api("POST", "/api/nonexistent");
    expect(res.status).toBe(404);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe("Not found");
  });

  it("should return 404 for non-GET/HEAD on unknown top-level path", async () => {
    const res = await api("POST", "/totally-unknown-path");
    expect(res.status).toBe(404);
  });
});

// ── Response headers ────────────────────────────────────────────────────────

describe("Response headers", () => {
  it("should include security headers on API responses", async () => {
    const res = await api("GET", "/api/stats");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("should include Content-Type: application/json on API responses", async () => {
    const res = await api("GET", "/api/stats");
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("should include CORS Allow-Origin header on API responses", async () => {
    const res = await api("GET", "/api/tasks");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(`http://localhost:${port}`);
  });
});

// ── End-to-end task lifecycle ───────────────────────────────────────────────

describe("Task lifecycle (end-to-end)", () => {
  it("should create, start, complete, and verify a task", async () => {
    // 1. Create
    const createRes = await api("POST", "/api/tasks", { title: "Lifecycle task" });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;
    const id = created.id as string;
    expect(created.status).toBe("pending");

    // 2. Verify it shows up in list
    const listRes = await api("GET", "/api/tasks");
    const tasks = (await listRes.json()) as Array<Record<string, unknown>>;
    const found = tasks.find((t) => t.id === id);
    expect(found).toBeTruthy();

    // 3. Start
    const startRes = await api("POST", `/api/tasks/${id}/start`);
    expect(startRes.status).toBe(200);
    const started = (await startRes.json()) as Record<string, unknown>;
    expect(started.status).toBe("in_progress");

    // 4. Complete
    const completeRes = await api("POST", `/api/tasks/${id}/complete`);
    expect(completeRes.status).toBe(200);
    const completed = (await completeRes.json()) as Record<string, unknown>;
    expect(completed.status).toBe("completed");
    expect(completed.completed_at).toBeTruthy();

    // 5. Delete
    const deleteRes = await api("DELETE", `/api/tasks/${id}`);
    expect(deleteRes.status).toBe(200);

    // 6. Verify gone
    const checkRes = await api("GET", `/api/tasks/${id}`);
    expect(checkRes.status).toBe(404);
  });
});
