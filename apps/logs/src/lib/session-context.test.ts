/**
 * Test gap coverage for src/lib/session-context.ts.
 *
 * agent-authored: the SOL consult for this repo did not deliver a spec (two
 * distinct Codewith accounts: one capacity-refused before answering, one
 * admitted but timed out at 600s on both the initial call and its resume).
 * This analysis and these tests were produced by the sweep agent.
 *
 * The session-context fetch module had no sibling test. These tests pin the
 * fail-open contract: logs always come from the local catalog, the optional
 * SESSIONS_URL enrichment joins without a double slash, non-OK responses and
 * fetch failures degrade to logs-only (with an error field on failure), and
 * rows are returned timestamp-ascending.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { createTestDb } from "../db/index.ts";
import { getSessionContext } from "./session-context.ts";

const SESSIONS_URL = "SESSIONS_URL";
const ORIGINAL = process.env[SESSIONS_URL];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[SESSIONS_URL];
  else process.env[SESSIONS_URL] = ORIGINAL;
});

function dbWithLogs(): ReturnType<typeof createTestDb> {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO logs (id, timestamp, project_id, page_id, level, source, service, message, trace_id, session_id, agent, url, stack_trace, metadata)
     VALUES (?, ?, NULL, NULL, 'info', 'test', NULL, ?, NULL, 'sess-1', NULL, NULL, NULL, NULL)`,
  ).run("log-1", "2026-08-01T09:00:00.000Z", "first");
  db.prepare(
    `INSERT INTO logs (id, timestamp, project_id, page_id, level, source, service, message, trace_id, session_id, agent, url, stack_trace, metadata)
     VALUES (?, ?, NULL, NULL, 'error', 'test', NULL, ?, NULL, 'sess-1', NULL, NULL, NULL, NULL)`,
  ).run("log-2", "2026-08-01T08:00:00.000Z", "earlier");
  return db;
}

describe("getSessionContext", () => {
  it("returns local logs without a session object when SESSIONS_URL is unset", async () => {
    delete process.env[SESSIONS_URL];
    const db = dbWithLogs();
    const result = await getSessionContext(db, "sess-1");
    expect(result.session_id).toBe("sess-1");
    expect(result.logs.map((l) => l.id)).toEqual(["log-2", "log-1"]); // timestamp ASC
    expect("session" in result).toBe(false);
    expect("error" in result).toBe(false);
  });

  it("joins the session URL without a double slash and returns the session object", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push(String(input));
      return new Response(JSON.stringify({ id: "sess-1", status: "active" }), {
        status: 200,
      });
    }) as typeof fetch;
    try {
      process.env[SESSIONS_URL] = "https://sessions.example.com/";
      const db = dbWithLogs();
      const result = await getSessionContext(db, "sess-1");
      expect(calls).toEqual(["https://sessions.example.com/api/sessions/sess-1"]);
      expect(result.session).toEqual({ id: "sess-1", status: "active" });
      expect(result.error).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("degrades to logs-only on a non-OK session response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      new Response("nope", { status: 404 })) as typeof fetch;
    try {
      process.env[SESSIONS_URL] = "https://sessions.example.com";
      const db = dbWithLogs();
      const result = await getSessionContext(db, "sess-1");
      expect(result.logs).toHaveLength(2);
      expect("session" in result).toBe(false);
      expect("error" in result).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("records a fetch failure in error and keeps local logs", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      throw new Error("network down");
    }) as typeof fetch;
    try {
      process.env[SESSIONS_URL] = "https://sessions.example.com";
      const db = dbWithLogs();
      const result = await getSessionContext(db, "sess-1");
      expect(result.logs).toHaveLength(2);
      expect("session" in result).toBe(false);
      expect(result.error).toBe("Error: network down");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
