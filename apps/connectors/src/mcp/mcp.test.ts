import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const MCP = join(import.meta.dir, "..", "..", "bin", "mcp.js");
const TEST_DIR = join(import.meta.dir, "..", "..", ".test-mcp-tmp");

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

async function callMcp(
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<{ result?: any; error?: any }> {
  const messages = [
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    }),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  ].join("\n") + "\n";

  const proc = Bun.spawn(["bun", MCP], {
    cwd: TEST_DIR,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(messages);
  proc.stdin.end();

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  // Parse the last JSON-RPC response (the tool call result)
  const lines = stdout.trim().split("\n");
  const lastLine = lines[lines.length - 1];
  return JSON.parse(lastLine);
}

function parseContent(response: any): any {
  const text = response.result?.content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

beforeEach(() => {
  cleanup();
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  cleanup();
});

describe("MCP Server", () => {
  describe("search_connectors", () => {
    test("finds connectors by keyword", async () => {
      const res = await callMcp("search_connectors", { query: "payment" });
      const data = parseContent(res);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data.some((c: any) => c.name === "stripe")).toBe(true);
    });

    test("returns empty array for no matches", async () => {
      const res = await callMcp("search_connectors", { query: "zzzznonexistent" });
      const data = parseContent(res);
      expect(data).toEqual([]);
    });

    test("returns name, version, category, description", async () => {
      const res = await callMcp("search_connectors", { query: "figma" });
      const data = parseContent(res);
      const figma = data.find((c: any) => c.name === "figma");
      expect(figma).toBeDefined();
      expect(figma.displayName).toBe("Figma");
      expect(figma.version).toBeDefined();
      expect(figma.category).toBe("Design & Content");
    });
  });

  describe("list_connectors", () => {
    test("lists all connectors without category", async () => {
      const res = await callMcp("list_connectors", {});
      const data = parseContent(res);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(50);
    });

    test("filters by category", async () => {
      const res = await callMcp("list_connectors", { category: "AI & ML" });
      const data = parseContent(res);
      expect(data.length).toBeGreaterThan(0);
      for (const c of data) {
        expect(c.category).toBe("AI & ML");
      }
    });

    test("errors for invalid category", async () => {
      const res = await callMcp("list_connectors", { category: "Nonexistent" });
      const text = res.result?.content?.[0]?.text;
      expect(text).toContain("Unknown category");
      expect(res.result?.isError).toBe(true);
    });
  });

  describe("connector_docs", () => {
    test("returns structured docs for a connector", async () => {
      const res = await callMcp("connector_docs", { name: "stripe" });
      const data = parseContent(res);
      expect(data.name).toBe("stripe");
      expect(data.overview).toContain("Stripe");
      expect(data.auth).toContain("Bearer");
      expect(Array.isArray(data.envVars)).toBe(true);
      expect(data.envVars.length).toBeGreaterThan(0);
      expect(data.envVars[0]).toHaveProperty("variable");
      expect(data.envVars[0]).toHaveProperty("description");
    });

    test("returns env vars for gmail", async () => {
      const res = await callMcp("connector_docs", { name: "gmail" });
      const data = parseContent(res);
      expect(data.auth).toContain("OAuth");
      expect(data.envVars.some((v: any) => v.variable === "GMAIL_CLIENT_ID")).toBe(true);
    });

    test("errors for non-existent connector", async () => {
      const res = await callMcp("connector_docs", { name: "nonexistent" });
      expect(res.result?.isError).toBe(true);
    });
  });

  describe("connector_info", () => {
    test("returns connector metadata", async () => {
      const res = await callMcp("connector_info", { name: "anthropic" });
      const data = parseContent(res);
      expect(data.name).toBe("anthropic");
      expect(data.displayName).toBe("Anthropic");
      expect(data.category).toBe("AI & ML");
      expect(data).toHaveProperty("version");
      expect(data).toHaveProperty("installed");
      expect(data.package).toBe("@hasna/connect-anthropic");
    });

    test("errors for non-existent connector", async () => {
      const res = await callMcp("connector_info", { name: "nonexistent" });
      expect(res.result?.isError).toBe(true);
    });
  });

  describe("install_connector", () => {
    test("installs connectors", async () => {
      const res = await callMcp("install_connector", {
        names: ["anthropic", "figma"],
      });
      const data = parseContent(res);
      expect(data.results).toHaveLength(2);
      expect(data.results[0].success).toBe(true);
      expect(data.results[1].success).toBe(true);
      expect(data.usage).toContain("anthropic");
      expect(data.usage).toContain("figma");

      // Verify files exist
      expect(existsSync(join(TEST_DIR, ".connectors", "connect-anthropic"))).toBe(true);
      expect(existsSync(join(TEST_DIR, ".connectors", "connect-figma"))).toBe(true);
    });

    test("errors for non-existent connector", async () => {
      const res = await callMcp("install_connector", {
        names: ["nonexistent-xyz"],
      });
      const data = parseContent(res);
      expect(data.results[0].success).toBe(false);
    });
  });

  describe("list_installed", () => {
    test("returns empty when nothing installed", async () => {
      const res = await callMcp("list_installed");
      const data = parseContent(res);
      expect(data.installed).toEqual([]);
      expect(data.count).toBe(0);
    });

    test("returns installed connectors after install", async () => {
      await callMcp("install_connector", { names: ["anthropic"] });
      const res = await callMcp("list_installed");
      const data = parseContent(res);
      expect(data.installed).toContain("anthropic");
      expect(data.count).toBe(1);
    });
  });

  describe("remove_connector", () => {
    test("removes an installed connector", async () => {
      await callMcp("install_connector", { names: ["anthropic"] });
      const res = await callMcp("remove_connector", { name: "anthropic" });
      const data = parseContent(res);
      expect(data.removed).toBe(true);
    });

    test("returns false for non-installed connector", async () => {
      const res = await callMcp("remove_connector", { name: "nonexistent" });
      const data = parseContent(res);
      expect(data.removed).toBe(false);
    });
  });
});
