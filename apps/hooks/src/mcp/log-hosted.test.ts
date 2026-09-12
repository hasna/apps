/**
 * The MCP event tools against the hosted route.
 *
 * `hooks_log_list`, `hooks_log_tail`, `hooks_log_errors`, `hooks_log_summary`,
 * `hooks_run`, `hooks_batch_run` and `send_feedback` all used to read or write
 * `~/.hasna/hooks/hooks.db` directly. Here they run with a hosted credential
 * against a loopback `hooks-serve` built from the REAL `handleServeRequest`,
 * and each assertion is about the rows the ROUTE holds.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHooksServer } from "./server.js";
import { handleServeRequest } from "../serve.js";
import { MemoryHookEventStore } from "../server/memory-event-store.js";
import { closeDb } from "../db/index.js";
import { setPinnedHook, sha256Of } from "../lib/store.js";

const API_KEY = "fixture-mcp-key";
const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-mcp-hosted-"));
const TEST_HOME = mkdtempSync(join(tmpdir(), "hooks-mcp-hosted-home-"));

let store = new MemoryHookEventStore();
let server: ReturnType<typeof Bun.serve>;
const saved: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeAll(() => {
  closeDb();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => handleServeRequest(req, API_KEY, { eventStore: store }),
  });
  setEnv("HASNA_HOOKS_DATA_DIR", TEST_DIR);
  setEnv("HASNA_HOOKS_DB_PATH", join(TEST_DIR, "hooks.db"));
  setEnv("HASNA_HOOKS_LOCK_PATH", join(TEST_DIR, "hooks.lock"));
  setEnv("HOME", TEST_HOME);
  setEnv("HASNA_HOOKS_API_URL", `http://127.0.0.1:${server.port}`);
  setEnv("HASNA_HOOKS_API_KEY", API_KEY);
  // The tools resolve against the ambient env, where the Keychain tier is
  // live: name a station that cannot have an item.
  setEnv("HASNA_STATION", "no-such-station");
  setEnv("HASNA_HOOKS_LOCAL", undefined);
  setEnv("HOOKS_LOCAL", undefined);
});

afterEach(() => {
  store = new MemoryHookEventStore();
  server.reload({ fetch: (req: Request) => handleServeRequest(req, API_KEY, { eventStore: store }) });
});

afterAll(() => {
  server.stop(true);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
  rmSync(TEST_HOME, { recursive: true, force: true });
});

function parseResult(result: any): any {
  return JSON.parse((result.content as any)[0].text);
}

async function withClient(fn: (client: Client) => Promise<void>): Promise<void> {
  const server = createHooksServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function seed(): Promise<unknown> {
  return store.insertEvents([
    {
      session_id: "sess-mcp-1",
      hook_name: "commandlog",
      event_type: "PostToolUse",
      tool_name: "Bash",
      tool_input: "git push --force",
      timestamp: "2026-09-11T10:00:00.000Z",
    },
    {
      session_id: "sess-mcp-2",
      hook_name: "errornotify",
      event_type: "PostToolUse",
      error: "Exit code 1: boom",
      timestamp: "2026-09-11T11:00:00.000Z",
    },
  ] as never[]);
}

/** A trusted custom hook, so the run tools reach execution. */
function trustedHook(name: string, script: string): void {
  const dir = join(TEST_DIR, "hooks", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ name, version: "1.0.0", events: ["PostToolUse"], script: "script.sh" }),
  );
  writeFileSync(join(dir, "script.sh"), script, { mode: 0o755 });
  setPinnedHook(name, {
    version: "1.0.0",
    sha256: sha256Of(readFileSync(join(dir, "script.sh"))),
    source: "custom",
  });
}

