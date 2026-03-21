import { describe, it, expect, beforeAll, afterAll } from "bun:test";

let port: number;
let baseUrl: string;

beforeAll(() => {
  // Set up test DB
  process.env.SEARCH_DB_PATH = ":memory:";
  port = 19899;
  baseUrl = `http://localhost:${port}`;

  // Import and start server
  const { startServer } = require("./serve");
  startServer(port);
});

describe("REST API", () => {
  it("GET /api/providers should return 12 providers", async () => {
    const res = await fetch(`${baseUrl}/api/providers`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(12);
  });

  it("GET /api/profiles should return 6 profiles", async () => {
    const res = await fetch(`${baseUrl}/api/profiles`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(6);
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
});
