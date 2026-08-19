// Sol-guided coverage (tests-coverage-sol workflow, lane controls) — Priority 2:
// HTTP rate limiting and CORS (src/server/app.ts).
//
// Rate-limit key derivation must use a TRUSTED source: the real socket peer
// address (Bun.serve `requestIP`, injected here through the Hono env) or the
// RIGHTMOST X-Forwarded-For hop appended by a trusted proxy. The leftmost XFF
// entries are client-supplied and spoofable — a changed leftmost value must
// NEVER mint a fresh bucket.
//
// The rate-limit window is 60s and the bucket map is per test-process; every
// test case uses its own socket address so buckets never bleed across tests.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createApp } from "../src/server/app.js";

type TestEnv = { requestIP: (req: Request) => { address?: string } | null };

let app: ReturnType<typeof createApp>;

const ORIGIN_ALLOWLIST = "https://app.example.com, https://second.example.com";

function envFor(address: string): TestEnv {
  return { requestIP: () => ({ address }) };
}

function expectRateLimited(res: Response): Promise<void> {
  return res.json().then((body) => {
    expect(res.status).toBe(429);
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.message).toBe("Too many requests");
  });
}

beforeAll(() => {
  process.env["HASNA_CONTROLS_RATE_LIMIT"] = "1";
  delete process.env["HASNA_CONTROLS_BIND_HOST"];
  delete process.env["HASNA_CONTROLS_DATABASE_URL"];
  delete process.env["HASNA_CONTROLS_API_CREDENTIALS"];
  delete process.env["HASNA_CONTROLS_API_KEY"];
  app = createApp();
});

afterAll(() => {
  delete process.env["HASNA_CONTROLS_RATE_LIMIT"];
  delete process.env["HASNA_CONTROLS_CORS_ORIGINS"];
  delete process.env["CONTROLS_CORS_ORIGINS"];
});

describe("http: rate limiting (max=1)", () => {
  it("the first request from a socket address succeeds and reports remaining; the second is 429 (two-sided)", async () => {
    const e1 = envFor("10.1.0.1");
    const first = await app.request("/health", {}, e1);
    expect(first.status).toBe(200);
    expect(first.headers.get("X-RateLimit-Remaining")).toBe("0");

    const second = await app.request("/health", {}, e1);
    await expectRateLimited(second);

    // A different socket address has its own bucket and is not throttled.
    const other = await app.request("/health", {}, envFor("10.1.0.2"));
    expect(other.status).toBe(200);
    expect(other.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("the 429 response itself carries the X-RateLimit-Remaining header", async () => {
    const e2 = envFor("10.1.0.10");
    await app.request("/health", {}, e2); // consume the single allowed request
    const limited = await app.request("/health", {}, e2);
    await expectRateLimited(limited);
    expect(limited.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("a trusted requestIP wins over a rotated X-Forwarded-For chain (no fresh bucket)", async () => {
    const e3 = envFor("10.2.0.1");
    const first = await app.request("/health", { headers: { "X-Forwarded-For": "6.6.6.6, 7.7.7.7" } }, e3);
    expect(first.status).toBe(200);
    // Attacker rotates the entire XFF chain; the bucket must still be the socket address.
    const second = await app.request("/health", { headers: { "X-Forwarded-For": "8.8.8.8, 9.9.9.9" } }, e3);
    await expectRateLimited(second);
  });

  it("without requestIP the RIGHTMOST XFF hop keys the bucket; a spoofed leftmost hop cannot mint a fresh bucket (two-sided)", async () => {
    // No env → no requestIP → XFF fallback. Both requests share the rightmost 7.7.7.7.
    const first = await app.request("/health", { headers: { "X-Forwarded-For": "6.6.6.6, 7.7.7.7" } });
    expect(first.status).toBe(200);
    const second = await app.request("/health", { headers: { "X-Forwarded-For": "6.6.6.6, 7.7.7.7" } });
    await expectRateLimited(second);
    // Spoof a NEW leftmost hop only: the rightmost 7.7.7.7 is unchanged → still 429.
    const spoofedLeft = await app.request("/health", { headers: { "X-Forwarded-For": "5.5.5.5, 7.7.7.7" } });
    await expectRateLimited(spoofedLeft);
    // A genuinely new rightmost hop (a new trusted proxy hop) gets a fresh bucket.
    const newHop = await app.request("/health", { headers: { "X-Forwarded-For": "9.9.9.9" } });
    expect(newHop.status).toBe(200);
  });
});

describe("http: CORS", () => {
  beforeEach(() => {
    process.env["HASNA_CONTROLS_CORS_ORIGINS"] = ORIGIN_ALLOWLIST;
  });

  it("emits no CORS headers when no Origin is present", async () => {
    const res = await app.request("/health", {}, envFor("10.3.0.1"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("denies an unlisted Origin (no Access-Control-Allow-Origin at all)", async () => {
    const res = await app.request("/health", { headers: { Origin: "https://evil.example.com" } }, envFor("10.3.0.2"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("echoes an allowlisted Origin exactly — never a wildcard", async () => {
    const res = await app.request("/health", { headers: { Origin: "https://app.example.com" } }, envFor("10.3.0.3"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("a second allowlisted origin is honored", async () => {
    const res = await app.request("/health", { headers: { Origin: "https://second.example.com" } }, envFor("10.3.0.4"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://second.example.com");
  });

  it("preflight for an allowlisted Origin answers 204 with the allow headers", async () => {
    const res = await app.request(
      "/health",
      { method: "OPTIONS", headers: { Origin: "https://app.example.com" } },
      envFor("10.3.0.5"),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
  });

  it("preflight for an unlisted Origin answers 204 WITHOUT any CORS allow headers", async () => {
    const res = await app.request(
      "/health",
      { method: "OPTIONS", headers: { Origin: "https://evil.example.com" } },
      envFor("10.3.0.6"),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Methods")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Headers")).toBeNull();
  });
});
