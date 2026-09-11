/**
 * The hosted hook-event client, driven against the REAL `/api/v1/events`
 * handler on a loopback Bun.serve.
 *
 * What each test is actually proving:
 *   - the sink reaches the hosted route (method, path, body) and the row it
 *     posted is readable back through the same route;
 *   - a hosted credential never opens SQLite: after every exercise, the
 *     temporary HOME holds no `*.db*` file;
 *   - writes never throw (a hook must keep running when the registry is
 *     unreachable) while reads fail LOUD (an empty `hooks log` must never be
 *     the way a refused credential looks);
 *   - the local SQLite arm is reachable ONLY through the deliberate opt-in.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { handleServeRequest } from "../serve.js";
import { MemoryHookEventStore } from "../server/memory-event-store.js";
import {
  deleteHookEvents,
  eventsUrl,
  hookEventSummary,
  listHookEvents,
  postFeedback,
  postHookEvents,
  projectEventForTransport,
  recordHookRunRouted,
  usesLocalHookStore,
  writeHookEventRouted,
} from "./event-sink.js";

const API_KEY = "fixture-sink-key";

let store = new MemoryHookEventStore();
let server: ReturnType<typeof Bun.serve>;
let origin = "";
const homes: string[] = [];

/** A hermetic env: a temp HOME (disk tier misses) and no ambient Keychain. */
function hostedEnv(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const home = mkdtempSync(join(tmpdir(), "hooks-sink-home-"));
  homes.push(home);
  return {
    HOME: home,
    HASNA_HOOKS_API_URL: origin,
    HASNA_HOOKS_API_KEY: API_KEY,
    ...extra,
  };
}

/** Every *.db / *.sqlite file under a root — the fail-closed evidence. */
function sqliteFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sqliteFilesUnder(full));
    else if (/\.(?:db|sqlite3?)/.test(entry.name)) out.push(full);
  }
  return out;
}

