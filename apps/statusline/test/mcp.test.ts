import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildServer } from "../src/mcp/index";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "statusline-mcp-"));
  tempDirs.push(dir);
  return dir;
}

async function connectClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  const client = new Client({ name: "statusline-mcp-test", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function parseToolText(result: Awaited<ReturnType<Client["callTool"]>>): any {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]?.text ?? "{}");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("statusline MCP server", () => {
  test("lists tools and renders statusline", async () => {
    const { client, close } = await connectClient();
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("render_statusline");
      const render = parseToolText(
        await client.callTool({
          name: "render_statusline",
          arguments: {
            input: { cwd: process.cwd(), model: { id: "claude-fable-5[1m]" } },
            config: { separator: " | ", segments: ["model-context"] },
          },
        }),
      );
      expect(render.line).toBe("fable 5 [1m]");
    } finally {
      await close();
    }
  });

  test("updates config only with explicit write confirmation", async () => {
    const configPath = join(tempDir(), "config.json");
    const otherConfigPath = join(tempDir(), "other.json");
    const previousConfig = process.env.STATUSLINE_CONFIG;
    process.env.STATUSLINE_CONFIG = configPath;
    const { client, close } = await connectClient();
    try {
      const denied = await client.callTool({
        name: "enable_segments",
        arguments: { config_path: configPath, ids: ["duration"] },
      });
      expect(denied.isError).toBe(true);

      const dryRun = parseToolText(
        await client.callTool({
          name: "enable_segments",
          arguments: { config_path: configPath, ids: ["duration"], dry_run: true },
        }),
      );
      expect(dryRun.config.segments).toContain("duration");
      expect(() => readFileSync(configPath, "utf8")).toThrow();

      const written = parseToolText(
        await client.callTool({
          name: "enable_segments",
          arguments: { config_path: configPath, ids: ["duration"], confirm_write: true },
        }),
      );
      expect(written.config.segments).toContain("duration");
      expect(JSON.parse(readFileSync(configPath, "utf8")).segments).toContain("duration");

      const arbitraryPath = await client.callTool({
        name: "enable_segments",
        arguments: { config_path: otherConfigPath, ids: ["cost"], confirm_write: true },
      });
      expect(arbitraryPath.isError).toBe(true);
      expect(JSON.stringify(parseToolText(arbitraryPath))).toContain("restricted");
    } finally {
      await close();
      if (previousConfig === undefined) delete process.env.STATUSLINE_CONFIG;
      else process.env.STATUSLINE_CONFIG = previousConfig;
    }
  });

  test("statusline_health returns server metadata", async () => {
    const { client, close } = await connectClient();
    try {
      const health = parseToolText(await client.callTool({ name: "statusline_health", arguments: {} }));
      expect(health.ok).toBe(true);
      expect(health.name).toBe("statusline-mcp");
      expect(health.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(typeof health.defaultConfigPath).toBe("string");
    } finally {
      await close();
    }
  });

  test("get, list, update, disable, order, reset, and preview config operations", async () => {
    const configPath = join(tempDir(), "config.json");
    const previousConfig = process.env.STATUSLINE_CONFIG;
    process.env.STATUSLINE_CONFIG = configPath;
    const { client, close } = await connectClient();
    try {
      const list = parseToolText(await client.callTool({ name: "list_segments", arguments: { config_path: configPath } }));
      expect(list.segments.some((segment: { id: string }) => segment.id === "machine")).toBe(true);

      const updated = parseToolText(
        await client.callTool({
          name: "update_config",
          arguments: {
            config_path: configPath,
            separator: " | ",
            segments: ["machine", "duration", "cost"],
            confirm_write: true,
          },
        }),
      );
      expect(updated.config.separator).toBe(" | ");
      expect(updated.config.segments).toEqual(["machine", "duration", "cost"]);

      const disabled = parseToolText(
        await client.callTool({
          name: "disable_segments",
          arguments: { config_path: configPath, ids: ["duration"], confirm_write: true },
        }),
      );
      expect(disabled.config.segments).toEqual(["machine", "cost"]);

      const order = parseToolText(
        await client.callTool({
          name: "order_segments",
          arguments: { config_path: configPath, ids: ["machine", "cost"], confirm_write: true },
        }),
      );
      expect(order.config.segments).toEqual(["machine", "cost"]);

      const config = parseToolText(await client.callTool({ name: "get_config", arguments: { config_path: configPath } }));
      expect(config.config.segments).toEqual(["machine", "cost"]);

      const preview = parseToolText(await client.callTool({ name: "preview_statusline", arguments: { config_path: configPath } }));
      expect(typeof preview.line).toBe("string");

      const resetDry = parseToolText(
        await client.callTool({
          name: "reset_config",
          arguments: { config_path: configPath, dry_run: true },
        }),
      );
      expect(resetDry.dryRun).toBe(true);
      expect(resetDry.config.segments).toContain("model-context");
      expect(JSON.parse(readFileSync(configPath, "utf8")).segments).toEqual(["machine", "cost"]);

      const reset = parseToolText(
        await client.callTool({
          name: "reset_config",
          arguments: { config_path: configPath, confirm_write: true },
        }),
      );
      expect(reset.config.segments).toContain("model-context");
    } finally {
      await close();
      if (previousConfig === undefined) delete process.env.STATUSLINE_CONFIG;
      else process.env.STATUSLINE_CONFIG = previousConfig;
    }
  });

  test("startMcpServer subprocess prints stdio banner", async () => {
    const proc = Bun.spawn(["bun", "src/mcp/index.ts"], {
      cwd: import.meta.dir + "/..",
      stderr: "pipe",
      stdin: "ignore",
      stdout: "ignore",
    });
    const stderr = await new Response(proc.stderr).text();
    proc.kill();
    await proc.exited;
    expect(stderr).toContain("statusline MCP server running on stdio");
  }, 10_000);

  test("startMcpServer connects buildServer in-process", async () => {
    const messages: string[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => {
      messages.push(args.map(String).join(" "));
    };
    const connect = McpServer.prototype.connect;
    McpServer.prototype.connect = async function () {};
    try {
      const { startMcpServer } = await import("../src/mcp/index");
      await startMcpServer();
      expect(messages.some((m) => m.includes("statusline MCP server running on stdio"))).toBe(true);
    } finally {
      McpServer.prototype.connect = connect;
      console.error = origErr;
    }
  });
});
