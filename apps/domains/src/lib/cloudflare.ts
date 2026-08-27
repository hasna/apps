/**
 * Cloudflare DNS provider — zone and record management via Cloudflare API v4
 *
 * Env vars:
 *   CLOUDFLARE_API_TOKEN   — API token with Zone:Edit + DNS:Edit permissions
 *   CLOUDFLARE_ACCOUNT_ID  — Account ID (required for zone creation)
 */

import type {
  DbFunctions,
  DnsProvider,
  DomainInventoryProvider,
  ProviderDnsRecord,
  ProviderDomainInfo,
  ProviderSyncResult,
} from "./registrar.js";
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
 * nameservers are what the registrar should be delegated to when Cloudflare is
 * the selected DNS provider.
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

async function listRecordsByNameType(zoneId: string, type: string, name: string, config?: CloudflareConfig): Promise<CloudflareRecord[]> {
  const result = await cfFetch<{ id: string; type: string; name: string; content: string; ttl: number; priority?: number; proxied?: boolean }[]>(
    `/zones/${zoneId}/dns_records?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`,
    { config }
  );
  return (result ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    content: r.content,
    ttl: r.ttl,
    priority: r.priority,
    proxied: r.proxied,
  }));
}

export async function upsertRecord(zoneId: string, record: CloudflareRecord, config?: CloudflareConfig): Promise<void> {
  const existing = await listRecordsByNameType(zoneId, record.type, record.name, config);

  const body = {
    type: record.type,
    name: record.name,
    content: record.content,
    ttl: record.ttl ?? 1, // 1 = automatic
    priority: record.priority,
    proxied: record.proxied ?? false,
  };

  const sameRecord = existing.find((r) =>
    r.content === record.content
    && (r.priority ?? undefined) === (record.priority ?? undefined)
    && (r.proxied ?? false) === (record.proxied ?? false)
  );
  if (sameRecord?.id) {
    await cfFetch(`/zones/${zoneId}/dns_records/${sameRecord.id}`, { method: "PUT", body, config });
  } else {
    await cfFetch(`/zones/${zoneId}/dns_records`, { method: "POST", body, config });
  }
}

interface CloudflareRecordReplacement {
  existing: CloudflareRecord[];
  desired: CloudflareRecord[];
}

function sameRecordIdentity(a: CloudflareRecord, b: CloudflareRecord): boolean {
  return a.type === b.type
    && a.name === b.name
    && a.content === b.content
    && (a.priority ?? undefined) === (b.priority ?? undefined);
}

function resolveDesiredProxied(records: CloudflareRecord[], existing: CloudflareRecord[]): CloudflareRecord[] {
  const omitted = records.filter((record) => record.proxied === undefined);
  if (omitted.length === 0) return records;

  const { type, name } = records[0]!;
  if (omitted.length === records.length) {
    const proxyStates = new Set(existing.map((record) => record.proxied));
    if (proxyStates.size > 1) {
      throw new Error(
        `Cannot safely preserve Cloudflare proxied state for ${type} ${name}: `
        + "existing records have mixed proxied values while desired records omit proxied; "
        + "set proxied explicitly on every desired record",
      );
    }
    const inherited = existing[0]?.proxied;
    return inherited === undefined
      ? records
      : records.map((record) => ({ ...record, proxied: inherited }));
  }

  const existingHasProxyState = existing.some((record) => record.proxied !== undefined);
  return records.map((record) => {
    if (record.proxied !== undefined) return record;
    const matches = existing.filter((candidate) => sameRecordIdentity(candidate, record));
    if (matches.length === 1 && matches[0]!.proxied !== undefined) {
      return { ...record, proxied: matches[0]!.proxied };
    }
    if (!existingHasProxyState) return record;
    throw new Error(
      `Cannot safely preserve Cloudflare proxied state for ${type} ${name} record ${record.content}: `
      + "omitted proxied does not resolve to exactly one existing value; "
      + "set proxied explicitly on this desired record",
    );
  });
}

async function prepareRecordsByNameType(
  zoneId: string,
  records: CloudflareRecord[],
  config?: CloudflareConfig,
): Promise<CloudflareRecordReplacement | undefined> {
  if (records.length === 0) return;
  const { type, name } = records[0]!;
  const existing = await listRecordsByNameType(zoneId, type, name, config);
  if (
    existing.length === records.length
    && records.every((record) => existing.some((candidate) =>
      sameRecordIdentity(candidate, record)
      && candidate.ttl === record.ttl
      && (record.proxied === undefined || candidate.proxied === record.proxied)
    ))
  ) {
    return;
  }
  return { existing, desired: resolveDesiredProxied(records, existing) };
}

