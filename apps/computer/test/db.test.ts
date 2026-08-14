import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "crypto";
import {
  getDb,
  createSession,
  updateSession,
  logAction,
  getSession,
  listSessions,
  getActionLogs,
  deleteSession,
  getStats,
  searchSessions,
} from "../src/db/index.js";
import type { Session } from "../src/types/index.js";

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: randomUUID(),
    task: "Test task: open Safari and search for weather",
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

describe("db", () => {
  beforeAll(() => {
    getDb(); // Ensure DB is initialized
  });

  test("createSession + getSession", async () => {
    const session = makeSession();
    await createSession(session);
    const got = getSession(session.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(session.id);
    expect(got!.task).toBe(session.task);
    expect(got!.provider).toBe("anthropic");
    expect(got!.status).toBe("running");
  });

  test("updateSession", async () => {
    const session = makeSession();
    await createSession(session);

    session.status = "completed";
    session.steps = 5;
    session.total_tokens_in = 1000;
    session.total_tokens_out = 500;
    session.total_duration_ms = 3000;
    session.completed_at = new Date().toISOString();
    await updateSession(session);

    const got = getSession(session.id);
    expect(got!.status).toBe("completed");
    expect(got!.steps).toBe(5);
    expect(got!.total_tokens_in).toBe(1000);
  });

  test("logAction + getActionLogs", async () => {
    const session = makeSession();
    await createSession(session);

    await logAction({
      session_id: session.id,
      step: 0,
      action: { type: "click", point: { x: 100, y: 200 } },
      reasoning: "Clicking on the search button",
      success: true,
      duration_ms: 150,
      tokens_in: 500,
      tokens_out: 100,
    });

    await logAction({
      session_id: session.id,
      step: 1,
      action: { type: "type", text: "weather" },
      reasoning: "Typing search query",
      success: true,
      duration_ms: 50,
    });

    const logs = getActionLogs(session.id);
    expect(logs.length).toBe(2);
    expect(logs[0].step).toBe(0);
    expect(logs[0].action.type).toBe("click");
    expect(logs[1].step).toBe(1);
    expect(logs[1].action.type).toBe("type");
  });

  test("listSessions returns sessions ordered by created_at desc", async () => {
    const s1 = makeSession({ created_at: "2026-01-01T00:00:00Z" });
    const s2 = makeSession({ created_at: "2026-01-02T00:00:00Z" });
    await createSession(s1);
    await createSession(s2);

    const sessions = listSessions({ limit: 100 });
    const ids = sessions.map((s) => s.id);
    const i1 = ids.indexOf(s1.id);
    const i2 = ids.indexOf(s2.id);
    expect(i2).toBeLessThan(i1); // s2 (newer) should come first
  });

  test("listSessions filters by status", async () => {
    const s1 = makeSession({ status: "completed" });
    const s2 = makeSession({ status: "failed" });
    await createSession(s1);
    await createSession(s2);

    const completed = listSessions({ status: "completed", limit: 100 });
    expect(completed.every((s) => s.status === "completed")).toBe(true);
  });

  test("deleteSession removes session and logs", async () => {
    const session = makeSession();
    await createSession(session);
    await logAction({
      session_id: session.id,
      step: 0,
      action: { type: "screenshot" },
      reasoning: "test",
      success: true,
      duration_ms: 0,
    });

    const deleted = deleteSession(session.id);
    expect(deleted).toBe(true);
    expect(getSession(session.id)).toBeNull();
    expect(getActionLogs(session.id).length).toBe(0);
  });

  test("deleteSession returns false for non-existent session", () => {
    const deleted = deleteSession("non-existent-id");
    expect(deleted).toBe(false);
  });

  test("getStats returns correct counts", async () => {
    const before = getStats();
    const s1 = makeSession({ status: "completed", steps: 3, total_tokens_in: 100, total_tokens_out: 50 });
    await createSession(s1);

    const after = getStats();
    expect(after.total_sessions).toBe(before.total_sessions + 1);
    expect(after.completed).toBe(before.completed + 1);
  });

  test("searchSessions finds by task text", async () => {
    const uniqueWord = `unicorn_${Date.now()}`;
    const session = makeSession({ task: `Find the ${uniqueWord} in the garden` });
    await createSession(session);

    const results = searchSessions(uniqueWord);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((s) => s.id === session.id)).toBe(true);
  });

  test("getSession returns null for non-existent id", () => {
    expect(getSession("does-not-exist")).toBeNull();
  });
});
