import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { TrashApi } from "./client.js";

const id = "10000000-0000-4000-8000-000000000001";
test("hosted client appends v1 once and defaults to compact bounded reads", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const api = new TrashApi({ env: { HASNA_TRASH_API_KEY: randomBytes(32).toString("hex"), HASNA_TRASH_API_URL: "https://api.hasna.com/trash" },
    fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ items: [], nextCursor: null }); } });
  await api.list();
  expect(calls[0].url).toBe("https://api.hasna.com/trash/v1/entries?limit=20");
  expect(calls[0].init?.method).toBe("GET");
  await expect(api.list({ limit: 101 })).rejects.toThrow();
  expect(calls.length).toBe(1);
});

test("metadata mutations carry stable idempotency and optimistic versions", async () => {
  const calls: RequestInit[] = [];
  const api = new TrashApi({ env: { HASNA_TRASH_API_KEY: randomBytes(32).toString("hex") },
    fetchImpl: async (_url, init) => { calls.push(init!); return Response.json({ id, version: 3 }); } });
  await api.hold(id, 2, true, "fixture-idempotency");
  const headers = new Headers(calls[0].headers);
  expect(headers.get("idempotency-key")).toBe("fixture-idempotency");
  expect(headers.get("if-match")).toBe("2");
  expect(calls[0].body).toBe(JSON.stringify({ held: true }));
  await expect(api.get("../credentials")).rejects.toThrow();
  expect(calls.length).toBe(1);
});

test("API denial and transport errors are redacted and never trigger a local fallback", async () => {
  const secret = randomBytes(32).toString("hex"); let calls = 0;
  const api = new TrashApi({ env: { HASNA_TRASH_API_KEY: secret }, fetchImpl: async () => { calls++; return Response.json({ error: { code: "revoked", message: secret }, transfer: { url: `https://objects.example.test/?secret=${secret}` } }, { status: 401 }); } });
  try { await api.status(); throw new Error("Unexpected success"); }
  catch (error) {
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(error).toHaveProperty("status", 401);
  }
  expect(calls).toBe(1);
});

test("unrecognized server error codes cannot smuggle response data into agent diagnostics", async () => {
  const secret = `a${randomBytes(16).toString("hex")}`;
  const api = new TrashApi({ env: { HASNA_TRASH_API_KEY: randomBytes(32).toString("hex") }, fetchImpl: async () => Response.json({ error: { code: secret } }, { status: 400 }) });
  try { await api.status(); throw new Error("Unexpected success"); }
  catch (error) { expect(JSON.stringify(error).includes(secret)).toBe(false); expect(error).toHaveProperty("code", "request_failed"); }
});
