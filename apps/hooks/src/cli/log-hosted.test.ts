/**
 * `hooks log …` and `hooks run` against the hosted event route.
 *
 * The CLI runs as a real subprocess with a hosted credential (a temporary
 * HOME, an api-url pointing at a loopback `hooks-serve` built from the REAL
 * `handleServeRequest`, and a station name that cannot match a Keychain
 * item). Every command is asserted to read or write the rows the ROUTE
 * holds — not a local SQLite file.
 *
 * Note on `hooks run`: the trust check (`checkScriptHash`, src/lib/store.ts)
 * still opens the local trust store, and that gate belongs to the fail-closed
 * lane, not to this port. What this file proves about `run` is the ported
 * half: the execution EVENT goes to `/api/v1/events` and no `hook_events`
 * row is written locally.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { handleServeRequest } from "../serve.js";
import { MemoryHookEventStore } from "../server/memory-event-store.js";

const CLI = join(import.meta.dir, "index.tsx");
const API_KEY = "fixture-cli-key";

let store = new MemoryHookEventStore();
let server: ReturnType<typeof Bun.serve>;
let origin = "";
let HOME = "";
let DATA_DIR = "";

function hostedEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    ...process.env,
    HOME,
    HASNA_HOOKS_DATA_DIR: DATA_DIR,
    HASNA_HOOKS_DB_PATH: join(DATA_DIR, "hooks.db"),
    HASNA_HOOKS_LOCK_PATH: join(DATA_DIR, "hooks.lock"),
    HASNA_HOOKS_API_URL: origin,
    HASNA_HOOKS_API_KEY: API_KEY,
    // The Keychain tier is ambient for a subprocess: name a station that
    // cannot have an item so the env tier is what resolves.
    HASNA_STATION: "no-such-station",
    HASNA_HOOKS_LOCAL: undefined,
    HOOKS_LOCAL: undefined,
    NO_COLOR: "1",
    ...extra,
  };
}

async function cli(
  args: string[],
  options: { env?: Record<string, string | undefined>; stdin?: string } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: options.stdin === undefined ? "ignore" : new Response(options.stdin),
    env: options.env ?? hostedEnv(),
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, exitCode: await proc.exited };
}

function seed(): Promise<unknown> {
  return store.insertEvents([
    {
      session_id: "sess-cli-1",
      hook_name: "commandlog",
      event_type: "PostToolUse",
      tool_name: "Bash",
      tool_input: "git push --force",
      timestamp: "2026-09-11T10:00:00.000Z",
    },
    {
      session_id: "sess-cli-2",
      hook_name: "errornotify",
      event_type: "PostToolUse",
      error: "Exit code 1: boom",
      timestamp: "2026-09-11T11:00:00.000Z",
    },
  ] as never[]);
}

beforeAll(() => {
  HOME = mkdtempSync(join(tmpdir(), "hooks-cli-hosted-home-"));
  DATA_DIR = mkdtempSync(join(tmpdir(), "hooks-cli-hosted-data-"));
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

describe("hooks log reads the hosted route", () => {
  test("log list returns the rows the registry holds", async () => {
    await seed();
    const { stdout, exitCode } = await cli(["log", "list", "--json"]);
    expect(exitCode).toBe(0);
    const rows = JSON.parse(stdout) as Array<{ hook_name: string }>;
    expect(rows.map((row) => row.hook_name).sort()).toEqual(["commandlog", "errornotify"]);
  });

  test("log list --hook filters on the server", async () => {
    await seed();
    const { stdout } = await cli(["log", "list", "--hook", "commandlog", "--json"]);
    const rows = JSON.parse(stdout) as Array<{ hook_name: string }>;
    expect(rows.map((row) => row.hook_name)).toEqual(["commandlog"]);
  });

  test("log search matches tool_input text on the server", async () => {
    await seed();
    const { stdout } = await cli(["log", "search", "force", "--json"]);
    const rows = JSON.parse(stdout) as Array<{ hook_name: string }>;
    expect(rows.map((row) => row.hook_name)).toEqual(["commandlog"]);
  });

  test("log tail returns the newest rows first", async () => {
    await seed();
    const { stdout } = await cli(["log", "tail", "-n", "1", "--json"]);
    const rows = JSON.parse(stdout) as Array<{ hook_name: string }>;
    expect(rows.map((row) => row.hook_name)).toEqual(["errornotify"]);
  });

  test("log errors returns only rows with an error", async () => {
    await seed();
    const { stdout } = await cli(["log", "errors", "--since", "3650d", "--json"]);
    const rows = JSON.parse(stdout) as Array<{ hook_name: string; error: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hook_name).toBe("errornotify");
  });

  test("log clear counts before deleting, then deletes on the server", async () => {
    await seed();
    const dry = await cli(["log", "clear"]);
    expect(dry.stdout).toContain("About to delete 2 event(s)");
    expect(dry.stdout).toContain("/api/v1/events");
    expect(store.events).toHaveLength(2);

    const done = await cli(["log", "clear", "--yes"]);
    expect(done.stdout).toContain("Cleared 2 event(s)");
    expect(store.events).toHaveLength(0);
  });

  test("log clear --hook deletes only that hook's events", async () => {
    await seed();
    const done = await cli(["log", "clear", "--hook", "commandlog", "--yes"]);
    expect(done.stdout).toContain("Cleared 1 event(s)");
    expect(store.events.map((row) => row.hook_name)).toEqual(["errornotify"]);
  });

  test("a hosted read never creates a database under HOME", async () => {
    await seed();
    await cli(["log", "list", "--json"]);
    await cli(["log", "tail", "--json"]);
    expect(existsSync(join(HOME, ".hasna", "hooks", "hooks.db"))).toBe(false);
    expect(existsSync(join(DATA_DIR, "hooks.db"))).toBe(false);
  });

  test("a refused credential fails loudly instead of printing an empty list", async () => {
    const { stdout, stderr, exitCode } = await cli(["log", "list", "--json"], {
      env: hostedEnv({ HASNA_HOOKS_API_KEY: "wrong-key" }),
    });
    expect(exitCode).not.toBe(0);
    expect(`${stdout}${stderr}`).toMatch(/rejected the resolved hooks API key/);
    expect(stdout.trim()).not.toBe("[]");
  });
});

describe("hooks run records its event on the registry", () => {
  test("a run posts a hook_events row to /api/v1/events and none locally", async () => {
    const hookDir = join(DATA_DIR, "hooks", "probehook");
    mkdirSync(hookDir, { recursive: true });
    const script = '#!/bin/bash\necho \'{"continue":true}\'\n';
    writeFileSync(join(hookDir, "script.sh"), script, { mode: 0o755 });
    writeFileSync(
      join(hookDir, "manifest.json"),
      JSON.stringify({ name: "probehook", version: "1.0.0", events: ["PostToolUse"], script: "script.sh" }),
    );
    writeFileSync(
      join(DATA_DIR, "hooks.lock"),
      JSON.stringify({
        hooks: {
          probehook: { version: "1.0.0", sha256: createHash("sha256").update(script).digest("hex"), source: "custom" },
        },
      }),
    );

    const { exitCode } = await cli(["run", "probehook"], {
      stdin: JSON.stringify({ session_id: "sess-run-cli", hook_event_name: "PostToolUse", tool_name: "Bash" }),
    });
    expect(exitCode).toBe(0);

    const rows = await store.listEvents({ hook: "probehook" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ session_id: "sess-run-cli", event_type: "PostToolUse", result: "continue" });
    expect(JSON.parse(rows[0]!.metadata!)).toMatchObject({ exit_code: 0, version: "1.0.0" });

    // The ported half: no hook_events row landed in a local database. (The
    // trust store itself may still open SQLite — that gate is the
    // fail-closed lane's, not this port's.)
    const localDb = join(DATA_DIR, "hooks.db");
    if (existsSync(localDb)) {
      const { Database } = await import("bun:sqlite");
      const db = new Database(localDb, { readonly: true });
      const row = db.query("SELECT COUNT(*) AS n FROM hook_events").get() as { n: number };
      db.close();
      expect(row.n).toBe(0);
    }
  }, 20_000);
});