describe("MCP log tools read the hosted route", () => {
  test("hooks_log_list returns the registry's rows and names its source", async () => {
    await seed();
    await withClient(async (client) => {
      const body = parseResult(await client.callTool({ name: "hooks_log_list", arguments: {} }));
      expect(body.source).toBe("hosted-registry");
      expect(body.count).toBe(2);
      expect(body.events.map((row: any) => row.hook_name).sort()).toEqual(["commandlog", "errornotify"]);
    });
  });

  test("hooks_log_list filters by hook name and session prefix on the server", async () => {
    await seed();
    await withClient(async (client) => {
      const byHook = parseResult(await client.callTool({ name: "hooks_log_list", arguments: { hook_name: "commandlog" } }));
      expect(byHook.events.map((row: any) => row.hook_name)).toEqual(["commandlog"]);
      const bySession = parseResult(await client.callTool({ name: "hooks_log_list", arguments: { session_id: "sess-mcp-2" } }));
      expect(bySession.events.map((row: any) => row.hook_name)).toEqual(["errornotify"]);
    });
  });

  test("hooks_log_tail returns the newest row first", async () => {
    await seed();
    await withClient(async (client) => {
      const body = parseResult(await client.callTool({ name: "hooks_log_tail", arguments: { n: 1 } }));
      expect(body.source).toBe("hosted-registry");
      expect(body.events.map((row: any) => row.hook_name)).toEqual(["errornotify"]);
    });
  });

  test("hooks_log_errors returns only rows carrying an error", async () => {
    await seed();
    await withClient(async (client) => {
      const body = parseResult(await client.callTool({ name: "hooks_log_errors", arguments: { since: "3650d" } }));
      expect(body.source).toBe("hosted-registry");
      expect(body.count).toBe(1);
      expect(body.events[0].hook_name).toBe("errornotify");
    });
  });

  test("hooks_log_summary aggregates on the server", async () => {
    await seed();
    await withClient(async (client) => {
      const body = parseResult(await client.callTool({ name: "hooks_log_summary", arguments: { since: "3650d" } }));
      expect(body.source).toBe("hosted-registry");
      expect(body.totals).toMatchObject({ events: 2, errors: 1, hooks_active: 2 });
      expect(body.hooks.find((row: any) => row.hook_name === "errornotify")).toMatchObject({ error_rate: "100.0%" });
    });
  });
});

describe("MCP run tools record events on the hosted route", () => {
  test("hooks_run posts the execution event to /api/v1/events", async () => {
    trustedHook("mcprunhook", '#!/bin/bash\necho \'{"continue":true}\'\n');
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "hooks_run",
        arguments: { name: "mcprunhook", input: { session_id: "sess-mcp-run", hook_event_name: "PostToolUse" } },
      });
      expect(JSON.stringify(result.content)).toContain("continue");
    });
    const rows = await store.listEvents({ hook: "mcprunhook" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ session_id: "sess-mcp-run", event_type: "PostToolUse" });
    expect(JSON.parse(rows[0]!.metadata!)).toMatchObject({ exit_code: 0 });
  }, 20_000);

  test("hooks_batch_run posts one event per hook", async () => {
    trustedHook("batchone", '#!/bin/bash\necho \'{"continue":true}\'\n');
    trustedHook("batchtwo", '#!/bin/bash\necho \'{"continue":true}\'\n');
    await withClient(async (client) => {
      await client.callTool({
        name: "hooks_batch_run",
        arguments: {
          hooks: [
            { name: "batchone", input: { session_id: "sess-batch", hook_event_name: "PostToolUse" } },
            { name: "batchtwo", input: { session_id: "sess-batch", hook_event_name: "PostToolUse" } },
          ],
        },
      });
    });
    const rows = await store.listEvents({ session: "sess-batch" });
    expect(rows.map((row) => row.hook_name).sort()).toEqual(["batchone", "batchtwo"]);
  }, 30_000);
});

describe("send_feedback reaches the hosted route", () => {
  test("feedback is stored on the registry, not in a local table", async () => {
    await withClient(async (client) => {
      const body = parseResult(await client.callTool({ name: "send_feedback", arguments: { message: "hosted feedback" } }));
      expect(body).toMatchObject({ ok: true, source: "hosted-registry" });
      expect(typeof body.id).toBe("string");
    });
    expect(store.feedback.map((row) => row.message)).toEqual(["hosted feedback"]);
  });
});
