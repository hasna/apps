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
    if (typeof result.ok !== "boolean" || !Array.isArray(result.sources) || result.sources.some(source => typeof source.source_id !== "string" || typeof source.complete !== "boolean" || [source.scanned, source.ingested, source.duplicate, source.error, source.notifications, source.acknowledged].some(count => !Number.isSafeInteger(count) || count < 0) || (source.next_cursor !== null && typeof source.next_cursor !== "string"))) throw new Error("Invalid inbox ingestion response.");
    return result;
  };
}

/** Bounded S3 walk for API clients, retaining completed-page evidence on later failures. */
export async function syncS3InboxApi(input: { bucket: string; source_id?: string; prefix?: string; region?: string; provider_id?: string; limit?: number; cursor?: string }): Promise<IngestBatchReport & { request_error?: string }> {
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error("Sync limit must be between 1 and 10000 objects.");
  for (const key of ["bucket", "source_id", "region", "provider_id", "cursor"] as const) {
    if ((key === "bucket" || input[key] !== undefined) && (typeof input[key] !== "string" || !input[key]!.trim())) throw new Error(`${key} must not be empty.`);
  }
  const run = await createInboxIngestClient("sync-s3", AbortSignal.timeout(120000));
  let remaining = limit, cursor = input.cursor;
  let aggregate: IngestBatchReport | undefined;
  try {
    while (remaining > 0) {
      const report = await run({ ...input, ...(cursor ? { cursor } : {}), limit: Math.min(10, remaining) });
      const page = report.sources[0];
      if (report.sources.length !== 1 || !page || (input.source_id && page.source_id !== input.source_id) || (aggregate && page.source_id !== aggregate.sources[0]!.source_id)) throw new Error("S3 sync returned a different or ambiguous source.");
      if (page.scanned > Math.min(10, remaining)) throw new Error("S3 sync exceeded the requested object limit.");
      if (!aggregate) aggregate = structuredClone(report);
      else {
        const previous = aggregate.sources[0]!;
        const combined = { ...page };
        for (const key of ["scanned", "ingested", "duplicate", "error", "notifications", "acknowledged"] as const) combined[key] += previous[key];
        aggregate = { ...report, ok: aggregate.ok && report.ok, sources: [combined] };
      }
      remaining -= page.scanned;
      if (!report.ok || !page.next_cursor || remaining <= 0) break;
      if (page.next_cursor === cursor || page.scanned === 0) throw new Error("S3 sync cursor did not advance.");
      cursor = page.next_cursor;
    }
  } catch (error) {
    if (!aggregate) throw error;
    return { ...aggregate, ok: false, sources: aggregate.sources.map(source => ({ ...source, complete: false })), request_error: error instanceof Error ? error.message : "S3 sync did not complete." };
  }
  return aggregate!;
}
