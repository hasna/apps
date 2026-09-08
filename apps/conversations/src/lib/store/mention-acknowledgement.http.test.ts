import { afterEach, beforeEach, expect, test } from "bun:test";
import { startLoopbackApiFixture } from "./test-support/loopback-api-fixture.js";
import { activateClientEnvironment } from "./test-support/client-environment.js";
import { getStore, resolveConversationsCloud } from "./index.js";

let fixture: Awaited<ReturnType<typeof startLoopbackApiFixture>>;
let restore: () => void;
beforeEach(async () => {
  fixture = await startLoopbackApiFixture();
  restore = activateClientEnvironment(fixture.env);
});
afterEach(async () => { restore(); await fixture.stop(); });

async function seedMentions() {
  const store = getStore();
  await store.createChannel("ack-scope", "fixture-writer");
  for (const suffix of ["one", "two"]) await store.sendMessage({
    from: "fixture-writer", to: "ack-scope", channel: "ack-scope", content: `@ack-reader ${suffix}`,
  });
  const page = await store.readMentionPreviews("ack-reader", { unread_only: true });
  const ids = page.messages.map(row => row.mention_id!);
  expect(ids).toHaveLength(2);
  expect(ids.every(id => Number.isSafeInteger(id) && id > 0)).toBe(true);
  return { store, ids };
}

// Real HTTP handler/auth + in-memory SQL fixture; this is not PostgreSQL proof.
test("APIStore exact mention acknowledgement keeps the other mention unread", async () => {
  const { store, ids } = await seedMentions();
  expect(await store.markMentionsReadByIds("ack-reader", [ids[0]])).toBe(1);
  const remaining = await store.readMentionPreviews("ack-reader", { unread_only: true });
  expect(remaining.messages.map(row => row.mention_id)).toEqual([ids[1]]);
  expect(await store.markMentionsReadByIds("ack-reader", [ids[0]])).toBe(0);
});

test("direct HTTP empty and malformed selectors never become broad acknowledgement", async () => {
  const { store, ids } = await seedMentions();
  const transport = resolveConversationsCloud().transport;
  expect(await transport.post<{ marked: number }>("/messages/read", { reader: "ack-reader", mentions_only: true, mention_ids: [], channel: "ack-scope", all: true })).toEqual({ marked: 0 });
  for (const mention_ids of [null, "1", {}, [0], [-1], [1.5], ["1"], [ids[0], 0], [Number.MAX_SAFE_INTEGER + 1]]) {
    await expect(transport.post("/messages/read", { reader: "ack-reader", mentions_only: true, mention_ids, all: true, channel: "ack-scope" })).rejects.toThrow();
    expect((await store.readMentionPreviews("ack-reader", { unread_only: true })).messages.map(row => row.mention_id)).toEqual(ids);
  }
  await expect(transport.post("/messages/read", { reader: "ack-reader", mention_ids: ids, all: true })).rejects.toThrow();
  expect((await store.readMentionPreviews("ack-reader", { unread_only: true })).messages.map(row => row.mention_id)).toEqual(ids);
  // Omitted IDs deliberately retain the existing broad operation.
  expect(await store.markMentionsRead("ack-reader", "ack-scope")).toBe(2);
}, 20_000);

test("raw sensitive channel is rejected before normalization and unknown-channel lookup", async () => {
  const sensitive = new URL("postgresql://db.example.invalid/fixture");
  sensitive.username = "fixture";
  sensitive.password = crypto.randomUUID();
  let failure: unknown;
  try {
    await resolveConversationsCloud().transport.post("/messages", {
      from: "fixture-writer", to: "safe-recipient", channel: sensitive.href, content: "safe fixture message",
    });
  } catch (error) { failure = error; }
  expect(failure).toBeDefined();
  expect((failure as { status: number }).status).toBe(400);
  const raw = (failure as { body: unknown }).body;
  const body = typeof raw === "string" ? JSON.parse(raw) : raw as { error: string };
  expect(body.error).toContain("Message channel blocked: sensitive content detected");
  expect(JSON.stringify(body).includes(sensitive.password)).toBe(false);
  expect(JSON.stringify(body).includes(sensitive.href)).toBe(false);
  for (const channel of [[sensitive.href], { value: sensitive.href }]) {
    let invalid: unknown;
    try { await resolveConversationsCloud().transport.post("/messages", { from: "fixture-writer", to: "safe-recipient", channel, content: "safe fixture message" }); }
    catch (error) { invalid = error; }
    expect((invalid as { status: number }).status).toBe(400);
    expect(JSON.stringify((invalid as { body: unknown }).body).includes(sensitive.password)).toBe(false);
  }
  expect(await getStore().readMessages()).toEqual([]);
});
