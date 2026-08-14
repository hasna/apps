import { createHash, randomBytes } from "crypto";

/**
 * Namespace shared by the SQLite application migration and PostgreSQL SQL
 * migration. Keep this literal aligned with migration 4 in pg-migrations.ts.
 */
export const CHANNEL_ID_NAMESPACE = "hasna-conversations:channel:v1:";

/**
 * Return the deterministic identifier used only to backfill a pre-ID channel.
 * The exact stored name makes equivalent legacy stores converge while keeping
 * case-distinct historical rows collision-free.
 */
export function backfilledChannelIdForName(name: string): string {
  const digest = createHash("sha256")
    .update(`${CHANNEL_ID_NAMESPACE}${name}`)
    .digest("hex");
  return `chn_${digest.slice(0, 32)}`;
}

/** Return a new opaque channel identifier independent of its mutable name. */
export function newChannelId(): string {
  return `chn_${randomBytes(16).toString("hex")}`;
}
