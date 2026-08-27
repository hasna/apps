import { timingSafeEqual } from "node:crypto";

/** Env var holding the shared secret clients must present as `Authorization: Bearer <key>`. */
export const BRAINS_API_KEY_ENV = "HASNA_BRAINS_API_KEY";
/** Explicit local-development opt-out (defaults to authenticated). Set to "1" to disable the gate. */
export const BRAINS_ALLOW_UNAUTHENTICATED_ENV = "BRAINS_ALLOW_UNAUTHENTICATED";

export interface BrainsServerSecurityConfig {
  apiKey?: string | null;
  allowUnauthenticated: boolean;
}

export function resolveSecurityConfig(
  env: Record<string, string | undefined> = process.env,
): BrainsServerSecurityConfig {
  return {
    apiKey: env[BRAINS_API_KEY_ENV] ?? null,
    allowUnauthenticated: env[BRAINS_ALLOW_UNAUTHENTICATED_ENV] === "1",
  };
}

export function authenticate(req: Request, config: BrainsServerSecurityConfig): Response | null {
  if (config.allowUnauthenticated) return null;

  if (!config.apiKey) {
    return unauthorized(
      `Unauthorized. Set ${BRAINS_API_KEY_ENV} (or ${BRAINS_ALLOW_UNAUTHENTICATED_ENV}=1 for local development), and pass the key as an Authorization: Bearer header.`,
    );
  }

  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!timingSafeEqualStr(token, config.apiKey)) {
    return unauthorized("Unauthorized");
  }
  return null;
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Constant-time-ish self-compare on the length mismatch path so the early
    // return does not leak timing; length is not secret, but the shape matches
    // the browser server gate this pattern comes from.
    timingSafeEqualBuf(aBuf, aBuf);
    return false;
  }
  return timingSafeEqualBuf(aBuf, bBuf);
}

function timingSafeEqualBuf(a: Buffer, b: Buffer): boolean {
  return timingSafeEqual(a, b);
}
