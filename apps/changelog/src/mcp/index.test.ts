import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { VERSION } from "../version.js";

const ENTRY = join(import.meta.dir, "index.ts");

const EXPECTED_TOOLS = [
  "add_changelog_entry",
  "list_changelog_entries",
  "get_changelog_entry",
  "update_changelog_entry",
  "release_changelog",
  "generate_changelog",
  "publish_changelog",
  "changelog_stats",
  "export_changelog_jsonl",
];

describe("changelog-mcp entrypoint", () => {
  test("--help and -h exit 0 promptly with usage text and no stderr", () => {
    for (const flag of ["--help", "-h"]) {
      const result = spawnSync("bun", [ENTRY, flag], { encoding: "utf8", timeout: 30_000 });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Usage: changelog-mcp");
      for (const tool of EXPECTED_TOOLS) {
        expect(result.stdout, `help must list ${tool}`).toContain(tool);
      }
    }
  });

  test("serves the MCP protocol over real stdio with default metadata and all tools", async () => {
    const transport = new StdioClientTransport({
      command: "bun",
      args: [ENTRY],
      stderr: "pipe",
    });
    const client = new Client({ name: "test", version: "0.0.0" });
    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toEqual({ name: "changelog", version: VERSION });
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
    } finally {
      await client.close().catch(() => undefined);
      (transport as unknown as { stderr?: import("node:child_process").ChildProcessWithoutNullStreams }).stderr?.kill?.();
      const child = (transport as unknown as { _process?: import("node:child_process").ChildProcess })._process;
      child?.kill?.("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 100));
      await transport.close().catch(() => undefined);
    }
  });
});
