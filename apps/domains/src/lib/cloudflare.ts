/**
 * Cloudflare DNS provider — zone and record management via Cloudflare API v4
 *
 * Env vars:
 *   CLOUDFLARE_API_TOKEN   — API token with Zone:Edit + DNS:Edit permissions
 *   CLOUDFLARE_ACCOUNT_ID  — Account ID (required for zone creation)
 */

import type { DnsProvider, ProviderDnsRecord } from "./registrar.js";
import {
  resolveCloudflareConfig,
  cloudflareAuthHeaders,
  type CloudflareConfig,
} from "./cloudflare-auth.js";

export type { CloudflareConfig };

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
  nameservers: string[];
  original_nameservers?: string[];
}

export interface CloudflareRecord {
  id?: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  priority?: number;
  proxied?: boolean;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export function getConfig(): CloudflareConfig {
  return resolveCloudflareConfig();
}

function checkCredentials(cfg: CloudflareConfig): void {
  // Throws if neither a scoped token nor a global key + email is present.
  cloudflareAuthHeaders(cfg);
}

// ─── API Client ──────────────────────────────────────────────────────────────

const CF_BASE = "https://api.cloudflare.com/client/v4";

async function cfFetch<T>(
  path: string,
  opts: { method?: string; body?: unknown; config?: CloudflareConfig } = {}
): Promise<T> {
  const cfg = opts.config ?? getConfig();
  checkCredentials(cfg);

  const res = await fetch(`${CF_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...cloudflareAuthHeaders(cfg),
      "Content-Type": "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const json = await res.json() as { success: boolean; result: T; errors: { message: string }[] };
  if (!json.success) {
    const msg = json.errors?.[0]?.message ?? `Cloudflare API error (${res.status})`;
    throw new Error(msg);
  }
  return json.result;
}

// ─── Zones ───────────────────────────────────────────────────────────────────

export async function listZones(config?: CloudflareConfig): Promise<CloudflareZone[]> {
  const zones: CloudflareZone[] = [];
  let page = 1;

  while (true) {
    const result = await cfFetch<{ id: string; name: string; status: string; name_servers: string[]; original_name_servers?: string[] }[]>(
      `/zones?per_page=50&page=${page}`,
      { config }
    );
    if (!result || result.length === 0) break;
    for (const z of result) {
      zones.push({ id: z.id, name: z.name, status: z.status, nameservers: z.name_servers, original_nameservers: z.original_name_servers });
    }
    if (result.length < 50) break;
    page++;
  }

  return zones;
}

export async function getZone(domain: string, config?: CloudflareConfig): Promise<CloudflareZone | null> {
  const result = await cfFetch<{ id: string; name: string; status: string; name_servers: string[]; original_name_servers?: string[] }[]>(
    `/zones?name=${encodeURIComponent(domain)}`,
    { config }
  );
  if (!result || result.length === 0) return null;
  const z = result[0]!;
  return { id: z.id, name: z.name, status: z.status, nameservers: z.name_servers, original_nameservers: z.original_name_servers };
}

export async function createZone(domain: string, config?: CloudflareConfig): Promise<CloudflareZone> {
  const cfg = config ?? getConfig();
  if (!cfg.accountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is required to create a zone.");
  }
  const result = await cfFetch<{ id: string; name: string; status: string; name_servers: string[] }>(
    "/zones",
    { method: "POST", body: { name: domain, account: { id: cfg.accountId }, jump_start: false }, config: cfg }
  );
  return { id: result.id, name: result.name, status: result.status, nameservers: result.name_servers };
}

/**
 * Find-or-create a Cloudflare zone and return its assigned nameservers.
 * Idempotent: reuses an existing zone for the domain if present. The returned
 * nameservers are what the registrar should be delegated to (always-Cloudflare).
 *
 * `deps` is injectable for testing; defaults to the real getZone/createZone.
 */
export async function ensureZone(
  domain: string,
  config?: CloudflareConfig,
  deps?: {
    getZone: (d: string, c?: CloudflareConfig) => Promise<CloudflareZone | null>;
    createZone: (d: string, c?: CloudflareConfig) => Promise<CloudflareZone>;
  },
): Promise<CloudflareZone> {
  const get = deps?.getZone ?? getZone;
  const create = deps?.createZone ?? createZone;
  const existing = await get(domain, config);
  const zone = existing ?? (await create(domain, config));
  if (!zone.nameservers || zone.nameservers.length === 0) {
    throw new Error(`Cloudflare zone for ${domain} has no nameservers yet`);
  }
  return zone;
}

export async function deleteZone(zoneId: string, config?: CloudflareConfig): Promise<void> {
  await cfFetch(`/zones/${zoneId}`, { method: "DELETE", config });
}

// ─── DNS Records ─────────────────────────────────────────────────────────────

export async function listRecords(zoneId: string, config?: CloudflareConfig): Promise<CloudflareRecord[]> {
  const records: CloudflareRecord[] = [];
  let page = 1;

  while (true) {
    const result = await cfFetch<{ id: string; type: string; name: string; content: string; ttl: number; priority?: number; proxied?: boolean }[]>(
      `/zones/${zoneId}/dns_records?per_page=100&page=${page}`,
      { config }
    );
    if (!result || result.length === 0) break;
    for (const r of result) {
      records.push({ id: r.id, type: r.type, name: r.name, content: r.content, ttl: r.ttl, priority: r.priority, proxied: r.proxied });
    }
    if (result.length < 100) break;
    page++;
  }

  return records;
}

export async function upsertRecord(zoneId: string, record: CloudflareRecord, config?: CloudflareConfig): Promise<void> {
  // Check if record exists
  const existing = await cfFetch<{ id: string }[]>(
    `/zones/${zoneId}/dns_records?type=${record.type}&name=${encodeURIComponent(record.name)}`,
    { config }
  );

  const body = {
    type: record.type,
    name: record.name,
    content: record.content,
    ttl: record.ttl ?? 1, // 1 = automatic
    priority: record.priority,
    proxied: record.proxied ?? false,
  };

  if (existing && existing.length > 0) {
    await cfFetch(`/zones/${zoneId}/dns_records/${existing[0]!.id}`, { method: "PUT", body, config });
  } else {
    await cfFetch(`/zones/${zoneId}/dns_records`, { method: "POST", body, config });
  }
}

export async function deleteRecord(zoneId: string, recordId: string, config?: CloudflareConfig): Promise<void> {
  await cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, { method: "DELETE", config });
}

export async function deleteRecordByNameType(zoneId: string, name: string, type: string, config?: CloudflareConfig): Promise<void> {
  const existing = await cfFetch<{ id: string }[]>(
    `/zones/${zoneId}/dns_records?type=${type}&name=${encodeURIComponent(name)}`,
    { config }
  );
  for (const r of existing ?? []) {
    await deleteRecord(zoneId, r.id, config);
  }
}

// ─── DnsProvider Adapter ─────────────────────────────────────────────────────

export function createCloudflareProvider(config?: CloudflareConfig): DnsProvider {
  const cfg = config ?? getConfig();

  return {
    name: "cloudflare",

    async getDnsRecords(domain: string): Promise<ProviderDnsRecord[]> {
      const zone = await getZone(domain, cfg);
      if (!zone) return [];
      const records = await listRecords(zone.id, cfg);
      return records.map((r) => ({
        type: r.type,
        name: r.name,
        value: r.content,
        ttl: r.ttl === 1 ? 0 : r.ttl, // 1 = automatic in CF
        priority: r.priority,
      }));
    },

    async setDnsRecords(domain: string, records: ProviderDnsRecord[]): Promise<boolean> {
      const zone = await getZone(domain, cfg);
      if (!zone) throw new Error(`No Cloudflare zone found for ${domain}`);
      for (const r of records) {
        await upsertRecord(zone.id, { type: r.type, name: r.name, content: r.value, ttl: r.ttl || 1, priority: r.priority }, cfg);
      }
      return true;
    },
  };
}
