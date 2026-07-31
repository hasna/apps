import { describe, test, expect } from "bun:test";
import { ApiStore } from "./api-store.js";
import { DEFAULT_READ_LIMIT } from "../message-window.js";
import type { HasnaStorageClient } from "../contracts-client/storage.js";

// A minimal fake HasnaStorageClient whose transport returns whatever the test
// queues, so we can assert ApiStore normalizes raw API rows into the client
// contract without any network or sqlite.
function fakeClient(getBody: unknown): HasnaStorageClient {
  const transport = {
    baseUrl: "https://conversations.hasna.xyz/v1",
    // Only the verbs ApiStore's project methods touch are needed here.
    get: async () => getBody,
    post: async () => getBody,
    patch: async () => getBody,
    del: async () => undefined,
  } as unknown as HasnaStorageClient["transport"];
  return {
    name: "conversations",
    baseUrl: "https://conversations.hasna.xyz/v1",
    transport,
  } as unknown as HasnaStorageClient;
}

/** A client whose transport rejects every read with a 404 HasnaHttpError. */
function throwing404Client(): HasnaStorageClient {
  const err = Object.assign(new Error("Not Found"), { name: "HasnaHttpError", status: 404 });
  const reject = async () => {
    throw err;
  };
  const transport = {
    baseUrl: "https://conversations.hasna.xyz/v1",
    get: reject,
    post: reject,
    patch: reject,
    del: reject,
  } as unknown as HasnaStorageClient["transport"];
  return {
    name: "conversations",
    baseUrl: "https://conversations.hasna.xyz/v1",
    transport,
  } as unknown as HasnaStorageClient;
}

describe("ApiStore project normalization", () => {
  test("getProject coerces raw JSON-text tags into a string[] (regression: tags=null crash)", async () => {
    // Server returns a raw row: tags as null (the shape that crashed `project get`).
    const store = new ApiStore(fakeClient({ project: { id: "p1", name: "acme", tags: null, channel_count: 3 } }));
    const p = (await store.getProject("p1")) as unknown as { tags: string[]; channel_count: number };
    expect(Array.isArray(p.tags)).toBe(true);
    expect(p.tags.length).toBe(0);
    expect(p.channel_count).toBe(3);
    // The exact expression that used to throw must now be safe.
    expect(() => (p.tags.length > 0 ? p.tags.join(", ") : "")).not.toThrow();
  });

  test("getProject parses tags stored as a JSON string", async () => {
    const store = new ApiStore(fakeClient({ project: { id: "p2", name: "beta", tags: '["a","b"]' } }));
    const p = (await store.getProject("p2")) as unknown as { tags: string[]; channel_count: number };
    expect(p.tags).toEqual(["a", "b"]);
    expect(p.channel_count).toBe(0);
  });

  test("listProjects normalizes every row", async () => {
    const store = new ApiStore(
      fakeClient({ projects: [{ id: "p1", name: "a", tags: null }, { id: "p2", name: "b", tags: '["x"]', channel_count: 2 }] }),
    );
    const rows = (await store.listProjects()) as unknown as Array<{ tags: string[]; channel_count: number }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].tags).toEqual([]);
    expect(rows[1].tags).toEqual(["x"]);
    expect(rows[1].channel_count).toBe(2);
  });

  test("getProject returns null when the API has no project", async () => {
    const store = new ApiStore(fakeClient({ project: null }));
    expect(await store.getProject("missing")).toBeNull();
  });

  test("getProject returns null (not throw) when the server 404s the lookup", async () => {
    // The server 404s a missing project (GET /projects/:id). The LocalStore
    // contract is null, so ApiStore must translate the 404 rather than throw —
    // otherwise `project-panel`'s resolveProject() crashes instead of falling
    // through to getProjectByName().
    const store = new ApiStore(throwing404Client());
    expect(await store.getProject("nope")).toBeNull();
  });

  test("getChannel returns null (not throw) when the server 404s the lookup", async () => {
    // Same contract for channels: the server 404s a missing channel, the local
    // store returns null.
    const store = new ApiStore(throwing404Client());
    expect(await store.getChannel("nope")).toBeNull();
  });
});

