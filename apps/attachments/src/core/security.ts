import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { basename } from "path";
import { nanoid } from "nanoid";

export function generateShareToken(): string {
  return nanoid(32);
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sanitizeFilename(filename: string): string {
  const base = basename(filename).replace(/[\x00-\x1f\x7f]/g, "").trim();
  const safe = base.replace(/[\\/]/g, "-").replace(/\s+/g, " ");
  return safe || "attachment";
}

/**
 * Object keys are now content-addressed via src/core/artifact-keys.ts
 * (canonicalBlobKey/stagingKey/manifestKey). Key construction moved there so
 * one module owns the layout; nothing in this app mints a legacy
 * date/id-partitioned key any more.
 */

export function buildPasswordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPasswordHash(password: string, encodedHash: string | null): boolean {
  if (!encodedHash) return true;
  const [scheme, salt, expectedHex] = encodedHash.split("$");
  if (scheme !== "scrypt" || !salt || !expectedHex) return false;
  const actual = Buffer.from(scryptSync(password, salt, 32).toString("hex"), "utf-8");
  const expected = Buffer.from(expectedHex, "utf-8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function contentDispositionAttachment(filename: string): string {
  const safe = sanitizeFilename(filename).replace(/["\\]/g, "");
  // RFC 6266: the quoted `filename` fallback must be ISO-8859-1-safe. A raw
  // "raport-anexă.txt" is not a legal HTTP header value and made the runtime
  // throw while writing the header — turning every download of a file with
  // diacritics into a 500. The exact name still travels in `filename*`.
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_") || "attachment";
  const encoded = encodeURIComponent(safe).replace(/['()]/g, escape);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Lowercase + trim an email for consistent comparison/storage. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Pragmatic RFC-5322-ish email validation: one @, non-empty local part, dotted domain. */
export function isValidEmail(email: string): boolean {
  const value = email.trim();
  if (value.length === 0 || value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
