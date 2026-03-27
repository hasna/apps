import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createServerFetchHandler } from "./index.js";

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../package.json"), "utf-8")
) as { version: string };

const handler = createServerFetchHandler();

function get(path: string) {
  return handler(new Request(`http://localhost${path}`));
}
function post(path: string, body: unknown) {
  return handler(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}
function patch(path: string, body: unknown) {
  return handler(new Request(`http://localhost${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("brains server", () => {
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
});
