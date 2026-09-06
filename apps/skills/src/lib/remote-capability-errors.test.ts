import { afterEach, describe, expect, test } from "bun:test";
import { RemoteCapabilityUnavailableError, RemoteRequestError, RemoteRouteUnsupportedError, RemoteSkillsClient } from "./remote-client.js";

const originalFetch = globalThis.fetch;
const code = "SUBSCRIPTION_CHECKOUT_UNAVAILABLE";
const canary = "SERVER_CONTROLLED_CANARY";
const guidance = "Subscription checkout is unavailable on the configured Skills server. " +
  "Use skills credits packs to view credit packs, or skills billing portal to manage an existing subscription.";
afterEach(() => { globalThis.fetch = originalFetch; });

function fixture(response: Response) {
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    return response;
  }) as typeof fetch;
  return { client: new RemoteSkillsClient("fixture", "https://skills.example.test"), calls };
}

async function caught(action: Promise<unknown>): Promise<unknown> {
  try { await action; throw new Error("Expected rejection"); } catch (error) { return error; }
}

function generic(error: unknown, status = 503) {
  expect(error).toBeInstanceOf(RemoteRequestError);
  expect(error).not.toBeInstanceOf(RemoteCapabilityUnavailableError);
  expect((error as RemoteRequestError).status).toBe(status);
  expect((error as Error).message).not.toContain(canary);
  expect(JSON.stringify(error)).not.toContain(canary);
}

describe("bounded, client-owned remote capability errors", () => {
  test("recognizes only the checkout code and retains no arbitrary fields or reason phrase", async () => {
    const { client, calls } = fixture(Response.json({ code, error: canary, message: canary, detail: canary,
      url: `https://${canary}.example.test`, status: canary, headers: { authorization: canary } },
    { status: 503, statusText: canary, headers: { "x-debug": canary } }));
    const error = await caught(client.createBillingCheckout());
    expect(error).toBeInstanceOf(RemoteRequestError);
    expect(error).toBeInstanceOf(RemoteCapabilityUnavailableError);
    expect(error).toMatchObject({ name: "RemoteCapabilityUnavailableError", code, status: 503,
      path: "/api/v1/billing/checkout", message: guidance });
    expect(JSON.stringify(error)).not.toContain(canary);
    expect(Object.keys(error as object).sort()).toEqual(["code", "name", "path", "status"]);
    expect(calls).toEqual([{ url: "https://skills.example.test/api/v1/billing/checkout", method: "POST" }]);
  });

  test("generic errors omit custom reason phrases, including older SDK constructor calls", async () => {
    const error = new RemoteRequestError("/safe", 503, canary);
    expect(error.message).toBe("Remote request to /safe failed: HTTP 503");
    expect(JSON.stringify(error)).not.toContain(canary);
    const { client } = fixture(new Response(canary, { status: 500, statusText: canary }));
    generic(await caught(client.getRun("fixture")), 500);
  });

  test("wrong route, method, query, status and code retain generic error behavior", async () => {
    const cases: Array<{ path: string; method: string; status: number; body: unknown }> = [
      { path: "/api/v1/billing/portal", method: "POST", status: 503, body: { code } },
      { path: "/api/v1/billing/status", method: "GET", status: 503, body: { code } },
      { path: "/api/v1/billing/checkout", method: "GET", status: 503, body: { code } },
      { path: "/api/v1/billing/checkout?source=fixture", method: "POST", status: 503, body: { code } },
      { path: "/api/v1/billing/checkout", method: "POST", status: 502, body: { code } },
      ...[{ code: "OTHER_CODE" }, { code: code.toLowerCase() }, { code: [code] }, { error: { code } }, [{ code }], null]
        .map(body => ({ path: "/api/v1/billing/checkout", method: "POST", status: 503, body })),
    ];
    for (const entry of cases) {
      const { client, calls } = fixture(Response.json(entry.body, { status: entry.status, statusText: canary }));
      // Exercise the transport guard's complete route/method boundary, including
      // methods that the public checkout convenience function cannot generate.
      const transport = client as unknown as { requestNewRoute(path: string, options: RequestInit): Promise<Response> };
      generic(await caught(transport.requestNewRoute(entry.path, { method: entry.method })), entry.status);
      expect(calls).toHaveLength(1);
    }
  });

  test("404/405 still signal version skew, PIN_NOT_FOUND remains a domain result, and old success needs no preflight", async () => {
    for (const status of [404, 405]) {
      const { client, calls } = fixture(Response.json({ code }, { status }));
      expect(await caught(client.createBillingCheckout())).toBeInstanceOf(RemoteRouteUnsupportedError);
      expect(calls).toHaveLength(1);
    }
    const missing = fixture(Response.json({ code: "PIN_NOT_FOUND", message: canary }, { status: 404 }));
    expect(await missing.client.unpin("fixture")).toBe(false);
    const unknown = fixture(Response.json({ code: "NOT_FOUND", message: canary }, { status: 404 }));
    expect(await caught(unknown.client.unpin("fixture"))).toBeInstanceOf(RemoteRouteUnsupportedError);
    const older = fixture(Response.json({ url: "https://checkout.example.test/session", code }));
    expect(await older.client.createBillingCheckout()).toEqual({ url: "https://checkout.example.test/session" });
    expect(older.calls).toHaveLength(1);
  });

  test("accepts at most 8 KiB of complete JSON and refuses malformed or oversized bodies", async () => {
    const json = JSON.stringify({ code });
    const exact = json.padEnd(8 * 1024, " ");
    const valid = fixture(new Response(exact, { status: 503 }));
    expect(await caught(valid.client.createBillingCheckout())).toBeInstanceOf(RemoteCapabilityUnavailableError);
    for (const body of ["", "{", canary, exact + " ", JSON.stringify({ code, detail: "é".repeat(8 * 1024) })]) {
      const { client } = fixture(new Response(body, { status: 503, statusText: canary }));
      generic(await caught(client.createBillingCheckout()));
    }
  });

  test("cancels an oversized streaming body without awaiting a stalled cancel hook", async () => {
    let cancelled = false;
    let pulls = 0;
    let finishCancellation!: () => void;
    const cancellation = new Promise<void>(resolve => { finishCancellation = resolve; });
    const response = new Response(new ReadableStream({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(8 * 1024 + 1)); },
      cancel() { cancelled = true; return cancellation; },
    }), { status: 503 });
    const { client } = fixture(response);
    try {
      generic(await caught(client.createBillingCheckout()));
      expect(cancelled).toBe(true);
      expect(pulls).toBeLessThanOrEqual(2);
    } finally { finishCancellation(); await cancellation; }
  });

  test("a body that never finishes has a bounded deadline and cannot establish a code", async () => {
    let cancelled = false;
    let finishCancellation!: () => void;
    const cancellation = new Promise<void>(resolve => { finishCancellation = resolve; });
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ code }))); },
      cancel() { cancelled = true; return cancellation; },
    }), { status: 503 });
    const { client } = fixture(response);
    try {
      const start = performance.now();
      generic(await caught(client.createBillingCheckout()));
      expect(performance.now() - start).toBeLessThan(3_000);
      expect(cancelled).toBe(true);
    } finally { finishCancellation(); await cancellation; }
  });

  test("an irrelevant failure cancels the body without parsing server fields", async () => {
    let cancelled = false;
    const { client } = fixture(new Response(new ReadableStream({ cancel() { cancelled = true; } }),
      { status: 401, statusText: canary, headers: { code } }));
    generic(await caught(client.createBillingCheckout()), 401);
    expect(cancelled).toBe(true);
  });
});
