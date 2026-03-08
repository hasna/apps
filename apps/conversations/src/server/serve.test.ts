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

describe("Static files", () => {
  test("unknown paths return HTML (SPA fallback) or 404", async () => {
    const res = await fetch(`${base()}/some/random/path`);
    // Either 200 (SPA fallback to index.html) or 404 (no dist)
    expect([200, 404]).toContain(res.status);
  });
});
