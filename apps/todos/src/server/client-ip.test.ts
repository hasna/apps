import { describe, expect, test } from "bun:test";
import {
  isTrustedAddress,
  normalizeIpLiteral,
  parseForwardedFor,
  parseTrustedProxies,
  resolveRequestClientIp,
  resolveTrustProxy,
  trustedProxiesFromEnv,
} from "./client-ip.js";

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

// Addresses used by the fixtures: the gateway worker overwrites x-real-ip with
// cf-connecting-ip, the ALB appends its socket-peer view to x-forwarded-for.
const CLIENT = "203.0.113.9";
const CF_EGRESS = "198.51.100.4";
const ALB = "10.0.0.1";

describe("resolveRequestClientIp", () => {
  test("via gateway: x-real-ip (true client) wins, spoofed XFF cannot override it", () => {
    // The gateway sets x-real-ip from cf-connecting-ip; a hostile client that
    // pre-sends a forged XFF chain must not be able to pick its own bucket.
    const ip = resolveRequestClientIp({
      headers: headers({
        "x-real-ip": CLIENT,
        "x-forwarded-for": "1.2.3.4, 111.222.333.444, 5.6.7.8, " + CF_EGRESS,
      }),
      socketAddress: ALB,
      trustProxy: true,
      trustedProxies: parseTrustedProxies([CF_EGRESS, ALB].join(",")),
    });
    expect(ip).toBe(CLIENT);
  });

  test("via gateway, no x-real-ip: first untrusted XFF entry from the right", () => {
    // Client -> Cloudflare worker -> ALB: XFF carries [client, cf-egress]; the
    // trusted-proxy walk steps over the egress and lands on the visitor.
    const ip = resolveRequestClientIp({
      headers: headers({ "x-forwarded-for": `${CLIENT}, ${CF_EGRESS}` }),
      socketAddress: ALB,
      trustProxy: true,
      trustedProxies: parseTrustedProxies(`${CF_EGRESS}/32, ${ALB}/32`),
    });
    expect(ip).toBe(CLIENT);
  });

  test("direct to the ALB: rightmost XFF entry is the visitor", () => {
    const ip = resolveRequestClientIp({
      headers: headers({ "x-forwarded-for": CLIENT }),
      socketAddress: ALB,
      trustProxy: true,
      trustedProxies: parseTrustedProxies(ALB),
    });
    expect(ip).toBe(CLIENT);
  });

  test("no forwarding headers: falls back to the socket peer", () => {
    const ip = resolveRequestClientIp({
      headers: headers({}),
      socketAddress: ALB,
      trustProxy: true,
      trustedProxies: parseTrustedProxies(ALB),
    });
    expect(ip).toBe(ALB);
  });

  test("trust off (default): forwarding headers are ignored, socket wins", () => {
    // Local/dev behavior: Bun.serve never sets these headers for direct
    // connections, and trusting them by default would be a spoofing hole.
    expect(
      resolveRequestClientIp({
        headers: headers({ "x-forwarded-for": "66.66.66.66", "x-real-ip": "66.66.66.66" }),
        socketAddress: CLIENT,
        trustProxy: false,
        trustedProxies: [],
      }),
    ).toBe(CLIENT);
    expect(
      resolveRequestClientIp({
        headers: headers({}),
        socketAddress: CLIENT,
        trustProxy: undefined,
        trustedProxies: [],
      }),
    ).toBe(CLIENT);
  });

  test("malformed/abusive XFF is handled safely", () => {
    // Garbage entries are dropped and can never become a bucket key; the walk
    // lands on the first valid untrusted entry left of the trusted egress.
    const ip = resolveRequestClientIp({
      headers: headers({ "x-forwarded-for": `</script>, 999.1.1.1, 1.2.3.4.5, ${CLIENT}, ${CF_EGRESS}` }),
      socketAddress: ALB,
      trustProxy: true,
      trustedProxies: parseTrustedProxies(`${CF_EGRESS}/32, ${ALB}/32`),
    });
    expect(ip).toBe(CLIENT);

    // With only garbage present the resolver must not crash and must fall back
    // to the socket peer rather than emitting junk.
    const fallback = resolveRequestClientIp({
      headers: headers({ "x-forwarded-for": "not-an-ip, 999.999.999.999" }),
      socketAddress: ALB,
      trustProxy: true,
      trustedProxies: parseTrustedProxies(ALB),
    });
    expect(fallback).toBe(ALB);

    // A chain consisting solely of trusted proxies yields the far end of the
    // trusted run — a valid literal, never attacker-supplied garbage.
    const trustedOnly = resolveRequestClientIp({
      headers: headers({ "x-forwarded-for": `${CF_EGRESS}` }),
      socketAddress: ALB,
      trustProxy: true,
      trustedProxies: parseTrustedProxies(`${CF_EGRESS}/32, ${ALB}/32`),
    });
    expect(trustedOnly).toBe(CF_EGRESS);
  });

  test("spoofed trailing garbage and empty chain resolve to the socket peer", () => {
    const ip = resolveRequestClientIp({
      headers: headers({ "x-forwarded-for": " ,,  " }),
      socketAddress: ALB,
      trustProxy: true,
      trustedProxies: parseTrustedProxies(ALB),
    });
    expect(ip).toBe(ALB);
  });

  test("all-trusted chain degrades to the leftmost entry, never a header-free crash", () => {
    const ip = resolveRequestClientIp({
      headers: headers({ "x-forwarded-for": `${CF_EGRESS}, ${ALB}` }),
      socketAddress: ALB,
      trustProxy: true,
      trustedProxies: parseTrustedProxies(`${CF_EGRESS}, ${ALB}`),
    });
    expect(ip).toBe(CF_EGRESS);
  });

  test("missing socket address is tolerated", () => {
    expect(
      resolveRequestClientIp({
        headers: headers({}),
        socketAddress: null,
        trustProxy: true,
        trustedProxies: [],
      }),
    ).toBe(null);
  });
});

