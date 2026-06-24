import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "./server.js";
import { closeDb, createSession, logAction } from "../db/index.js";
import type { Session } from "../types/index.js";

let tempDir: string | null = null;
const savedEnv = new Map<string, string | undefined>();

function useTempDb(): void {
  closeDb();
  savedEnv.clear();
  for (const key of ["COMPUTER_DB_PATH", "COMPUTER_DATA_DIR"] as const) {
    savedEnv.set(key, process.env[key]);
  }
  tempDir = mkdtempSync(join(tmpdir(), "computer-mcp-output-"));
  process.env.COMPUTER_DATA_DIR = tempDir;
  process.env.COMPUTER_DB_PATH = join(tempDir, "computer.db");
}

afterEach(() => {
  closeDb();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "computer-mcp-output-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function text(result: unknown): string {
  return ((result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "");
}

function makeSession(id: string): Session {
  return {
    id,
    task: "Investigate a very long terminal transcript and summarize the important facts without dumping every raw action into context.",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    status: "completed",
    steps: 2,
    total_tokens_in: 1_000,
    total_tokens_out: 500,
    total_duration_ms: 2_000,
    created_at: "2026-06-24T06:00:00.000Z",
    completed_at: "2026-06-24T06:01:00.000Z",
  };
}

describe("MCP compact output", () => {
  test("list sessions is compact by default and JSON includes pagination", async () => {
    useTempDb();
    await createSession(makeSession("abc12345-session-output-1"));
    await createSession(makeSession("def67890-session-output-2"));

    await withClient(async (client) => {
      const summary = await client.callTool({ name: "computer_list_sessions", arguments: { limit: 1 } });
      const summaryText = text(summary);

      expect(summaryText).toContain("Sessions");
      expect(summaryText).toContain("computer_get_session");
      expect(() => JSON.parse(summaryText)).toThrow();

      const detail = await client.callTool({ name: "computer_get_session", arguments: { id: "abc12345" } });
      expect(text(detail)).toContain("abc12345-session-output-1");

      const json = await client.callTool({ name: "computer_list_sessions", arguments: { format: "json", limit: 1 } });
      const parsed = JSON.parse(text(json)) as {
        sessions: Array<{ id: string; task: string }>;
        has_more: boolean;
        next_cursor: number | null;
      };
      expect(parsed.sessions).toHaveLength(1);
      expect(parsed.sessions[0].task).toContain("very long terminal transcript");
      expect(parsed.has_more).toBe(true);
      expect(parsed.next_cursor).toBe(1);
    });
  });

  test("get session caps action logs unless verbose or JSON is requested", async () => {
    useTempDb();
    await createSession(makeSession("session-output-2"));
    for (let step = 0; step < 5; step++) {
      await logAction({
        session_id: "session-output-2",
        step,
        action: { type: "type", text: "hello world" },
        reasoning: "Long reasoning ".repeat(30),
        success: true,
        duration_ms: 100,
      });
    }

    await withClient(async (client) => {
      const compact = await client.callTool({
        name: "computer_get_session",
        arguments: { id: "session-output-2", limit: 2 },
      });
      expect(text(compact)).toContain("Action log (2/5");
      expect(text(compact)).toContain("More logs available");
      expect(text(compact)).not.toContain("[  3]");

      const verbose = await client.callTool({
        name: "computer_get_session",
        arguments: { id: "session-output-2", verbose: true },
      });
      expect(text(verbose)).toContain("Action log (5/5, verbose)");

      const json = await client.callTool({
        name: "computer_get_session",
        arguments: { id: "session-output-2", format: "json" },
      });
      const parsed = JSON.parse(text(json)) as { action_logs: unknown[]; has_more: boolean; next_cursor: number | null };
      expect(parsed.action_logs).toHaveLength(5);
      expect(parsed.has_more).toBe(false);
      expect(parsed.next_cursor).toBeNull();
    });
  });

  test("search JSON includes pagination metadata", async () => {
    useTempDb();
    await createSession(makeSession("search-output-1"));
    await createSession(makeSession("search-output-2"));

    await withClient(async (client) => {
      const json = await client.callTool({
        name: "computer_search",
        arguments: { query: "terminal", scope: "sessions", format: "json", limit: 1 },
      });
      const parsed = JSON.parse(text(json)) as {
        sessions: unknown[];
        has_more: boolean;
        next_cursor: number | null;
      };
      expect(parsed.sessions).toHaveLength(1);
      expect(parsed.has_more).toBe(true);
      expect(parsed.next_cursor).toBe(1);
    });
  });
});
