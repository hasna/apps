import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { startDashboardServer } from "./serve";
import { sendMessage } from "../lib/messages";
import { createSpace, joinSpace } from "../lib/spaces";
import { createProject } from "../lib/projects";
import { closeDb } from "../lib/db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-server-${Date.now()}.db`);
let server: ReturnType<typeof startDashboardServer>;

beforeAll(() => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();
  server = startDashboardServer(0);
});

afterAll(() => {
  server?.stop();
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
});

const base = () => `http://localhost:${server.port}`;

describe("API /api/status", () => {
  test("returns status object", async () => {
    const res = await fetch(`${base()}/api/status`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.db_path).toBeTruthy();
    expect(typeof data.total_messages).toBe("number");
    expect(typeof data.total_sessions).toBe("number");
    expect(typeof data.total_spaces).toBe("number");
    expect(typeof data.total_projects).toBe("number");
    expect(typeof data.unread_messages).toBe("number");
  });
});

describe("API /api/messages", () => {
  test("GET returns messages array", async () => {
    sendMessage({ from: "a", to: "b", content: "test-msg" });
    const res = await fetch(`${base()}/api/messages`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0].content).toBe("test-msg"); // reversed order: newest first
  });

  test("GET respects limit param", async () => {
    sendMessage({ from: "a", to: "b", content: "1" });
    sendMessage({ from: "a", to: "b", content: "2" });
    const res = await fetch(`${base()}/api/messages?limit=1`);
    const data = await res.json() as any[];
    expect(data).toHaveLength(1);
  });

  test("GET filters by from param", async () => {
    sendMessage({ from: "special-sender", to: "b", content: "from-filter" });
    const res = await fetch(`${base()}/api/messages?from=special-sender`);
    const data = await res.json() as any[];
    expect(data.every((m: any) => m.from_agent === "special-sender")).toBe(true);
  });

  test("POST sends a message", async () => {
    const res = await fetch(`${base()}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "web", to: "cli", content: "from dashboard" }),
    });
    expect(res.status).toBe(200);
    const msg = await res.json() as any;
    expect(msg.id).toBeTruthy();
    expect(msg.from_agent).toBe("web");
    expect(msg.content).toBe("from dashboard");
  });

  test("POST returns 400 on invalid JSON", async () => {
    const res = await fetch(`${base()}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });
});

