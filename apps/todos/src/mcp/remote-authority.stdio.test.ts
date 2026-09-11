/**
 * End-to-end regression for the MCP plan/task-list tools in local mode.
 *
 * The 0.16.0 conversion of these tools to the authenticated shared API made the
 * old guard throw a plain `Error` when no cloud client resolved, which the MCP
 * error formatter sanitized to `UNKNOWN_ERROR` ("An unexpected error occurred.
 * Check server logs for details."). The in-process suite in
 * `remote-authority.test.ts` pins the handler + formatter pair; this file pins
 * the surface a client actually sees: the real server over stdio.
 *
 * It is the reproducer from the release review, kept as a test: spawn
 * `src/mcp/index.ts` with the local opt-in and no credential, then assert every
 * affected tool answers with the typed `REMOTE_API_CONFIG_MISSING` payload —
 * while a genuinely local tool still answers locally.
 */
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

// One spawned server for the whole file; give a loaded host room for the cold start.
setDefaultTimeout(120_000);

const CWD = join(import.meta.dir, "../..");
const REMOTE_API_CONFIG_MISSING = "REMOTE_API_CONFIG_MISSING";

let tmpDir: string;
let client: Client;

function textPayload(result: unknown): any {
  const content = (result as { content?: { type: string; text: string }[] }).content;
  return JSON.parse(content?.[0]?.text ?? "null");
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "todos-mcp-remote-authority-stdio-"));
  const dbPath = join(tmpDir, "test.db");
  const fakeHome = join(tmpDir, "home");
  await mkdir(join(fakeHome, ".hasna", "todos"), { recursive: true });
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/mcp/index.ts"],
    cwd: CWD,
    // localRoutingTestEnv blanks every authority variable and turns the local
    // opt-in on, so this session physically cannot reach a hosted authority.
    env: localRoutingTestEnv({
      TODOS_PROFILE: "full",
      HOME: fakeHome,
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
    }) as Record<string, string>,
  });
  client = new Client({ name: "remote-authority-stdio", version: "1.0.0" });
  await client.connect(transport);
});

afterAll(async () => {
  await client?.close();
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

describe("MCP plan/task-list tools fail closed with a typed error over stdio", () => {
  for (const [tool, args] of [
    ["list_plans", {}],
    ["list_task_lists", {}],
    ["get_plan", { plan_id: "missing" }],
    ["get_task_list", { task_list_id: "missing" }],
    ["create_plan", { name: "probe" }],
  ] as const) {
    it(`${tool} returns REMOTE_API_CONFIG_MISSING, not UNKNOWN_ERROR`, async () => {
      const result = await client.callTool({ name: tool, arguments: args as Record<string, unknown> });
      expect(result.isError).toBe(true);
      const body = textPayload(result);
      expect(body.code).toBe(REMOTE_API_CONFIG_MISSING);
      expect(body.code).not.toBe("UNKNOWN_ERROR");
      expect(body.suggestion).toContain("HASNA_TODOS_API_URL");
    });
  }

  it("a tool with a real local path still answers locally in the same session", async () => {
    const result = await client.callTool({ name: "list_projects", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect((result as { content: { text: string }[] }).content[0]!.text).toBe("No projects found.");
  });
});
