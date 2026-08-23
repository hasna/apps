// Regression suite for the self-hosted TUI mail scan (src/cli/tui/data.remote.ts).
//
// The scan used to page limit/offset up to a hard SELF_HOSTED_MAIL_SCAN_CAP of
// 5000 rows and treat any short page as the end of the table. On a mailbox
// larger than 5000 messages every folder count, label tally and search result
// was computed over the newest 5000 rows and published as an exact total with
// no truncation marker anywhere (bug row O15-00350). These tests drive the REAL
// data functions against the out-of-process /v1 stub (see src/test-support/
// v1-stub.ts), exactly like data.test.ts, but with stores large enough and
// unstable enough to prove the scan is honest:
//
//   1. a 5100-message store is counted in FULL (no 5000-row cap), and the
//      counts are marked complete;
//   2. a paging window that MOVES (stub list-order instability) marks every
//      published count as a lower bound rather than an exact total.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import {
  mailboxCounts,
  listMailboxStatus,
  listMailboxSources,
  listMailbox,
  toggleRead,
  type TuiMessage,
} from "./data.js";

let stub: V1Stub;

// data.ts keeps a short TTL cache over the full message scan; mutations through
// data.ts invalidate it, but direct seeding does not — bust it between tests so
// each test observes only its own freshly-seeded state (same helper as
// data.test.ts).
function bustScanCache(): void {
  try {
    toggleRead({ kind: "inbound", id: "__cache_bust__", is_read: false } as TuiMessage);
  } catch {
    // The 404 PATCH is expected on the empty store; the cache was already nulled.
  }
}

/** `count` inbound messages, newest-first received_at, ids unique and stable. */
function seedMessages(count: number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `msg-${String(i).padStart(6, "0")}`,
      direction: "inbound",
      from_addr: "alice@ext.com",
      to_addrs: ["me@x.com"],
      subject: `subject-${i}`,
      body_text: `body of ${i}`,
      received_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
      is_read: false,
      is_starred: false,
      labels: [],
    });
  }
  return rows;
}

beforeAll(async () => {
  stub = await startV1Stub();
});
afterAll(() => stub.stop());
beforeEach(async () => {
  await stub.reset();
  stub.applyEnv();
  bustScanCache();
});
afterEach(() => stub.clearEnv());

describe("tui data — self-hosted mail scan honesty", () => {
  it("scans past the old 5000-row cap and counts a larger mailbox in full", async () => {
    await stub.seed({ messages: seedMessages(5100) });
    bustScanCache();

    const counts = mailboxCounts();
    expect(counts.inbox).toBe(5100);
    expect(counts.unread).toBe(5100);
    expect(counts.countsComplete).toBe(true);

    const status = listMailboxStatus();
    expect(status.countsComplete).toBe(true);
    expect(status.folders.find((f) => f.id === "inbox")!.count).toBe(5100);

    // Deep mail past the old cap is reachable: the oldest 100 of 5100 rows.
    const oldest = listMailbox("inbox", { limit: 200, offset: 5000 });
    expect(oldest).toHaveLength(100);
    expect(oldest[0]!.subject).toBe("subject-99");
    expect(oldest[99]!.subject).toBe("subject-0");
  });

  it("marks counts as lower bounds when the paging window is unstable", async () => {
    // Small store, but the server's ORDER BY is emulated as non-total: rows move
    // between pages, so no client-side pager can prove it saw the whole table.
    await stub.seed({ messages: seedMessages(600) });
    await stub.setListOrderInstability(1, ["messages"]);
    bustScanCache();

    const counts = mailboxCounts();
    expect(counts.countsComplete).toBe(false);

    const status = listMailboxStatus();
    expect(status.countsComplete).toBe(false);

    const sources = listMailboxSources();
    expect(sources[0]!.countsComplete).toBe(false);
  });

  it("marks counts as exact on a stable store that fits one page", async () => {
    await stub.seed({ messages: seedMessages(3) });
    bustScanCache();

    const counts = mailboxCounts();
    expect(counts.inbox).toBe(3);
    expect(counts.countsComplete).toBe(true);

    const status = listMailboxStatus();
    expect(status.countsComplete).toBe(true);

    const sources = listMailboxSources();
    expect(sources[0]!.countsComplete).toBe(true);
    expect(sources[0]!.total).toBe(3);
  });
});
