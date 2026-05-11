import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import "./setup";
import {
  addServer,
  removeServer,
  listServers,
  getServer,
  updateServer,
  enableServer,
  disableServer,
  cacheTools,
  getCachedTools,
} from "../src/lib/registry";
import { getDb, closeDb } from "../src/lib/db";

function clearDb() {
  const db = getDb();
  db.exec("DELETE FROM tool_cache");
  db.exec("DELETE FROM servers");
}

describe("registry", () => {
  beforeEach(() => {
    clearDb();
  });

  afterAll(() => {
    closeDb();
  });

  // ── addServer ──

  describe("addServer", () => {
    it("adds a server with minimal options", () => {
      const s = addServer({ command: "npx" });
      expect(s.id).toBe("npx");
      expect(s.name).toBe("npx");
      expect(s.command).toBe("npx");
      expect(s.args).toEqual([]);
      expect(s.env).toEqual({});
      expect(s.transport).toBe("stdio");
      expect(s.url).toBeNull();
      expect(s.source).toBe("local");
      expect(s.enabled).toBe(true);
      expect(s.description).toBeNull();
      expect(s.created_at).toBeTruthy();
      expect(s.updated_at).toBeTruthy();
    });

    it("uses name when provided", () => {
      const s = addServer({ command: "npx", name: "My Server" });
      expect(s.id).toBe("my-server");
      expect(s.name).toBe("My Server");
    });

    it("uses first arg as name fallback", () => {
      const s = addServer({ command: "npx", args: ["my-server", "@mcp/test"] });
      expect(s.id).toBe("my-server");
      expect(s.name).toBe("my-server");
    });

    it("stores args as JSON array", () => {
      const s = addServer({ command: "npx", args: ["-y", "@mcp/test"] });
      expect(s.args).toEqual(["-y", "@mcp/test"]);
    });

    it("stores env as JSON object", () => {
      const s = addServer({ command: "npx", env: { DEBUG: "true" } });
      expect(s.env).toEqual({ DEBUG: "true" });
    });

    it("respects transport option", () => {
      const s = addServer({ command: "node", transport: "sse", url: "http://localhost:3000" });
      expect(s.transport).toBe("sse");
      expect(s.url).toBe("http://localhost:3000");
    });

    it("respects source option", () => {
      const s = addServer({ command: "npx", source: "registry" });
      expect(s.source).toBe("registry");
    });

    it("respects description option", () => {
      const s = addServer({ command: "npx", description: "A test server" });
      expect(s.description).toBe("A test server");
    });

    it("generates kebab-case ID from name", () => {
      const s = addServer({ command: "npx", name: "My Awesome Server!!!" });
      expect(s.id).toBe("my-awesome-server");
    });

    it("throws on duplicate ID", () => {
      addServer({ command: "npx", name: "test" });
      expect(() => addServer({ command: "npx", name: "test" })).toThrow();
    });
  });

  // ── removeServer ──

  describe("removeServer", () => {
    it("removes an existing server", () => {
      addServer({ command: "npx", name: "remove-me" });
      expect(getServer("remove-me")).not.toBeNull();
      removeServer("remove-me");
      expect(getServer("remove-me")).toBeNull();
    });

    it("is a no-op for non-existent server", () => {
      expect(() => removeServer("does-not-exist")).not.toThrow();
    });

    it("cascades to tool_cache", () => {
      addServer({ command: "npx", name: "cached" });
      cacheTools("cached", [{ name: "tool1", description: "desc", input_schema: {} }]);
      expect(getCachedTools("cached")).toHaveLength(1);
      removeServer("cached");
      expect(getCachedTools("cached")).toHaveLength(0);
    });
  });

  // ── listServers ──

  describe("listServers", () => {
    it("returns empty array when no servers", () => {
      expect(listServers()).toEqual([]);
    });

    it("returns all servers sorted by name", () => {
      addServer({ command: "npx", name: "Zebra" });
      addServer({ command: "npx", name: "Alpha" });
      addServer({ command: "npx", name: "Middle" });
      const servers = listServers();
      expect(servers).toHaveLength(3);
      expect(servers[0].name).toBe("Alpha");
      expect(servers[1].name).toBe("Middle");
      expect(servers[2].name).toBe("Zebra");
    });
  });

  // ── getServer ──

  describe("getServer", () => {
    it("returns server by ID", () => {
      addServer({ command: "npx", name: "findme" });
      const s = getServer("findme");
      expect(s).not.toBeNull();
      expect(s!.name).toBe("findme");
    });

    it("returns null for non-existent ID", () => {
      expect(getServer("ghost")).toBeNull();
    });
  });

  // ── updateServer ──

  describe("updateServer", () => {
    it("updates name", () => {
      addServer({ command: "npx", name: "original" });
      const updated = updateServer("original", { name: "New Name" });
      expect(updated.name).toBe("New Name");
    });

    it("updates description", () => {
      addServer({ command: "npx", name: "upd-desc" });
      const updated = updateServer("upd-desc", { description: "new desc" });
      expect(updated.description).toBe("new desc");
    });

    it("updates command", () => {
      addServer({ command: "npx", name: "upd-cmd" });
      const updated = updateServer("upd-cmd", { command: "bunx" });
      expect(updated.command).toBe("bunx");
    });

    it("updates args", () => {
      addServer({ command: "npx", name: "upd-args" });
      const updated = updateServer("upd-args", { args: ["--flag"] });
      expect(updated.args).toEqual(["--flag"]);
    });

    it("updates env", () => {
      addServer({ command: "npx", name: "upd-env" });
      const updated = updateServer("upd-env", { env: { KEY: "val" } });
      expect(updated.env).toEqual({ KEY: "val" });
    });

    it("updates transport", () => {
      addServer({ command: "npx", name: "upd-transport" });
      const updated = updateServer("upd-transport", { transport: "sse" });
      expect(updated.transport).toBe("sse");
    });

    it("updates url", () => {
      addServer({ command: "npx", name: "upd-url" });
      const updated = updateServer("upd-url", { url: "http://localhost:3000" });
      expect(updated.url).toBe("http://localhost:3000");
    });

    it("updates enabled", () => {
      addServer({ command: "npx", name: "upd-enabled" });
      const updated = updateServer("upd-enabled", { enabled: false });
      expect(updated.enabled).toBe(false);
    });

    it("updates multiple fields at once", () => {
      addServer({ command: "npx", name: "upd-multi" });
      const updated = updateServer("upd-multi", {
        name: "Updated",
        description: "new",
        command: "bunx",
      });
      expect(updated.name).toBe("Updated");
      expect(updated.description).toBe("new");
      expect(updated.command).toBe("bunx");
    });

    it("sets updated_at timestamp", () => {
      const s = addServer({ command: "npx", name: "upd-ts" });
      const updated = updateServer("upd-ts", { name: "Updated TS" });
      // updated_at should be >= created_at
      expect(updated.updated_at).toBeTruthy();
    });
  });

  // ── enableServer / disableServer ──

  describe("enableServer / disableServer", () => {
    it("enables a disabled server", () => {
      addServer({ command: "npx", name: "toggle" });
      disableServer("toggle");
      expect(getServer("toggle")!.enabled).toBe(false);
      enableServer("toggle");
      expect(getServer("toggle")!.enabled).toBe(true);
    });

    it("disables an enabled server", () => {
      addServer({ command: "npx", name: "toggle2" });
      const s = disableServer("toggle2");
      expect(s.enabled).toBe(false);
    });
  });

  // ── cacheTools / getCachedTools ──

  describe("cacheTools / getCachedTools", () => {
    it("caches and retrieves tools", () => {
      addServer({ command: "npx", name: "cache-test" });
      cacheTools("cache-test", [
        { name: "tool1", description: "first", input_schema: { type: "object" } },
        { name: "tool2", description: "second", input_schema: {} },
      ]);

      const tools = getCachedTools("cache-test");
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("tool1");
      expect(tools[0].description).toBe("first");
      expect(tools[0].input_schema).toEqual({ type: "object" });
      expect(tools[1].name).toBe("tool2");
    });

    it("replaces existing cache on re-cache", () => {
      addServer({ command: "npx", name: "recache" });
      cacheTools("recache", [
        { name: "old", description: "old tool", input_schema: {} },
      ]);
      expect(getCachedTools("recache")).toHaveLength(1);

      cacheTools("recache", [
        { name: "new1", description: "", input_schema: {} },
        { name: "new2", description: "", input_schema: {} },
      ]);
      const tools = getCachedTools("recache");
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("new1");
    });

    it("returns empty array for server with no cached tools", () => {
      addServer({ command: "npx", name: "no-tools" });
      expect(getCachedTools("no-tools")).toEqual([]);
    });

    it("returns empty array for non-existent server", () => {
      expect(getCachedTools("ghost")).toEqual([]);
    });
  });
});
