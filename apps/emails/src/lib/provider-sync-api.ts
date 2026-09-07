import { resolveEmailsHostedTransport } from "./emails-credentials.js";
import { loadEmailsClientEnvSecret } from "./client-env.js";
import { listServerProviderIds } from "./provider-server-health.js";

export interface ProviderSyncReport {
  provider_id: string;
  status: string;
  checked: number;
  synced: number;
  contacts_updated: number;
  unattributed_contact_events: number;
  complete: boolean;
  next_cursor: string | null;
  failures: Array<{ message_id: string; error: string }>;
  historical_events_complete: boolean;
  scope: string;
  note: string;
}
export async function pullProviderObservations(providerRef?: string, signal?: AbortSignal): Promise<{ ok: boolean; providers: ProviderSyncReport[] }> {
  if (providerRef !== undefined && !providerRef.trim()) throw new Error("--provider must name a provider identifier.");
  const ids = await listServerProviderIds();
  const selected = providerRef === undefined ? ids : ids.includes(providerRef) ? [providerRef] : ids.filter(id => id.startsWith(providerRef));
  if (providerRef !== undefined && selected.length !== 1) throw new Error(selected.length ? "Provider identifier is ambiguous." : "Provider not found in this tenant.");
  loadEmailsClientEnvSecret(process.env);
  const transport = resolveEmailsHostedTransport(process.env);
  const credentials = [transport.credential, ...(transport.credentialFallbacks ?? []).map(item => item.value)];
  async function request(path: string, body?: unknown) {
    for (let i = 0; i < credentials.length; i++) {
      const response = await fetch(transport.baseUrl + path, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${credentials[i]}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(75000)]) : AbortSignal.timeout(75000), redirect: "error" });
      if (response.status === 401 && i < credentials.length - 1) continue;
      if (response.status === 404 || response.status === 405) throw new Error("The Emails API needs an update to support provider sync, or the provider no longer exists.");
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(error.error ?? `Provider sync request failed (HTTP ${response.status}).`);
      }
      return response.json();
    }
    throw new Error("No Emails API credential configured.");
  }
  const contract = await request("/openapi.json") as { paths?: Record<string, { post?: unknown }> };
  if (!contract.paths?.["/v1/providers/{id}/sync"]?.post) throw new Error("The Emails API needs an update to support provider sync. No sync request was submitted.");
  const reports: ProviderSyncReport[] = [];
  for (const id of selected) {
    let after: string | undefined;
    let combined: ProviderSyncReport | undefined;
    try {
    for (let page = 0; page < 10000; page++) {
      signal?.throwIfAborted();
      const result = await request(`/providers/${encodeURIComponent(id)}/sync`, { limit: 10, ...(after ? { after } : {}) }) as ProviderSyncReport;
      if (result.provider_id !== id || typeof result.complete !== "boolean" || !Number.isSafeInteger(result.checked) || !Number.isSafeInteger(result.synced) || !Array.isArray(result.failures) || (result.next_cursor !== null && typeof result.next_cursor !== "string")) throw new Error("Invalid provider sync API response.");
      combined = combined ? { ...result, checked: combined.checked + result.checked, synced: combined.synced + result.synced, contacts_updated: combined.contacts_updated + result.contacts_updated, unattributed_contact_events: combined.unattributed_contact_events + result.unattributed_contact_events, failures: [...combined.failures, ...result.failures], complete: result.complete && combined.failures.length === 0 } : result;
      if (!result.next_cursor) break;
      if (result.next_cursor === after) throw new Error("Provider sync cursor did not advance.");
      after = result.next_cursor;
    }
    if (combined) reports.push({ ...combined, status: combined.complete ? "synced" : "partial" });
    } catch (error) {
      signal?.throwIfAborted();
      reports.push({ provider_id: id, status: "failed", checked: combined?.checked ?? 0, synced: combined?.synced ?? 0, contacts_updated: combined?.contacts_updated ?? 0, unattributed_contact_events: combined?.unattributed_contact_events ?? 0, complete: false, next_cursor: after ?? null, failures: [...(combined?.failures ?? []), { message_id: "", error: error instanceof Error ? error.message : "Provider sync failed." }], historical_events_complete: false, scope: "known_provider_messages", note: "Provider sync did not complete. Resolve the reported server prerequisite and retry." });
    }
  }
  return { ok: reports.every(result => result.complete), providers: reports };
}
