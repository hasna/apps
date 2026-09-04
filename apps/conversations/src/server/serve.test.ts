import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { startDashboardServer } from "./serve";
import { sendMessage } from "../lib/messages";
import { createChannel, joinChannel } from "../lib/channels";
import { createProject } from "../lib/projects";
import { closeDb } from "../lib/db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pinStoreToDb, restoreStoreEnv } from "../lib/store/isolated-test-env.js";

const TEST_DB = join(tmpdir(), `conversations-test-server-${Date.now()}.db`);
let server: ReturnType<typeof startDashboardServer>;

beforeAll(() => {
  pinStoreToDb(TEST_DB);
  closeDb();
  server = startDashboardServer(0);
});

afterAll(() => {
  server?.stop();
  closeDb();
  restoreStoreEnv();
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
    expect(typeof data.total_projects).toBe("number");
    expect(typeof data.unread_messages).toBe("number");
  });
});

describe("API /api/messages", () => {
  test("GET returns a preview page envelope", async () => {
    sendMessage({ from: "a", to: "b", content: "test-msg" });
    const res = await fetch(`${base()}/api/messages`);
    expect(res.status).toBe(200);
    const data = await res.json() as { messages: Array<{ preview: string }>; count: number };
    expect(data.count).toBeGreaterThanOrEqual(1);
    expect(data.messages[0]?.preview).toBe("test-msg"); // newest first
  });

  test("GET respects limit param", async () => {
    sendMessage({ from: "a", to: "b", content: "1" });
    sendMessage({ from: "a", to: "b", content: "2" });
    const res = await fetch(`${base()}/api/messages?limit=1`);
    const data = await res.json() as { messages: any[] };
    expect(data.messages).toHaveLength(1);
  });

  test("GET filters by from param", async () => {
    sendMessage({ from: "special-sender", to: "b", content: "from-filter" });
    const res = await fetch(`${base()}/api/messages?from=special-sender`);
    const data = await res.json() as { messages: any[] };
    expect(data.messages.every((m: any) => m.from_agent === "special-sender")).toBe(true);
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
    createChannel("api-test-sp", "tester", { description: "Test channel" });
    const res = await fetch(`${base()}/api/channels`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.some((sp: any) => sp.name === "api-test-sp")).toBe(true);
  });

  test("POST creates a channel", async () => {
    const res = await fetch(`${base()}/api/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "web-channel", created_by: "web-user", description: "Created via API" }),
    });
    expect(res.status).toBe(200);
    const sp = await res.json() as any;
    expect(sp.name).toBe("web-channel");
  });

  test("POST returns 400 on duplicate", async () => {
    createChannel("dup-sp", "tester");
    const res = await fetch(`${base()}/api/channels`, {
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
    const data = await res.json() as { messages: Array<{ preview: string }> };
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].preview).toBe("unique-search-term-xyz");
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
    const data = await res.json() as { messages: unknown[] };
    expect(data.messages).toHaveLength(2);
  });

  test("filters by from param", async () => {
    sendMessage({ from: "search-sender-a", to: "b", content: "searchfrom-test" });
    sendMessage({ from: "search-sender-b", to: "b", content: "searchfrom-test" });
    const res = await fetch(`${base()}/api/messages/search?q=searchfrom-test&from=search-sender-a`);
    const data = await res.json() as { messages: Array<{ from_agent: string }> };
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].from_agent).toBe("search-sender-a");
  });

  test("filters by channel param", async () => {
    // sendMessage refuses a channel with no row rather than writing an orphan
    // that `channel list` cannot see and `channel archive` cannot remove
    // (todos 4cc80a4d).
    createChannel("search-sp", "fixture");
    sendMessage({ from: "a", to: "search-sp", content: "searchchannel-test", channel: "search-sp" });
    sendMessage({ from: "a", to: "b", content: "searchchannel-test" });
    const res = await fetch(`${base()}/api/messages/search?q=searchchannel-test&channel=search-sp`);
    const data = await res.json() as { messages: Array<{ channel: string }> };
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].channel).toBe("search-sp");
  });

  test("returns an empty preview envelope when no matches", async () => {
    const res = await fetch(`${base()}/api/messages/search?q=absolutely-nothing-matches-this-9876`);
    expect(res.status).toBe(200);
    const data = await res.json() as { messages: unknown[]; has_more: boolean; next_cursor: number | null };
    expect(data.messages).toEqual([]);
    expect(data.has_more).toBe(false);
    expect(data.next_cursor).toBeNull();
  });
});

describe("API /api/messages/pinned", () => {
  test("GET returns pinned messages", async () => {
    const msg = sendMessage({ from: "pin-user", to: "other", content: "pin-me-msg" });
    // Pin the message first via the pin endpoint
    await fetch(`${base()}/api/messages/${msg.id}/pin`, { method: "POST" });
    const res = await fetch(`${base()}/api/messages/pinned`);
    expect(res.status).toBe(200);
    const data = await res.json() as { messages: any[] };
    expect(data.messages.some((m: any) => m.id === msg.id)).toBe(true);
  });

  test("GET filters by channel", async () => {
    createChannel("pin-sp", "tester");
    const msg = sendMessage({ from: "a", to: "pin-sp", content: "pinned-in-channel", channel: "pin-sp" });
    await fetch(`${base()}/api/messages/${msg.id}/pin`, { method: "POST" });
    const res = await fetch(`${base()}/api/messages/pinned?channel=pin-sp`);
    expect(res.status).toBe(200);
    const data = await res.json() as { messages: any[] };
    expect(data.messages.every((m: any) => m.channel === "pin-sp")).toBe(true);
  });

  test("GET respects limit param", async () => {
    const m1 = sendMessage({ from: "a", to: "b", content: "pinlimit-1" });
    const m2 = sendMessage({ from: "a", to: "b", content: "pinlimit-2" });
    await fetch(`${base()}/api/messages/${m1.id}/pin`, { method: "POST" });
    await fetch(`${base()}/api/messages/${m2.id}/pin`, { method: "POST" });
    const res = await fetch(`${base()}/api/messages/pinned?limit=1`);
    expect(res.status).toBe(200);
    const data = await res.json() as { messages: any[] };
    expect(data.messages).toHaveLength(1);
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

describe("API /api/channels/:name (GET)", () => {
  test("GET returns a single channel", async () => {
    createChannel("get-single-sp", "tester", { description: "A test channel" });
    const res = await fetch(`${base()}/api/channels/get-single-sp`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.name).toBe("get-single-sp");
    expect(data.description).toBe("A test channel");
  });

  test("GET returns 404 for non-existent channel", async () => {
    const res = await fetch(`${base()}/api/channels/does-not-exist-sp`);
    expect(res.status).toBe(404);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });
});

describe("API /api/channels/:name/members (GET)", () => {
  test("GET returns members for an existing channel", async () => {
    createChannel("members-dashboard-sp", "alice");
    joinChannel("members-dashboard-sp", "bob");

    const res = await fetch(`${base()}/api/channels/members-dashboard-sp/members`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual([
      expect.objectContaining({ channel: "members-dashboard-sp", agent: "alice" }),
      expect.objectContaining({ channel: "members-dashboard-sp", agent: "bob" }),
    ]);
  });

  test("GET returns a structured JSON 404 for a missing channel", async () => {
    const res = await fetch(`${base()}/api/channels/missing-members-dashboard/members`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Channel not found: missing-members-dashboard" });
  });
});

describe("API /api/channels/:name (PUT)", () => {
  test("PUT updates a channel description", async () => {
    createChannel("update-sp", "tester", { description: "old desc" });
    const res = await fetch(`${base()}/api/channels/update-sp`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "new desc" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.description).toBe("new desc");
  });

  test("PUT returns 400 for non-existent channel", async () => {
    const res = await fetch(`${base()}/api/channels/nonexistent-update-sp`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "wont work" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });
});

describe("API /api/channels/:name/archive", () => {
  test("POST archives a channel", async () => {
    createChannel("archive-sp", "tester");
    const res = await fetch(`${base()}/api/channels/archive-sp/archive`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.name).toBe("archive-sp");
  });

  test("POST returns 400 for non-existent channel", async () => {
    const res = await fetch(`${base()}/api/channels/nonexistent-archive-sp/archive`, { method: "POST" });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBeTruthy();
  });
});

describe("API /api/channels/:name/unarchive", () => {
  test("POST unarchives a channel", async () => {
    createChannel("unarchive-sp", "tester");
    // Archive first
    await fetch(`${base()}/api/channels/unarchive-sp/archive`, { method: "POST" });
    const res = await fetch(`${base()}/api/channels/unarchive-sp/unarchive`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.name).toBe("unarchive-sp");
  });

  test("POST returns 400 for non-existent channel", async () => {
    const res = await fetch(`${base()}/api/channels/nonexistent-unarchive-sp/unarchive`, { method: "POST" });
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

  test("DELETE returns 400 when channels reference the project", async () => {
    const proj = createProject({ name: "nodelete-proj", created_by: "tester" });
    createChannel("proj-ref-sp", "tester", { project_id: proj.id });
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
  test("GET creates a bounded preview-only JSON artifact by default", async () => {
    sendMessage({ from: "export-user", to: "other", content: "export-test-msg" });
    const res = await fetch(`${base()}/api/export`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") || "";
    expect(ct).toContain("application/json");
    const data = await res.json() as { artifact: Record<string, unknown> };
    expect(data.artifact.detail).toBe("preview");
    expect(Number(data.artifact.count)).toBeGreaterThanOrEqual(1);
    expect(data.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("GET creates CSV artifact metadata without streaming bodies", async () => {
    sendMessage({ from: "csv-user", to: "other", content: "csv-export-msg" });
    const res = await fetch(`${base()}/api/export?format=csv`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") || "";
    expect(ct).toContain("application/json");
    const data = await res.json() as { artifact: Record<string, unknown> };
    expect(data.artifact.format).toBe("csv");
    expect(data.artifact.detail).toBe("preview");
  });

  test("GET filters by channel", async () => {
    createChannel("export-sp", "tester");
    sendMessage({ from: "a", to: "export-sp", content: "export-sp-msg", channel: "export-sp" });
    const res = await fetch(`${base()}/api/export?channel=export-sp`);
    expect(res.status).toBe(200);
    const data = await res.json() as { artifact: Record<string, unknown> };
    expect(data.artifact.detail).toBe("preview");
    expect(data.artifact.count).toBe(1);
  });

  test("GET filters by from", async () => {
    sendMessage({ from: "export-sender", to: "b", content: "export-from-msg" });
    const res = await fetch(`${base()}/api/export?from=export-sender`);
    expect(res.status).toBe(200);
    const data = await res.json() as { artifact: Record<string, unknown> };
    expect(data.artifact.detail).toBe("preview");
    expect(data.artifact.count).toBe(1);
  });
});

describe("API /api/reactions", () => {
  test("GET returns 400 without message_id", async () => {
    const res = await fetch(`${base()}/api/reactions`);
    expect(res.status).toBe(400);
  });

  test("GET returns reactions array for message", async () => {
    const msg = sendMessage({ from: "reactor", to: "other", content: "reaction test" });
    const res = await fetch(`${base()}/api/reactions?message_id=${msg.id}`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(Array.isArray(data)).toBe(true);
  });

  test("GET with summary=true returns summary", async () => {
    const msg = sendMessage({ from: "reactor", to: "other", content: "summary test" });
    const res = await fetch(`${base()}/api/reactions?message_id=${msg.id}&summary=true`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("API /api/locks", () => {
  test("GET returns active locks array", async () => {
    const res = await fetch(`${base()}/api/locks`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(Array.isArray(data)).toBe(true);
  });

  test("GET filters by resource_type", async () => {
    const res = await fetch(`${base()}/api/locks?resource_type=channel`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("API /api/version", () => {
  const registryUrl = "https://registry.npmjs.org/@hasna/conversations/latest";

  test("reports latest version using an abortable registry request", async () => {
    const originalFetch = globalThis.fetch;
    let registrySignal: AbortSignal | undefined;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === registryUrl) {
        registrySignal = init?.signal as AbortSignal | undefined;
        if (!registrySignal) throw new Error("missing abort signal");
        return new Response(JSON.stringify({ version: "9.9.9" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const res = await originalFetch(`${base()}/api/version`);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.latest).toBe("9.9.9");
      expect(data.updateAvailable).toBe(true);
      expect(registrySignal).toBeInstanceOf(AbortSignal);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns 504 when registry fetch exceeds the timeout", async () => {
    const originalFetch = globalThis.fetch;
    const originalTimeout = process.env.CONVERSATIONS_REGISTRY_TIMEOUT_MS;
    process.env.CONVERSATIONS_REGISTRY_TIMEOUT_MS = "5";

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === registryUrl) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!(signal instanceof AbortSignal)) {
            setTimeout(() => reject(new Error("missing abort signal")), 50);
            return;
          }
          if (signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const res = await originalFetch(`${base()}/api/version`);
      expect(res.status).toBe(504);
      const data = await res.json() as any;
      expect(data.error).toContain("npm registry request timed out");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalTimeout === undefined) {
        delete process.env.CONVERSATIONS_REGISTRY_TIMEOUT_MS;
      } else {
        process.env.CONVERSATIONS_REGISTRY_TIMEOUT_MS = originalTimeout;
      }
    }
  });
});

/**
 * G2 — the dashboard's own collection routes parse as strictly as /v1 does.
 *
 * These routes hand-rolled their parsing: `url.searchParams.get(x) || undefined`
 * maps a present-but-empty filter onto an absent one, and `parseInt(...)` with a
 * silent fallback turns `?limit=abc` into `limit=50`. Both answer a question the
 * caller did not ask, with a 200.
 */
describe("G2 dashboard collection filters fail closed", () => {
  const EMPTY_FILTERS: Array<[string, string]> = [
    ["/api/messages", "channel"],
    ["/api/messages", "session"],
    ["/api/messages", "from"],
    ["/api/messages", "to"],
    ["/api/messages/pinned", "channel"],
    ["/api/messages/pinned", "session_id"],
    ["/api/export", "channel"],
    ["/api/export", "session"],
  ];

  for (const [path, name] of EMPTY_FILTERS) {
    test(`GET ${path}?${name}= is rejected`, async () => {
      const res = await fetch(`${base()}${path}?${name}=`);
      expect(res.status).toBe(400);
      const body = await res.json() as { error?: string };
      expect(String(body.error)).toContain(name);
    });
  }

  test("a malformed limit is rejected instead of silently defaulted", async () => {
    const res = await fetch(`${base()}/api/messages?limit=abc`);
    expect(res.status).toBe(400);
  });

  test("a malformed since is rejected", async () => {
    const res = await fetch(`${base()}/api/export?since=not-a-date`);
    expect(res.status).toBe(400);
  });

  test("an empty search query stays a 400", async () => {
    const res = await fetch(`${base()}/api/messages/search?q=`);
    expect(res.status).toBe(400);
  });

  // The instrument can pass: well-formed values still return a page.
  test("well-formed filters are accepted", async () => {
    sendMessage({ from: "strict-a", to: "strict-b", content: "strict accepted" });
    const res = await fetch(`${base()}/api/messages?limit=5&from=strict-a`);
    expect(res.status).toBe(200);
    const body = await res.json() as { messages: unknown[] };
    expect(Array.isArray(body.messages)).toBe(true);
  });
});

/**
 * G3 — the dashboard collection routes return the store's page envelope.
 *
 * A bare JSON array cannot say "there is more" or "I dropped rows to stay under
 * a byte cap". Every consumer of a bare array reads it as the complete answer,
 * which is exactly the confident-complete-result-after-truncation failure.
 */
describe("G3 dashboard collection routes preserve the page envelope", () => {
  const CONTRACT_FIELDS = ["messages", "count", "limit", "cursor", "next_cursor", "has_more", "skipped_count", "byte_length", "max_bytes", "timeout_ms"];

  test("GET /api/messages returns the envelope, not a bare array", async () => {
    sendMessage({ from: "env-a", to: "env-b", content: "envelope probe" });
    const res = await fetch(`${base()}/api/messages?limit=5`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body)).toBe(false);
    for (const field of CONTRACT_FIELDS) expect(Object.keys(body)).toContain(field);
  });

  test("GET /api/messages/pinned returns the envelope, not a bare array", async () => {
    const res = await fetch(`${base()}/api/messages/pinned?limit=5`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body)).toBe(false);
    for (const field of CONTRACT_FIELDS) expect(Object.keys(body)).toContain(field);
  });

  test("GET /api/messages/search returns the envelope, not a bare array", async () => {
    sendMessage({ from: "search-env-a", to: "search-env-b", content: "dashboard envelope search probe" });
    const res = await fetch(`${base()}/api/messages/search?q=envelope&limit=5`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body)).toBe(false);
    for (const field of CONTRACT_FIELDS) expect(Object.keys(body)).toContain(field);
  });

  test("a byte-capped page never claims to be complete", async () => {
    for (let i = 0; i < 8; i++) {
      sendMessage({ from: "cap-a", to: "cap-b", content: `cap probe ${i} ${"z".repeat(400)}` });
    }
    const res = await fetch(`${base()}/api/messages?to=cap-b&limit=8&max_bytes=1024`);
    expect(res.status).toBe(200);
    const body = await res.json() as { count: number; has_more: boolean; skipped_count: number; next_cursor: number | null };
    expect(body.count < 8 || body.skipped_count > 0).toBe(true);
    expect(body.has_more).toBe(true);
    expect(body.next_cursor).not.toBeNull();
  });
});
