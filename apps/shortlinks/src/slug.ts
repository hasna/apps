import { randomBytes } from "node:crypto";

export const SLUG_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const DEFAULT_SLUG_LENGTH = 7;

export function randomToken(length = DEFAULT_SLUG_LENGTH): string {
  if (length < 1 || length > 128) throw new Error("Token length must be between 1 and 128.");
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += SLUG_ALPHABET[bytes[i]! % SLUG_ALPHABET.length];
  }
  return out;
}

export function normalizeSlug(slug: string): string {
  const normalized = slug.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized) throw new Error("Slug is required.");
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(normalized)) {
    throw new Error("Slug can only contain letters, numbers, underscores, and dashes.");
  }
  return normalized;
}
