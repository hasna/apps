import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";

const MCP = join(import.meta.dir, "..", "..", "bin", "mcp.js");
const TEST_DIR = join(import.meta.dir, "..", "..", ".test-mcp-tmp");
const MANIFEST_PATH = join(TEST_DIR, ".connectors", "manifest.json");

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
  test("prints help and exits", async () => {
    const proc = Bun.spawn(["bun", MCP, "--help"], {
      cwd: TEST_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Usage: connectors-mcp");
    expect(stdout).toContain("stdio");
  });

  test("prints version and exits", async () => {
    const proc = Bun.spawn(["bun", MCP, "--version"], {
      cwd: TEST_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("direct shebang launch responds to initialize", async () => {
    const proc = Bun.spawn([MCP], {
      cwd: TEST_DIR,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      }) + "\n"
    );
    proc.stdin.end();

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const lines = stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const response = JSON.parse(lines[0]);
    expect(response.id).toBe(1);
    expect(response.result?.protocolVersion).toBe("2025-06-18");
  });

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
      expect(data.usage).toContain("connectors run <connector> --help");
      expect(data.usage).toContain("connectors serve");

      expect(existsSync(MANIFEST_PATH)).toBe(true);
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as {
        connectors: string[];
      };
      expect(manifest.connectors).toContain("anthropic");
      expect(manifest.connectors).toContain("figma");
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

  describe("search_connectors edge cases", () => {
    test("finds by tag", async () => {
      const res = await callMcp("search_connectors", { query: "llm" });
      const data = parseContent(res);
      expect(data.some((c: any) => c.name === "anthropic")).toBe(true);
      expect(data.some((c: any) => c.name === "openai")).toBe(true);
    });

    test("finds google connectors", async () => {
      const res = await callMcp("search_connectors", { query: "google" });
      const data = parseContent(res);
      expect(data.length).toBeGreaterThan(3);
    });
  });

  describe("list_connectors edge cases", () => {
    test("lists Developer Tools category", async () => {
      const res = await callMcp("list_connectors", { category: "Developer Tools" });
      const data = parseContent(res);
      expect(data.some((c: any) => c.name === "github")).toBe(true);
      expect(data.every((c: any) => c.category === "Developer Tools")).toBe(true);
    });

    test("case-insensitive category matching", async () => {
      const res = await callMcp("list_connectors", { category: "ai & ml" });
      const data = parseContent(res);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });
  });

  describe("connector_docs edge cases", () => {
    test("returns cli commands for stripe", async () => {
      const res = await callMcp("connector_docs", { name: "stripe" });
      const data = parseContent(res);
      expect(data.cliCommands).toContain("connect-stripe");
    });

    test("returns data storage for github", async () => {
      const res = await callMcp("connector_docs", { name: "github" });
      const data = parseContent(res);
      expect(data.dataStorage).toContain("~/.hasna/connectors/connect-github");
    });

    test("returns version and category in docs", async () => {
      const res = await callMcp("connector_docs", { name: "anthropic" });
      const data = parseContent(res);
      expect(data.version).toBeDefined();
      expect(data.category).toBe("AI & ML");
      expect(data.displayName).toBe("Anthropic");
    });
  });

  describe("install_connector edge cases", () => {
    test("usage field is undefined when all fail", async () => {
      const res = await callMcp("install_connector", {
        names: ["nonexistent-a", "nonexistent-b"],
      });
      const data = parseContent(res);
      expect(data.results[0].success).toBe(false);
      expect(data.results[1].success).toBe(false);
      expect(data.usage).toBeUndefined();
    });

    test("overwrite flag works", async () => {
      await callMcp("install_connector", { names: ["anthropic"] });
      // Without overwrite, should fail
      const res1 = await callMcp("install_connector", { names: ["anthropic"] });
      const data1 = parseContent(res1);
      expect(data1.results[0].success).toBe(false);
      // With overwrite, should succeed
      const res2 = await callMcp("install_connector", {
        names: ["anthropic"],
        overwrite: true,
      });
      const data2 = parseContent(res2);
      expect(data2.results[0].success).toBe(true);
    });

    test("summary contains error messages for failures", async () => {
      const res = await callMcp("install_connector", {
        names: ["nonexistent-xyz"],
      });
      const data = parseContent(res);
      expect(data.summary).toContain("✗");
      expect(data.summary).toContain("not found");
    });
  });

  describe("connector_info edge cases", () => {
    test("installed flag is false before install", async () => {
      const res = await callMcp("connector_info", { name: "figma" });
      const data = parseContent(res);
      expect(data.installed).toBe(false);
    });

    test("installed flag is true after install", async () => {
      await callMcp("install_connector", { names: ["figma"] });
      const res = await callMcp("connector_info", { name: "figma" });
      const data = parseContent(res);
      expect(data.installed).toBe(true);
    });

    test("includes tags array", async () => {
      const res = await callMcp("connector_info", { name: "stripe" });
      const data = parseContent(res);
      expect(Array.isArray(data.tags)).toBe(true);
      expect(data.tags).toContain("payments");
    });
  });

  describe("connector_auth_status", () => {
    test("returns auth status for bearer connector", async () => {
      const res = await callMcp("connector_auth_status", { name: "stripe" });
      const data = parseContent(res);
      expect(data.type).toBe("bearer");
      expect(typeof data.configured).toBe("boolean");
    });

    test("returns auth status for oauth connector", async () => {
      const res = await callMcp("connector_auth_status", { name: "gmail" });
      const data = parseContent(res);
      expect(data.type).toBe("oauth");
      expect(typeof data.hasRefreshToken).toBe("boolean");
    });

    test("errors for non-existent connector", async () => {
      const res = await callMcp("connector_auth_status", { name: "nonexistent" });
      expect(res.result?.isError).toBe(true);
    });

    test("returns envVars array with variable and description", async () => {
      const res = await callMcp("connector_auth_status", { name: "stripe" });
      const data = parseContent(res);
      expect(Array.isArray(data.envVars)).toBe(true);
      expect(data.envVars.length).toBeGreaterThan(0);
      expect(data.envVars[0]).toHaveProperty("variable");
      expect(data.envVars[0]).toHaveProperty("description");
    });
  });

  describe("configure_auth", () => {
    const authName1 = `zzztest${process.pid}mcpauth1`;
    const authName2 = `zzztest${process.pid}mcpauth2`;

    afterEach(async () => {
      const { rmSync, existsSync } = await import("fs");
      const { join } = await import("path");
      const { homedir } = await import("os");
      for (const n of [authName1, authName2]) {
        const dir = join(homedir(), ".hasna", "connectors", `connect-${n}`);
        if (existsSync(dir)) rmSync(dir, { recursive: true });
      }
    });

    test("saves API key for a connector", async () => {
      const res = await callMcp("configure_auth", { name: authName1, key: "sk_test_key_mcp" });
      const data = parseContent(res);
      expect(data.success).toBe(true);
      expect(data.connector).toBe(authName1);
    });

    test("saves API key with custom field", async () => {
      const res = await callMcp("configure_auth", { name: authName2, key: "my-token", field: "bearerToken" });
      const data = parseContent(res);
      expect(data.success).toBe(true);
      expect(data.field).toBe("bearerToken");
    });
  });

  describe("list_categories", () => {
    test("returns all categories with counts", async () => {
      const res = await callMcp("list_categories", {});
      const data = parseContent(res);
      expect(Array.isArray(data.categories)).toBe(true);
      expect(data.categories.length).toBeGreaterThan(10);
      expect(data.total).toBeGreaterThanOrEqual(62);

      const aiCategory = data.categories.find((c: any) => c.category === "AI & ML");
      expect(aiCategory).toBeDefined();
      expect(aiCategory.count).toBeGreaterThan(0);
    });

    test("each category has category name and count", async () => {
      const res = await callMcp("list_categories", {});
      const data = parseContent(res);
      for (const cat of data.categories) {
        expect(typeof cat.category).toBe("string");
        expect(typeof cat.count).toBe("number");
      }
    });
  });

  describe("list_connector_operations", () => {
    test("lists operations for a connector", async () => {
      const res = await callMcp("list_connector_operations", { name: "stripe" });
      const data = parseContent(res);
      expect(data.connector).toBe("stripe");
      expect(data.displayName).toBe("Stripe");
      expect(data.commands).toBeInstanceOf(Array);
      expect(data.commands.length).toBeGreaterThan(0);
      expect(data.commands).toContain("products");
      expect(data.commands).toContain("customers");
      expect(data.auth.type).toBe("bearer");
      expect(data.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "products",
            source: "internal",
          }),
        ])
      );
    });

    test("returns subcommand help when command specified", async () => {
      const res = await callMcp("list_connector_operations", {
        name: "stripe",
        command: "products",
      });
      const data = parseContent(res);
      expect(data.connector).toBe("stripe");
      expect(data.command).toBe("products");
      expect(data.help).toContain("list");
      expect(data.help).toContain("create");
    });

    test("returns error for unknown connector", async () => {
      const res = await callMcp("list_connector_operations", { name: "zzzznonexistent" });
      expect(res.result?.isError).toBe(true);
    });

    test("lists operations for gmail", async () => {
      const res = await callMcp("list_connector_operations", { name: "gmail" });
      const data = parseContent(res);
      expect(data.connector).toBe("gmail");
      expect(data.commands).toContain("messages");
      expect(data.commands).toContain("attachments");
      expect(data.commands).not.toContain("queries)");
      expect(data.auth.type).toBe("oauth");
      expect(data.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "messages",
            source: "cli",
          }),
        ])
      );
    });

    test("lists operations for anthropic", async () => {
      const res = await callMcp("list_connector_operations", { name: "anthropic" });
      const data = parseContent(res);
      expect(data.connector).toBe("anthropic");
      expect(data.commands).toContain("messages");
      expect(data.commands).toContain("models");
    });

    test("lists operations for github", async () => {
      const res = await callMcp("list_connector_operations", { name: "github" });
      const data = parseContent(res);
      expect(data.connector).toBe("github");
      expect(data.commands).toContain("repo");
      expect(data.commands).toContain("issue");
    });

    test("lists operations for stripe", async () => {
      const res = await callMcp("list_connector_operations", { name: "stripe" });
      const data = parseContent(res);
      expect(data.connector).toBe("stripe");
      expect(data.commands).toContain("config");
      expect(data.commands).toContain("products");
    });
  });

  describe("run_connector_operation", () => {
    test("runs connector operation successfully", async () => {
      const res = await callMcp("run_connector_operation", {
        name: "anthropic",
        args: ["models"],
      });
      const data = parseContent(res);
      expect(data.connector).toBe("anthropic");
      expect(data.success).toBe(true);
      expect(data.output).toContain("claude");
    });

    test("returns error for unknown connector", async () => {
      const res = await callMcp("run_connector_operation", {
        name: "zzzznonexistent",
        args: ["test"],
      });
      expect(res.result?.isError).toBe(true);
    });

    test("returns error for invalid command", async () => {
      const res = await callMcp("run_connector_operation", {
        name: "stripe",
        args: ["zzzznonexistent"],
      });
      const data = parseContent(res);
      expect(data.success).toBe(false);
    });

    test("passes format option", async () => {
      const res = await callMcp("run_connector_operation", {
        name: "anthropic",
        args: ["models"],
        format: "pretty",
      });
      const data = parseContent(res);
      expect(data.success).toBe(true);
    });

    test("runs internal github command surface", async () => {
      const res = await callMcp("run_connector_operation", {
        name: "github",
        args: ["config", "show"],
        format: "json",
      });
      const data = parseContent(res);
      expect(data.connector).toBe("github");
      expect(data.success).toBe(true);
      expect(data.output).toContain("\"profile\"");
    });

    test("runs internal stripe command surface", async () => {
      const res = await callMcp("run_connector_operation", {
        name: "stripe",
        args: ["config", "show"],
        format: "json",
      });
      const data = parseContent(res);
      expect(data.connector).toBe("stripe");
      expect(data.success).toBe(true);
      expect(data.output).toContain("\"profile\"");
    });
  });
});
