// Test-gap lane: agent-authored analysis (SOL consult refused — gpt-5.6-sol consult timed out twice within the 2x600s protocol bound; no answer delivered). Authored by Paulinus.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession,
  deleteSession,
  getActionLogs,
  getDb,
  getSession,
  getStats,
  listSessions,
  logAction,
  searchActionLogs,
  updateSession,
} from "../src/db/index.js";
import { getStorageStatus } from "../src/db/storage-sync.js";
import type { Session } from "../src/types/index.js";

const TEST_DB_ROOT = mkdtempSync(join(tmpdir(), "computer-db-extras-"));

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: randomUUID(),
    task: "Extras test task",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    status: "running",
    steps: 0,
    total_tokens_in: 0,
    total_tokens_out: 0,
    total_duration_ms: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeAll(() => {
  process.env["COMPUTER_DB_PATH"] = join(TEST_DB_ROOT, "test.db");
  getDb();
});

afterAll(() => {
  delete process.env["COMPUTER_DB_PATH"];
  rmSync(TEST_DB_ROOT, { recursive: true, force: true });
});

describe("db — tags", () => {
  test("tags round-trip through createSession/getSession", async () => {
    const session = makeSession({ tags: ["dev", "computer-use"] });
    await createSession(session);
    const got = getSession(session.id)!;
    expect(got.tags).toEqual(["dev", "computer-use"]);
  });

  test("listSessions filters by exact tag", async () => {
    const tagged = makeSession({ tags: ["unique-tag-xyz"] });
    const plain = makeSession();
    await createSession(tagged);
    await createSession(plain);

    const results = listSessions({ tag: "unique-tag-xyz", limit: 100 });
    expect(results.some((s) => s.id === tagged.id)).toBe(true);
    expect(results.some((s) => s.id === plain.id)).toBe(false);
  });

  test("listSessions tag filter does not match partial tag substrings across entries", async () => {
    const a = makeSession({ tags: ["alpha"] });
    const b = makeSession({ tags: ["alphabet"] });
    await createSession(a);
    await createSession(b);
    const results = listSessions({ tag: "alpha", limit: 100 });
    expect(results.some((s) => s.id === a.id)).toBe(true);
    expect(results.some((s) => s.id === b.id)).toBe(false);
  });
});

describe("db — action log round-trips", () => {
  test("every DriverAction variant survives logAction → getActionLogs JSON round-trip", async () => {
    const session = makeSession();
    await createSession(session);

    const actions = [
      { type: "click", point: { x: 1, y: 2 }, button: "right", count: 2 },
      { type: "type", text: "hello: world" },
      { type: "key", keys: "cmd+shift+delete" },
      { type: "scroll", point: { x: 3, y: 4 }, deltaX: 5, deltaY: -6 },
      { type: "mouse_move", point: { x: 7, y: 8 } },
      { type: "drag", from: { x: 1, y: 1 }, to: { x: 9, y: 9 } },
      { type: "wait", ms: 250 },
      { type: "open_url", url: "https://example.com/a?b=c" },
      { type: "open_app", name: "Safari" },
      { type: "screenshot" },
    ];

    for (let i = 0; i < actions.length; i++) {
      await logAction({
        session_id: session.id,
        step: i,
        action: actions[i] as any,
        reasoning: `reasoning ${i}`,
        success: i % 2 === 0,
        error: i % 2 === 0 ? undefined : "boom",
        duration_ms: i,
      });
    }

    const logs = getActionLogs(session.id);
    expect(logs.length).toBe(actions.length);
    for (let i = 0; i < actions.length; i++) {
      expect(logs[i].action).toEqual(actions[i]);
      expect(logs[i].success).toBe(i % 2 === 0);
      // Storage boundary: SQLite returns NULL for an unset error, so
      // undefined in → null out (the ActionLog.error?: string type says
      // undefined; the store returns null — asserted as the real contract).
      expect(logs[i].error).toBe(i % 2 === 0 ? null : "boom");
    }
  });

  test("searchActionLogs finds reasoning text via FTS", async () => {
    const session = makeSession();
    await createSession(session);
    const unique = `quasar_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await logAction({
      session_id: session.id,
      step: 0,
      action: { type: "screenshot" },
      reasoning: `the ${unique} is visible in the corner`,
      success: true,
      duration_ms: 0,
    });
    const hits = searchActionLogs(unique);
    expect(hits.some((l) => l.session_id === session.id)).toBe(true);
  });
});

describe("db — list/pagination and update semantics", () => {
  test("updateSession on a missing id does not throw and changes nothing", async () => {
    const ghost = makeSession({ id: "no-such-session" });
    await expect(updateSession(ghost)).resolves.toBeUndefined();
    expect(getSession("no-such-session")).toBeNull();
  });

  test("listSessions honors limit and offset with created_at desc ordering", async () => {
    // Timestamps must be clearly newer than rows created by earlier tests in
    // this file, so anchor them far in the future with 1s separations.
    const base = Date.now() + 60_000;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = makeSession({ created_at: new Date(base + i * 1000).toISOString() });
      ids.push(s.id);
      await createSession(s);
    }
    // newest first: ids[2], ids[1], ids[0]
    const first = listSessions({ limit: 2, offset: 0 });
    expect(first.map((s) => s.id)).toEqual([ids[2], ids[1]]);
    const second = listSessions({ limit: 1, offset: 2 });
    expect(second.map((s) => s.id)).toEqual([ids[0]]);
  });

  test("deleteSession cascades action logs (FK enforced)", async () => {
    const session = makeSession();
    await createSession(session);
    await logAction({
      session_id: session.id,
      step: 0,
      action: { type: "key", keys: "cmd+c" },
      reasoning: "x",
      success: true,
      duration_ms: 0,
    });
    deleteSession(session.id);
    expect(getActionLogs(session.id)).toEqual([]);
  });

  test("getStats counts failed sessions separately", async () => {
    const before = getStats();
    await createSession(makeSession({ status: "failed", steps: 2, total_tokens_in: 10, total_tokens_out: 20 }));
    const after = getStats();
    expect(after.total_sessions).toBe(before.total_sessions + 1);
    expect(after.failed).toBe(before.failed + 1);
    expect(after.total_steps).toBe(before.total_steps + 2);
    expect(after.total_tokens).toBe(before.total_tokens + 30);
  });
});

describe("storage — getStorageStatus local shape", () => {
  const STORAGE_ENV = [
    "HASNA_COMPUTER_DATABASE_URL",
    "COMPUTER_DATABASE_URL",
    "HASNA_COMPUTER_STORAGE_MODE",
    "COMPUTER_STORAGE_MODE",
  ] as const;
  let savedStorage: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of STORAGE_ENV) {
      savedStorage[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterAll(() => {
    for (const key of STORAGE_ENV) {
      if (savedStorage[key] === undefined) delete process.env[key];
      else process.env[key] = savedStorage[key];
    }
  });

  test("unconfigured local status reports mode local, empty sync, env list", () => {
    const status = getStorageStatus();
    expect(status.configured).toBe(false);
    expect(status.mode).toBe("local");
    expect(status.activeEnv).toBeNull();
    expect(status.service).toBe("computer");
    expect(status.tables).toEqual(["sessions", "action_logs", "feedback"]);
    expect(status.env).toEqual(["HASNA_COMPUTER_DATABASE_URL", "COMPUTER_DATABASE_URL"]);
    expect(Array.isArray(status.sync)).toBe(true);
  });
});
