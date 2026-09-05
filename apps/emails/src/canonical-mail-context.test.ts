import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetMailDataSource, resolveMailDataSource } from "./lib/mail-data-source.js";
import {
  CLIENT_DATABASE_SETTINGS, EMAILS_API_KEY_SETTINGS, EMAILS_API_URL_SETTINGS,
  RETIRED_EMAILS_SELECTOR_SETTINGS,
} from "./lib/client-settings.js";

const keys = [...new Set([
  ...CLIENT_DATABASE_SETTINGS, ...EMAILS_API_KEY_SETTINGS, ...EMAILS_API_URL_SETTINGS,
  ...RETIRED_EMAILS_SELECTOR_SETTINGS, "EMAILS_SESSION_TOKEN", "EMAILS_IDP_TOKEN", "EMAILS_CLIENT_ENV_SECRET",
])];
let saved: Record<string, string | undefined>;
let originalFetch: typeof fetch;
const requests: Array<{ origin: string; credential: string }> = [];

beforeEach(() => {
  saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.HASNA_EMAILS_API_URL = "https://one.example";
  process.env.HASNA_EMAILS_API_KEY = "synthetic-key-one";
  resetMailDataSource();
  requests.length = 0;
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const credential = new Headers(init?.headers).get("authorization") ?? "";
    requests.push({ origin: url.origin, credential });
    // Label summary walks are cached by the actual data source. One synthetic row
    // makes reuse across identity boundaries observable without a service/database.
    return Response.json({ messages: [{
      id: "fixture-message", direction: "inbound", from_addr: "sender@example.com",
      to_addrs: ["recipient@example.com"], cc_addrs: [], subject: "synthetic",
      status: "received", labels: [credential], received_at: "2026-09-01T00:00:00Z",
      message_id: "<synthetic@example.com>", in_reply_to: null, provider_message_id: null,
      is_read: false, is_starred: false, source_id: null, send_state: "none", send_started_at: null,
      created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
      snippet: "synthetic", attachment_count: 0, policy_denial: null,
    }], next_cursor: null });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetMailDataSource();
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("canonical mailbox context cache", () => {
  it("keeps same-context caches but never reuses rows or credentials across rotation or switch-back", async () => {
    const first = resolveMailDataSource();
    const firstLabels = await first.listLabelSummaries();
    const firstRequests = requests.length;
    expect(firstRequests).toBeGreaterThan(0);
    expect(resolveMailDataSource()).toBe(first);
    expect(await resolveMailDataSource().listLabelSummaries()).toEqual(firstLabels);
    expect(requests).toHaveLength(firstRequests);

    process.env.HASNA_EMAILS_API_KEY = "synthetic-key-two";
    const second = resolveMailDataSource();
    expect(second).not.toBe(first);
    expect(await second.listLabelSummaries()).not.toEqual(firstLabels);
    expect(requests.at(-1)?.credential).toBe("Bearer synthetic-key-two");

    process.env.HASNA_EMAILS_API_URL = "https://two.example";
    const otherEndpoint = resolveMailDataSource();
    expect(otherEndpoint).not.toBe(second);
    await otherEndpoint.listLabelSummaries();
    expect(requests.at(-1)?.origin).toBe("https://two.example");

    process.env.HASNA_EMAILS_API_URL = "https://one.example";
    process.env.HASNA_EMAILS_API_KEY = "synthetic-key-one";
    const switchedBack = resolveMailDataSource();
    expect(switchedBack).not.toBe(first);
    const before = requests.length;
    expect(await switchedBack.listLabelSummaries()).toEqual(firstLabels);
    expect(requests.length).toBeGreaterThan(before);
  });

  it("invalidates for effective credential setting and every ordered fallback context change", () => {
    let previous = resolveMailDataSource();
    const assertChanged = () => {
      const next = resolveMailDataSource();
      expect(next).not.toBe(previous);
      expect(resolveMailDataSource()).toBe(next);
      previous = next;
    };
    process.env.EMAILS_SESSION_TOKEN = "synthetic-key-one";
    assertChanged(); // Same bytes, different credential class/setting.
    process.env.EMAILS_IDP_TOKEN = "synthetic-idp-one";
    assertChanged();
    process.env.EMAILS_IDP_TOKEN = "synthetic-idp-two";
    assertChanged();
    process.env.HASNA_EMAILS_API_KEY = "fixture-fallback";
    assertChanged();
    delete process.env.EMAILS_IDP_TOKEN;
    assertChanged();
    delete process.env.HASNA_EMAILS_API_KEY;
    assertChanged();
    expect(requests).toHaveLength(0);
  });

  it.each([
    ["removed credential", () => { delete process.env.HASNA_EMAILS_API_KEY; }],
    ["blank credential", () => { process.env.HASNA_EMAILS_API_KEY = " "; }],
    ["conflicting aliases", () => { process.env.EMAILS_API_KEY = "fixture-conflict"; }],
    ["removed endpoint", () => { delete process.env.HASNA_EMAILS_API_URL; }],
    ["invalid endpoint", () => { process.env.HASNA_EMAILS_API_URL = "https://user:pass@example.com"; }],
    ["retired selector", () => { process.env.EMAILS_MODE = "self_hosted"; }],
    ["client DSN", () => { process.env.DATABASE_URL = "postgres://synthetic.invalid/test"; }],
  ] as const)("rejects %s before cache reuse or dispatch", async (_name, invalidate) => {
    const first = resolveMailDataSource();
    await first.listLabelSummaries();
    const before = requests.length;
    invalidate();
    expect(() => resolveMailDataSource()).toThrow();
    expect(requests).toHaveLength(before);
    for (const key of keys) delete process.env[key];
    process.env.HASNA_EMAILS_API_URL = "https://one.example";
    process.env.HASNA_EMAILS_API_KEY = "synthetic-key-one";
    expect(resolveMailDataSource()).not.toBe(first);
  });
});
