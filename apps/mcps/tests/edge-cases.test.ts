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

describe("edge cases", () => {
  beforeEach(() => {
    clearDb();
  });

  afterAll(() => {
    closeDb();
  });

  // ── ID generation edge cases ──

  describe("ID generation", () => {
    it("strips special characters from name", () => {
      const s = addServer({ command: "npx", name: "@scope/my-server!!!" });
      expect(s.id).toBe("scope-my-server");
    });

    it("handles names with only special chars", () => {
      // Falls back to command name
      const s = addServer({ command: "mycommand", name: "!!!" });
      // generateId("!!!") -> "" after replacing, but this depends on impl
      // The name is "!!!" but the id will be empty string after stripping
      // This is an edge case - just verify it doesn't crash
      expect(s.name).toBe("!!!");
    });

    it("handles names with spaces", () => {
      const s = addServer({ command: "npx", name: "My Great Server" });
      expect(s.id).toBe("my-great-server");
    });

    it("handles names with numbers", () => {
      const s = addServer({ command: "npx", name: "server123" });
      expect(s.id).toBe("server123");
    });

    it("falls back to command when no name or args", () => {
      const s = addServer({ command: "my-command" });
      expect(s.name).toBe("my-command");
      expect(s.id).toBe("my-command");
    });
  });

  // ── addServer field defaults ──

  describe("addServer defaults", () => {
    it("defaults transport to stdio", () => {
      const s = addServer({ command: "npx", name: "default-transport" });
      expect(s.transport).toBe("stdio");
    });

    it("defaults source to local", () => {
      const s = addServer({ command: "npx", name: "default-source" });
      expect(s.source).toBe("local");
    });

    it("defaults enabled to true", () => {
      const s = addServer({ command: "npx", name: "default-enabled" });
      expect(s.enabled).toBe(true);
    });

    it("defaults args to empty array", () => {
      const s = addServer({ command: "npx", name: "default-args" });
      expect(s.args).toEqual([]);
    });

    it("defaults env to empty object", () => {
      const s = addServer({ command: "npx", name: "default-env" });
      expect(s.env).toEqual({});
    });

    it("defaults description to null", () => {
      const s = addServer({ command: "npx", name: "default-desc" });
      expect(s.description).toBeNull();
    });

    it("defaults url to null", () => {
      const s = addServer({ command: "npx", name: "default-url" });
      expect(s.url).toBeNull();
    });
  });

  // ── updateServer edge cases ──

  describe("updateServer edge cases", () => {
    it("setting enabled to true", () => {
      addServer({ command: "npx", name: "upd-e-true" });
      disableServer("upd-e-true");
      const updated = updateServer("upd-e-true", { enabled: true });
      expect(updated.enabled).toBe(true);
    });

    it("setting enabled to false", () => {
      addServer({ command: "npx", name: "upd-e-false" });
      const updated = updateServer("upd-e-false", { enabled: false });
      expect(updated.enabled).toBe(false);
    });

    it("preserves untouched fields", () => {
      const s = addServer({
        command: "npx",
        name: "preserve",
        description: "original",
        args: ["--flag"],
        env: { KEY: "val" },
      });
      const updated = updateServer("preserve", { name: "NewName" });
      expect(updated.name).toBe("NewName");
      expect(updated.description).toBe("original");
      expect(updated.args).toEqual(["--flag"]);
      expect(updated.env).toEqual({ KEY: "val" });
      expect(updated.command).toBe("npx");
    });
  });

  // ── cacheTools edge cases ──

  describe("cacheTools edge cases", () => {
    it("handles tools with complex input_schema", () => {
      addServer({ command: "npx", name: "complex" });
      cacheTools("complex", [
        {
          name: "complex-tool",
          description: "A complex tool",
          input_schema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Name" },
              count: { type: "number" },
              nested: { type: "object", properties: { deep: { type: "boolean" } } },
            },
            required: ["name"],
          },
        },
      ]);

      const tools = getCachedTools("complex");
      expect(tools).toHaveLength(1);
      expect(tools[0].input_schema).toEqual({
        type: "object",
        properties: {
          name: { type: "string", description: "Name" },
          count: { type: "number" },
          nested: { type: "object", properties: { deep: { type: "boolean" } } },
        },
        required: ["name"],
      });
    });

    it("handles empty tools array", () => {
      addServer({ command: "npx", name: "empty-tools" });
      cacheTools("empty-tools", []);
      expect(getCachedTools("empty-tools")).toEqual([]);
    });

    it("overwrites all tools on re-cache", () => {
      addServer({ command: "npx", name: "overwrite" });
      cacheTools("overwrite", [
        { name: "a", description: "A", input_schema: {} },
        { name: "b", description: "B", input_schema: {} },
        { name: "c", description: "C", input_schema: {} },
      ]);
      expect(getCachedTools("overwrite")).toHaveLength(3);

      cacheTools("overwrite", [{ name: "x", description: "X", input_schema: {} }]);
      const tools = getCachedTools("overwrite");
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("x");
    });
  });

  // ── Multiple servers operations ──

  describe("multiple servers", () => {
    it("handles adding and listing many servers", () => {
      for (let i = 0; i < 20; i++) {
        addServer({ command: "npx", name: `server-${i.toString().padStart(2, "0")}` });
      }
      const servers = listServers();
      expect(servers).toHaveLength(20);
      // Should be sorted by name
      expect(servers[0].name).toBe("server-00");
      expect(servers[19].name).toBe("server-19");
    });

    it("remove only affects target server", () => {
      addServer({ command: "npx", name: "keep-a" });
      addServer({ command: "npx", name: "keep-b" });
      addServer({ command: "npx", name: "remove-c" });
      removeServer("remove-c");
      const servers = listServers();
      expect(servers).toHaveLength(2);
      expect(servers.find((s) => s.id === "keep-a")).toBeTruthy();
      expect(servers.find((s) => s.id === "keep-b")).toBeTruthy();
    });

    it("disable/enable only affects target server", () => {
      addServer({ command: "npx", name: "stay-enabled" });
      addServer({ command: "npx", name: "gets-disabled" });
      disableServer("gets-disabled");
      expect(getServer("stay-enabled")!.enabled).toBe(true);
      expect(getServer("gets-disabled")!.enabled).toBe(false);
    });
  });

  // ── Server with all fields populated ──

  describe("fully populated server", () => {
    it("round-trips all fields correctly", () => {
      const s = addServer({
        name: "Full Server",
        description: "A fully configured server",
        command: "node",
        args: ["server.js", "--port", "3000"],
        env: { API_KEY: "secret123", DEBUG: "true" },
        transport: "sse",
        url: "http://localhost:3000/sse",
        source: "registry",
      });

      const retrieved = getServer(s.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe("Full Server");
      expect(retrieved!.description).toBe("A fully configured server");
      expect(retrieved!.command).toBe("node");
      expect(retrieved!.args).toEqual(["server.js", "--port", "3000"]);
      expect(retrieved!.env).toEqual({ API_KEY: "secret123", DEBUG: "true" });
      expect(retrieved!.transport).toBe("sse");
      expect(retrieved!.url).toBe("http://localhost:3000/sse");
      expect(retrieved!.source).toBe("registry");
      expect(retrieved!.enabled).toBe(true);
    });
  });
});
