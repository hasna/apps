import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CWD = join(import.meta.dir, "../..");

let tmpDir: string;
let dbPath: string;
let fakeHome: string;

async function connectAndListTools(command: string, args: string[]): Promise<string[]> {
  const transport = new StdioClientTransport({
    command,
    args,
    cwd: CWD,
    env: {
      ...process.env,
      HOME: fakeHome,
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
    } as Record<string, string>,
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await client.listTools(cursor ? { cursor } : {});
      for (const t of res.tools) names.push(t.name);
      cursor = res.nextCursor;
    } while (cursor);
    return names;
  } finally {
    await client.close();
  }
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "todos-stdio-startup-"));
  dbPath = join(tmpDir, "test.db");
  fakeHome = join(tmpDir, "home");
  await mkdir(join(fakeHome, ".hasna", "todos"), { recursive: true });
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("C1: `todos mcp` starts a stdio MCP server", () => {
  it("responds to the MCP handshake and lists tools", async () => {
    const tools = await connectAndListTools("bun", ["run", "src/cli/index.tsx", "mcp"]);
    expect(tools.length).toBeGreaterThan(0);
    // minimal (default) profile core tool
    expect(tools).toContain("bootstrap");
  }, 30000);
});

describe("C2: bare `todos-mcp` defaults to stdio (not HTTP)", () => {
  it("running mcp/index.ts with no flags speaks stdio", async () => {
    const tools = await connectAndListTools("bun", ["run", "src/mcp/index.ts"]);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools).toContain("bootstrap");
  }, 30000);

  it("still speaks stdio with an explicit --stdio flag (register-writer form)", async () => {
    const tools = await connectAndListTools("bun", ["run", "src/mcp/index.ts", "--stdio"]);
    expect(tools).toContain("bootstrap");
  }, 30000);
});
