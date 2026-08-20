import { describe, test, expect } from "bun:test";
import { ApiStore, SERVER_SEARCH_MAX_ROWS } from "./api-store.js";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";

/**
 * Regression cover for todos 83852845 — `search` silently caps at 500 rows and
 * ignores a larger `--limit`, emitting no truncation signal at all.
 *
 * The defect class is what makes this worth pinning: the obvious use of the
 * verb is auditing one sender's history, and an audit is an ABSENCE claim. A
 * cap with no signal turns "I found no instances" into a confident wrong
 * answer the moment the population exceeds the cap.
 *
 * Every test here therefore asserts BOTH states. A truncation signal that is
 * always absent and one that is always present are equally useless, so a fix
 * demonstrated only on the truncating case has not been demonstrated.
 */

/** Records the query the store actually sent, and replays a canned body. */
function recordingClient(body: unknown) {
  const seen: Record<string, unknown>[] = [];
  const transport = {
    baseUrl: "https://conversations.hasna.xyz/v1",
    get: async (_path: string, opts?: { query?: Record<string, unknown> }) => {
      seen.push(opts?.query ?? {});
      return body;
    },
    post: async () => body,
    patch: async () => body,
    del: async () => undefined,
  } as unknown as HasnaStorageClient["transport"];
  const client = {
    name: "conversations",
    baseUrl: "https://conversations.hasna.xyz/v1",
    transport,
  } as unknown as HasnaStorageClient;
  return { client, seen };
}

/** `n` rows shaped enough for the preview search response. */
function rows(n: number, startId = 1) {
  return Array.from({ length: n }, (_, i) => ({
    id: startId + i,
    session_id: "session",
    from_agent: "fabricius",
    to_agent: null,
    channel: "board",
    preview: `row ${startId + i} the`,
    preview_bytes: Buffer.byteLength(`row ${startId + i} the`),
    content_bytes: Buffer.byteLength(`row ${startId + i} the`),
    priority: "normal",
    created_at: "2026-08-02T10:00:00.000Z",
    unread: false,
    blocking: false,
    truncated: false,
    redacted: false,
  }));
}

