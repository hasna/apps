/**
 * The hosted hook-event routes on `hooks-serve`.
 *
 * These drive the REAL `handleServeRequest` against a store that really
 * persists, so every assertion is "the route wrote a row and read that row
 * back", never "the route answered something shaped right". The PostgreSQL
 * implementation of the same contract is exercised by the live gate in
 * `event-store.pg.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { handleServeRequest } from "../serve.js";
import { closeDb } from "../db/index.js";
import { MemoryHookEventStore } from "./memory-event-store.js";
import {
  hookEventStoreDsn,
  HOOK_EVENT_STORE_DSN_ENV,
  normalizeSubmittedEvent,
  PostgresHookEventStore,
  resolveHookEventStore,
  __resetHookEventStore,
} from "./event-store.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-event-routes-"));
const TEST_HOME = mkdtempSync(join(tmpdir(), "hooks-event-routes-home-"));
const API_KEY = "fixture-serve-key";
const savedHome = process.env.HOME;
const savedStation = process.env.HASNA_STATION;

beforeAll(() => {
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DIR;
  process.env.HASNA_HOOKS_DB_PATH = ":memory:";
  // Nothing in these routes should reach the real home; pin it anyway so a
  // future route that resolves a credential cannot read the station's.
  process.env.HOME = TEST_HOME;
  process.env.HASNA_STATION = "no-such-station";
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedStation === undefined) delete process.env.HASNA_STATION;
  else process.env.HASNA_STATION = savedStation;
  rmSync(TEST_HOME, { recursive: true, force: true });
  closeDb();
  __resetHookEventStore();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:39428${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function authed(method: string, path: string, body?: unknown): Request {
  return req(method, path, body, { "x-api-key": API_KEY });
}

function sampleEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: "sess-abcdef123456",
    hook_name: "commandlog",
    event_type: "PostToolUse",
    tool_name: "Bash",
    tool_input: "git status",
    result: "continue",
    duration_ms: 12,
    project_dir: "/work/repo",
    ...overrides,
  };
}

describe("POST /api/v1/events", () => {
  test("persists a submitted event and reads it back through GET", async () => {
    const store = new MemoryHookEventStore();
    const post = await handleServeRequest(authed("POST", "/api/v1/events", sampleEvent()), API_KEY, {
      eventStore: store,
    });
    expect(post.status).toBe(201);
    const created = (await post.json()) as { events: Array<{ id: string; timestamp: string }>; count: number };
    expect(created.count).toBe(1);
    expect(created.events[0]!.id).toBeTruthy();

    const get = await handleServeRequest(authed("GET", "/api/v1/events"), API_KEY, { eventStore: store });
    expect(get.status).toBe(200);
    const read = (await get.json()) as { events: Array<Record<string, unknown>>; count: number };
    expect(read.count).toBe(1);
    expect(read.events[0]).toMatchObject({
      id: created.events[0]!.id,
      hook_name: "commandlog",
      tool_name: "Bash",
      tool_input: "git status",
      session_id: "sess-abcdef123456",
      duration_ms: 12,
    });
  });

  test("accepts a batch under the {events:[...]} envelope", async () => {
    const store = new MemoryHookEventStore();
    const res = await handleServeRequest(
      authed("POST", "/api/v1/events", {
        events: [sampleEvent({ hook_name: "sessionlog" }), sampleEvent({ hook_name: "costwatch", event_type: "Stop" })],
      }),
      API_KEY,
      { eventStore: store },
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as { count: number }).count).toBe(2);
    expect((await store.listEvents({})).map((row) => row.hook_name).sort()).toEqual(["costwatch", "sessionlog"]);
  });

  test("rejects an unknown event_type with 400 rather than storing it", async () => {
    const store = new MemoryHookEventStore();
    const res = await handleServeRequest(
      authed("POST", "/api/v1/events", sampleEvent({ event_type: "NotAnEvent" })),
      API_KEY,
      { eventStore: store },
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: expect.stringContaining("event_type") });
    expect(store.events).toHaveLength(0);
  });

  test("rejects a missing session_id with 400", async () => {
    const store = new MemoryHookEventStore();
    const body = sampleEvent();
    delete body.session_id;
    const res = await handleServeRequest(authed("POST", "/api/v1/events", body), API_KEY, { eventStore: store });
    expect(res.status).toBe(400);
    expect(store.events).toHaveLength(0);
  });
});

describe("GET /api/v1/events filters", () => {
  const store = new MemoryHookEventStore();

  beforeAll(async () => {
    await store.insertEvents([
      sampleEvent({ hook_name: "commandlog", tool_input: "git push --force", timestamp: "2026-09-10T10:00:00.000Z" }) as never,
      sampleEvent({
        hook_name: "errornotify",
        error: "Exit code 1: boom",
        timestamp: "2026-09-11T10:00:00.000Z",
      }) as never,
      sampleEvent({ hook_name: "sessionlog", session_id: "other-session", timestamp: "2026-09-11T11:00:00.000Z" }) as never,
    ]);
  });

  test("filters by hook name", async () => {
    const res = await handleServeRequest(authed("GET", "/api/v1/events?hook=errornotify"), API_KEY, {
      eventStore: store,
    });
    const body = (await res.json()) as { events: Array<{ hook_name: string }> };
    expect(body.events.map((row) => row.hook_name)).toEqual(["errornotify"]);
  });

  test("filters by session prefix", async () => {
    const res = await handleServeRequest(authed("GET", "/api/v1/events?session=other"), API_KEY, {
      eventStore: store,
    });
    const body = (await res.json()) as { events: Array<{ hook_name: string }> };
    expect(body.events.map((row) => row.hook_name)).toEqual(["sessionlog"]);
  });

  test("errors_only returns only rows carrying an error", async () => {
    const res = await handleServeRequest(authed("GET", "/api/v1/events?errors_only=true"), API_KEY, {
      eventStore: store,
    });
    const body = (await res.json()) as { events: Array<{ hook_name: string; error: string }> };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]!.error).toContain("boom");
  });

  test("q searches tool_input and error text", async () => {
    const res = await handleServeRequest(authed("GET", "/api/v1/events?q=force"), API_KEY, { eventStore: store });
    const body = (await res.json()) as { events: Array<{ hook_name: string }> };
    expect(body.events.map((row) => row.hook_name)).toEqual(["commandlog"]);
  });

  test("since accepts an ISO timestamp and a duration string", async () => {
    const iso = await handleServeRequest(authed("GET", "/api/v1/events?since=2026-09-11T00:00:00.000Z"), API_KEY, {
      eventStore: store,
    });
    expect(((await iso.json()) as { count: number }).count).toBe(2);

    // A duration is resolved relative to now, so the 2026-09-10 row is out.
    const duration = await handleServeRequest(authed("GET", "/api/v1/events?since=99999d"), API_KEY, {
      eventStore: store,
    });
    expect(((await duration.json()) as { count: number }).count).toBe(3);
  });

  test("rows come back newest first and honour limit", async () => {
    const res = await handleServeRequest(authed("GET", "/api/v1/events?limit=2"), API_KEY, { eventStore: store });
    const body = (await res.json()) as { events: Array<{ timestamp: string }> };
    expect(body.events).toHaveLength(2);
    expect(body.events[0]!.timestamp > body.events[1]!.timestamp).toBe(true);
  });
});

describe("GET /api/v1/events/summary", () => {
  test("counts events and errors per hook", async () => {
    const store = new MemoryHookEventStore();
    await store.insertEvents([
      sampleEvent({ hook_name: "commandlog" }) as never,
      sampleEvent({ hook_name: "commandlog" }) as never,
      sampleEvent({ hook_name: "errornotify", error: "boom" }) as never,
    ]);
    const res = await handleServeRequest(authed("GET", "/api/v1/events/summary"), API_KEY, { eventStore: store });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hooks: Array<{ hook_name: string; total: number; errors: number; error_rate: string }>;
      totals: { events: number; errors: number; hooks_active: number };
    };
    expect(body.totals).toEqual({ events: 3, errors: 1, hooks_active: 2 });
    expect(body.hooks[0]).toMatchObject({ hook_name: "commandlog", total: 2, errors: 0, error_rate: "0.0%" });
    expect(body.hooks.find((row) => row.hook_name === "errornotify")).toMatchObject({ error_rate: "100.0%" });
  });
});

describe("DELETE /api/v1/events", () => {
  test("deletes every event, or only one hook's", async () => {
    const store = new MemoryHookEventStore();
    await store.insertEvents([
      sampleEvent({ hook_name: "commandlog" }) as never,
      sampleEvent({ hook_name: "sessionlog" }) as never,
    ]);

    const one = await handleServeRequest(authed("DELETE", "/api/v1/events?hook=commandlog"), API_KEY, {
      eventStore: store,
    });
    expect(((await one.json()) as { deleted: number }).deleted).toBe(1);
    expect((await store.listEvents({})).map((row) => row.hook_name)).toEqual(["sessionlog"]);

    const all = await handleServeRequest(authed("DELETE", "/api/v1/events"), API_KEY, { eventStore: store });
    expect(((await all.json()) as { deleted: number }).deleted).toBe(1);
    expect(await store.listEvents({})).toHaveLength(0);
  });
});

describe("POST /api/v1/feedback", () => {
  test("stores feedback and returns its id", async () => {
    const store = new MemoryHookEventStore();
    const res = await handleServeRequest(
      authed("POST", "/api/v1/feedback", { message: "the log tail is great", category: "general", version: "0.8.0" }),
      API_KEY,
      { eventStore: store },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(store.feedback).toEqual([
      { id: body.id, message: "the log tail is great", email: null, category: "general", version: "0.8.0" },
    ]);
  });

  test("an empty message is 400", async () => {
    const store = new MemoryHookEventStore();
    const res = await handleServeRequest(authed("POST", "/api/v1/feedback", { message: "  " }), API_KEY, {
      eventStore: store,
    });
    expect(res.status).toBe(400);
    expect(store.feedback).toHaveLength(0);
  });
});

describe("event routes are closed by default", () => {
  test.each([
    ["POST", "/api/v1/events"],
    ["GET", "/api/v1/events"],
    ["DELETE", "/api/v1/events"],
    ["GET", "/api/v1/events/summary"],
    ["POST", "/api/v1/feedback"],
  ])("%s %s without the API key is 401", async (method, path) => {
    const store = new MemoryHookEventStore();
    const res = await handleServeRequest(req(method, path, method === "POST" ? sampleEvent() : undefined), API_KEY, {
      eventStore: store,
    });
    expect(res.status).toBe(401);
    expect(store.events).toHaveLength(0);
  });

  test("an unconfigured server answers 503 — never an empty list", async () => {
    const res = await handleServeRequest(authed("GET", "/api/v1/events"), API_KEY, { eventStore: null });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("HASNA_HOOKS_DATABASE_URL");
    expect(JSON.stringify(body)).not.toContain('"events"');
  });
});

describe("store resolution", () => {
  test("no DSN means no store, so the routes cannot answer from thin air", () => {
    __resetHookEventStore();
    expect(hookEventStoreDsn({})).toBeUndefined();
    expect(resolveHookEventStore({})).toBeNull();
  });

  test("a DSN resolves the PostgreSQL store and the same DSN reuses the pool", () => {
    __resetHookEventStore();
    const env = { [HOOK_EVENT_STORE_DSN_ENV[0]]: "postgres://user@127.0.0.1:5432/hooks_test" };
    const first = resolveHookEventStore(env);
    expect(first).toBeInstanceOf(PostgresHookEventStore);
    expect(resolveHookEventStore(env)).toBe(first);
    __resetHookEventStore();
  });

  test("the legacy HOOKS_DATABASE_URL spelling is honoured", () => {
    expect(hookEventStoreDsn({ [HOOK_EVENT_STORE_DSN_ENV[1]]: "postgres://x/y" })).toBe("postgres://x/y");
  });
});

describe("submitted-event normalization", () => {
  test("assigns an id and a timestamp when the writer omits them", () => {
    const record = normalizeSubmittedEvent(sampleEvent());
    expect(record.id).toMatch(/^[0-9a-f]{21}$/);
    expect(Number.isNaN(Date.parse(record.timestamp))).toBe(false);
  });

  test("keeps a caller-supplied timestamp, normalized to ISO", () => {
    const record = normalizeSubmittedEvent(sampleEvent({ timestamp: "2026-09-11T10:00:00Z" }));
    expect(record.timestamp).toBe("2026-09-11T10:00:00.000Z");
  });

  test("refuses a non-object payload", () => {
    expect(() => normalizeSubmittedEvent("nope")).toThrow(/must be an object/);
  });
});
