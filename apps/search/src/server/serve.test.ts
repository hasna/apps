import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let port: number;
let baseUrl: string;
let indexedDir: string;

beforeAll(() => {
  // Set up test DBs (history + local file index)
  process.env.SEARCH_DB_PATH = ":memory:";
  process.env.SEARCH_INDEX_DB_PATH = ":memory:";
  port = 19899;
  baseUrl = `http://localhost:${port}`;
  indexedDir = mkdtempSync(join(tmpdir(), "search-serve-"));
  writeFileSync(join(indexedDir, "serve-needle.ts"), "export const serveNeedleSymbol = 1;");

  // Import and start server
  const { startServer } = require("./serve");
  startServer(port);
});

afterAll(() => {
  rmSync(indexedDir, { recursive: true, force: true });
});

describe("REST API", () => {
  it("GET /api/providers should return 14 providers", async () => {
    const res = await fetch(`${baseUrl}/api/providers`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(14);
  });

  it("GET /api/profiles should return 7 profiles", async () => {
    const res = await fetch(`${baseUrl}/api/profiles`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(7);
  });

  it("GET /api/stats should return stats", async () => {
    const res = await fetch(`${baseUrl}/api/stats`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.totalSearches).toBe("number");
    expect(typeof data.totalResults).toBe("number");
  });

  it("GET /api/searches should return empty initially", async () => {
    const res = await fetch(`${baseUrl}/api/searches`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(0);
  });

  it("GET /api/saved-searches should return empty initially", async () => {
    const res = await fetch(`${baseUrl}/api/saved-searches`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /api/config should return config", async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.defaultLimit).toBe(10);
    expect(data.dedup).toBe(true);
  });

  it("GET /api/search without q should return 400", async () => {
    const res = await fetch(`${baseUrl}/api/search`);
    expect(res.status).toBe(400);
  });

  it("PUT /api/providers/:name should toggle provider", async () => {
    const res = await fetch(`${baseUrl}/api/providers/google`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);

    // Verify
    const providers = await (await fetch(`${baseUrl}/api/providers`)).json();
    const google = providers.find((p: any) => p.name === "google");
    expect(google.enabled).toBe(false);

    // Re-enable
    await fetch(`${baseUrl}/api/providers/google`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
  });

  it("POST /api/saved-searches should create a saved search", async () => {
    const res = await fetch(`${baseUrl}/api/saved-searches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Save", query: "test query", providers: ["google"] }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("Test Save");
    expect(data.query).toBe("test query");
  });

  it("OPTIONS should return CORS headers", async () => {
    const res = await fetch(`${baseUrl}/api/search`, { method: "OPTIONS" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("GET /api/find without q should return 400", async () => {
    const res = await fetch(`${baseUrl}/api/find`);
    expect(res.status).toBe(400);
  });

  it("GET /api/find with empty index reports indexed:false", async () => {
    const res = await fetch(`${baseUrl}/api/find?q=anything`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.indexed).toBe(false);
  });

  it("local index lifecycle: add, find, update, remove", async () => {
    // Add
    const addRes = await fetch(`${baseUrl}/api/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: indexedDir, name: "serve-test" }),
    });
    expect(addRes.status).toBe(201);
    const added = await addRes.json();
    expect(added.root.status).toBe("ready");
    expect(added.stats.added).toBe(1);

    // List
    const listRes = await fetch(`${baseUrl}/api/index`);
    const roots = await listRes.json();
    expect(roots.length).toBe(1);
    expect(roots[0].name).toBe("serve-test");

    // Find by name and by content
    const byName = await (await fetch(`${baseUrl}/api/find?q=serve-needle`)).json();
    expect(byName.indexed).toBe(true);
    expect(byName.results.length).toBe(1);
    expect(byName.results[0].path).toBe(join(indexedDir, "serve-needle.ts"));

    const byContent = await (await fetch(`${baseUrl}/api/find?q=serveNeedleSymbol&kind=content`)).json();
    expect(byContent.results.length).toBe(1);
    expect(byContent.results[0].line).toBe(1);

    // Update
    const updateRes = await fetch(`${baseUrl}/api/index/serve-test`, { method: "PUT" });
    expect(updateRes.status).toBe(200);
    const stats = await updateRes.json();
    expect(stats.fileCount).toBe(1);

    // Remove
    const rmRes = await fetch(`${baseUrl}/api/index/serve-test`, { method: "DELETE" });
    expect(rmRes.status).toBe(200);
    const after = await (await fetch(`${baseUrl}/api/index`)).json();
    expect(after.length).toBe(0);
  });
});
