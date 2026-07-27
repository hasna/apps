import { describe, test, expect } from "bun:test";
import { ApiStore } from "./api-store.js";
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
