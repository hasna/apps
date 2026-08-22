import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import {
  checkRateLimit,
  json,
  optionalQueryInteger,
  parseInteger,
  queryInteger,
  queryPage,
  rateLimitWindowCount,
  resetRateLimitWindows,
} from "./helpers.js";

describe("route integer parsing", () => {
  it("uses defaults for missing, empty, and invalid values", () => {
    expect(parseInteger(undefined, 20)).toBe(20);
    expect(parseInteger("", 20)).toBe(20);
    expect(parseInteger("nope", 20)).toBe(20);
  });

  it("truncates, clamps, and caps parsed values", () => {
    expect(parseInteger("12.9", 20)).toBe(12);
    expect(parseInteger("-10", 20, { min: 1 })).toBe(1);
    expect(parseInteger("10000", 20, { max: 1000 })).toBe(1000);
  });

  it("reads query integers consistently", () => {
    const url = new URL("http://127.0.0.1/api/emails?limit=0&offset=bad");
    expect(queryInteger(url, "limit", 50, { min: 1, max: 1000 })).toBe(1);
    expect(queryInteger(url, "missing", 50, { min: 1, max: 1000 })).toBe(50);
    expect(optionalQueryInteger(url, "offset", { min: 0 })).toBeUndefined();
    expect(optionalQueryInteger(url, "missing", { min: 0 })).toBeUndefined();
    expect(optionalQueryInteger(new URL("http://127.0.0.1/api/messages?priority=-2"), "priority", { min: 1 })).toBe(1);
  });

  it("builds bounded collection pages with defaults", () => {
    expect(queryPage(new URL("http://127.0.0.1/api/providers"), 50)).toEqual({ limit: 50, offset: 0 });
    expect(queryPage(new URL("http://127.0.0.1/api/providers?limit=0&offset=bad"), 50)).toEqual({ limit: 1, offset: 0 });
    expect(queryPage(new URL("http://127.0.0.1/api/providers?limit=5000&offset=2"), 50, 1000)).toEqual({ limit: 1000, offset: 2 });
  });
});

describe("route JSON responses", () => {
  it("does not emit wildcard CORS headers", async () => {
    const response = json({ ok: true });

    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("rate-limit windows", () => {
  afterEach(() => {
    resetRateLimitWindows();
    setSystemTime();
  });

  it("stays bounded under key rotation", () => {
    for (let i = 0; i < 12_000; i++) {
      expect(checkRateLimit(`10.0.0.${i}`, "verify", 10)).toBe(true);
    }
    expect(rateLimitWindowCount()).toBeLessThanOrEqual(10_000);
  });

  it("drops expired keys when the map is under cap pressure", () => {
    setSystemTime(new Date(1_700_000_000_000));
    for (let i = 0; i < 9_500; i++) {
      expect(checkRateLimit(`10.0.0.${i}`, "verify", 10)).toBe(true);
    }
    expect(rateLimitWindowCount()).toBe(9_500);

    // Let every window expire, then push the map over the cap with fresh keys.
    setSystemTime(new Date(1_700_000_000_000 + 61_000));
    for (let i = 0; i < 600; i++) {
      expect(checkRateLimit(`10.0.1.${i}`, "verify", 10)).toBe(true);
    }
    expect(rateLimitWindowCount()).toBe(600);
  });

  it("leaves no residue for a key whose window fully expires", () => {
    setSystemTime(new Date(1_700_000_000_000));
    expect(checkRateLimit("192.0.2.1", "verify", 10)).toBe(true);
    expect(rateLimitWindowCount()).toBe(1);

    setSystemTime(new Date(1_700_000_000_000 + 61_000));
    expect(checkRateLimit("192.0.2.1", "verify", 10)).toBe(true);
    expect(rateLimitWindowCount()).toBe(1);
  });

  it("still enforces the per-key bound within a window", () => {
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit("198.51.100.1", "verify", 10)).toBe(true);
    }
    expect(checkRateLimit("198.51.100.1", "verify", 10)).toBe(false);
    expect(checkRateLimit("198.51.100.2", "verify", 10)).toBe(true);
  });
});