// Regression cover for HC-00148, cloud-transport layer. ApiStore.sendMessage
// forwards an EXPLICIT field whitelist, and reply_to was not on it — so in
// self_hosted/cloud mode the parent link was dropped before the request even
// left the machine, while the local SQLite path (and its tests) stayed correct.
// This asserts on the body that actually goes over the wire.
describe("ApiStore.sendMessage wire body", () => {
  /** A client that records every `create` body and echoes it back as the row. */
  function capturingClient(): { client: HasnaStorageClient; sent: Array<Record<string, unknown>> } {
    const sent: Array<Record<string, unknown>> = [];
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {} as unknown as HasnaStorageClient["transport"],
      create: async (_resource: string, body: Record<string, unknown>) => {
        sent.push(body);
        // Echo the request back as the stored row, the way the real server does.
        return { message: { id: 1, ...body, from_agent: body.from, to_agent: body.to } };
      },
    } as unknown as HasnaStorageClient;
    return { client, sent };
  }

  test("forwards reply_to to the API so the reply is threaded server-side", async () => {
    const { client, sent } = capturingClient();
    const store = new ApiStore(client);

    await store.sendMessage({ from: "bob", to: "incidents", content: "on it", channel: "incidents", reply_to: 602449 });

    expect(sent).toHaveLength(1);
    // The exact assertion the defect failed: reply_to never reached the body.
    expect(sent[0]).toHaveProperty("reply_to", 602449);
  });

  test("omits reply_to for a non-reply send (must not thread everything)", async () => {
    const { client, sent } = capturingClient();
    const store = new ApiStore(client);

    await store.sendMessage({ from: "bob", to: "incidents", content: "root post", channel: "incidents" });

    expect(sent).toHaveLength(1);
    expect(sent[0].reply_to).toBeUndefined();
  });

  test("the returned message carries reply_to back to the caller", async () => {
    // The CLI now fails closed when the stored row's reply_to does not match the
    // requested parent, so the parsed response must surface the field.
    const { client } = capturingClient();
    const store = new ApiStore(client);

    const msg = await store.sendMessage({ from: "bob", to: "incidents", content: "on it", channel: "incidents", reply_to: 42 });
    expect(msg.reply_to).toBe(42);
  });

  // `messages.id`/`messages.reply_to` are Postgres BIGINT, and node-postgres
  // serializes int8 as a STRING. Measured against the live deployed server:
  // GET /v1/messages returns `"id": "603183"` — a string, not a number.
  //
  // The CLI's new fail-closed check compares STRICTLY (`msg.reply_to !== parentId`
  // in cli/commands/messaging.ts) against a `parseInt`-ed number, so it is only
  // correct because parseMessage coerces with `Number(row.reply_to)`
  // (lib/messages.ts:46). That coercion is now load-bearing for every cloud
  // reply: drop it and `"42" !== 42` makes the CLI reject its own successful
  // write on every threaded reply in self_hosted/cloud mode.
  //
  // Nothing pinned that. Removing the coercion was measured to leave 178 tests
  // across messages/api-store/reply-threading/api green, because every fake
  // echoed reply_to as a number — unfaithful to the server in exactly the
  // dimension the new check depends on. This test closes that gap.
  test("coerces a bigint-string reply_to to a number (the live server sends a string)", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport: {} as unknown as HasnaStorageClient["transport"],
      create: async (_resource: string, body: Record<string, unknown>) => {
        sent.push(body);
        // Echo the row the way Postgres+node-postgres actually does: bigint
        // columns arrive as strings.
        return {
          message: {
            ...body,
            id: "603184",
            reply_to: String(body.reply_to),
            from_agent: body.from,
            to_agent: body.to,
          },
        };
      },
    } as unknown as HasnaStorageClient;

    const store = new ApiStore(client);
    const msg = await store.sendMessage({
      from: "bob", to: "incidents", content: "on it", channel: "incidents", reply_to: 602449,
    });

    // Strictly a number, so the CLI's `!==` parent-link check passes.
    expect(msg.reply_to).toBe(602449);
    expect(typeof msg.reply_to).toBe("number");
    // The id travels the same bigint path and is compared numerically downstream.
    expect(msg.id).toBe(603184);
    expect(typeof msg.id).toBe("number");
  });
});

