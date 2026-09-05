/**
 * The CLI transport must validate its base URL exactly like the SDK does.
 *
 * hasna/apps#1763 hardened `resolveMementosApiBase` in `src/sdk/index.ts`, but
 * the `mementos` CLI does not use `MementosClient` — it routes through
 * `src/db/api-mode.ts`, whose `normalizeBase` was still a bare string
 * concatenation with no validation. That left the whole hasna/apps#1601 defect
 * class live on the path operators actually take:
 *
 *   - `https://api.hasna.com/mementos?debug=1` resolved to
 *     `…/mementos?debug=1/v1`, so `/v1/memories` became query data and the
 *     request landed on the wrong route;
 *   - `https://user:pass@…` was preserved verbatim and would be echoed by any
 *     surface printing the endpoint (`mementos status`, `mementos doctor`);
 *   - `not a url` and `ftp://…` resolved silently instead of failing closed.
 *
 * These assert the resolved endpoint through the real exported entry point.
 */
import { describe, expect, test, afterEach } from "bun:test";

import { getConfiguredApiEnv } from "./api-mode";

const URL_KEY = "HASNA_MEMENTOS_API_URL";
const saved = process.env[URL_KEY];

afterEach(() => {
  if (saved === undefined) delete process.env[URL_KEY];
  else process.env[URL_KEY] = saved;
});

function resolve(base: string): string | null {
  process.env[URL_KEY] = base;
  return getConfiguredApiEnv().baseUrl;
}

describe("api-mode base URL resolution", () => {
  test("a path-prefixed gateway base keeps its path and gains /v1", () => {
    expect(resolve("https://api.hasna.com/mementos")).toBe("https://api.hasna.com/mementos/v1");
  });

  test("a base already carrying /v1 is not doubled", () => {
    expect(resolve("https://api.hasna.com/mementos/v1")).toBe("https://api.hasna.com/mementos/v1");
  });

  test("the legacy /api prefix is preserved rather than suffixed with /v1", () => {
    expect(resolve("https://api.hasna.com/mementos/api")).toBe("https://api.hasna.com/mementos/api");
  });

  test("a bare origin gains /v1", () => {
    expect(resolve("https://mementos.hasna.xyz")).toBe("https://mementos.hasna.xyz/v1");
  });

  test("trailing slashes do not produce a doubled separator", () => {
    expect(resolve("https://api.hasna.com/mementos///")).toBe("https://api.hasna.com/mementos/v1");
  });

  // --- fail closed rather than build a wrong-but-plausible URL -------------

  test("a query string is rejected, not concatenated into the route", () => {
    expect(() => resolve("https://api.hasna.com/mementos?debug=1")).toThrow(/userinfo, query, or fragment/);
  });

  test("a fragment is rejected", () => {
    expect(() => resolve("https://api.hasna.com/mementos#frag")).toThrow(/userinfo, query, or fragment/);
  });

  test("a bare trailing ? or # is rejected rather than concatenated into the route", () => {
    // The URL parser reports an empty search/hash for these, but the raw
    // string is what the route is built from: `…/mementos?` used to resolve
    // to `…/mementos?/v1` and `list` answered 404 instead of the clear error.
    expect(() => resolve("https://api.hasna.com/mementos?")).toThrow(/userinfo, query, or fragment/);
    expect(() => resolve("https://api.hasna.com/mementos#")).toThrow(/userinfo, query, or fragment/);
  });

  test("userinfo is rejected so credentials cannot reach a printed endpoint", () => {
    expect(() => resolve("https://user:pass@api.hasna.com/mementos")).toThrow(/userinfo, query, or fragment/);
  });

  test("a non-http(s) scheme is rejected", () => {
    expect(() => resolve("ftp://example.com/mementos")).toThrow(/absolute http\(s\) URL/);
  });

  test("a non-URL is rejected", () => {
    expect(() => resolve("not a url")).toThrow(/absolute http\(s\) URL/);
  });

  test("the rejection message never contains the credential material", () => {
    // Both branches: a well-formed URL refused for its userinfo, and one that
    // does not even parse (the parse-failure message used to quote the input).
    for (const raw of ["https://user:sup3rsecret@api.hasna.com/mementos", "https://user:sup3rsecret@"]) {
      let message = "";
      try {
        resolve(raw);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).not.toContain("sup3rsecret");
      expect(message.length).toBeGreaterThan(0);
    }
  });
});
