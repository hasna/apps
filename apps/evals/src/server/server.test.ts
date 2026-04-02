import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";

// Mock adapters and judge so the server doesn't need real API keys
mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mock(async () => ({
        content: [{ type: "text", text: "REASONING: good.\nVERDICT: PASS" }],
        usage: { input_tokens: 20, output_tokens: 10 },
      })),
    };
  },
}));

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mock(async () => ({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 5 } })) } };
  },
}));

// Use in-memory DB for all server tests
process.env["EVALS_DB_PATH"] = ":memory:";
process.env["EVALS_PORT"] = "19490";

// Dynamically import the server after env vars are set
// We start it in a background process via fetch tests against the port

const BASE = "http://localhost:19490";

// Helper
async function post(path: string, body: unknown) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function get(path: string) {
  return fetch(`${BASE}${path}`);
}

let serverProc: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  // Spawn evals-serve as a subprocess
  serverProc = Bun.spawn(
    ["bun", "run", "src/server/index.ts"],
    {
      env: { ...process.env, EVALS_DB_PATH: ":memory:", EVALS_PORT: "19490" },
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  // Wait for server to be ready
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(100);
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(200) });
      if (r.ok) break;
    } catch { /* not ready yet */ }
  }
});

afterAll(() => {
  serverProc.kill();
});

describe("GET /api/health", () => {
  test("returns ok and version", async () => {
    const r = await get("/api/health");
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(body.version).toBeTruthy();
  });
});

describe("GET /api/runs — empty", () => {
  test("returns empty array when no runs saved", async () => {
    const r = await get("/api/runs");
    expect(r.status).toBe(200);
    const runs = await r.json() as unknown[];
    expect(Array.isArray(runs)).toBe(true);
  });
});

describe("POST /api/runs — validation", () => {
  test("returns 400 when dataset missing", async () => {
    const r = await post("/api/runs", { adapter: { type: "http", url: "http://localhost:1" } });
    expect(r.status).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toContain("dataset");
  });

  test("returns 400 when adapter missing", async () => {
    const r = await post("/api/runs", { dataset: "smoke.jsonl" });
    expect(r.status).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toContain("adapter");
  });
});

describe("POST /api/judge", () => {
  test("judges input/output pair", async () => {
    const r = await post("/api/judge", {
      input: "What is 2+2?",
      output: "4",
      rubric: "Must answer 4",
    });
    expect(r.status).toBe(200);
    const body = await r.json() as { verdict: string; reasoning: string };
    expect(["PASS", "FAIL", "UNKNOWN"]).toContain(body.verdict);
    expect(body.reasoning).toBeTruthy();
  });

  test("returns 400 when input missing", async () => {
    const r = await post("/api/judge", { output: "4", rubric: "Must answer 4" });
    expect(r.status).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toContain("input");
  });

  test("returns 400 when rubric missing", async () => {
    const r = await post("/api/judge", { input: "q", output: "a" });
    expect(r.status).toBe(400);
    const body = await r.json() as { error: string };
    expect(body.error).toContain("rubric");
  });
});

describe("GET /api/runs/:id — not found", () => {
  test("returns 404 for unknown run ID", async () => {
    const r = await get("/api/runs/nonexistent-run-id");
    expect(r.status).toBe(404);
    const body = await r.json() as { error: string };
    expect(body.error).toContain("not found");
  });
});

describe("POST /api/baselines — validation", () => {
  test("returns 400 when name missing", async () => {
    const r = await post("/api/baselines", { runId: "some-id" });
    expect(r.status).toBe(400);
  });

  test("returns 400 when runId missing", async () => {
    const r = await post("/api/baselines", { name: "main" });
    expect(r.status).toBe(400);
  });
});

describe("GET /api/baselines/:name — not found", () => {
  test("returns 404 for unknown baseline", async () => {
    const r = await get("/api/baselines/nonexistent");
    expect(r.status).toBe(404);
  });
});

describe("Unknown route", () => {
  test("returns 404 for unrecognised path", async () => {
    const r = await get("/api/totally-unknown-endpoint");
    expect(r.status).toBe(404);
    const body = await r.json() as { error: string };
    expect(body.error).toContain("Not found");
  });
});
