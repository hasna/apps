/**
 * The four bundled observability hooks (`commandlog`, `sessionlog`,
 * `costwatch`, `errornotify`) write their events to the hosted route.
 *
 * Each of them imported `writeHookEvent` and wrote `~/.hasna/hooks/hooks.db`
 * unconditionally — no transport decision at all. They now go through the
 * routed sink, so each script is run here as a real process against a
 * loopback `hooks-serve` built from the REAL handler, and the assertion is
 * that the ROUTE holds the row and the temporary HOME holds no database.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { handleServeRequest } from "../serve.js";
import { MemoryHookEventStore } from "../server/memory-event-store.js";

const API_KEY = "fixture-bundled-key";
const HOOKS_ROOT = join(import.meta.dir, "..", "..", "hooks");

let store = new MemoryHookEventStore();
let server: ReturnType<typeof Bun.serve>;
let origin = "";
let HOME = "";
let DATA_DIR = "";

function hookEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    ...process.env,
    HOME,
    HASNA_HOOKS_DATA_DIR: DATA_DIR,
    HASNA_HOOKS_DB_PATH: join(DATA_DIR, "hooks.db"),
    HASNA_HOOKS_API_URL: origin,
    HASNA_HOOKS_API_KEY: API_KEY,
    HASNA_STATION: "no-such-station",
    HASNA_HOOKS_LOCAL: undefined,
    HOOKS_LOCAL: undefined,
    ...extra,
  };
}

function sqliteFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sqliteFilesUnder(full));
    else if (/\.(?:db|sqlite3?)/.test(entry.name)) out.push(full);
  }
  return out;
}

async function runBundledHook(
  hookDir: string,
  input: unknown,
  env: Record<string, string | undefined> = hookEnv(),
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", join(HOOKS_ROOT, hookDir, "src", "hook.ts")], {
    stdin: new Response(JSON.stringify(input)),
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, exitCode: await proc.exited };
}

beforeAll(() => {
  HOME = mkdtempSync(join(tmpdir(), "hooks-bundled-home-"));
  DATA_DIR = mkdtempSync(join(tmpdir(), "hooks-bundled-data-"));
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => handleServeRequest(req, API_KEY, { eventStore: store }),
  });
  origin = `http://127.0.0.1:${server.port}`;
});

afterEach(() => {
  store = new MemoryHookEventStore();
  server.reload({ fetch: (req: Request) => handleServeRequest(req, API_KEY, { eventStore: store }) });
});

afterAll(() => {
  server.stop(true);
  rmSync(HOME, { recursive: true, force: true });
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe("bundled observability hooks post to /api/v1/events", () => {
  test("hook-commandlog records a Bash command", async () => {
    const result = await runBundledHook("hook-commandlog", {
      session_id: "sess-bundled-cmd",
      cwd: "/work",
      tool_name: "Bash",
      tool_input: { command: "git status", exit_code: 0 },
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ continue: true });

    const rows = await store.listEvents({ hook: "commandlog" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      session_id: "sess-bundled-cmd",
      event_type: "PostToolUse",
      tool_name: "Bash",
      tool_input: "git status",
      project_dir: "/work",
    });
    expect(sqliteFilesUnder(HOME)).toEqual([]);
  }, 20_000);

  test("hook-sessionlog records every tool call", async () => {
    const result = await runBundledHook("hook-sessionlog", {
      session_id: "sess-bundled-session",
      cwd: "/work",
      tool_name: "Read",
      tool_input: { file_path: "/work/README.md" },
    });
    expect(result.exitCode).toBe(0);

    const rows = await store.listEvents({ hook: "sessionlog" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ session_id: "sess-bundled-session", tool_name: "Read" });
    expect(rows[0]!.tool_input).toContain("README.md");
    expect(sqliteFilesUnder(HOME)).toEqual([]);
  }, 20_000);

  test("hook-costwatch records a Stop event with its estimate metadata", async () => {
    const result = await runBundledHook("hook-costwatch", {
      session_id: "sess-bundled-cost",
      cwd: "/work",
      hook_event_name: "Stop",
    });
    expect(result.exitCode).toBe(0);

    const rows = await store.listEvents({ hook: "costwatch" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe("Stop");
    expect(JSON.parse(rows[0]!.metadata!)).toHaveProperty("budget_usd");
    expect(sqliteFilesUnder(HOME)).toEqual([]);
  }, 20_000);

  test("hook-errornotify records a failing tool call", async () => {
    const result = await runBundledHook("hook-errornotify", {
      session_id: "sess-bundled-err",
      cwd: "/work",
      tool_name: "Bash",
      tool_input: { command: "false" },
      tool_output: { exit_code: 1, stderr: "command failed" },
    });
    expect(result.exitCode).toBe(0);

    const rows = await store.listEvents({ hook: "errornotify" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.error).toContain("Exit code 1");
    expect(sqliteFilesUnder(HOME)).toEqual([]);
  }, 20_000);

  test("a hook whose registry is unreachable still succeeds — and writes no database", async () => {
    const env = hookEnv({ HASNA_HOOKS_API_URL: "http://127.0.0.1:1" });
    const result = await runBundledHook(
      "hook-commandlog",
      { session_id: "sess-bundled-down", cwd: "/work", tool_name: "Bash", tool_input: { command: "ls" } },
      env,
    );
    // Observability must never break the agent's tool call.
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ continue: true });
    expect(result.stderr).toContain("event not recorded");
    expect(sqliteFilesUnder(HOME)).toEqual([]);
  }, 20_000);
});
