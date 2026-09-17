import { afterEach, describe, expect, test } from "bun:test";
import { buildFetch } from "./serve.js";

const keys = ["HASNA_RECORDINGS_RATE_LIMIT_MAX", "RECORDINGS_RATE_LIMIT_MAX", "RECORDINGS_TRUST_PROXY"] as const;
const initial = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const key of keys) {
    if (initial[key] === undefined) delete process.env[key];
    else process.env[key] = initial[key];
  }
});

function configure(canonical?: string, legacy?: string) {
  for (const [key, value] of [[keys[0], canonical], [keys[1], legacy]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  process.env.RECORDINGS_TRUST_PROXY = "0";
}

describe("Recordings HTTP request headroom", () => {
  test("allows a default burst past 240 requests while data routes still require authentication", async () => {
    configure();
    const handler = buildFetch();
    const peer = { requestIP: () => ({ address: "203.0.113.150" }) };
    const statuses = [];
    for (let i = 0; i < 300; i++) {
      const response = await handler(new Request("http://localhost/health"), peer);
      statuses.push(response.status);
      await response.arrayBuffer();
    }
    expect(statuses.filter((status) => status !== 200)).toEqual([]);
    const denied = await handler(new Request("http://localhost/v1/recordings"), peer);
    expect([401, 503]).toContain(denied.status);
  });

  test("preserves the legacy override and refuses spoofed forwarded-header buckets", async () => {
    configure(undefined, "5");
    const handler = buildFetch();
    const peer = { requestIP: () => ({ address: "203.0.113.151" }) };
    for (let i = 0; i < 6; i++) {
      const response = await handler(new Request("http://localhost/health", {
        headers: { "x-forwarded-for": `198.51.100.${i}`, "x-real-ip": `198.51.100.${i}` },
      }), peer);
      expect(response.status).toBe(i < 5 ? 200 : 429);
      if (i === 5) {
        const body = await response.json() as { retry_after: number };
        expect(body.retry_after).toBeGreaterThan(0);
        expect(response.headers.get("retry-after")).toBe(String(body.retry_after));
      }
    }
  });

  test("uses canonical override ahead of legacy and excludes OPTIONS", async () => {
    configure("1", "5");
    const handler = buildFetch();
    const peer = { requestIP: () => ({ address: "203.0.113.152" }) };
    expect((await handler(new Request("http://localhost/health", { method: "OPTIONS" }), peer)).status).toBe(200);
    expect((await handler(new Request("http://localhost/health"), peer)).status).toBe(200);
    expect((await handler(new Request("http://localhost/health"), peer)).status).toBe(429);
  });

  test("refuses malformed configuration before a handler can accept requests", () => {
    configure("NaN", "5");
    expect(() => buildFetch()).toThrow("HASNA_RECORDINGS_RATE_LIMIT_MAX");
  });
});
