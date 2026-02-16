import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { startDashboardServer } from "./serve";
import { sendMessage } from "../lib/messages";
import { createChannel, joinChannel } from "../lib/channels";
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
    expect(typeof data.total_channels).toBe("number");
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

describe("API /api/channels", () => {
  test("GET returns channels array", async () => {
    createChannel("api-test-ch", "tester", "Test channel");
    const res = await fetch(`${base()}/api/channels`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.some((ch: any) => ch.name === "api-test-ch")).toBe(true);
  });

  test("POST creates a channel", async () => {
    const res = await fetch(`${base()}/api/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "web-channel", created_by: "web-user", description: "Created via API" }),
    });
    expect(res.status).toBe(200);
    const ch = await res.json() as any;
    expect(ch.name).toBe("web-channel");
  });

  test("POST returns 400 on duplicate", async () => {
    createChannel("dup-ch", "tester");
    const res = await fetch(`${base()}/api/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dup-ch", created_by: "tester" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Static files", () => {
  test("unknown paths return HTML (SPA fallback) or 404", async () => {
    const res = await fetch(`${base()}/some/random/path`);
    // Either 200 (SPA fallback to index.html) or 404 (no dist)
    expect([200, 404]).toContain(res.status);
  });
});
