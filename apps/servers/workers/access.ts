/** Cloudflare Access JWT validation. The signing keys are loaded only from the configured team. */
export interface AccessConfig {
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

type AccessJwk = JsonWebKey & { kid?: string };
export type AccessFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type KeyCache = { keys: AccessJwk[]; expiresAt: number; refreshAfter: number };
const CACHE_MS = 300_000;
const REFRESH_COOLDOWN_MS = 30_000;

export function accessIssuer(value: unknown): string {
  if (typeof value !== "string") throw new Error("Missing Access team domain");
  const issuer = value.replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer)) {
    throw new Error("Invalid Access team domain");
  }
  return issuer;
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid JWT encoding");
  const bytes = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

function decodeJson(value: string): Record<string, unknown> {
  const decoded = JSON.parse(new TextDecoder().decode(decode(value)));
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("Invalid JWT");
  return decoded;
}

export function createAccessVerifier(fetcher: AccessFetcher = fetch, now = Date.now) {
  const cache = new Map<string, KeyCache>();
  const pending = new Map<string, Promise<KeyCache>>();

  async function getKeys(issuer: string, kid: string): Promise<AccessJwk[]> {
    const previous = cache.get(issuer);
    if (previous && previous.expiresAt > now() &&
        (previous.keys.some((key) => key.kid === kid) || previous.refreshAfter > now())) return previous.keys;
    let request = pending.get(issuer);
    if (!request) {
      request = (async () => {
        const response = await fetcher(`${issuer}/cdn-cgi/access/certs`, {
          // Workers supports follow/manual; reject redirect responses below without following them.
          redirect: "manual", signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error("Access keys unavailable");
        const jwks = await response.json() as { keys?: unknown };
        if (!Array.isArray(jwks.keys) || jwks.keys.length > 50) throw new Error("Invalid Access keys");
        const keys = jwks.keys.filter((value): value is AccessJwk =>
          value !== null && typeof value === "object" && value.kty === "RSA" && typeof value.kid === "string" &&
          (value.use === undefined || value.use === "sig") && (value.alg === undefined || value.alg === "RS256"));
        const entry = { keys, expiresAt: now() + CACHE_MS, refreshAfter: now() + REFRESH_COOLDOWN_MS };
        cache.set(issuer, entry);
        return entry;
      })();
      pending.set(issuer, request);
    }
    try { return (await request).keys; }
    finally { pending.delete(issuer); }
  }

  return async function verifyAccess(request: Request, config: AccessConfig): Promise<boolean> {
    try {
      const issuer = accessIssuer(config.ACCESS_TEAM_DOMAIN);
      if (typeof config.ACCESS_AUD !== "string" || !config.ACCESS_AUD) return false;
      const token = request.headers.get("cf-access-jwt-assertion");
      if (!token || token.length > 16_384) return false;
      const parts = token.split(".");
      if (parts.length !== 3) return false;
      const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
      const header = decodeJson(encodedHeader);
      const payload = decodeJson(encodedPayload);
      if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length > 200 || header.crit !== undefined) return false;
      const current = now() / 1000;
      if (payload.iss !== issuer || typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= current) return false;
      if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf) || payload.nbf > current)) return false;
      if (payload.iat !== undefined && (typeof payload.iat !== "number" || !Number.isFinite(payload.iat) || payload.iat > current)) return false;
      const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!audiences.includes(config.ACCESS_AUD)) return false;
      const keys = await getKeys(issuer, header.kid);
      const candidates = keys.filter((key) => key.kid === header.kid);
      if (candidates.length !== 1) return false;
      const key = await crypto.subtle.importKey("jwk", candidates[0]!, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(encodedSignature), new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`));
    } catch { return false; }
  };
}