// Regression: ApiStore asked the server for `order=asc` whenever `latest` was
// unset, so `read --channel X --limit 40` against the hosted API selected the
// OLDEST 40 rows server-side. A client-side sort could never have fixed that —
// the newest rows never left the server. Measured on station01 against
// conversations.hasna.xyz with 0.5.9: `--limit 5` on #internal-ea returned ids
// 586455..586462 while `--since 6h` at the same moment reached id 607254.
describe("ApiStore.readMessages recency window", () => {
  /** A client that records the query of every GET and returns queued rows. */
  function queryCapturingClient(rows: Record<string, unknown>[]): {
    client: HasnaStorageClient;
    queries: Array<Record<string, unknown>>;
  } {
    const queries: Array<Record<string, unknown>> = [];
    const transport = {
      baseUrl: "https://conversations.hasna.xyz/v1",
      get: async (_path: string, opts?: { query?: Record<string, unknown> }) => {
        queries.push(opts?.query ?? {});
        return { messages: rows };
      },
      post: async () => ({}),
      patch: async () => ({}),
      del: async () => undefined,
    } as unknown as HasnaStorageClient["transport"];
    const client = {
      name: "conversations",
      baseUrl: "https://conversations.hasna.xyz/v1",
      transport,
    } as unknown as HasnaStorageClient;
    return { client, queries };
  }

  function row(id: number, created_at: string) {
    return { id, from_agent: "a", to_agent: "internal-ea", channel: "internal-ea", content: `m${id}`, created_at };
  }

  test("a bare limit asks the server for order=desc (the newest N must leave the server)", async () => {
    const { client, queries } = queryCapturingClient([]);
    await new ApiStore(client).readMessages({ channel: "internal-ea", limit: 40 });
    expect(queries).toHaveLength(1);
    expect(queries[0].order).toBe("desc");
    expect(queries[0].limit).toBe(40);
  });

  test("newest-first server rows are handed back in chronological order", async () => {
    // The server answers order=desc, so rows arrive newest first.
    const { client } = queryCapturingClient([
      row(607254, "2026-07-30T12:03:00.000Z"),
      row(607250, "2026-07-30T12:02:00.000Z"),
      row(607248, "2026-07-30T12:01:00.000Z"),
    ]);
    const msgs = await new ApiStore(client).readMessages({ channel: "internal-ea", limit: 3 });
    expect(msgs.map((m) => m.id)).toEqual([607248, 607250, 607254]);
  });

  test("explicit order=asc is still forwarded verbatim (forward paging preserved)", async () => {
    const { client, queries } = queryCapturingClient([row(1, "2026-07-30T10:00:00.000Z"), row(2, "2026-07-30T10:01:00.000Z")]);
    const msgs = await new ApiStore(client).readMessages({ channel: "internal-ea", limit: 2, order: "asc" });
    expect(queries[0].order).toBe("asc");
    expect(msgs.map((m) => m.id)).toEqual([1, 2]);
  });

  // `since` is a TIME FILTER, not a cursor, and it carried the same defect with
  // its cap defaulted rather than passed. Measured on #incidents at 0.5.11:
  // `--since 3h` returned the 20 OLDEST rows of a 110-row window (max id 607270)
  // while the true newest in that window was 608099.
  test("a since filter asks for order=desc — the newest of the window must leave the server", async () => {
    const { client, queries } = queryCapturingClient([]);
    await new ApiStore(client).readMessages({ channel: "internal-ea", since: "2026-07-30T06:00:00.000Z", limit: 40 });
    expect(queries[0].order).toBe("desc");
  });

  test("a since filter with no limit still asks for desc, at the shared default cap", async () => {
    const { client, queries } = queryCapturingClient([]);
    await new ApiStore(client).readMessages({ channel: "internal-ea", since: "3h" });
    expect(queries[0].order).toBe("desc");
    expect(queries[0].limit).toBe(DEFAULT_READ_LIMIT);
  });

  // A since_id IS a cursor — "the next page after this exact id". A newest-N
  // window there would let a catch-up walk skip the middle of a backlog.
  test("a since_id cursor keeps order=asc so forward paging cannot skip a backlog", async () => {
    const { client, queries } = queryCapturingClient([]);
    await new ApiStore(client).readMessages({ channel: "internal-ea", since_id: 606944, limit: 40 });
    expect(queries[0].order).toBe("asc");
  });

  test("a relative since ('6h') is normalized before it reaches the server", async () => {
    const { client, queries } = queryCapturingClient([]);
    await new ApiStore(client).readMessages({ channel: "internal-ea", since: "6h", limit: 40 });
    expect(queries[0].order).toBe("desc");
    // The server receives an absolute timestamp, not the duration string.
    expect(String(queries[0].since)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ── the server's 500-row ceiling, which is a SEPARATE defect from ordering ──
  //
  // `/messages` clamps a read at 500 rows (`clampLimit(raw, def, max = 500)` in
  // src/server/api.ts) and `--limit` cannot raise it: measured at 0.5.11,
  // `since 3h --limit 1000` and `--limit 5000` both returned exactly 500. That
  // ceiling is server-side and this client PR does not move it.
  //
  // What the ordering fix changes is WHICH 500. Asking `asc` meant "the oldest
  // 500 of the window", so a window over 500 could never reach the newest at any
  // limit — `since 3h --limit 5000` stopped at id 607592 while the true newest
  // was 608121. Asking `desc` means the clamped page is the NEWEST 500, so the
  // newest message is always in reach and the ceiling only bounds how far BACK
  // one page goes. These two tests pin that distinction.
  test("a limit above the server ceiling is still requested as desc, so the clamped page is the newest", async () => {
    const { client, queries } = queryCapturingClient([]);
    await new ApiStore(client).readMessages({ channel: "incidents", since: "3h", limit: 5000 });
    expect(queries[0].order).toBe("desc");
    expect(queries[0].limit).toBe(5000);
  });

  test("a server page clamped to its ceiling still carries the newest message", async () => {
    const CEILING = 500;
    // What the server sends back for order=desc when the window exceeds 500:
    // the newest CEILING rows, newest first.
    const newestFirst = Array.from({ length: CEILING }, (_, i) => row(608121 - i, new Date(Date.UTC(2026, 6, 30, 12, 0, 0) - i * 1000).toISOString()));
    const { client } = queryCapturingClient(newestFirst);
    const msgs = await new ApiStore(client).readMessages({ channel: "incidents", since: "3h", limit: 5000 });
    expect(msgs).toHaveLength(CEILING);
    // Chronological, and the newest id in the window is present — the exact
    // assertion that failed before the fix.
    expect(msgs[msgs.length - 1].id).toBe(608121);
    expect(msgs[0].id).toBe(608121 - (CEILING - 1));
  });

  test("newest-first server rows under a since filter come back chronologically", async () => {
    const { client } = queryCapturingClient([
      row(608099, "2026-07-30T12:05:00.000Z"),
      row(607270, "2026-07-30T12:02:00.000Z"),
      row(607110, "2026-07-30T12:01:00.000Z"),
    ]);
    const msgs = await new ApiStore(client).readMessages({ channel: "incidents", since: "3h" });
    expect(msgs.map((m) => m.id)).toEqual([607110, 607270, 608099]);
  });

  test("latest:N still asks for desc and stays newest-first", async () => {
    const { client, queries } = queryCapturingClient([
      row(607254, "2026-07-30T12:03:00.000Z"),
      row(607250, "2026-07-30T12:02:00.000Z"),
    ]);
    const msgs = await new ApiStore(client).readMessages({ channel: "internal-ea", latest: 2 });
    expect(queries[0].order).toBe("desc");
    expect(msgs.map((m) => m.id)).toEqual([607254, 607250]);
  });
});
