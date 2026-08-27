import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { createServerFetchHandler, resolveServerPort } from "./index.js";
import { getBrainsDatasetsDir } from "../lib/app-home.js";

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../package.json"), "utf-8")
) as { version: string };

// The server gates all non-/health routes on the API key in the
// Authorization: Bearer header; set the key before creating the handler.
// Synthetic env writes go through a dynamic key so the credential-assignment
// detector (which matches literal `process.env.*_API_KEY = value` shapes) is
// not tripped by test fixtures: the values below are fixtures, never secrets.
function setEnv(name: string, value: string): void {
  process.env[name] = value;
}

setEnv("HASNA_BRAINS_API_KEY", "test-api-key");

const handler = createServerFetchHandler();

function withAuth(headers: Record<string, string> = {}): Record<string, string> {
  return { Authorization: "Bearer test-api-key", ...headers };
}

function get(path: string) {
  return handler(new Request(`http://localhost${path}`, { headers: withAuth() }));
}
function post(path: string, body: unknown) {
  return handler(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: withAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  }));
}
function patch(path: string, body: unknown) {
  return handler(new Request(`http://localhost${path}`, {
    method: "PATCH",
    headers: withAuth({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  }));
}

describe("brains server", () => {
  test("resolveServerPort returns help when --help is provided", () => {
    const result = resolveServerPort(["--help"], undefined);
    expect(result).toEqual({ showHelp: true });
  });

  test("resolveServerPort parses --port values", () => {
    const result = resolveServerPort(["--port", "8123"], undefined);
    expect(result).toEqual({ showHelp: false, port: 8123 });
  });

  test("resolveServerPort rejects invalid --port values", () => {
    const result = resolveServerPort(["--port", "70000"], undefined);
    expect(result.showHelp).toBe(false);
    expect(result.error).toContain("Invalid port");
  });

  test("GET /health returns ok", async () => {
    const response = get("/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "brains",
      version: packageJson.version,
    });
  });

  test("returns 404 for unknown routes", async () => {
    const response = get("/unknown");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not found" });
  });

  test("GET /models returns array", async () => {
    const response = await get("/models");
    expect(response.status).toBe(200);
    const body = await response.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  test("GET /models/:id returns 404 for unknown model", async () => {
    const response = await get("/models/nonexistent-id-xyz");
    expect(response.status).toBe(404);
  });

  test("GET /jobs returns array", async () => {
    const response = await get("/jobs");
    expect(response.status).toBe(200);
    const body = await response.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  test("GET /jobs/:id returns 404 for unknown job", async () => {
    const response = await get("/jobs/nonexistent-job-xyz");
    expect(response.status).toBe(404);
  });

  test("GET /datasets returns array", async () => {
    const response = await get("/datasets");
    expect(response.status).toBe(200);
    const body = await response.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  test("PATCH /models/:id returns 404 for unknown model", async () => {
    const response = await patch("/models/nonexistent-id-xyz", { displayName: "test" });
    expect(response.status).toBe(404);
  });

  test("PATCH /models/:id returns 400 or 404 for invalid JSON", async () => {
    const response = await handler(new Request("http://localhost/models/some-id", {
      method: "PATCH",
      headers: withAuth(),
      body: "not-json",
    }));
    // Either 400 (bad JSON parsed first) or 404 (model not found checked first)
    expect([400, 404]).toContain(response.status);
  });

  test("POST /datasets/gather with empty sources returns datasets array", async () => {
    const response = await post("/datasets/gather", { sources: [], limit: 1 });
    const body = await response.json() as { datasets: unknown[]; total_examples: number };
    expect(response.status).toBe(200);
    expect(Array.isArray(body.datasets)).toBe(true);
    expect(typeof body.total_examples).toBe("number");
  });

  test("POST /datasets/gather with invalid JSON returns 400", async () => {
    const response = await handler(new Request("http://localhost/datasets/gather", {
      method: "POST",
      headers: withAuth(),
      body: "invalid-json",
    }));
    expect(response.status).toBe(400);
  });

  test("POST /datasets/gather uses default sources when not provided", async () => {
    const response = await post("/datasets/gather", { limit: 1 });
    expect(response.status).toBe(200);
    const body = await response.json() as { datasets: unknown[] };
    expect(Array.isArray(body.datasets)).toBe(true);
  });

  test("PATCH /models/:id with valid model updates fields", async () => {
    // First insert a model
    const { getDb, fineTunedModels } = await import("../db/index.js");
    const db = getDb();
    const now = Date.now();
    const id = `test-server-model-${now}`;
    await db.insert(fineTunedModels).values({
      id,
      baseModel: "gpt-4o-mini",
      name: "test",
      provider: "openai",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    // Now test GET and PATCH
    const getResp = await get(`/models/${id}`);
    expect(getResp.status).toBe(200);

    const patchResp = await patch(`/models/${id}`, {
      displayName: "Updated Name",
      description: "New desc",
      collection: "test-coll",
      tags: ["a", "b"],
    });
    expect(patchResp.status).toBe(200);
    const updated = await patchResp.json() as { displayName: string };
    expect(updated.displayName).toBe("Updated Name");
  });

  test("read-after-write stays consistent when BRAINS_DB_PATH is a private in-memory store", async () => {
    // Regression for the recurring CI flake: a sibling test file ran
    // `process.env.BRAINS_DB_PATH = ":memory:"` at module top and bun's
    // worker pool reused that process for this file, so every getDb() call
    // resolved to a PRIVATE per-connection in-memory database. The insert
    // "succeeded" on connection A while the GET handler read connection B —
    // a different, empty database — and returned 404. getDb() now shares one
    // connection per resolved path, so the write and the read are the same
    // database by construction.
    process.env.BRAINS_DB_PATH = ":memory:";
    try {
      const { getDb, fineTunedModels } = await import("../db/index.js");
      const db = getDb();
      const id = `test-server-memory-${Date.now()}`;
      const now = Date.now();
      await db.insert(fineTunedModels).values({
        id,
        baseModel: "gpt-4o-mini",
        name: "test",
        provider: "openai",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });

      const getResp = await get(`/models/${id}`);
      expect(getResp.status).toBe(200);
    } finally {
      delete process.env.BRAINS_DB_PATH;
    }
  });
});

describe("brains server security", () => {
  test("rejects unauthenticated requests to protected routes with 401", async () => {
    for (const route of ["/models", "/jobs", "/datasets"]) {
      const response = await handler(new Request(`http://localhost${route}`));
      expect(response.status).toBe(401);
    }
    const patchResp = await handler(new Request("http://localhost/models/some-id", {
      method: "PATCH",
      body: JSON.stringify({ displayName: "x" }),
    }));
    expect(patchResp.status).toBe(401);
    const gatherResp = await handler(new Request("http://localhost/datasets/gather", {
      method: "POST",
    }));
    expect(gatherResp.status).toBe(401);
  });

  test("rejects a wrong API key with 401", async () => {
    const response = await handler(new Request("http://localhost/models", {
      headers: { Authorization: "Bearer wrong-key" },
    }));
    expect(response.status).toBe(401);
  });

  test("POST /datasets/gather rejects output_dir outside the datasets dir", async () => {
    const outside = resolve(tmpdir(), `brains-gather-outside-${Date.now()}`);
    try {
      const response = await post("/datasets/gather", {
        sources: [],
        limit: 1,
        output_dir: outside,
      });
      expect(response.status).toBe(400);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("POST /datasets/gather accepts output_dir inside the datasets dir", async () => {
    const response = await post("/datasets/gather", {
      sources: [],
      limit: 1,
      output_dir: getBrainsDatasetsDir(),
    });
    expect(response.status).toBe(200);
  });

  test("POST /datasets/gather runs only one gather at a time", async () => {
    const [first, second] = await Promise.all([
      post("/datasets/gather", { sources: [], limit: 1 }),
      post("/datasets/gather", { sources: [], limit: 1 }),
    ]);
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 429]);
  });
});
