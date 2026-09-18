import { useDefaultTestTimeout } from "../test-preload.js";
import { afterEach, expect, test } from "bun:test";
import { RemoteCreditCheckoutError, RemoteRequestError, RemoteSkillsClient } from "./remote-client.js";

useDefaultTestTimeout();
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const key = "checkout-request-0001", packId = "credits_100";
const client = () => new RemoteSkillsClient("synthetic-not-a-credential", "https://checkout-fixture.example.test");
function server(reply: (body: any, count: number) => Response | Promise<Response>) {
  const posts: any[] = [], reads: string[] = [];
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    expect(String(input)).toBe("https://checkout-fixture.example.test/api/v1/billing/credits");
    expect(init?.redirect).toBe("error"); expect(init?.credentials).toBe("omit");
    if (init?.method !== "POST") { reads.push(String(input)); return Response.json([{ id: packId, credits: 100 }]); }
    const body = JSON.parse(String(init.body)); posts.push(body); return reply(body, posts.length);
  }) as typeof fetch;
  return { posts, reads };
}
async function refused(operation: Promise<unknown>) {
  try { await operation; throw Error("expected checkout refusal"); }
  catch (error) { expect(error).toBeInstanceOf(RemoteCreditCheckoutError); expect(error).toBeInstanceOf(RemoteRequestError); return error as RemoteCreditCheckoutError; }
}
test("503 then409 then200 needs explicit calls and reuses one caller key", async () => {
  const observed = server((body, n) => Response.json(n === 1 ? { error: "credit checkout creation unresolved", retryAfterSeconds: 30, requestIdempotencyKey: body.idempotencyKey, detail: "SERVER_SECRET" }
    : n === 2 ? { error: "credit checkout in_progress", requestIdempotencyKey: body.idempotencyKey }
    : { url: "https://checkout.example.test/session", requestIdempotencyKey: body.idempotencyKey, idempotencyKey: "provider-key-must-not-replace-request" }, { status: n === 1 ? 503 : n === 2 ? 409 : 200 }));
  const c = client(), first = await refused(c.createCreditCheckout(packId, { idempotencyKey: key }));
  expect(first).toMatchObject({ code: "CREDIT_CHECKOUT_UNCONFIRMED", status: 503, requestIdempotencyKey: key, retryAfterSeconds: 30 }); expect(observed.posts).toHaveLength(1);
  const second = await refused(c.createCreditCheckout(packId, { idempotencyKey: first.requestIdempotencyKey }));
  expect(second.code).toBe("CREDIT_CHECKOUT_IN_PROGRESS"); expect(observed.posts).toHaveLength(2);
  expect(await c.createCreditCheckout(packId, { idempotencyKey: second.requestIdempotencyKey })).toEqual({ url: "https://checkout.example.test/session", requestIdempotencyKey: key });
  expect(observed.posts).toEqual(Array.from({ length: 3 }, () => ({ packId, idempotencyKey: key })));
  expect(JSON.stringify(first) + first.message).not.toContain("SERVER_SECRET");
});
test("transport loss retains preselected key and never retries a POST automatically", async () => {
  const observed = server((_body, count) => { if (count === 1) throw Error("RAW_NETWORK_SECRET"); return Response.json({ url: "https://checkout.example.test/session" }); });
  const c = client(), failure = await refused(c.createCreditCheckout(packId, { idempotencyKey: key }));
  expect(failure).toMatchObject({ status: 0, requestIdempotencyKey: key, code: "CREDIT_CHECKOUT_UNCONFIRMED" }); expect(observed.posts).toHaveLength(1);
  expect(failure.message + JSON.stringify(failure)).not.toContain("RAW_NETWORK_SECRET");
  expect(await c.createCreditCheckout(packId, { idempotencyKey: key })).toEqual({ url: "https://checkout.example.test/session", requestIdempotencyKey: key });
  expect(observed.posts).toEqual([{ packId, idempotencyKey: key }, { packId, idempotencyKey: key }]);
});
test("backward-compatible omitted option generates its key before POST and retains it", async () => {
  const observed = server(() => { throw Error("connection reset"); });
  const error = await refused(client().createCreditCheckout(packId));
  expect(error.requestIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(observed.posts).toEqual([{ packId, idempotencyKey: error.requestIdempotencyKey }]);
});
test("terminal states are fixed and a mismatched server echo cannot replace caller authority", async () => {
  for (const state of ["expired", "fulfilled"] as const) {
    const observed = server(() => Response.json({ error: "credit checkout " + state, requestIdempotencyKey: key, retryAfterSeconds: 1, extra: "SERVER_SECRET" }, { status: 409 }));
    const error = await refused(client().createCreditCheckout(packId, { idempotencyKey: key }));
    expect(error.code).toBe(state === "expired" ? "CREDIT_CHECKOUT_EXPIRED" : "CREDIT_CHECKOUT_FULFILLED"); expect(error.retryAfterSeconds).toBeUndefined(); expect(observed.posts).toHaveLength(1);
  }
  for (const state of ["expired", "fulfilled"]) {
    const missingEcho = server(() => Response.json({ error: "credit checkout " + state }, { status: 409 }));
    expect((await refused(client().createCreditCheckout(packId, { idempotencyKey: key }))).code).toBe("CREDIT_CHECKOUT_UNCONFIRMED");
    expect(missingEcho.posts).toHaveLength(1);
  }
  const observed = server(() => Response.json({ error: "credit checkout fulfilled", requestIdempotencyKey: "OTHER_SERVER_KEY" }, { status: 409 }));
  const error = await refused(client().createCreditCheckout(packId, { idempotencyKey: key }));
  expect(error.code).toBe("CREDIT_CHECKOUT_UNCONFIRMED"); expect(error.requestIdempotencyKey).toBe(key); expect(JSON.stringify(error)).not.toContain("OTHER_SERVER_KEY"); expect(observed.posts).toHaveLength(1);
});
test("malformed or overlong responses keep only safe checkout context", async () => {
  for (const response of [new Response("SERVER_SECRET", { status: 503 }), Response.json({ error: "SERVER_SECRET", retryAfterSeconds: 999999 }, { status: 503 }),
    Response.json({ url: "https://checkout.example.test/session", requestIdempotencyKey: "SERVER_SECRET" }), Response.json({ url: "https://checkout.example.test/session", extra: "x".repeat(5000) })]) {
    const observed = server(() => response);
    const error = await refused(client().createCreditCheckout(packId, { idempotencyKey: key }));
    expect(error.code).toBe("CREDIT_CHECKOUT_UNCONFIRMED"); expect(error.retryAfterSeconds).toBeUndefined(); expect(error.requestIdempotencyKey).toBe(key); expect(JSON.stringify(error) + error.message).not.toContain("SERVER_SECRET"); expect(observed.posts).toHaveLength(1);
  }
});
test("invalid key and unknown pack refuse before POST; options cannot change during discovery", async () => {
  const observed = server(() => Response.json({ url: "https://checkout.example.test/session" }));
  for (const invalid of ["short", "bad\ncharacters", "x".repeat(256), 42]) await expect(client().createCreditCheckout(packId, { idempotencyKey: invalid as string })).rejects.toThrow("8-255 URL-safe");
  expect(observed.reads).toHaveLength(0); expect(observed.posts).toHaveLength(0);
  await expect(client().createCreditCheckout("missing", { idempotencyKey: key })).rejects.toThrow("Choose a credit pack"); expect(observed.posts).toHaveLength(0);
  const options = { idempotencyKey: key }; const request = client().createCreditCheckout(packId, options); options.idempotencyKey = "changed-after-call";
  expect((await request).requestIdempotencyKey).toBe(key); expect(observed.posts).toEqual([{ packId, idempotencyKey: key }]);
});
