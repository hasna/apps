import { beforeAll, describe, expect, test } from "bun:test";
import { createAccessVerifier, type AccessFetcher } from "./access";

let keys: CryptoKeyPair;
let publicKey: JsonWebKey;
const issuer = "https://example.cloudflareaccess.com";
const audience = "example-audience";
const now = 1_800_000_000_000;
const config = { ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: audience };

beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
});

function encode(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function signed(payload: Record<string, unknown> = {}, header: Record<string, unknown> = {}): Promise<string> {
  const data = `${encode(JSON.stringify({ alg: "RS256", kid: "current", ...header }))}.${encode(JSON.stringify({
    iss: issuer, aud: [audience], iat: now / 1000 - 1, exp: now / 1000 + 120, ...payload,
  }))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(data));
  return `${data}.${encode(new Uint8Array(signature))}`;
}

function request(token: string): Request {
  return new Request("https://studio-web.example.workers.dev/", { headers: { "cf-access-jwt-assertion": token } });
}

function fixture() {
  let clock = now;
  let hits = 0;
  let kid = "current";
  const fetcher = (async (url: string | URL | Request, options?: RequestInit) => {
    hits++;
    expect(String(url)).toBe(`${issuer}/cdn-cgi/access/certs`);
    expect(options?.redirect).toBe("manual");
    return Response.json({ keys: [{ ...publicKey, kid }] });
  }) satisfies AccessFetcher;
  return {
    verify: createAccessVerifier(fetcher, () => clock), hits: () => hits,
    setClock: (value: number) => { clock = value; }, setKid: (value: string) => { kid = value; },
  };
}

describe("Cloudflare Access signature validation", () => {
  test("verifies signed tokens and caches trusted team keys", async () => {
    const { verify, hits } = fixture();
    const token = await signed();
    expect(await verify(request(token), config)).toBe(true);
    expect(await verify(request(token), config)).toBe(true);
    expect(hits()).toBe(1);
  });

  test("rejects forged signature despite plausible issuer and audience", async () => {
    const { verify } = fixture();
    const token = await signed();
    const parts = token.split(".");
    parts[1] = encode(JSON.stringify({ iss: issuer, aud: [audience], exp: now / 1000 + 300, email: "forged@example.com" }));
    expect(await verify(request(parts.join(".")), config)).toBe(false);
  });

  test("rejects none/HS256/critical JWT headers and malformed token", async () => {
    const { verify, hits } = fixture();
    for (const header of [{ alg: "none" }, { alg: "HS256" }, { crit: ["b64"] }]) {
      expect(await verify(request(await signed({}, header)), config)).toBe(false);
    }
    expect(await verify(request("not.a.jwt"), config)).toBe(false);
    expect(hits()).toBe(0);
  });

  test("checks issuer, audience, expiration, not-before and issue time", async () => {
    const { verify, hits } = fixture();
    for (const payload of [
      { iss: "https://attacker.cloudflareaccess.com" }, { aud: ["other-app"] },
      { exp: now / 1000 }, { exp: "later" }, { nbf: now / 1000 + 1 }, { iat: now / 1000 + 1 },
    ]) expect(await verify(request(await signed(payload)), config)).toBe(false);
    expect(hits()).toBe(0);
    expect(await verify(request(await signed({ aud: audience })), config)).toBe(true);
  });

  test("does not trust arbitrary key endpoints or missing Access config", async () => {
    const { verify, hits } = fixture();
    const token = await signed();
    expect(await verify(request(token), { ...config, ACCESS_TEAM_DOMAIN: "http://127.0.0.1" })).toBe(false);
    expect(await verify(request(token), { ...config, ACCESS_AUD: "" })).toBe(false);
    expect(await verify(new Request("https://example.com"), config)).toBe(false);
    expect(hits()).toBe(0);
  });

  test("refreshes rotated keys with a cooldown against unknown-kid request storms", async () => {
    const { verify, hits, setClock, setKid } = fixture();
    expect(await verify(request(await signed()), config)).toBe(true);
    setKid("rotated");
    const rotated = await signed({}, { kid: "rotated" });
    expect(await verify(request(rotated), config)).toBe(false);
    expect(hits()).toBe(1);
    setClock(now + 31_000);
    expect(await verify(request(rotated), config)).toBe(true);
    expect(hits()).toBe(2);
  });

  test("concurrent verification shares one key request and fails closed on key outage", async () => {
    const { verify, hits } = fixture();
    const token = await signed();
    expect(await Promise.all(Array.from({ length: 8 }, () => verify(request(token), config)))).toEqual(Array(8).fill(true));
    expect(hits()).toBe(1);
    const failed = createAccessVerifier(async () => { throw new Error("network down"); }, () => now);
    expect(await failed(request(token), config)).toBe(false);
  });

  test("rejects JWKS redirects without following them in the Workers runtime", async () => {
    let calls = 0;
    const verify = createAccessVerifier(async (url, options) => {
      calls++;
      expect(String(url)).toBe(`${issuer}/cdn-cgi/access/certs`);
      expect(options?.redirect).toBe("manual");
      return new Response(JSON.stringify({ keys: [{ ...publicKey, kid: "current" }] }), {
        status: 302,
        headers: { location: "https://untrusted.example/keys", "content-type": "application/json" },
      });
    }, () => now);
    expect(await verify(request(await signed()), config)).toBe(false);
    expect(calls).toBe(1);
  });
});
