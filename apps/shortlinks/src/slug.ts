import { randomBytes } from "node:crypto";

/** Public default when a caller does not select a custom domain. */
export const DEFAULT_DOMAIN_HOSTNAME = "has.na";

/** Case-sensitive alphabet used only for generated public codes. */
export const SLUG_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** Generated codes start short and grow only after repeated collisions. */
export const DEFAULT_SLUG_LENGTH = 3;
export const MAX_GENERATED_SLUG_LENGTH = 96;
export const COLLISION_ATTEMPTS_PER_LENGTH = 8;

export const RESERVED_PUBLIC_SLUGS = new Set([
  "a",
  "v1",
  "health",
  "healthz",
  "ready",
  "version",
  "openapi.json",
]);

export type SlugTokenFactory = (length: number) => string;

export function randomToken(length = DEFAULT_SLUG_LENGTH): string {
  if (length < 1 || length > 128) throw new Error("Token length must be between 1 and 128.");
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += SLUG_ALPHABET[bytes[i]! % SLUG_ALPHABET.length];
  }
  return out;
}

/**
 * Return the generated-code length for a zero-based collision attempt.
 * Eight atomic insert collisions at one size move allocation to the next size.
 */
export function adaptiveSlugLength(
  attempt: number,
  requestedLength = DEFAULT_SLUG_LENGTH,
): number {
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error("Attempt must be a non-negative integer.");
  const start = Math.max(DEFAULT_SLUG_LENGTH, Math.min(MAX_GENERATED_SLUG_LENGTH, Math.trunc(requestedLength)));
  return Math.min(MAX_GENERATED_SLUG_LENGTH, start + Math.floor(attempt / COLLISION_ATTEMPTS_PER_LENGTH));
}

export function normalizeGeneratedSlugLength(length?: number): number {
  if (length === undefined) return DEFAULT_SLUG_LENGTH;
  if (!Number.isFinite(length)) throw new Error("Generated slug length must be a number.");
  return Math.max(DEFAULT_SLUG_LENGTH, Math.min(MAX_GENERATED_SLUG_LENGTH, Math.trunc(length)));
}

/** Friendly aliases and generated codes share one root-path slug syntax. */
export function normalizeSlug(slug: string): string {
  const normalized = slug.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized) throw new Error("Slug is required.");
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(normalized)) {
    throw new Error("Slug can only contain letters, numbers, underscores, and dashes.");
  }
  if (RESERVED_PUBLIC_SLUGS.has(normalized.toLowerCase())) {
    throw new Error(`Reserved shortlink slug: ${normalized}`);
  }
  return normalized;
}
