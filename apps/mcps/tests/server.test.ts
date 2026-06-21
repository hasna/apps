import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import "./setup";
import { getDb, closeDb } from "../src/lib/db";
import { addServer, cacheTools, getServer } from "../src/lib/registry";

const PORT = 19499;
let serverProcess: ReturnType<typeof Bun.serve>;

function clearDb() {
  const db = getDb();
  db.exec("DELETE FROM tool_cache");
  db.exec("DELETE FROM servers");
}

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`http://localhost:${PORT}${path}`, options);
  return { status: res.status, data: await res.json() as any, headers: res.headers };
}

describe("server API", () => {
  beforeAll(async () => {
    // Start server without opening browser
    // We import and call startServer inline since it starts Bun.serve
    const { startServer } = await import("../src/server/serve");
    // startServer won't return (it runs forever), so we call it and don't await
    startServer(PORT, { open: false });
    // Give it a moment to start
    await Bun.sleep(200);
  });

  beforeEach(() => {
    clearDb();
  });

  afterAll(() => {
    closeDb();
  });

  // ── GET /api/servers ──

  describe("GET /api/servers", () => {
    it("returns empty array when no servers", async () => {
      const { status, data } = await api("/api/servers");
      expect(status).toBe(200);
      expect(data).toEqual([]);
    });

    it("returns servers with toolCount", async () => {
      addServer({ command: "npx", name: "srv1" });
      cacheTools("srv1", [
        { name: "t1", description: "", input_schema: {} },
        { name: "t2", description: "", input_schema: {} },
      ]);

      const { status, data } = await api("/api/servers");
      expect(status).toBe(200);
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("srv1");
      expect(data[0].toolCount).toBe(2);
    });

    it("includes security headers", async () => {
      const { headers } = await api("/api/servers");
      expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(headers.get("X-Frame-Options")).toBe("DENY");
    });
  });

  // ── POST /api/servers ──

  describe("POST /api/servers", () => {
    it("requires consent before adding local stdio commands", async () => {
      const { status, data } = await api("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "npx", name: "NeedsConsent", args: ["-y", "test"] }),
      });
      expect(status).toBe(400);
      expect(data.error).toContain("local stdio command approval is required");
    });

    it("adds a server and returns entry after local stdio consent", async () => {
      const { status, data } = await api("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "npx", name: "NewServer", args: ["-y", "test"], allow_local_stdio: true }),
      });
      expect(status).toBe(200);
      expect(data.id).toBe("newserver");
      expect(data.command).toBe("npx");
      expect(data.args).toEqual(["-y", "test"]);
    });

    it("rejects raw secret-like env values and accepts credential refs", async () => {
      const raw = await api("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "npx",
          name: "RawSecret",
          env: { API_KEY: "sk_live_should_not_be_stored" },
          allow_local_stdio: true,
        }),
      });
      expect(raw.status).toBe(400);
      expect(raw.data.error).toContain("credential reference");

      const referenced = await api("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "npx",
          name: "ReferencedSecret",
          credential_refs: { API_KEY: { source: "env", name: "UPSTREAM_API_KEY" } },
          allow_local_stdio: true,
        }),
      });
      expect(referenced.status).toBe(200);
      expect(referenced.data.env).toEqual({});
      expect(referenced.data.credentialRefs.API_KEY).toMatchObject({
        source: "env",
        name: "UPSTREAM_API_KEY",
      });
    });

    it("returns 400 when command is missing", async () => {
      const { status, data } = await api("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "NoCommand" }),
      });
      expect(status).toBe(400);
      expect(data.error).toBe("Missing 'command'");
    });

    it("returns 500 on duplicate", async () => {
      addServer({ command: "npx", name: "dup" });
      const { status, data } = await api("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "npx", name: "dup", allow_local_stdio: true }),
      });
      expect(status).toBe(500);
      expect(data.error).toBeTruthy();
    });
  });

  // ── GET /api/servers/:id ──

  describe("GET /api/servers/:id", () => {
    it("returns server details with tools", async () => {
      addServer({ command: "npx", name: "detail" });
      cacheTools("detail", [{ name: "t1", description: "tool", input_schema: { x: 1 } }]);

      const { status, data } = await api("/api/servers/detail");
      expect(status).toBe(200);
      expect(data.name).toBe("detail");
      expect(data.toolCount).toBe(1);
      expect(data.tools).toHaveLength(1);
      expect(data.tools[0].name).toBe("t1");
    });

    it("returns 404 for non-existent server", async () => {
      const { status, data } = await api("/api/servers/ghost");
      expect(status).toBe(404);
      expect(data.error).toContain("not found");
    });

    it("returns 400 for invalid ID", async () => {
      const { status, data } = await api("/api/servers/INVALID%20ID");
      expect(status).toBe(400);
      expect(data.error).toBe("Invalid server ID");
    });
  });

  // ── DELETE /api/servers/:id ──

  describe("DELETE /api/servers/:id", () => {
    it("removes an existing server", async () => {
      addServer({ command: "npx", name: "removeme" });
      const { status, data } = await api("/api/servers/removeme", { method: "DELETE" });
      expect(status).toBe(200);
      expect(data.success).toBe(true);

      // Verify removed
      const { status: s2 } = await api("/api/servers/removeme");
      expect(s2).toBe(404);
    });

    it("returns 404 for non-existent server", async () => {
      const { status, data } = await api("/api/servers/ghost", { method: "DELETE" });
      expect(status).toBe(404);
    });

    it("returns 400 for invalid ID", async () => {
      const { status } = await api("/api/servers/BAD%20ID", { method: "DELETE" });
      expect(status).toBe(400);
    });
  });

  // ── POST /api/servers/:id/enable ──

  describe("POST /api/servers/:id/enable", () => {
    it("enables a server", async () => {
      addServer({ command: "npx", name: "enab" });
      // First disable it
      await api("/api/servers/enab/disable", { method: "POST" });
      // Then enable
      const { status, data } = await api("/api/servers/enab/enable", { method: "POST" });
      expect(status).toBe(200);
      expect(data.success).toBe(true);

      // Verify
      const { data: detail } = await api("/api/servers/enab");
      expect(detail.enabled).toBe(true);
    });

    it("returns 400 for invalid ID", async () => {
      const { status } = await api("/api/servers/BAD!/enable", { method: "POST" });
      expect(status).toBe(400);
    });
  });

  // ── POST /api/servers/:id/disable ──

  describe("POST /api/servers/:id/disable", () => {
    it("disables a server", async () => {
      addServer({ command: "npx", name: "disab" });
      const { status, data } = await api("/api/servers/disab/disable", { method: "POST" });
      expect(status).toBe(200);
      expect(data.success).toBe(true);

      const { data: detail } = await api("/api/servers/disab");
      expect(detail.enabled).toBe(false);
    });
  });

  // ── PATCH /api/servers/:id ──

  describe("PATCH /api/servers/:id", () => {
    it("returns 400 for blank command updates without changing the existing command", async () => {
      addServer({ command: "npx", name: "patch-cmd" });

      const { status, data } = await api("/api/servers/patch-cmd", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "   ", allow_local_stdio: true }),
      });

      expect(status).toBe(400);
      expect(data.error).toBe("Command is required");
      expect(getServer("patch-cmd")!.command).toBe("npx");
    });
  });

  // ── POST /api/servers/:id/call ──

  describe("POST /api/servers/:id/call", () => {
    it("returns 400 when local stdio launch consent is missing", async () => {
      addServer({ command: "npx", args: ["-y", "@example/mcp-server"], name: "callme" });

      const { status, data } = await api("/api/servers/callme/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "example" }),
      });

      expect(status).toBe(400);
      expect(data.error).toContain("local stdio command approval is required");
    });
  });

  // ── OPTIONS (CORS) ──

  describe("OPTIONS (CORS)", () => {
    it("returns CORS headers", async () => {
      const res = await fetch(`http://localhost:${PORT}/api/servers`, {
        method: "OPTIONS",
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
      expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
    });
  });

  // ── Static files / SPA ──

  describe("static serving", () => {
    it("serves index.html at root (SPA fallback)", async () => {
      const res = await fetch(`http://localhost:${PORT}/`);
      // If dashboard is built, we get 200 HTML; otherwise 404 JSON
      expect([200, 404]).toContain(res.status);
    });

    it("returns 404 for unknown API routes", async () => {
      // Use a POST to a non-existent route so it won't match the SPA fallback
      const res = await fetch(`http://localhost:${PORT}/api/nonexistent`, {
        method: "PATCH",
      });
      const data = await res.json() as any;
      expect(res.status).toBe(404);
      expect(data.error).toBe("Not found");
    });
  });
});