describe("header parsing", () => {
  test("normalizeIpLiteral accepts v4, v6, bracketed, ported, mapped forms", () => {
    expect(normalizeIpLiteral("203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeIpLiteral("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeIpLiteral("[2001:db8::1]")).toBe("2001:db8::1");
    expect(normalizeIpLiteral("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIpLiteral("1.2.3.4:9999")).toBe("1.2.3.4");
    expect(normalizeIpLiteral("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  test("normalizeIpLiteral rejects junk, leading zeros, out-of-range octets", () => {
    for (const bad of ["", "banana", "203.0.113", "203.0.113.9.1", "999.1.1.1", "01.2.3.4",
      "256.0.0.1", "2001:db8:::1", "1.2.3.4:notaport", "   ", "a.b.c.d"]) {
      expect(normalizeIpLiteral(bad)).toBe(null);
    }
  });

  test("parseForwardedFor splits, trims and validates", () => {
    expect(parseForwardedFor("1.2.3.4, 5.6.7.8")).toEqual(["1.2.3.4", "5.6.7.8"]);
    expect(parseForwardedFor("1.2.3.4, banana, 5.6.7.8")).toEqual(["1.2.3.4", "5.6.7.8"]);
    expect(parseForwardedFor(null)).toEqual([]);
    expect(parseForwardedFor("")).toEqual([]);
  });

  test("parseTrustedProxies keeps valid IPs/CIDRs and drops garbage", () => {
    expect(parseTrustedProxies("10.0.0.0/8, 198.51.100.4, 2001:db8::/32")).toEqual([
      "10.0.0.0/8",
      "198.51.100.4",
      "2001:db8::/32",
    ]);
    expect(parseTrustedProxies("10.0.0.0/33, banana, 999.1.1.1, 10.0.0.0/8")).toEqual([
      "10.0.0.0/8",
    ]);
    expect(parseTrustedProxies(undefined)).toEqual([]);
  });

  test("isTrustedAddress matches exactly and inside CIDR blocks", () => {
    const trusted = parseTrustedProxies("198.51.100.0/24, 10.0.0.1, 2001:db8::/32");
    expect(isTrustedAddress("198.51.100.4", trusted)).toBe(true);
    expect(isTrustedAddress("198.51.100.255", trusted)).toBe(true);
    expect(isTrustedAddress("198.51.101.1", trusted)).toBe(false);
    expect(isTrustedAddress("10.0.0.1", trusted)).toBe(true);
    expect(isTrustedAddress("10.0.0.2", trusted)).toBe(false);
    expect(isTrustedAddress("2001:db8:1::42", trusted)).toBe(true);
    expect(isTrustedAddress("2001:db9::1", trusted)).toBe(false);
    expect(isTrustedAddress("junk", trusted)).toBe(false);
  });

  test("env wiring: trust flag and trusted-proxy CSV", () => {
    expect(resolveTrustProxy({})).toBe(false);
    expect(resolveTrustProxy({ TODOS_TRUST_PROXY: "1" })).toBe(true);
    expect(resolveTrustProxy({ TODOS_TRUST_PROXY: "true" })).toBe(true);
    expect(resolveTrustProxy({ TODOS_TRUST_PROXY: "0" })).toBe(false);
    expect(resolveTrustProxy({ TODOS_TRUST_PROXY: "banana" })).toBe(false);
    expect(trustedProxiesFromEnv({})).toEqual([]);
    expect(trustedProxiesFromEnv({ TODOS_TRUSTED_PROXIES: "10.0.0.0/8, banana" })).toEqual([
      "10.0.0.0/8",
    ]);
  });
});