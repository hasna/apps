import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createApp } from "../index.ts";
import { getDatabase, resetDatabase, closeDatabase } from "../../db/database.ts";
import { registerAgent } from "../../db/agents.ts";
import { createProject } from "../../db/projects.ts";
import { createApiKey } from "../../lib/auth.ts";

// Use in-memory DB for all tests
process.env["TICKETS_DB_PATH"] = ":memory:";

let app: ReturnType<typeof createApp>;
let apiKey: string;
let projectId: string;

async function req(method: string, path: string, body?: unknown, key?: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key ?? apiKey) headers["X-API-Key"] = key ?? apiKey;
  return app.fetch(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  }));
}

beforeEach(async () => {
  resetDatabase();
  app = createApp();
  const db = getDatabase();

  // Bootstrap: agent + project + api key
  const agent = registerAgent({ name: "test-agent", type: "ai_agent" }, db);
  const { rawKey } = await createApiKey(agent.id, "test-key", ["read", "write"], db);
  apiKey = rawKey;
  const project = createProject({ name: "Test Project", ticket_prefix: "TST" }, db);
  projectId = project.id;
});

afterEach(() => {
  closeDatabase();
});

// ── Health ────────────────────────────────────────────────────────────────────

describe("GET /api/health", () => {
  it("returns ok without auth", async () => {
    const res = await app.fetch(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

// ── Auth ──────────────────────────────────────────────────────────────────────

describe("Auth middleware", () => {
  it("returns 401 without API key", async () => {
    const res = await app.fetch(new Request("http://localhost/api/tickets"));
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid API key", async () => {
    const res = await req("GET", "/api/tickets", undefined, "tkt_invalid");
    expect(res.status).toBe(401);
  });

  it("allows valid API key", async () => {
    const res = await req("GET", "/api/tickets");
    expect(res.status).toBe(200);
  });
});

// ── Tickets ───────────────────────────────────────────────────────────────────

describe("POST /api/tickets", () => {
  it("creates a ticket and returns 201", async () => {
    const res = await req("POST", "/api/tickets", { project_id: projectId, title: "Login fails on Safari", type: "bug", priority: "high" });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { short_id: string; status: string } };
    expect(body.data.short_id).toMatch(/^TST-\d{4}$/);
    expect(body.data.status).toBe("open");
  });

  it("returns 400 for missing title", async () => {
    const res = await req("POST", "/api/tickets", { project_id: projectId });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown project", async () => {
    const res = await req("POST", "/api/tickets", { project_id: "nonexistent", title: "Test" });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/tickets", () => {
  it("returns empty list initially", async () => {
    const res = await req("GET", "/api/tickets");
    const body = await res.json() as { data: unknown[]; meta: { total: number } };
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it("returns created tickets", async () => {
    await req("POST", "/api/tickets", { project_id: projectId, title: "First ticket" });
    await req("POST", "/api/tickets", { project_id: projectId, title: "Second ticket" });
    const res = await req("GET", "/api/tickets");
    const body = await res.json() as { meta: { total: number } };
    expect(body.meta.total).toBe(2);
  });

  it("filters by status", async () => {
    await req("POST", "/api/tickets", { project_id: projectId, title: "Open ticket" });
    const res = await req("GET", "/api/tickets?status=open");
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("filters by project_id", async () => {
    await req("POST", "/api/tickets", { project_id: projectId, title: "Project ticket" });
    const res = await req("GET", `/api/tickets?project_id=${projectId}`);
    const body = await res.json() as { meta: { total: number } };
    expect(body.meta.total).toBe(1);
  });
});

describe("GET /api/tickets/:id", () => {
  it("returns ticket by short ID", async () => {
    const createRes = await req("POST", "/api/tickets", { project_id: projectId, title: "Find me" });
    const created = await createRes.json() as { data: { short_id: string; title: string } };

    const res = await req("GET", `/api/tickets/${created.data.short_id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { title: string } };
    expect(body.data.title).toBe("Find me");
  });

  it("returns 404 for unknown ticket", async () => {
    const res = await req("GET", "/api/tickets/NOTREAL-9999");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/tickets/:id", () => {
  it("updates ticket fields", async () => {
    const createRes = await req("POST", "/api/tickets", { project_id: projectId, title: "Original" });
    const created = await createRes.json() as { data: { short_id: string; version: number } };

    const res = await req("PATCH", `/api/tickets/${created.data.short_id}`, { title: "Updated", priority: "critical" });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { title: string; priority: string; version: number } };
    expect(body.data.title).toBe("Updated");
    expect(body.data.priority).toBe("critical");
    expect(body.data.version).toBe(2);
  });
});

describe("POST /api/tickets/:id/close", () => {
  it("closes a ticket with resolution", async () => {
    const createRes = await req("POST", "/api/tickets", { project_id: projectId, title: "Bug" });
    const created = await createRes.json() as { data: { short_id: string } };

    const res = await req("POST", `/api/tickets/${created.data.short_id}/close`, { resolution: "fixed" });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string; resolution: string } };
    expect(body.data.status).toBe("closed");
    expect(body.data.resolution).toBe("fixed");
  });

  it("returns 400 for invalid state transition (already closed)", async () => {
    const createRes = await req("POST", "/api/tickets", { project_id: projectId, title: "Bug" });
    const created = await createRes.json() as { data: { short_id: string } };
    await req("POST", `/api/tickets/${created.data.short_id}/close`, { resolution: "fixed" });
    // Already closed — close again should 400
    const res = await req("POST", `/api/tickets/${created.data.short_id}/close`, { resolution: "fixed" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/tickets/:id/reopen", () => {
  it("reopens a closed ticket", async () => {
    const createRes = await req("POST", "/api/tickets", { project_id: projectId, title: "Bug" });
    const created = await createRes.json() as { data: { short_id: string } };
    await req("POST", `/api/tickets/${created.data.short_id}/close`, { resolution: "fixed" });

    const res = await req("POST", `/api/tickets/${created.data.short_id}/reopen`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { status: string; resolution: null } };
    expect(body.data.status).toBe("open");
    expect(body.data.resolution).toBeNull();
  });
});

describe("DELETE /api/tickets/:id", () => {
  it("deletes a ticket", async () => {
    const createRes = await req("POST", "/api/tickets", { project_id: projectId, title: "Delete me" });
    const created = await createRes.json() as { data: { short_id: string } };
    const del = await req("DELETE", `/api/tickets/${created.data.short_id}`);
    expect(del.status).toBe(200);
    const get = await req("GET", `/api/tickets/${created.data.short_id}`);
    expect(get.status).toBe(404);
  });
});

// ── Comments ──────────────────────────────────────────────────────────────────

describe("Comments", () => {
  it("creates and lists comments", async () => {
    const createRes = await req("POST", "/api/tickets", { project_id: projectId, title: "Commentable" });
    const created = await createRes.json() as { data: { id: string; short_id: string } };

    await req("POST", `/api/tickets/${created.data.short_id}/comments`, { content: "First comment" });
    await req("POST", `/api/tickets/${created.data.short_id}/comments`, { content: "Internal note", is_internal: true });

    const res = await req("GET", `/api/tickets/${created.data.short_id}/comments`);
    const body = await res.json() as { data: Array<{ content: string; is_internal: boolean }> };
    expect(body.data.length).toBe(2);
  });

  it("filters out internal comments when requested", async () => {
    const createRes = await req("POST", "/api/tickets", { project_id: projectId, title: "Test" });
    const created = await createRes.json() as { data: { short_id: string } };
    await req("POST", `/api/tickets/${created.data.short_id}/comments`, { content: "Public" });
    await req("POST", `/api/tickets/${created.data.short_id}/comments`, { content: "Secret", is_internal: true });

    const res = await req("GET", `/api/tickets/${created.data.short_id}/comments?include_internal=false`);
    const body = await res.json() as { data: Array<{ content: string }> };
    expect(body.data.length).toBe(1);
    expect(body.data[0]!.content).toBe("Public");
  });
});

// ── Search ────────────────────────────────────────────────────────────────────

describe("GET /api/tickets/search", () => {
  it("returns matching tickets via FTS", async () => {
    await req("POST", "/api/tickets", { project_id: projectId, title: "Authentication broken" });
    await req("POST", "/api/tickets", { project_id: projectId, title: "Dashboard loading slow" });

    const res = await req("GET", "/api/tickets/search?q=authentication");
    const body = await res.json() as { data: Array<{ title: string }> };
    expect(body.data.some((t) => t.title.toLowerCase().includes("auth"))).toBe(true);
  });
});

// ── Projects ──────────────────────────────────────────────────────────────────

describe("Projects", () => {
  it("creates and lists projects", async () => {
    await req("POST", "/api/projects", { name: "New Project" });
    const res = await req("GET", "/api/projects");
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBeGreaterThanOrEqual(2); // test project + new one
  });

  it("returns project stats", async () => {
    await req("POST", "/api/tickets", { project_id: projectId, title: "Open bug", type: "bug" });
    const res = await req("GET", `/api/projects/${projectId}/stats`);
    const body = await res.json() as { data: { open: number; total: number } };
    expect(body.data.open).toBe(1);
    expect(body.data.total).toBe(1);
  });
});
