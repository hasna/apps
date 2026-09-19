import { describe, expect, test } from "bun:test";
import { resolvePublicOrigin } from "./request-origin.js";

function headers(values: Record<string, string>) {
  const normalized = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => normalized.get(name.toLowerCase()) ?? null };
}

describe("has.na public edge origin", () => {
  test("prefers normalized hasna public host/proto", () => {
    expect(resolvePublicOrigin({
      headers: headers({
        "x-hasna-public-host": "Go.Example.COM:443",
        "x-hasna-public-proto": "https",
        "x-forwarded-host": "api.hasna.com",
        host: "internal.example",
      }),
      trustHasnaPublicHost: true,
      trustForwardedHost: true,
    })).toBe("https://go.example.com:443");
  });

  test("rejects malformed public hints and falls back safely", () => {
    expect(resolvePublicOrigin({
      headers: headers({
        "x-hasna-public-host": "evil.example/path",
        "x-hasna-public-proto": "javascript",
        "x-forwarded-host": "api.hasna.com",
        "x-forwarded-proto": "https",
      }),
      trustHasnaPublicHost: true,
      trustForwardedHost: true,
    })).toBe("https://api.hasna.com");
  });
});