describe("API /api/sessions", () => {
  test("returns sessions array", async () => {
    const res = await fetch(`${base()}/api/sessions`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(Array.isArray(data)).toBe(true);
  });

  test("filters by agent param", async () => {
    sendMessage({ from: "sess-agent", to: "other", content: "hi", session_id: "unique-sess" });
    const res = await fetch(`${base()}/api/sessions?agent=sess-agent`);
    const data = await res.json() as any[];
    expect(data.some((s: any) => s.session_id === "unique-sess")).toBe(true);
  });
});

describe("API /api/spaces", () => {
  test("GET returns spaces array", async () => {
    createSpace("api-test-sp", "tester", { description: "Test space" });
    const res = await fetch(`${base()}/api/spaces`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.some((sp: any) => sp.name === "api-test-sp")).toBe(true);
  });

  test("POST creates a space", async () => {
    const res = await fetch(`${base()}/api/spaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "web-space", created_by: "web-user", description: "Created via API" }),
    });
    expect(res.status).toBe(200);
    const sp = await res.json() as any;
    expect(sp.name).toBe("web-space");
  });

  test("POST returns 400 on duplicate", async () => {
    createSpace("dup-sp", "tester");
    const res = await fetch(`${base()}/api/spaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dup-sp", created_by: "tester" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("API /api/projects", () => {
  test("GET returns projects array", async () => {
    createProject({ name: "api-test-proj", created_by: "tester" });
    const res = await fetch(`${base()}/api/projects`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.some((p: any) => p.name === "api-test-proj")).toBe(true);
  });

  test("POST creates a project", async () => {
    const res = await fetch(`${base()}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "web-project", created_by: "web-user", description: "Created via API" }),
    });
    expect(res.status).toBe(200);
    const p = await res.json() as any;
    expect(p.name).toBe("web-project");
    expect(p.id).toBeTruthy();
  });
});

describe("API /api/messages/search", () => {
  test("returns matching messages", async () => {
    sendMessage({ from: "search-agent", to: "other", content: "unique-search-term-xyz" });
    sendMessage({ from: "search-agent", to: "other", content: "no match here" });
    const res = await fetch(`${base()}/api/messages/search?q=unique-search-term-xyz`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data).toHaveLength(1);
    expect(data[0].content).toBe("unique-search-term-xyz");
  });

  test("returns 400 when query is missing", async () => {
    const res = await fetch(`${base()}/api/messages/search`);
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });

  test("returns 400 when query is empty", async () => {
    const res = await fetch(`${base()}/api/messages/search?q=`);
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });

  test("respects limit param", async () => {
    sendMessage({ from: "a", to: "b", content: "searchlimit-item-1" });
    sendMessage({ from: "a", to: "b", content: "searchlimit-item-2" });
    sendMessage({ from: "a", to: "b", content: "searchlimit-item-3" });
    const res = await fetch(`${base()}/api/messages/search?q=searchlimit-item&limit=2`);
    const data = await res.json() as any[];
    expect(data).toHaveLength(2);
  });

  test("filters by from param", async () => {
    sendMessage({ from: "search-sender-a", to: "b", content: "searchfrom-test" });
    sendMessage({ from: "search-sender-b", to: "b", content: "searchfrom-test" });
    const res = await fetch(`${base()}/api/messages/search?q=searchfrom-test&from=search-sender-a`);
    const data = await res.json() as any[];
    expect(data).toHaveLength(1);
    expect(data[0].from_agent).toBe("search-sender-a");
  });

  test("filters by space param", async () => {
    sendMessage({ from: "a", to: "search-sp", content: "searchspace-test", space: "search-sp" });
    sendMessage({ from: "a", to: "b", content: "searchspace-test" });
    const res = await fetch(`${base()}/api/messages/search?q=searchspace-test&space=search-sp`);
    const data = await res.json() as any[];
    expect(data).toHaveLength(1);
    expect(data[0].space).toBe("search-sp");
  });

  test("returns empty array when no matches", async () => {
    const res = await fetch(`${base()}/api/messages/search?q=absolutely-nothing-matches-this-9876`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data).toEqual([]);
  });
});

describe("API /api/messages/pinned", () => {
  test("GET returns pinned messages", async () => {
    const msg = sendMessage({ from: "pin-user", to: "other", content: "pin-me-msg" });
    // Pin the message first via the pin endpoint
    await fetch(`${base()}/api/messages/${msg.id}/pin`, { method: "POST" });
    const res = await fetch(`${base()}/api/messages/pinned`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.some((m: any) => m.id === msg.id)).toBe(true);
  });

  test("GET filters by space", async () => {
    createSpace("pin-sp", "tester");
    const msg = sendMessage({ from: "a", to: "pin-sp", content: "pinned-in-space", space: "pin-sp" });
    await fetch(`${base()}/api/messages/${msg.id}/pin`, { method: "POST" });
    const res = await fetch(`${base()}/api/messages/pinned?space=pin-sp`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.every((m: any) => m.space === "pin-sp")).toBe(true);
  });

  test("GET respects limit param", async () => {
    const m1 = sendMessage({ from: "a", to: "b", content: "pinlimit-1" });
    const m2 = sendMessage({ from: "a", to: "b", content: "pinlimit-2" });
    await fetch(`${base()}/api/messages/${m1.id}/pin`, { method: "POST" });
    await fetch(`${base()}/api/messages/${m2.id}/pin`, { method: "POST" });
    const res = await fetch(`${base()}/api/messages/pinned?limit=1`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data).toHaveLength(1);
  });
});

describe("API /api/messages/:id/pin", () => {
  test("POST pins a message", async () => {
    const msg = sendMessage({ from: "a", to: "b", content: "to-pin" });
    const res = await fetch(`${base()}/api/messages/${msg.id}/pin`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.id).toBe(msg.id);
  });

  test("POST returns 404 for non-existent message", async () => {
    const res = await fetch(`${base()}/api/messages/999999/pin`, { method: "POST" });
    expect(res.status).toBe(404);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });

  test("DELETE unpins a message", async () => {
    const msg = sendMessage({ from: "a", to: "b", content: "to-unpin" });
    await fetch(`${base()}/api/messages/${msg.id}/pin`, { method: "POST" });
    const res = await fetch(`${base()}/api/messages/${msg.id}/pin`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.id).toBe(msg.id);
  });

  test("DELETE returns 404 for non-existent message", async () => {
    const res = await fetch(`${base()}/api/messages/999999/pin`, { method: "DELETE" });
    expect(res.status).toBe(404);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });
});

describe("API /api/messages/:id (DELETE)", () => {
  test("DELETE deletes a message", async () => {
    const msg = sendMessage({ from: "del-user", to: "b", content: "delete-me" });
    const res = await fetch(`${base()}/api/messages/${msg.id}?from=del-user`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.id).toBe(msg.id);
    expect(data.deleted).toBe(true);
  });

  test("DELETE returns 400 when from param is missing", async () => {
    const msg = sendMessage({ from: "a", to: "b", content: "del-no-from" });
    const res = await fetch(`${base()}/api/messages/${msg.id}`, { method: "DELETE" });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });

  test("DELETE returns 404 for wrong sender", async () => {
    const msg = sendMessage({ from: "real-sender", to: "b", content: "not-yours" });
    const res = await fetch(`${base()}/api/messages/${msg.id}?from=wrong-sender`, { method: "DELETE" });
    expect(res.status).toBe(404);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });

  test("DELETE returns 404 for non-existent message", async () => {
    const res = await fetch(`${base()}/api/messages/999999?from=a`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("API /api/messages/:id (PUT)", () => {
  test("PUT edits a message", async () => {
    const msg = sendMessage({ from: "edit-user", to: "b", content: "original-content" });
    const res = await fetch(`${base()}/api/messages/${msg.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "edit-user", content: "updated-content" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.content).toBe("updated-content");
  });

  test("PUT returns 400 when content is missing", async () => {
    const msg = sendMessage({ from: "a", to: "b", content: "edit-no-content" });
    const res = await fetch(`${base()}/api/messages/${msg.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "a" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });

  test("PUT returns 400 when from is missing", async () => {
    const msg = sendMessage({ from: "a", to: "b", content: "edit-no-from" });
    const res = await fetch(`${base()}/api/messages/${msg.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "new" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });

  test("PUT returns 404 for wrong sender", async () => {
    const msg = sendMessage({ from: "real-owner", to: "b", content: "cant-edit" });
    const res = await fetch(`${base()}/api/messages/${msg.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "wrong-owner", content: "hacked" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });

  test("PUT returns 400 on invalid JSON", async () => {
    const msg = sendMessage({ from: "a", to: "b", content: "edit-bad-json" });
    const res = await fetch(`${base()}/api/messages/${msg.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("API /api/spaces/:name (GET)", () => {
  test("GET returns a single space", async () => {
    createSpace("get-single-sp", "tester", { description: "A test space" });
    const res = await fetch(`${base()}/api/spaces/get-single-sp`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.name).toBe("get-single-sp");
    expect(data.description).toBe("A test space");
  });

  test("GET returns 404 for non-existent space", async () => {
    const res = await fetch(`${base()}/api/spaces/does-not-exist-sp`);
    expect(res.status).toBe(404);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });
});

describe("API /api/spaces/:name (PUT)", () => {
  test("PUT updates a space description", async () => {
    createSpace("update-sp", "tester", { description: "old desc" });
    const res = await fetch(`${base()}/api/spaces/update-sp`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "new desc" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.description).toBe("new desc");
  });

  test("PUT returns 400 for non-existent space", async () => {
    const res = await fetch(`${base()}/api/spaces/nonexistent-update-sp`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "wont work" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });
});

describe("API /api/spaces/:name/archive", () => {
  test("POST archives a space", async () => {
    createSpace("archive-sp", "tester");
    const res = await fetch(`${base()}/api/spaces/archive-sp/archive`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.name).toBe("archive-sp");
  });

  test("POST returns 400 for non-existent space", async () => {
    const res = await fetch(`${base()}/api/spaces/nonexistent-archive-sp/archive`, { method: "POST" });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });
});

describe("API /api/spaces/:name/unarchive", () => {
  test("POST unarchives a space", async () => {
    createSpace("unarchive-sp", "tester");
    // Archive first
    await fetch(`${base()}/api/spaces/unarchive-sp/archive`, { method: "POST" });
    const res = await fetch(`${base()}/api/spaces/unarchive-sp/unarchive`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.name).toBe("unarchive-sp");
  });

  test("POST returns 400 for non-existent space", async () => {
    const res = await fetch(`${base()}/api/spaces/nonexistent-unarchive-sp/unarchive`, { method: "POST" });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });
});

describe("API /api/projects/:id (GET)", () => {
  test("GET returns a project by ID", async () => {
    const proj = createProject({ name: "get-proj-byid", created_by: "tester" });
    const res = await fetch(`${base()}/api/projects/${proj.id}`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.name).toBe("get-proj-byid");
    expect(data.id).toBe(proj.id);
  });

  test("GET returns a project by name", async () => {
    createProject({ name: "get-proj-byname", created_by: "tester" });
    const res = await fetch(`${base()}/api/projects/get-proj-byname`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.name).toBe("get-proj-byname");
  });

  test("GET returns 404 for non-existent project", async () => {
    const res = await fetch(`${base()}/api/projects/nonexistent-project-id`);
    expect(res.status).toBe(404);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });
});

describe("API /api/projects/:id (PUT)", () => {
  test("PUT updates a project", async () => {
    const proj = createProject({ name: "update-proj", created_by: "tester" });
    const res = await fetch(`${base()}/api/projects/${proj.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "updated desc", tags: ["tag1"] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.description).toBe("updated desc");
  });

  test("PUT returns 400 for non-existent project", async () => {
    const res = await fetch(`${base()}/api/projects/nonexistent-proj-id`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "wont work" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });
});

describe("API /api/projects/:id (DELETE)", () => {
  test("DELETE deletes a project", async () => {
    const proj = createProject({ name: "delete-proj", created_by: "tester" });
    const res = await fetch(`${base()}/api/projects/${proj.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.id).toBe(proj.id);
    expect(data.deleted).toBe(true);
  });

  test("DELETE returns 404 for non-existent project", async () => {
    const res = await fetch(`${base()}/api/projects/nonexistent-del-proj`, { method: "DELETE" });
    expect(res.status).toBe(404);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });

  test("DELETE returns 400 when spaces reference the project", async () => {
    const proj = createProject({ name: "nodelete-proj", created_by: "tester" });
    createSpace("proj-ref-sp", "tester", { project_id: proj.id });
    const res = await fetch(`${base()}/api/projects/${proj.id}`, { method: "DELETE" });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });
});

describe("API /api/agents", () => {
  test("GET returns agents array", async () => {
    const res = await fetch(`${base()}/api/agents`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(Array.isArray(data)).toBe(true);
  });

  test("GET supports online_only param", async () => {
    const res = await fetch(`${base()}/api/agents?online_only=true`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("API /api/export", () => {
  test("GET exports messages as JSON by default", async () => {
    sendMessage({ from: "export-user", to: "other", content: "export-test-msg" });
    const res = await fetch(`${base()}/api/export`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") || "";
    expect(ct).toContain("application/json");
    const data = await res.json() as any[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  test("GET exports messages as CSV", async () => {
    sendMessage({ from: "csv-user", to: "other", content: "csv-export-msg" });
    const res = await fetch(`${base()}/api/export?format=csv`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") || "";
    expect(ct).toContain("text/csv");
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
  });

  test("GET filters by space", async () => {
    createSpace("export-sp", "tester");
    sendMessage({ from: "a", to: "export-sp", content: "export-sp-msg", space: "export-sp" });
    const res = await fetch(`${base()}/api/export?space=export-sp`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.every((m: any) => m.space === "export-sp")).toBe(true);
  });

  test("GET filters by from", async () => {
    sendMessage({ from: "export-sender", to: "b", content: "export-from-msg" });
    const res = await fetch(`${base()}/api/export?from=export-sender`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.every((m: any) => m.from_agent === "export-sender")).toBe(true);
  });
});

describe("Static files", () => {
  test("unknown paths return HTML (SPA fallback) or 404", async () => {
    const res = await fetch(`${base()}/some/random/path`);
    // Either 200 (SPA fallback to index.html) or 404 (no dist)
    expect([200, 404]).toContain(res.status);
  });
});
