import { describe, expect, test } from "bun:test";
import { resolvePublicOrigin, sanitizeHost } from "./request-origin.js";

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("resolvePublicOrigin", () => {
  test("honors x-forwarded-proto https override behind the gateway", () => {
    // The api.hasna.com gateway sets x-forwarded-proto: https; the origin must
    // emit https links even though the transport hop was internal.
    const origin = resolvePublicOrigin({
      headers: headers({ "x-forwarded-proto": "https", host: "todos.hasna.xyz" }),
    });
    expect(origin).toBe("https://todos.hasna.xyz");
  });

  test("ignores a bogus or missing x-forwarded-proto and falls back", () => {
    expect(
      resolvePublicOrigin({ headers: headers({ "x-forwarded-proto": "javascript", host: "a.test" }) }),
    ).toBe("http://a.test");
    expect(
      resolvePublicOrigin({
        headers: headers({ "x-forwarded-proto": "https://evil", host: "a.test" }),
        defaultProtocol: "https",
      }),
    ).toBe("https://a.test");
    expect(
      resolvePublicOrigin({ headers: headers({ host: "a.test" }) }),
    ).toBe("http://a.test");
  });

  test("uses the sanitized Host header when no forwarding headers are present", () => {
    expect(
      resolvePublicOrigin({ headers: headers({ host: "localhost:8787" }) }),
    ).toBe("http://localhost:8787");
    expect(
      resolvePublicOrigin({ headers: headers({ host: " has.na " }) }),
    ).toBe("http://has.na");
  });

  test("x-forwarded-host is only honored when the hop is trusted", () => {
    const forwarded = { "x-forwarded-host": "api.hasna.com", host: "internal.test" };
    // Not trusted: the client-supplied Host wins (sanitized).
    expect(resolvePublicOrigin({ headers: headers({ ...forwarded }) })).toBe("http://internal.test");
    // Trusted: the proxy-set host wins.
    expect(
      resolvePublicOrigin({ headers: headers({ ...forwarded }), trustForwardedHost: true }),
    ).toBe("http://api.hasna.com");
  });

  test("host presence sanitization blocks abusive header values", () => {
    for (const evil of [
      "a.test/../admin",
      "a.test?x=1",
      "a.test#frag",
      "user@a.test",
      "a..b.test",
      "-evil.test",
      "evil-.test",
    ]) {
      // Rejected outright — never half-sanitized into a link.
      expect(resolvePublicOrigin({ headers: headers({ host: evil }) })).toBeNull();
    }

    // A comma-joined Host resolves through the first segment only.
    expect(
      resolvePublicOrigin({ headers: headers({ host: "a.test, b.test" }) }),
    ).toBe("http://a.test");

    // CRLF/control-character smuggling is rejected at the sanitizer boundary
    // (Bun's Headers already refuses to construct such values, but raw
    // wire-decoded headers reach the server code path through other readers).
    for (const evil of [
      "a.test\r\nX-Evil: 1",
      "a.test\nevil",
      "a.test\tb",
    ]) {
      expect(sanitizeHost(evil)).toBeNull();
    }

    // Oversized hosts are rejected outright.
    expect(
      resolvePublicOrigin({ headers: headers({ host: `${"x".repeat(254)}.test` }) }),
    ).toBeNull();
  });

  test("falls back to the default host and protocol", () => {
    expect(
      resolvePublicOrigin({ headers: headers({}), defaultHost: "localhost:8787" }),
    ).toBe("http://localhost:8787");
    expect(
      resolvePublicOrigin({ headers: headers({}), defaultHost: "localhost:8787", defaultProtocol: "https" }),
    ).toBe("https://localhost:8787");
    expect(resolvePublicOrigin({ headers: headers({}) })).toBeNull();
  });

  test("takes the first comma segment of a multi-hop forwarding header", () => {
    const origin = resolvePublicOrigin({
      headers: headers({ "x-forwarded-proto": "https, http", host: "api.hasna.com" }),
      trustForwardedHost: true,
    });
    expect(origin).toBe("https://api.hasna.com");
  });
});

describe("sanitizeHost", () => {
  test("accepts hostnames, IPs, ports and localhost", () => {
    expect(sanitizeHost("api.hasna.com")).toBe("api.hasna.com");
    expect(sanitizeHost("has.na")).toBe("has.na");
    expect(sanitizeHost("localhost")).toBe("localhost");
    expect(sanitizeHost("127.0.0.1:19427")).toBe("127.0.0.1:19427");
    expect(sanitizeHost("[2001:db8::1]:8080")).toBe("[2001:db8::1]:8080");
    expect(sanitizeHost("x.y.123")).toBe("x.y.123");
  });

  test("rejects junk, control characters and oversized values", () => {
    for (const bad of [
      "",
      "   ",
      "a b.test",
      "a\tb.test",
      "a\nb.test",
      "a\rb.test",
      "a/b.test",
      "a@b.test",
      "a?b",
      "a#b",
      ":::", // malformed IPv6
      "999.1.1.1",
      "a.test:70000", // port out of range
      "a.test:notaport",
      `${"y".repeat(254)}.test`,
      "a\n.set",
    ]) {
      expect(sanitizeHost(bad)).toBeNull();
    }
  });
});