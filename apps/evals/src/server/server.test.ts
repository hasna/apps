import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDatabase } from "../db/store.js";
import { createEvalsServerHandler } from "./index.js";

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

const BASE = "http://localhost:19490";
const handler = createEvalsServerHandler();

// Helper
async function post(path: string, body: unknown) {
  return handler(new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function get(path: string) {
  return handler(new Request(`${BASE}${path}`));
}

let tmpDir: string;
let datasetPath: string;
let modulePath: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "evals-server-"));
  datasetPath = join(tmpDir, "server.jsonl");
  modulePath = join(tmpDir, "adapter.js");

  writeFileSync(datasetPath, JSON.stringify({
    id: "server-run-1",
    input: "hello",
    assertions: [{ type: "contains", value: "server echo: hello" }],
    tags: ["server-success"],
  }) + "\n");

  writeFileSync(modulePath, `export default async function(input) { return "server echo: " + input; }\n`);

  closeDatabase();
});

afterAll(() => {
  closeDatabase();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
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

describe("POST /api/runs — success", () => {
  test("runs, saves, lists, and returns a baseline through the API", async () => {
    const runResponse = await post("/api/runs", {
      dataset: datasetPath,
      adapter: { type: "function", modulePath },
      skipJudge: true,
      save: true,
    });

    expect(runResponse.status).toBe(200);
    const run = await runResponse.json() as {
      id: string;
      dataset: string;
      stats: { total: number; passed: number; failed: number; errors: number };
      results: Array<{ caseId: string; verdict: string; output: string }>;
    };

    expect(run.id).toBeTruthy();
    expect(run.dataset).toBe(datasetPath);
    expect(run.stats.total).toBe(1);
    expect(run.stats.passed).toBe(1);
    expect(run.stats.failed).toBe(0);
    expect(run.stats.errors).toBe(0);
    expect(run.results[0]?.caseId).toBe("server-run-1");
    expect(run.results[0]?.verdict).toBe("PASS");
    expect(run.results[0]?.output).toBe("server echo: hello");

    const getResponse = await get(`/api/runs/${run.id}`);
    expect(getResponse.status).toBe(200);
    const fetched = await getResponse.json() as { id: string };
    expect(fetched.id).toBe(run.id);

    const listResponse = await get(`/api/runs?dataset=${encodeURIComponent(datasetPath)}`);
    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json() as Array<{ id: string; dataset: string }>;
    expect(listed.some((item) => item.id === run.id && item.dataset === datasetPath)).toBe(true);

    const baselineName = `server-main-${Date.now()}`;
    const baselineResponse = await post("/api/baselines", { name: baselineName, runId: run.id });
    expect(baselineResponse.status).toBe(200);

    const baselineRunResponse = await get(`/api/baselines/${baselineName}`);
    expect(baselineRunResponse.status).toBe(200);
    const baselineRun = await baselineRunResponse.json() as { id: string };
    expect(baselineRun.id).toBe(run.id);
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
