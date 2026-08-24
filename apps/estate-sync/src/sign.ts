/**
 * HMAC signing of the estate-sync index object (`<prefix>/index/<name>.json`).
 *
 * The signed index is the mutable pointer that names the current digest of an
 * artifact. A consumer that holds the shared signing key can prove the index it
 * read was written by a principal that knows the key, which is what stops a
 * bucket-wide-write attacker (or a mis-scoped principal) from pointing a name at
 * a digest the publisher never wrote. A signature is over a canonical rendering
 * of the index entry (sorted keys, signature field excluded) so it is
 * deterministic across writers.
 *
 * Fail-closed semantics: `verifyIndexSignature` returns false on ANY mismatch or
 * a malformed entry — a bad signature is never a pass. It is the caller's choice
 * whether an unsigned or unsigned-verifiable index is tolerated (a puller with
 * no key cannot verify, and records that honestly rather than failing the pull).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Canonical index signature schema version. */
export const INDEX_SIGNATURE_VERSION = "v1" as const;

/**
 * Deterministic canonical string for signing an index entry: the entry's own
 * JSON with sorted keys and the signature fields removed. Stable across
 * serializers because the shape is fixed.
 */
export function canonicalIndexString(entry: Record<string, unknown>): string {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(entry).sort()) {
    if (key === "signature" || key === "signingKeyId") continue;
    const value = entry[key];
    if (value === undefined) continue;
    copy[key] = value;
  }
  return `${JSON.stringify(copy)}\n`;
}

export function signIndex(entry: Record<string, unknown>, signingKey: string): string {
  return createHmac("sha256", signingKey).update(canonicalIndexString(entry)).digest("hex");
}

export function verifyIndexSignature(entry: Record<string, unknown>, signingKey: string): boolean {
  const signature = entry.signature;
  if (typeof signature !== "string" || signature.length === 0) return false;
  const expected = createHmac("sha256", signingKey).update(canonicalIndexString(entry)).digest();
  const actual = Buffer.from(signature, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
