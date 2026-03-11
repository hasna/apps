process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { spawn, type Subprocess } from "bun";

const PORT = 19400 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;

let serverProc: Subprocess;

beforeAll(async () => {
  serverProc = spawn({
    cmd: ["bun", "run", new URL("./index.ts", import.meta.url).pathname],
    env: {
      ...process.env,
      TESTERS_DB_PATH: ":memory:",
      TESTERS_PORT: String(PORT),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for the server to be ready (poll up to 5 seconds)
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/status`);
      if (res.ok) break;
    } catch {
      // not ready yet
    }
    await Bun.sleep(100);
  }
});

afterAll(() => {
  if (serverProc) {
    serverProc.kill();
  }
});

describe("GET /api/status", () => {
  test("returns 200 with JSON status", async () => {
    const res = await fetch(`${BASE}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("scenarioCount");
    expect(body).toHaveProperty("runCount");
    expect(body).toHaveProperty("dbPath");
    expect(body.dbPath).toBe(":memory:");
  });
});

describe("POST /api/scenarios", () => {
  test("creates a scenario and returns 201", async () => {
    const res = await fetch(`${BASE}/api/scenarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", description: "desc" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("id");
    expect(body.name).toBe("test");
    expect(body.description).toBe("desc");
    expect(body.priority).toBe("medium");
    expect(body.version).toBe(1);
  });

  test("returns 400 for invalid body", async () => {
    const res = await fetch(`${BASE}/api/scenarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/scenarios", () => {
  test("returns an array of scenarios", async () => {
    const res = await fetch(`${BASE}/api/scenarios`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/scenarios/:id", () => {
  test("returns a scenario by id", async () => {
    // First create a scenario to get its id
    const createRes = await fetch(`${BASE}/api/scenarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "lookup-test", description: "for lookup" }),
    });
    const created = await createRes.json();

    const res = await fetch(`${BASE}/api/scenarios/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.name).toBe("lookup-test");
  });

  test("returns 404 for nonexistent scenario", async () => {
    const res = await fetch(`${BASE}/api/scenarios/nonexistent-id-12345`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});

describe("DELETE /api/scenarios/:id", () => {
  test("deletes a scenario and returns success", async () => {
    // Create a scenario to delete
    const createRes = await fetch(`${BASE}/api/scenarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "to-delete", description: "will be deleted" }),
    });
    const created = await createRes.json();

    const res = await fetch(`${BASE}/api/scenarios/${created.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);

    // Verify it's gone
    const getRes = await fetch(`${BASE}/api/scenarios/${created.id}`);
    expect(getRes.status).toBe(404);
  });

  test("returns 404 when deleting nonexistent scenario", async () => {
    const res = await fetch(`${BASE}/api/scenarios/nonexistent-id-12345`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/runs", () => {
  test("returns an array (empty initially)", async () => {
    const res = await fetch(`${BASE}/api/runs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe("CORS", () => {
  test("OPTIONS returns 204 with CORS headers", async () => {
    const res = await fetch(`${BASE}/api/status`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});
