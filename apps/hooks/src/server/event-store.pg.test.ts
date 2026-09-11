/**
 * Live-PostgreSQL gate for the hook-event store (storage.pgTestGate in
 * hasna.contract.json).
 *
 * The route tests drive the real handler against an in-memory store; this
 * file holds the PRODUCTION store to the same contract against a real
 * server. It runs only when `HASNA_HOOKS_TEST_DATABASE_URL` points at a
 * throwaway PostgreSQL — the manifest gate command refuses to pass without
 * one — and skips otherwise so the ordinary suite stays green.
 *
 *   HASNA_HOOKS_DATABASE_URL="$HASNA_HOOKS_TEST_DATABASE_URL" \
 *     bun test src/server/event-store.pg.test.ts
 */

import { describe, expect, test } from "bun:test";
import { PostgresHookEventStore } from "./event-store.js";

const TEST_DATABASE_URL = process.env.HASNA_HOOKS_TEST_DATABASE_URL;
const maybe = TEST_DATABASE_URL ? describe : describe.skip;

maybe("PostgresHookEventStore against a live server", () => {
  test("writes, filters, summarizes and deletes real rows", async () => {
    const store = new PostgresHookEventStore(TEST_DATABASE_URL!);
    const session = `gate-${Date.now().toString(36)}`;
    try {
      const written = await store.insertEvents([
        {
          session_id: session,
          hook_name: "commandlog",
          event_type: "PostToolUse",
          tool_name: "Bash",
          tool_input: "git push --force",
          result: "continue",
          duration_ms: 7,
        },
        {
          session_id: session,
          hook_name: "errornotify",
          event_type: "PostToolUse",
          error: "Exit code 1: boom",
        },
      ]);
      expect(written).toHaveLength(2);

      const all = await store.listEvents({ session });
      expect(all.map((row) => row.hook_name).sort()).toEqual(["commandlog", "errornotify"]);
      expect(all.find((row) => row.hook_name === "commandlog")).toMatchObject({
        tool_name: "Bash",
        tool_input: "git push --force",
        duration_ms: 7,
      });

      expect((await store.listEvents({ session, errorsOnly: true })).map((row) => row.hook_name)).toEqual([
        "errornotify",
      ]);
      expect((await store.listEvents({ session, search: "force" })).map((row) => row.hook_name)).toEqual([
        "commandlog",
      ]);
      expect(await store.listEvents({ session, hook: "nothing-here" })).toEqual([]);

      const summary = (await store.summarize(null)).filter((row) =>
        ["commandlog", "errornotify"].includes(row.hook_name),
      );
      expect(summary.length).toBeGreaterThanOrEqual(2);

      const feedback = await store.insertFeedback({ message: `gate ${session}`, category: "general" });
      expect(feedback.id).toMatch(/^[0-9a-f]{21}$/);
    } finally {
      // Clean up only this run's rows.
      await store.deleteEvents({ hook: "commandlog" });
      await store.deleteEvents({ hook: "errornotify" });
      await store.close();
    }
  });

  test("refuses an unknown event_type instead of writing it", async () => {
    const store = new PostgresHookEventStore(TEST_DATABASE_URL!);
    try {
      await expect(
        store.insertEvents([{ session_id: "gate", hook_name: "x", event_type: "Nope" as never }]),
      ).rejects.toThrow(/event_type/);
    } finally {
      await store.close();
    }
  });
});