beforeAll(() => {
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
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

describe("the sink posts to the hosted route", () => {
  test("writeHookEventRouted writes a row the route reads back", async () => {
    const env = hostedEnv();
    await writeHookEventRouted(
      {
        session_id: "sess-hosted-1",
        hook_name: "commandlog",
        event_type: "PostToolUse",
        tool_name: "Bash",
        tool_input: "git status",
        project_dir: "/work",
      },
      { env },
    );

    const rows = await listHookEvents({ hook: "commandlog" }, { env });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ hook_name: "commandlog", tool_name: "Bash", tool_input: "git status" });
    expect(sqliteFilesUnder(env.HOME!)).toEqual([]);
  });

  test("recordHookRunRouted carries version/sha256/exit_code in metadata", async () => {
    const env = hostedEnv();
    await recordHookRunRouted(
      {
        hookName: "gitguard",
        eventType: "PreToolUse",
        version: "1.2.3",
        sha256: "a".repeat(64),
        sessionId: "sess-run",
        toolName: "Bash",
        toolInput: { command: "rm -rf /" },
        result: "block",
        exitCode: 2,
        durationMs: 41,
        projectDir: "/work",
      },
      { env },
    );

    const rows = await listHookEvents({ hook: "gitguard" }, { env });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_type: "PreToolUse", result: "block", duration_ms: 41 });
    expect(JSON.parse(rows[0]!.metadata!)).toMatchObject({ version: "1.2.3", exit_code: 2 });
    expect(sqliteFilesUnder(env.HOME!)).toEqual([]);
  });

  test("an unsupported event type is reported, not posted", async () => {
    const env = hostedEnv();
    const notices: string[] = [];
    await recordHookRunRouted(
      { hookName: "x", eventType: "NotAnEvent", exitCode: 0, durationMs: 1 },
      { env, notice: (line) => notices.push(line) },
    );
    expect(notices.join("\n")).toContain("unsupported event type");
    expect(store.events).toHaveLength(0);
  });

  test("postHookEvents batches and reports the stored ids", async () => {
    const env = hostedEnv();
    const result = await postHookEvents(
      [
        { session_id: "s", hook_name: "sessionlog", event_type: "PostToolUse" },
        { session_id: "s", hook_name: "costwatch", event_type: "Stop" },
      ],
      { env },
    );
    expect(result.count).toBe(2);
    expect(result.events.every((row) => typeof row.id === "string" && row.id.length > 0)).toBe(true);
  });

  test("the request carries the resolved key as x-api-key and never in the URL", async () => {
    const env = hostedEnv();
    const seen: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      seen.push({
        method: init?.method ?? "GET",
        url,
        headers: init?.headers as Record<string, string>,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      return new Response(JSON.stringify({ events: [], count: 0 }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    };

    await postHookEvents([{ session_id: "s", hook_name: "h", event_type: "Stop" }], { env, fetchImpl });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("POST");
    expect(new URL(seen[0]!.url).pathname).toBe("/api/v1/events");
    expect(seen[0]!.url).not.toContain(API_KEY);
    expect(seen[0]!.headers["x-api-key"]).toBe(API_KEY);
    expect(seen[0]!.body).toMatchObject({ events: [{ hook_name: "h", event_type: "Stop" }] });
  });
});

describe("reads and deletes go through the route", () => {
  test("listHookEvents forwards every filter as a query parameter", async () => {
    const env = hostedEnv();
    let requested = "";
    const fetchImpl: typeof fetch = async (input) => {
      requested = typeof input === "string" ? input : (input as Request).url;
      return new Response(JSON.stringify({ events: [], count: 0 }), {
        headers: { "content-type": "application/json" },
      });
    };
    await listHookEvents(
      { hook: "commandlog", session: "sess", since: "2026-09-11T00:00:00.000Z", search: "git", errorsOnly: true, limit: 7 },
      { env, fetchImpl },
    );
    const url = new URL(requested);
    expect(url.pathname).toBe("/api/v1/events");
    expect(url.searchParams.get("hook")).toBe("commandlog");
    expect(url.searchParams.get("session")).toBe("sess");
    expect(url.searchParams.get("since")).toBe("2026-09-11T00:00:00.000Z");
    expect(url.searchParams.get("q")).toBe("git");
    expect(url.searchParams.get("errors_only")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("7");
  });

  test("deleteHookEvents removes rows on the server and reports the count", async () => {
    const env = hostedEnv();
    await postHookEvents(
      [
        { session_id: "s", hook_name: "commandlog", event_type: "Stop" },
        { session_id: "s", hook_name: "sessionlog", event_type: "Stop" },
      ],
      { env },
    );
    expect(await deleteHookEvents({ hook: "commandlog" }, { env })).toBe(1);
    expect((await listHookEvents({}, { env })).map((row) => row.hook_name)).toEqual(["sessionlog"]);
  });

  test("hookEventSummary reads the hosted aggregate", async () => {
    const env = hostedEnv();
    await postHookEvents(
      [
        { session_id: "s", hook_name: "commandlog", event_type: "Stop" },
        { session_id: "s", hook_name: "commandlog", event_type: "Stop", error: "boom" },
      ],
      { env },
    );
    const summary = await hookEventSummary("7d", { env });
    expect(summary.totals).toMatchObject({ events: 2, errors: 1, hooks_active: 1 });
    expect(summary.hooks[0]).toMatchObject({ hook_name: "commandlog", error_rate: "50.0%" });
  });

  test("postFeedback reaches /api/v1/feedback", async () => {
    const env = hostedEnv();
    const saved = await postFeedback({ message: "hosted feedback works" }, { env });
    expect(saved.ok).toBe(true);
    expect(store.feedback).toHaveLength(1);
    expect(store.feedback[0]!.message).toBe("hosted feedback works");
  });
});

describe("fail-closed behaviour", () => {
  test("a write with no resolvable credential reports and drops the event — it never opens SQLite", async () => {
    const home = mkdtempSync(join(tmpdir(), "hooks-sink-nocred-"));
    homes.push(home);
    const notices: string[] = [];
    await writeHookEventRouted(
      { session_id: "s", hook_name: "commandlog", event_type: "Stop" },
      { env: { HOME: home }, notice: (line) => notices.push(line) },
    );
    expect(notices.join("\n")).toMatch(/event not recorded/);
    expect(sqliteFilesUnder(home)).toEqual([]);
  });

  test("a read with no resolvable credential THROWS rather than returning an empty list", async () => {
    const home = mkdtempSync(join(tmpdir(), "hooks-sink-noread-"));
    homes.push(home);
    await expect(listHookEvents({}, { env: { HOME: home } })).rejects.toThrow(
      /no registry authority resolved|REMOTE_API_CONFIG_MISSING/,
    );
  });

  test("a 401 from the registry is surfaced, not swallowed into an empty result", async () => {
    const env = hostedEnv({ HASNA_HOOKS_API_KEY: "wrong-key" });
    await expect(listHookEvents({}, { env })).rejects.toThrow(/rejected the resolved hooks API key/);
  });

  test("a registry without an event store surfaces the 503, never an empty list", async () => {
    const env = hostedEnv();
    const unconfigured = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => handleServeRequest(req, API_KEY, { eventStore: null }),
    });
    try {
      await expect(
        listHookEvents({}, { env: { ...env, HASNA_HOOKS_API_URL: `http://127.0.0.1:${unconfigured.port}` } }),
      ).rejects.toThrow(/unavailable/);
    } finally {
      unconfigured.stop(true);
    }
  });
});

describe("the local arm needs the deliberate opt-in", () => {
  test("a hosted env does not select the local store", async () => {
    expect(await usesLocalHookStore(hostedEnv())).toBe(false);
  });

  test("HASNA_HOOKS_LOCAL alone selects it", async () => {
    const home = mkdtempSync(join(tmpdir(), "hooks-sink-local-"));
    homes.push(home);
    expect(await usesLocalHookStore({ HOME: home, HASNA_HOOKS_LOCAL: "1" })).toBe(true);
  });

  test("HASNA_HOOKS_LOCAL beside a configured authority does NOT silently go local", async () => {
    expect(await usesLocalHookStore(hostedEnv({ HASNA_HOOKS_LOCAL: "1" }))).toBe(false);
  });
});

describe("payload handling", () => {
  test("secrets are redacted and tool_input truncated before the event leaves the machine", () => {
    const projected = projectEventForTransport({
      session_id: "s",
      hook_name: "commandlog",
      event_type: "PostToolUse",
      tool_input: JSON.stringify({ api_key: "super-secret-value", command: "x".repeat(900) }),
      error: null,
      metadata: null,
    });
    expect(projected.tool_input!.length).toBeLessThanOrEqual(500);
    expect(projected.tool_input).not.toContain("super-secret-value");
  });

  test("eventsUrl composes /api/v1/events on the registry origin", () => {
    expect(eventsUrl("https://api.hasna.com/hooks")).toBe("https://api.hasna.com/hooks/api/v1/events");
    expect(eventsUrl("https://api.hasna.com/hooks/", "/summary")).toBe(
      "https://api.hasna.com/hooks/api/v1/events/summary",
    );
    expect(eventsUrl("https://api.hasna.com/hooks", "", { hook: "commandlog" })).toContain("?hook=commandlog");
  });
});
