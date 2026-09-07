import { selfHostedResource } from "../db/self-hosted-resource.js";

type Row = Record<string, unknown>;
type SourceStatus = "live" | "import" | "legacy" | "retired";
export interface RegisteredS3Source {
  id: string; type: "s3"; name: string; bucket: string; prefix?: string; region: string;
  provider_id?: string; status: SourceStatus; live_sync_enabled: boolean;
  created_at: string; updated_at: string; retired_at: string | null;
}
function settings(row: Row): Row {
  const value = row.settings_json;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
function project(row: Row): RegisteredS3Source {
  const config = settings(row);
  const status: SourceStatus = row.status === "retired" ? "retired" : ["live", "import", "legacy"].includes(String(config.source_status)) ? config.source_status as SourceStatus : row.status === "active" ? "live" : "legacy";
  return { id: String(row.id), type: "s3", name: String(row.name ?? ""), bucket: String(config.bucket ?? ""), prefix: typeof config.prefix === "string" ? config.prefix : undefined, region: String(config.region ?? ""), provider_id: typeof row.provider_id === "string" ? row.provider_id : undefined, status, live_sync_enabled: row.status === "active" && status === "live" && config.live_sync_enabled !== false, created_at: String(row.created_at), updated_at: String(row.updated_at), retired_at: typeof config.retired_at === "string" ? config.retired_at : null };
}
function rows(): Row[] {
  const store = selfHostedResource("sources"), result: Row[] = [], seen = new Set<string>();
  for (let offset = 0; offset < 100000; offset += 1000) {
    const page = store.list({ limit: 1000, offset });
    for (const row of page) { if (seen.has(String(row.id))) throw new Error("Source registry pagination did not advance."); seen.add(String(row.id)); if (["s3", "ses_s3"].includes(String(row.type))) result.push(row); }
    if (page.length < 1000) return result;
  }
  throw new Error("Source registry exceeds the safe enumeration limit.");
}
export function listRegisteredS3Sources(): RegisteredS3Source[] { return rows().map(project); }
export function registerApiS3Source(input: { bucket: string; prefix?: string; region?: string; providerId?: string; name?: string; status: SourceStatus; liveSyncEnabled: boolean }): RegisteredS3Source {
  const bucket = input.bucket.trim(), prefix = input.prefix?.trim() ?? "", region = input.region?.trim() ?? "us-east-1";
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("Invalid S3 bucket name.");
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) throw new Error("Invalid AWS region.");
  if (/[\u0000-\u001f\u007f]/.test(prefix)) throw new Error("Invalid S3 prefix.");
  const matches = rows().filter(row => settings(row).bucket === bucket && (settings(row).prefix ?? "") === prefix);
  if (matches.length > 1) throw new Error("Multiple API sources match this bucket and prefix; resolve the duplicate registry entries first.");
  const previous = matches[0];
  const record = { mailbox_id: previous?.mailbox_id ?? "inbox", type: previous?.type ?? "ses_s3", name: input.name ?? previous?.name ?? bucket, provider_id: input.providerId ?? previous?.provider_id ?? null,
    status: input.status === "retired" ? "retired" : input.status === "legacy" ? "inactive" : "active",
    settings_json: { ...settings(previous ?? {}), bucket, prefix, region, source_status: input.status, live_sync_enabled: input.liveSyncEnabled && input.status === "live", retired_at: input.status === "retired" ? new Date().toISOString() : null },
  };
  const store = selfHostedResource("sources");
  return project(previous ? store.update(String(previous.id), record) : store.create(record));
}
export function retireApiS3Source(ref: string): RegisteredS3Source {
  if (!ref.trim()) throw new Error("Source ID or bucket must not be blank.");
  const all = rows(); const exact = all.filter(row => row.id === ref);
  const matches = exact.length ? exact : all.filter(row => String(row.id).startsWith(ref) || settings(row).bucket === ref);
  if (!matches.length) throw new Error(`S3 source not found: ${ref}`);
  if (matches.length > 1) throw new Error("Ambiguous S3 source; use its full API source ID.");
  const row = matches[0]!;
  return project(selfHostedResource("sources").update(String(row.id), { status: "retired", settings_json: { ...settings(row), source_status: "retired", live_sync_enabled: false, retired_at: new Date().toISOString() } }));
}
