/**
 * Secret TTL is an access-control boundary, not just a garbage-collection hint.
 * Invalid stored expiry values also fail closed: a malformed record must never
 * become indefinitely readable because its timestamp cannot be parsed.
 */
export function isSecretExpired(expiresAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!expiresAt) return false;
  const expiryMs = Date.parse(expiresAt);
  return Number.isNaN(expiryMs) || expiryMs <= nowMs;
}
