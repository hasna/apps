import { afterEach, describe, expect, test } from "bun:test";
import {
  ApiError,
  clearStoredApiKey,
  fetchSession,
  fetchSessions,
  fetchStats,
  setStoredApiKey,
} from "../dashboard/src/api.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearStoredApiKey();
});

describe("dashboard API client", () => {
  test("attaches stored API key as bearer auth", async () => {
    setStoredApiKey("secret");
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer secret");
      expect(headers.get("accept")).toBe("application/json");
      return Response.json([]);
    }) as typeof fetch;

    expect(await fetchSessions()).toEqual([]);
  });

  test("throws ApiError for protected endpoint failures", async () => {
    globalThis.fetch = (async () => Response.json(
      { error: "Invalid or missing computer API key" },
      { status: 401 },
    )) as typeof fetch;

    try {
      await fetchStats();
      throw new Error("expected fetchStats to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(401);
      expect((error as ApiError).message).toContain("Invalid or missing");
    }
  });

  test("reads timeline payloads from session detail responses", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/sessions/session-1");
      return Response.json({
        session: {
          id: "session-1",
          task: "Inspect visible browser session",
          provider: "anthropic",
          model: "claude-test",
          status: "running",
          steps: 1,
          total_tokens_in: 10,
          total_tokens_out: 5,
          total_duration_ms: 1000,
          created_at: "2026-06-19T10:00:00.000Z",
        },
        action_logs: [],
        timeline: {
          run: { id: "session-1", status: "running", created_at: "2026-06-19T10:00:00.000Z", updated_at: "2026-06-19T10:00:01.000Z" },
          counts: {
            run_step: 0,
            model_decision: 1,
            action: 1,
            observation: 0,
            approval: 0,
            artifact: 0,
            policy: 0,
            verifier: 0,
            model_usage: 0,
          },
          items: [
            {
              id: "model-decision:1",
              kind: "model_decision",
              source: "action_logs",
              timestamp: "2026-06-19T10:00:01.000Z",
              title: "Model chose screenshot",
              status: "accepted",
            },
          ],
          last_event_at: "2026-06-19T10:00:01.000Z",
        },
      });
    }) as typeof fetch;

    const detail = await fetchSession("session-1");

    expect(detail.timeline?.items[0]).toEqual(expect.objectContaining({
      kind: "model_decision",
      title: "Model chose screenshot",
    }));
    expect(detail.timeline?.counts.action).toBe(1);
  });
});
