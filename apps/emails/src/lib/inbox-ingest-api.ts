import { resolveEmailsHostedTransport } from "./emails-credentials.js";
import { loadEmailsClientEnvSecret } from "./client-env.js";

export interface IngestBatchReport {
  ok: boolean;
  sources: Array<{ source_id: string; scanned: number; ingested: number; duplicate: number; error: number; notifications: number; acknowledged: number; next_cursor: string | null; complete: boolean; queue: { visible: number | null; in_flight: number | null } | null }>;
}
export async function createInboxIngestClient(operation: "sync-s3" | "watch", signal?: AbortSignal) {
  loadEmailsClientEnvSecret(process.env);
  const transport = resolveEmailsHostedTransport(process.env);
  const credentials = [transport.credential, ...(transport.credentialFallbacks ?? []).map(item => item.value)];
  async function request(path: string, body?: unknown) {
    for (let index = 0; index < credentials.length; index++) {
      const response = await fetch(transport.baseUrl + path, {
        method: body === undefined ? "GET" : "POST", redirect: "error",
        headers: { Authorization: `Bearer ${credentials[index]}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000),
      });
      if (response.status === 401 && index < credentials.length - 1) continue;
      if ([404, 405].includes(response.status)) throw new Error("The Emails API needs an update for inbox ingestion, or the selected source is not registered in this tenant.");
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error ?? `Inbox ingestion failed (HTTP ${response.status}).`);
      }
      return response.json();
    }
    throw new Error("No Emails API credential is configured.");
  }
  const contract = await request("/openapi.json") as { paths?: Record<string, { post?: unknown }> };
  if (!contract.paths?.[`/v1/inbox/${operation}`]?.post) throw new Error("The Emails API needs an update for inbox ingestion. No ingestion request was submitted.");
  return async (body: Record<string, unknown>): Promise<IngestBatchReport> => {
    const result = await request(`/inbox/${operation}`, body) as IngestBatchReport;
    if (typeof result.ok !== "boolean" || !Array.isArray(result.sources) || result.sources.some(source => typeof source.source_id !== "string" || typeof source.complete !== "boolean" || !Number.isSafeInteger(source.scanned) || !Number.isSafeInteger(source.error) || (source.next_cursor !== null && typeof source.next_cursor !== "string"))) throw new Error("Invalid inbox ingestion response.");
    return result;
  };
}