describe("ApiStore.searchMessagesPage — truncation is disclosed, both states", () => {
  test("under the cap: no truncation claimed, and every row is returned", async () => {
    // 12 rows for a request of 50: genuinely exhausted.
    const { client } = recordingClient({ messages: rows(12) });
    const page = await new ApiStore(client).searchMessagesPage({ query: "the", from: "fabricius", limit: 50 });

    expect(page.has_more).toBe(false);
    expect(page.next_cursor).toBeNull();
    expect(page.items.length).toBe(12);
  });

  test("over the requested limit: truncation is reported and the page is trimmed to what was asked", async () => {
    // Over-fetch by one is how the page learns there is more; the caller must
    // still receive exactly the 10 rows it asked for, not the probe row.
    const { client, seen } = recordingClient({ messages: rows(11) });
    const page = await new ApiStore(client).searchMessagesPage({ query: "the", from: "fabricius", limit: 10 });

    expect(seen[0]?.limit).toBe(11); // asked for one more than needed
    expect(page.has_more).toBe(true);
    expect(page.items.length).toBe(10);
    expect(page.next_cursor).toBe(10);
  });

  test("THE REPORTED DEFECT: a server-side clamp to 500 is reported as truncation, not as exhaustion", async () => {
    // Measured 2026-08-02: `--limit 3000` returned exactly 500 rows, rc=0, no
    // signal. The server clamps and answers with FEWER rows than requested,
    // which every ordinary pagination rule reads as "exhausted". That inversion
    // is the bug: the one shape that means "there is more" looks like the shape
    // that means "there is no more".
    const { client } = recordingClient({ messages: rows(SERVER_SEARCH_MAX_ROWS) });
    const page = await new ApiStore(client).searchMessagesPage({ query: "the", from: "fabricius", limit: 3000 });

    expect(page.items.length).toBe(SERVER_SEARCH_MAX_ROWS);
    expect(page.has_more).toBe(true);
    expect(page.effective_limit).toBe(SERVER_SEARCH_MAX_ROWS);
    expect(page.next_cursor).toBe(SERVER_SEARCH_MAX_ROWS);
  });

  test("a server that reports has_more is believed over the client's inference", async () => {
    // Once the hosted server ships the additive `has_more`, the client must
    // stop guessing. Exactly 500 rows that genuinely exhaust the population is
    // the case the clamp heuristic gets wrong, and this is how it gets fixed.
    const { client } = recordingClient({ messages: rows(SERVER_SEARCH_MAX_ROWS), has_more: false, limit: SERVER_SEARCH_MAX_ROWS });
    const page = await new ApiStore(client).searchMessagesPage({ query: "the", from: "fabricius", limit: 3000 });

    expect(page.has_more).toBe(false);
    expect(page.next_cursor).toBeNull();
  });

  test("a server that reports has_more:true is believed even when it returns fewer rows than the cap", async () => {
    const { client } = recordingClient({ messages: rows(30), has_more: true, next_offset: 30 });
    const page = await new ApiStore(client).searchMessagesPage({ query: "the", limit: 100 });

    expect(page.has_more).toBe(true);
    expect(page.next_cursor).toBe(30);
  });

  test("a new server cannot hide the client's final probe row behind has_more:false", async () => {
    // The client asks for 11 rows to serve a 10-row page. A new server treats
    // that wire limit as its page size and can truthfully say the 11-row wire
    // page exhausted the population. The client still owes its caller a way to
    // reach row 11 after trimming the page back to 10.
    const { client } = recordingClient({ messages: rows(11), has_more: false, next_offset: null, limit: 11 });
    const page = await new ApiStore(client).searchMessagesPage({ query: "the", limit: 10 });

    expect(page.items.length).toBe(10);
    expect(page.has_more).toBe(true);
    expect(page.next_cursor).toBe(10);
  });

  test("a new server cursor advances by returned caller rows, not by the wire probe row", async () => {
    // The server's next_offset=11 is correct for its 11-row wire page, but the
    // client returns only 10 rows. Reusing 11 would skip row 11 permanently.
    const { client } = recordingClient({ messages: rows(11), has_more: true, next_offset: 11, limit: 11 });
    const page = await new ApiStore(client).searchMessagesPage({ query: "the", limit: 10 });

    expect(page.items.length).toBe(10);
    expect(page.has_more).toBe(true);
    expect(page.next_cursor).toBe(10);
  });

  test("cursor offsets carry into next_cursor so paging past the cap advances", async () => {
    const { client } = recordingClient({ messages: rows(SERVER_SEARCH_MAX_ROWS, 501) });
    const page = await new ApiStore(client).searchMessagesPage({ query: "the", limit: 3000, offset: 500 });

    expect(page.has_more).toBe(true);
    expect(page.next_cursor).toBe(1000);
  });

  test("search rows keep the fields that make this verb worth using", async () => {
    // Named explicitly because the fix must not regress them: created_at,
    // channel, bounded compatibility content and from_agent travelling together
    // is what makes search better than walking channels with digest for a
    // sender audit.
    const { client } = recordingClient({ messages: rows(1) });
    const page = await new ApiStore(client).searchMessagesPage({ query: "the", limit: 10 });

    const row = page.items[0]!;
    expect(row.created_at).toBe("2026-08-02T10:00:00.000Z");
    expect(row.channel).toBe("board");
    expect(row.from_agent).toBe("fabricius");
    expect(row.content).toContain("row 1");
  });

  test("an empty result set is exhaustion, never truncation", async () => {
    // The negative control from the bug report: a query matching nothing must
    // stay a clean, signal-free zero, or the disclosure becomes noise that
    // readers learn to ignore.
    const { client } = recordingClient({ messages: [] });
    const page = await new ApiStore(client).searchMessagesPage({ query: "zzqxnotarealtokenhere", limit: 500 });

    expect(page.items.length).toBe(0);
    expect(page.has_more).toBe(false);
    expect(page.next_cursor).toBeNull();
  });

  test("forwards one canonical exact since cutoff to the HTTP search route", async () => {
    const { client, seen } = recordingClient({ messages: rows(1), has_more: false });
    await new ApiStore(client).searchMessagesPage({
      query: "the",
      since: "2026-08-02T14:00:00+02:00",
      limit: 10,
    });

    expect(seen[0]?.since).toBe("2026-08-02T12:00:00.000Z");
  });

  test("rejects an invalid HTTP search cutoff before making a request", async () => {
    const { client, seen } = recordingClient({ messages: rows(1) });
    await expect(new ApiStore(client).searchMessagesPage({ query: "the", since: "yesterday" })).rejects.toThrow(
      "Invalid search since timestamp",
    );
    expect(seen).toHaveLength(0);
  });
});
