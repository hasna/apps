import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { TokenKind } from "../tenancy/types.js";

/**
 * Opaque bearer tokens. The plaintext is returned to the caller exactly once;
 * only its sha256 is persisted. Prefixes match the platform-personalnotes
 * control plane (`pn_` for API keys) so the app/CLI experience is consistent.
 */

export const SESSION_TOKEN_PREFIX = "pn_sess_";
export const API_TOKEN_PREFIX = "pn_";

export function generateToken(kind: TokenKind): { token: string; tokenHash: string } {
  const raw = randomBytes(32).toString("base64url");
  const token = kind === "session" ? `${SESSION_TOKEN_PREFIX}${raw}` : `${API_TOKEN_PREFIX}${raw}`;
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenKindOf(token: string): TokenKind | null {
  if (token.startsWith(SESSION_TOKEN_PREFIX)) return "session";
  // API keys share the `pn_` prefix; classify anything else `pn_*` as an API token.
  if (token.startsWith(API_TOKEN_PREFIX)) return "api";
  return null;
}

/** Constant-time comparison of two hex digests. */
export function safeHashEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Extract a bearer token from an `Authorization: Bearer <t>` header (or `X-Api-Key`). */
export function extractBearer(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match?.[1]) return match[1].trim();
  }
  const apiKey = headers.get("x-api-key");
  if (apiKey?.trim()) return apiKey.trim();
  return null;
}
