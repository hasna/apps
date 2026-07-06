/**
 * Suppression sync: push email unsubscribes/suppressions recorded in contacts
 * to a mail delivery system so campaign sends never hit opted-out addresses.
 *
 * The default adapter dynamically imports @hasna/mailery (which exposes
 * `suppressContact(email)`) so mailery stays an optional integration rather
 * than a hard dependency. Any other backend can implement
 * SuppressionSyncAdapter and be passed to syncSuppressions().
 */
import type { ContactsDatabase } from "../db/database.js";
import { getDatabase, now } from "../db/database.js";
import {
  listAudiences,
  listSuppressions,
  markAudienceSuppressionSynced,
  markSuppressionsSynced,
} from "../db/audiences.js";
import type { ContactSuppression } from "../types/index.js";

export interface SuppressionSyncAdapter {
  /** Human-readable adapter name for reporting, e.g. "mailery". */
  name: string;
  /** Push one suppressed email address to the delivery system. Throw on failure. */
  suppress(email: string, reason?: string): Promise<void> | void;
}

export interface SuppressionSyncResult {
  adapter: string;
  dry_run: boolean;
  pending: number;
  pushed: number;
  failed: { address: string; error: string }[];
  synced_at: string | null;
}

export class MaileryNotAvailableError extends Error {
  constructor(detail: string) {
    super(
      `@hasna/mailery is not importable (${detail}). ` +
      `Install it (bun add @hasna/mailery) or pass a custom SuppressionSyncAdapter.`,
    );
    this.name = "MaileryNotAvailableError";
  }
}

/**
 * Build the default adapter backed by @hasna/mailery, if importable.
 * Throws MaileryNotAvailableError when the package is not installed.
 */
export async function createMaileryAdapter(): Promise<SuppressionSyncAdapter> {
  let mod: { suppressContact?: (email: string) => void };
  // Computed specifier keeps @hasna/mailery an optional runtime dependency
  // (no compile-time module resolution).
  const specifier = "@hasna/mailery";
  try {
    mod = (await import(specifier)) as { suppressContact?: (email: string) => void };
  } catch (err) {
    throw new MaileryNotAvailableError(err instanceof Error ? err.message : String(err));
  }
  if (typeof mod.suppressContact !== "function") {
    throw new MaileryNotAvailableError("suppressContact export not found");
  }
  const suppressContact = mod.suppressContact;
  return {
    name: "mailery",
    suppress(email: string): void {
      suppressContact(email);
    },
  };
}

export interface SyncSuppressionsOptions {
  adapter?: SuppressionSyncAdapter;
  dryRun?: boolean;
  db?: ContactsDatabase;
}

/**
 * Push all unsynced email suppressions to the delivery system and stamp
 * synced_at on each pushed entry plus suppression_synced_at on every audience.
 */
export async function syncSuppressions(options: SyncSuppressionsOptions = {}): Promise<SuppressionSyncResult> {
  const d = options.db || getDatabase();
  const pending: ContactSuppression[] = listSuppressions({ channel: "email", unsyncedOnly: true }, d);

  if (options.dryRun) {
    const adapterName = options.adapter?.name ?? "mailery";
    return { adapter: adapterName, dry_run: true, pending: pending.length, pushed: 0, failed: [], synced_at: null };
  }

  const adapter = options.adapter ?? (await createMaileryAdapter());
  const pushedIds: string[] = [];
  const failed: { address: string; error: string }[] = [];
  for (const entry of pending) {
    try {
      await adapter.suppress(entry.address, entry.reason ?? undefined);
      pushedIds.push(entry.id);
    } catch (err) {
      failed.push({ address: entry.address, error: err instanceof Error ? err.message : String(err) });
    }
  }

  let syncedAt: string | null = null;
  if (pushedIds.length > 0 || pending.length === 0) {
    syncedAt = now();
    markSuppressionsSynced(pushedIds, syncedAt, d);
    if (failed.length === 0) {
      for (const audience of listAudiences(d)) {
        markAudienceSuppressionSynced(audience.id, syncedAt, d);
      }
    }
  }

  return {
    adapter: adapter.name,
    dry_run: false,
    pending: pending.length,
    pushed: pushedIds.length,
    failed,
    synced_at: syncedAt,
  };
}