async function replaceRecordsByNameType(
  zoneId: string,
  replacement: CloudflareRecordReplacement,
  config?: CloudflareConfig,
): Promise<void> {
  for (const record of replacement.existing) {
    if (record.id) await deleteRecord(zoneId, record.id, config);
  }
  for (const record of replacement.desired) {
    await cfFetch(`/zones/${zoneId}/dns_records`, {
      method: "POST",
      body: {
        type: record.type,
        name: record.name,
        content: record.content,
        ttl: record.ttl ?? 1,
        priority: record.priority,
        ...(record.proxied === undefined ? {} : { proxied: record.proxied }),
      },
      config,
    });
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

// ─── DnsProvider + DomainInventoryProvider Adapter ───────────────────────────

function zoneToDomainInfo(zone: CloudflareZone): ProviderDomainInfo {
  return {
    domain: zone.name,
    registrar: "Cloudflare DNS",
    created: "",
    expires: "",
    nameservers: zone.nameservers,
    status: zone.status === "active" ? "active" : "discovered",
    auto_renew: false,
  };
}

function withCloudflareMetadata(existing: Record<string, unknown>, zone: CloudflareZone): Record<string, unknown> {
  return {
    ...existing,
    cloudflare: {
      zone_id: zone.id,
      zone_status: zone.status,
      source: "cloudflare:zones",
      synced_at: new Date().toISOString(),
    },
  };
}

export function createCloudflareProvider(config?: CloudflareConfig): DnsProvider & DomainInventoryProvider {
  const cfg = config ?? getConfig();

  return {
    name: "cloudflare",
    dnsWriteScope: "changed-groups",

    async listDomains(): Promise<ProviderDomainInfo[]> {
      const zones = await listZones(cfg);
      return zones.map(zoneToDomainInfo);
    },

    async syncToLocalDb(dbFns: DbFunctions): Promise<ProviderSyncResult> {
      const zones = await listZones(cfg);
      let synced = 0;
      let created = 0;
      let updated = 0;
      const errors: string[] = [];

      for (const zone of zones) {
        try {
          const info = zoneToDomainInfo(zone);
          const existing = await dbFns.getDomainByName(zone.name);
          if (existing) {
            await dbFns.updateDomain(existing.id, {
              ...(existing.registrar === "Cloudflare DNS" ? { registrar: null } : {}),
              status: existing.status === "discovered" && info.status === "active" ? "active" : existing.status,
              nameservers: zone.nameservers,
              metadata: withCloudflareMetadata(existing.metadata, zone),
            });
            updated++;
          } else {
            await dbFns.createDomain({
              name: zone.name,
              status: info.status === "active" ? "active" : "discovered",
              auto_renew: false,
              nameservers: zone.nameservers,
              notes: "Discovered from Cloudflare zones; registrar ownership was not inferred.",
              metadata: withCloudflareMetadata({}, zone),
            });
            created++;
          }
          synced++;
        } catch (err) {
          errors.push(`${zone.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return { synced, created, updated, errors };
    },

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
        ...(r.proxied === undefined ? {} : { proxied: r.proxied }),
      }));
    },

    async setDnsRecords(domain: string, records: ProviderDnsRecord[]): Promise<boolean> {
      const zone = await getZone(domain, cfg);
      if (!zone) throw new Error(`No Cloudflare zone found for ${domain}`);
      const grouped = new Map<string, CloudflareRecord[]>();
      for (const r of records) {
        const key = `${r.type}|${r.name}`;
        const existing = grouped.get(key) ?? [];
        existing.push({
          type: r.type,
          name: r.name,
          content: r.value,
          ttl: r.ttl || 1,
          priority: r.priority,
          ...(r.proxied === undefined ? {} : { proxied: r.proxied }),
        });
        grouped.set(key, existing);
      }
      const replacements: CloudflareRecordReplacement[] = [];
      for (const group of grouped.values()) {
        const replacement = await prepareRecordsByNameType(zone.id, group, cfg);
        if (replacement) replacements.push(replacement);
      }
      for (const replacement of replacements) {
        await replaceRecordsByNameType(zone.id, replacement, cfg);
      }
      return true;
    },

    async deleteDnsRecords(domain: string, records: ProviderDnsRecord[]): Promise<boolean> {
      const zone = await getZone(domain, cfg);
      if (!zone) throw new Error(`No Cloudflare zone found for ${domain}`);
      const grouped = new Map<string, ProviderDnsRecord[]>();
      for (const record of records) {
        const key = `${record.type}|${record.name}`;
        const group = grouped.get(key) ?? [];
        group.push(record);
        grouped.set(key, group);
      }
      for (const group of grouped.values()) {
        const { type, name } = group[0]!;
        const existing = await listRecordsByNameType(zone.id, type, name, cfg);
        for (const record of group) {
          const match = existing.find((candidate) =>
            candidate.content === record.value
            && (candidate.priority ?? undefined) === (record.priority ?? undefined)
          );
          if (match?.id) {
            await deleteRecord(zone.id, match.id, cfg);
          }
        }
      }
      return true;
    },
  };
}
