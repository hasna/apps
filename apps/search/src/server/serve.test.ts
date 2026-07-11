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
  delete process.env.HASNA_SEARCH_ALLOWED_ORIGINS;
  delete process.env.SEARCH_ALLOWED_ORIGINS;
  delete process.env.HASNA_SEARCH_API_TOKEN;
  delete process.env.SEARCH_API_TOKEN;
  port = 19899;
  baseUrl = `http://127.0.0.1:${port}`;
  indexedDir = mkdtempSync(join(tmpdir(), "search-serve-"));
  writeFileSync(join(indexedDir, "serve-needle.ts"), "export const serveNeedleSymbol = 1;");

  // Import and start server
  const { startServer } = require("./serve");
  startServer(port, { hostname: "127.0.0.1" });
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

  it("OPTIONS should echo trusted local CORS origins without wildcarding", async () => {
    const origin = "http://localhost:5173";
    const res = await fetch(`${baseUrl}/api/search`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });

  it("GET /api/providers should echo trusted local CORS origins without wildcarding", async () => {
    const origin = "http://localhost:5173";
    const res = await fetch(`${baseUrl}/api/providers`, {
      headers: { Origin: origin },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });

  it("should reject hostile browser preflight requests for local-file APIs", async () => {
    const res = await fetch(`${baseUrl}/api/find?q=anything&kind=content`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });

  it("should reject hostile browser reads of local-file search results", async () => {
    const res = await fetch(`${baseUrl}/api/find?q=anything&kind=content`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Origin");
  });

  it("should reject hostile browser reads of local providers through unified search", async () => {
    for (const path of [
      "/api/search?q=anything&providers=files",
      "/api/search?q=anything&providers=content",
      "/api/search/files?q=anything",
      "/api/search/content?q=anything",
    ]) {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { Origin: "https://evil.example" },
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Origin");
    }
  });

  it("should require a bearer token for local providers through unified search when publicly bound", async () => {
    const { handleServerRequest } = require("./serve");
    for (const path of [
      "/api/search?q=anything&providers=files",
      "/api/search?q=anything&providers=content",
      "/api/search/files?q=anything",
      "/api/search/content?q=anything",
      "/api/search?q=anything",
    ]) {
      const res = await handleServerRequest(
        new Request(`http://192.0.2.10${path}`),
        { requireBearerTokenForSensitiveRoutes: true },
      );
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("bearer token");
    }
  });

  it("should keep invalid online-only provider errors on the normal search route", async () => {
    const { handleServerRequest } = require("./serve");
    const res = await handleServerRequest(new Request("http://127.0.0.1/api/search?q=x&providers=bogus"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Unknown search provider");
  });

  it("should reject null-origin browser reads of local-file search results", async () => {
    const res = await fetch(`${baseUrl}/api/find?q=anything&kind=content`, {
      headers: { Origin: "null" },
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Origin");
  });

  it("should reject hostile browser writes to local index roots", async () => {
    const res = await fetch(`${baseUrl}/api/index`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify({ path: indexedDir, name: "evil-origin" }),
    });
    expect(res.status).toBe(403);

    const roots = await (await fetch(`${baseUrl}/api/index`)).json();
    expect(roots.length).toBe(0);
  });

  it("should reject non-loopback local-file request hosts without a bearer token", async () => {
    const { handleServerRequest } = require("./serve");
    const res = await handleServerRequest(new Request("http://192.0.2.10/api/find?q=anything"));
    expect(res.status).toBe(403);
  });

  it("should reject spoofed loopback Host values when search-serve is publicly bound", async () => {
    const { handleServerRequest } = require("./serve");
    const res = await handleServerRequest(
      new Request("http://127.0.0.1/api/find?q=anything", {
        headers: { Host: "127.0.0.1" },
      }),
      { requireBearerTokenForSensitiveRoutes: true },
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("bearer token");
  });

  it("should allow explicit bearer-token access for non-loopback local-file request hosts", async () => {
    const { handleServerRequest } = require("./serve");
    process.env.HASNA_SEARCH_API_TOKEN = "test-token";
    try {
      const res = await handleServerRequest(
        new Request("http://192.0.2.10/api/find?q=anything", {
          headers: { Authorization: "Bearer test-token" },
        }),
        { requireBearerTokenForSensitiveRoutes: true },
      );
      expect(res.status).toBe(200);
    } finally {
      delete process.env.HASNA_SEARCH_API_TOKEN;
    }
  });

  it("should allow trusted bearer-token preflight when search-serve is publicly bound", async () => {
    const { handleServerRequest } = require("./serve");
    process.env.HASNA_SEARCH_API_TOKEN = "test-token";
    process.env.HASNA_SEARCH_ALLOWED_ORIGINS = "https://app.example";
    try {
      const res = await handleServerRequest(
        new Request("http://192.0.2.10/api/find?q=anything", {
          method: "OPTIONS",
          headers: {
            Origin: "https://app.example",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization",
          },
        }),
        { requireBearerTokenForSensitiveRoutes: true },
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Authorization");
    } finally {
      delete process.env.HASNA_SEARCH_API_TOKEN;
      delete process.env.HASNA_SEARCH_ALLOWED_ORIGINS;
    }
  });

  it("should reject hostile browser access to MCP under search-serve", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });

  it("should require a bearer token for MCP when search-serve is publicly bound", async () => {
    const { handleServerRequest } = require("./serve");
    const res = await handleServerRequest(
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: { Host: "127.0.0.1" },
      }),
      { requireBearerTokenForSensitiveRoutes: true },
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("MCP HTTP transport");
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
