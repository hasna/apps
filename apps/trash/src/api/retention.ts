import { randomUUID } from "node:crypto";
import { ApiError, type Entry } from "./domain.js";
import type { PgTrashStore } from "./store.js";
import type { TrashObjects } from "./objects.js";

/**
 * Commit a deletion claim before touching immutable storage. A failed object
 * request keeps a durable deleting row; expired leases make crash recovery safe.
 * There is no bucket-wide lifecycle rule that could bypass pins or Backup holds.
 */
export async function sweepExpired(store: PgTrashStore, objects: TrashObjects, options: { now?: () => number; limit?: number; tenant?: string } = {}) {
  const now = options.now ?? Date.now; const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, "invalid_limit", "A retention batch must contain 1–100 entries.");
  const result = { expired: 0, failed: 0 };
  for (let i = 0; i < limit; i++) {
    const claim = await store.sql.begin(async (tx) => {
      const parameters: unknown[] = [new Date(now()).toISOString()];
      const tenantFilter = options.tenant === undefined ? "" : "AND tenant=$2";
      if (options.tenant !== undefined) parameters.push(options.tenant);
      const rows = await tx.unsafe(`SELECT tenant,payload FROM trash_entries WHERE (
        (state IN ('trashed','restored') AND expires_at <= $1::timestamptz AND held=false
          AND backup IN ('none','verified')
          AND COALESCE((payload->>'downloadUntil')::timestamptz, '-infinity'::timestamptz) <= $1::timestamptz)
        OR (state='deleting' AND COALESCE((payload->'deletionLease'->>'until')::timestamptz, '-infinity'::timestamptz) <= $1::timestamptz)
      ) ${tenantFilter} ORDER BY expires_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`, parameters);
      if (!rows.length) return null;
      const tenant = String(rows[0]!.tenant); const current = rows[0]!.payload as Entry;
      const entry = await store.replaceEntry(tenant, { ...current, state: "deleting", deletionLease: { id: randomUUID(), until: new Date(now() + 300_000).toISOString() } }, current.version, tx);
      return { tenant, entry };
    });
    if (!claim) break;
    let deleted = false;
    try {
      if (!claim.entry.objectVersion) throw new Error("An exact object version is required for expiration.");
      await objects.remove(claim.entry); deleted = true;
    } catch { /* Persist the failed claim below. No payload or credential-bearing error is logged. */ }
    await store.sql.begin(async (tx) => {
      const current = await store.entry(claim.tenant, claim.entry.id, tx, true);
      if (current.state !== "deleting" || current.deletionLease?.id !== claim.entry.deletionLease!.id) return;
      await store.replaceEntry(claim.tenant, { ...current, state: deleted ? "expired" : "deleting", deletionLease: null }, current.version, tx);
    });
    if (deleted) result.expired++;
    else { result.failed++; break; }
  }
  return result;
}
