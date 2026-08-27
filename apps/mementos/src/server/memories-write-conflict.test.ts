// Server-side regression tests for the shared-scope write-path 500 family
// (todos PLA8-00141, skills task-drain): POST /api/memories with dedupe
// "create" (or "error") on an already-occupied unique tuple, and PATCH
// scope-change into an occupied tuple, used to surface a driver-dependent
// database constraint error — 500 "Internal server error" on the deployed
// Postgres server, 400 with a misleading enum message on SQLite. Both must be
// a handled 409 conflict naming the existing row.
//
// These tests fail against the pre-fix server: the same-tuple dedupe-create
// returns 400/500 and the dedupe-"error" collision returns 500.

// Set in-memory DB before any imports
process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const PORT = 19900 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;

const TOKEN = "tupelo";

let serverProc: ReturnType<typeof Bun.spawn>;
let agentId: string;

beforeAll(async () => {
  // The server under test is the LOCAL SQLite one. If the operator's shell has
  // cloud credentials exported the child inherits them, api mode engages, and
  // this suite would drive the real store. Strip them.
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^(HASNA_)?MEMENTOS_(API_URL|API_KEY|DATABASE_URL|STORAGE_MODE)$/.test(k)) continue;
    childEnv[k] = v;
  }
  childEnv["MEMENTOS_DB_PATH"] = ":memory:";
  // The server fails closed on state-changing requests without a key, so opt
  // in to unauthenticated writes explicitly and name the test server's own
  // origin on the state-changing allowlist (same pattern as the sibling
  // server route suites).
  childEnv["MEMENTOS_ALLOW_UNAUTHENTICATED_WRITES"] = "1";
  childEnv["MEMENTOS_CORS_ORIGIN"] = `http://localhost:${PORT}`;

  serverProc = Bun.spawn(["bun", "run", "src/server/index.ts", "--port", String(PORT)], {
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
    cwd: new URL("../../", import.meta.url).pathname.replace(/\/$/, ""),
  });

  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      /* not ready yet */
    }
    await Bun.sleep(200);
  }
  if (!ready) throw new Error("Server failed to start");

  // memories.agent_id carries a FK to agents(id), so the owner must be a real
  // row rather than an invented string.
  const agent = await post("/api/agents", { name: `${TOKEN}-owner` });
  agentId = agent.data.id as string;
  if (!agentId) throw new Error("agent fixture setup failed");
});

afterAll(() => {
  serverProc.kill();
});

async function post(path: string, body: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function patch(path: string, body: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const sharedTuple = (key: string) => ({ key, value: `${TOKEN} value`, scope: "shared", agent_id: agentId });

describe("POST /api/memories — write-path tuple collisions are handled 409s (PLA8-00141)", () => {
  // ------------------------------------------------------------------ control
  // Runs first and is load-bearing: a fresh tuple must still create (201).
  test("CONTROL: dedupe create on a fresh tuple returns 201", async () => {
    const { status, data } = await post("/api/memories", { ...sharedTuple("k-control"), dedupe: "create" });
    expect(status).toBe(201);
    expect(data.id).toBeTruthy();
  });

  test("dedupe create on an occupied tuple returns 409, not 400/500", async () => {
    const key = "k-create-collision";
    const first = await post("/api/memories", { ...sharedTuple(key), dedupe: "create" });
    expect(first.status).toBe(201);

    const second = await post("/api/memories", { ...sharedTuple(key), value: `${TOKEN} second`, dedupe: "create" });
    expect(second.status).toBe(409);
    expect(String(second.data?.error ?? "")).toContain("Memory conflict");
  });

  test("dedupe error on an occupied tuple returns 409 (was 500)", async () => {
    const key = "k-error-collision";
    const first = await post("/api/memories", { ...sharedTuple(key), dedupe: "create" });
    expect(first.status).toBe(201);

    const second = await post("/api/memories", { ...sharedTuple(key), value: `${TOKEN} third`, dedupe: "error" });
    expect(second.status).toBe(409);
    expect(String(second.data?.error ?? "")).toContain("Memory conflict");
  });

  test("dedupe create still forks when a tuple field differs", async () => {
    const key = "k-fork-ok";
    const first = await post("/api/memories", { ...sharedTuple(key), dedupe: "create" });
    expect(first.status).toBe(201);

    const forked = await post("/api/memories", {
      ...sharedTuple(key),
      session_id: "s-other",
      value: `${TOKEN} fork`,
      dedupe: "create",
    });
    expect(forked.status).toBe(201);
    expect(forked.data.session_id).toBe("s-other");
  });

  test("PATCH scope change into an occupied tuple returns 409", async () => {
    const key = "k-patch-collision";
    const shared = await post("/api/memories", { ...sharedTuple(key), dedupe: "create" });
    expect(shared.status).toBe(201);
    const privateRow = await post("/api/memories", {
      key,
      value: `${TOKEN} private`,
      scope: "private",
      agent_id: agentId,
      dedupe: "create",
    });
    expect(privateRow.status).toBe(201);

    const patched = await patch(`/api/memories/${privateRow.data.id}`, { scope: "shared" });
    expect(patched.status).toBe(409);
    expect(String(patched.data?.error ?? "")).toContain("Memory conflict");
  });
});
