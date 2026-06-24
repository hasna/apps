import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function runMcpPayloadSmoke(): { exitCode: number; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "open-security-compact-mcp-"));
  const code = `
    import { registerAdvisoryTools } from "./src/mcp/tools/advisories.ts";
    import { seedAdvisories } from "./src/data/advisories.ts";
    import { getDb } from "./src/db/index.ts";

    getDb();
    seedAdvisories();

    const handlers = {};
    const server = {
      tool(name, _description, _schema, handler) {
        handlers[name] = handler;
      },
    };
    const jsonResult = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
    registerAdvisoryTools(server, jsonResult);

    const compact = JSON.parse((await handlers.list_advisories({ limit: 1 })).content[0].text);
    const verbose = JSON.parse((await handlers.list_advisories({ limit: 1, verbose: true })).content[0].text);
    console.log(JSON.stringify({ compact, verbose }));
  `;
  const proc = Bun.spawnSync(["bun", "-e", code], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: dir,
      SECURITY_DB: join(dir, "shield.db"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("MCP compact output contracts", () => {
  test("shared MCP JSON output is single-line and list_agents is capped", () => {
    const buildServer = source("src/mcp/build-server.ts");

    expect(buildServer).toContain("JSON.stringify(data)");
    expect(buildServer).not.toContain("JSON.stringify(data, null, 2)");
    expect(buildServer).toContain("agents.slice(0, 20)");
    expect(buildServer).toContain("More agents hidden");
  });

  test("list-like MCP tools support compact defaults and verbose detail mode", () => {
    const files = [
      "src/mcp/tools/findings.ts",
      "src/mcp/tools/scan.ts",
      "src/mcp/tools/rules-policies.ts",
      "src/mcp/tools/advisories.ts",
    ].map(source);

    for (const text of files) {
      expect(text).toContain("compactListResult");
      expect(text).toContain("compact: true");
      expect(text).toContain("verbose");
      expect(text).toContain("parseLimitOption");
    }
  });

  test("storage status exposes compact and verbose modes without pretty dumps", () => {
    const storage = source("src/mcp/tools/storage.ts");

    expect(storage).toContain("compactStorageStatus");
    expect(storage).toContain("verbose");
    expect(storage).toContain("JSON.stringify(data)");
    expect(storage).not.toContain("JSON.stringify(data, null, 2)");
  });

  test("list_advisories returns compact rows by default and full rows with verbose", () => {
    const result = runMcpPayloadSmoke();
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");

    const parsed = JSON.parse(result.stdout);
    expect(parsed.compact.compact).toBe(true);
    expect(parsed.compact.advisories).toHaveLength(1);
    expect(parsed.compact.advisories[0].affected_versions).toBeUndefined();
    expect(parsed.compact.next_offset).toBe(1);
    expect(parsed.compact.hint).toContain("verbose=true");

    expect(parsed.verbose.compact).toBe(false);
    expect(parsed.verbose.advisories).toHaveLength(1);
    expect(parsed.verbose.advisories[0].affected_versions).toBeArray();
    expect(parsed.verbose.advisories[0].detected_at).toBeString();
  });
});
