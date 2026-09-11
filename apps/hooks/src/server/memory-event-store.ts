/**
 * An in-memory `HookEventStore`.
 *
 * It exists so the REAL `/api/v1/events` handler can be driven end to end
 * without a PostgreSQL instance: it genuinely stores what is posted and reads
 * it back, so a route test proves persistence and retrieval rather than a
 * canned response. `resolveHookEventStore` never returns it — a server only
 * ever gets the PostgreSQL store or nothing at all (and then answers 503), so
 * this cannot become a production path that silently loses events.
 *
 * The PostgreSQL implementation is held to the same behaviour by the live
 * gate in `src/server/event-store.pg.test.ts`
 * (`HASNA_HOOKS_TEST_DATABASE_URL`).
 */

import {
  boundedRowLimit,
  type FeedbackInput,
  type HookEventInput,
  type HookEventQuery,
  type HookEventRecord,
  type HookEventSummaryRow,
} from "../lib/event-types.js";
import { normalizeSubmittedEvent, type HookEventStore } from "./event-store.js";

export class MemoryHookEventStore implements HookEventStore {
  readonly events: HookEventRecord[] = [];
  readonly feedback: Array<FeedbackInput & { id: string }> = [];

  async insertEvents(events: HookEventInput[]): Promise<HookEventRecord[]> {
    const records = events.map((event) => normalizeSubmittedEvent(event));
    this.events.push(...records);
    return records;
  }

  async listEvents(query: HookEventQuery): Promise<HookEventRecord[]> {
    const limit = boundedRowLimit(query.limit, 50);
    return this.events
      .filter((row) => {
        if (query.hook && row.hook_name !== query.hook) return false;
        if (query.session && !row.session_id.startsWith(query.session)) return false;
        if (query.since && row.timestamp < query.since) return false;
        if (query.errorsOnly && !row.error) return false;
        if (query.search) {
          const haystack = `${row.tool_input ?? ""}\n${row.error ?? ""}`;
          if (!haystack.includes(query.search)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
      .slice(0, limit);
  }

  async deleteEvents(filter: { hook?: string }): Promise<number> {
    const keep = filter.hook ? this.events.filter((row) => row.hook_name !== filter.hook) : [];
    const deleted = this.events.length - keep.length;
    this.events.length = 0;
    this.events.push(...keep);
    return deleted;
  }

  async summarize(since: string | null): Promise<HookEventSummaryRow[]> {
    const byHook = new Map<string, HookEventSummaryRow>();
    for (const row of this.events) {
      if (since && row.timestamp < since) continue;
      const entry = byHook.get(row.hook_name) ?? { hook_name: row.hook_name, total: 0, errors: 0 };
      entry.total += 1;
      if (row.error) entry.errors += 1;
      byHook.set(row.hook_name, entry);
    }
    return [...byHook.values()].sort((a, b) => b.total - a.total);
  }

  async insertFeedback(input: FeedbackInput): Promise<{ id: string }> {
    if (typeof input.message !== "string" || input.message.trim() === "") {
      throw new Error("'message' is required");
    }
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 21);
    this.feedback.push({ ...input, id });
    return { id };
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
