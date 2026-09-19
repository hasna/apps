/**
 * Retention TTL grammar and the `expiresAt` contract.
 *
 * Two fleet contracts are reused here (copied semantics, not imports — neither
 * is a published subpath):
 *
 *  - the TTL grammar `parseExpiry("30d"|"24h"|"never")`
 *    (`apps/attachments/src/core/config.ts:247-278`), used by `trash config set`
 *    and by `trash purge --older-than`;
 *  - "store BOTH the intent (`days`) and a precomputed absolute `expiresAt`
 *    (`null` = never), rejecting negative/non-finite at write time"
 *    (`apps/todos/src/lib/artifact-store.ts:24-32,107-112`).
 */

/** Parse `30d` / `24h` / `45m` / `never` into milliseconds. `null` = never or unparseable. */
export function parseExpiry(expiry: string): number | null {
  if (expiry === "never") return null;

  const match = /^(\d+)(m|h|d)$/.exec(expiry.trim());
  if (!match) return null;

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;
  if (value <= 0) return null;

  switch (unit) {
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

export function parseExpiryStrict(expiry: string): { milliseconds: number | null; never: boolean } {
  const trimmed = expiry.trim();
  if (trimmed === "never") return { milliseconds: null, never: true };
  const milliseconds = parseExpiry(trimmed);
  if (milliseconds === null) {
    throw new Error(`Invalid expiry format: ${expiry}. Use values like 30m, 24h, 7d, or never.`);
  }
  return { milliseconds, never: false };
}

/** Days → ISO timestamp added to `from`; `null` days = never (`null` expiresAt). */
export function retentionExpiresAt(from: string, retentionDays: number | null | undefined): string | null {
  if (retentionDays === null || retentionDays === undefined) return null;
  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    throw new Error("retentionDays must be a non-negative finite number (or null for never)");
  }
  const expires = new Date(from);
  if (Number.isNaN(expires.getTime())) throw new Error(`invalid timestamp: ${from}`);
  expires.setUTCDate(expires.getUTCDate() + retentionDays);
  return expires.toISOString();
}

/** True when an entry's retention window has elapsed. `null` expiresAt never expires. */
export function isExpired(expiresAt: string | null, now: number = Date.now()): boolean {
  if (expiresAt === null) return false;
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return false;
  return at <= now;
}

/** Age in ms from an immutable ISO timestamp — the reaper never keys off file mtime (§6/§12). */
export function ageMs(capturedAt: string, now: number = Date.now()): number {
  const at = Date.parse(capturedAt);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, now - at);
}
