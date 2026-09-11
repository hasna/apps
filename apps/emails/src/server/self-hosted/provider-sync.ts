import type { TenantScopedStore } from "./store.js";
import { resourceSpecForPath } from "./resources.js";
import type { SenderResolver } from "./sender.js";

export class ProviderSyncError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function syncProviderDelivery(store: TenantScopedStore, tenantId: string, providerId: string, options: { after?: string; limit?: number; resolveSender?: SenderResolver; timeoutMs?: number; delay?: (ms: number) => Promise<void> } = {}) {
  const provider = await store.getResource(resourceSpecForPath("providers")!, providerId);
  if (!provider) throw new ProviderSyncError("Provider not found in this tenant.", 404);
  if (provider.active === false) throw new ProviderSyncError("Provider is inactive.", 409);
  const sender = await options.resolveSender?.(tenantId, providerId);
  if (!sender) throw new ProviderSyncError("Configure EMAILS_SENDER_BINDINGS for this tenant/provider on the server.", 503);
  if (sender.provider !== provider.type) throw new ProviderSyncError("Provider type does not match its server binding.", 409);
  if (!sender.readDelivery) throw new ProviderSyncError("This server binding does not support reading delivery observations. Update the server or configure a supported binding.", 503);
  const limit = options.limit ?? 10;
  const rows = await store.listDeliverySyncMessages(providerId, options.after, limit + 1);
  const selected = rows.slice(0, limit);
  let checked = 0, synced = 0, contactsUpdated = 0, unattributed = 0;
  const failures: Array<{ message_id: string; error: string }> = [];
  const evidence = new Set<string>();
  for (const row of selected) {
    const signal = AbortSignal.timeout(options.timeoutMs ?? 5000);
    try {
      const read = await Promise.race([
        sender.readDelivery(row.provider_message_id!, signal),
        new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true })),
      ]);
      const result = await store.applyDeliveryObservations(providerId, row.id, read);
      evidence.add(read.evidence);
      checked++;
      synced += result.inserted;
      contactsUpdated += result.contacts_updated;
      unattributed += result.unattributed;
    } catch {
      failures.push({ message_id: row.id, error: signal.aborted ? "Provider read timed out." : "Provider observation could not be read or committed. Check server permissions, provider retention/insights availability, and retry." });
    }
    if (sender.provider === "ses" && row !== selected.at(-1)) await (options.delay ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms))))(1000);
  }
  return {
    provider_id: providerId, status: failures.length ? "partial" : "synced", checked, synced, contacts_updated: contactsUpdated,
    unattributed_contact_events: unattributed, failures, complete: rows.length <= limit && failures.length === 0,
    next_cursor: rows.length > limit ? selected.at(-1)!.id : null,
    evidence: [...evidence], scope: "known_provider_messages",
    historical_events_complete: false,
    note: "Reconciles only server messages with this provider's recorded provenance. Current-status snapshots are observations, not a complete historical event stream. Messages without provider provenance are excluded.",
  };
}
