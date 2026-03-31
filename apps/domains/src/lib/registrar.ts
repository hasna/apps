/**
 * Unified registrar provider system
 *
 * Wraps Namecheap and GoDaddy into a common RegistrarProvider interface.
 */

import type { Domain, CreateDomainInput, UpdateDomainInput } from "../db/domains.js";
import * as namecheap from "./namecheap.js";
import * as godaddy from "./godaddy.js";
import { createRoute53Provider } from "./route53.js";
import { createCloudflareProvider } from "./cloudflare.js";
import { createBrandsightProvider } from "./brandsight.js";

// ============================================================
// Types
// ============================================================

export interface ProviderDnsRecord {
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority?: number;
}

export interface ProviderDomainInfo {
  domain: string;
  registrar: string;
  created: string;
  expires: string;
  nameservers: string[];
  status: string;
  auto_renew: boolean;
}

export interface ProviderRenewResult {
  domain: string;
  success: boolean;
  orderId?: string;
  chargedAmount?: string;
}

export interface ProviderSyncResult {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}

export interface ProviderAvailability {
  domain: string;
  available: boolean;
}

export type DbFunctions = {
  getDomainByName: (name: string) => Domain | null;
  createDomain: (input: CreateDomainInput) => Domain;
  updateDomain: (id: string, input: UpdateDomainInput) => Domain | null;
};

/** Handles domain registration, renewal, and availability checks */
export interface RegistrarProvider {
  name: string;
  listDomains(): Promise<ProviderDomainInfo[]>;
  getDomainInfo(domain: string): Promise<ProviderDomainInfo>;
  renewDomain(domain: string): Promise<ProviderRenewResult>;
  checkAvailability(domain: string): Promise<ProviderAvailability>;
  syncToLocalDb(dbFns: DbFunctions): Promise<ProviderSyncResult>;
}

/** Handles DNS zone and record management */
export interface DnsProvider {
  name: string;
  getDnsRecords(domain: string): Promise<ProviderDnsRecord[]>;
  setDnsRecords(domain: string, records: ProviderDnsRecord[]): Promise<boolean>;
}

/** A provider that does both — e.g. Route 53 */
export type FullProvider = RegistrarProvider & DnsProvider;

export interface ProviderInfo {
  name: string;
  type: "registrar" | "dns" | "full";
  configured: boolean;
  envVars: string[];
}

export interface SyncAllResult {
  providers: { name: string; result: ProviderSyncResult }[];
  totalSynced: number;
  totalErrors: string[];
}

// ============================================================
// Namecheap Provider Adapter
// ============================================================

function createNamecheapProvider(): FullProvider {
  return {
    name: "namecheap",

    async listDomains(): Promise<ProviderDomainInfo[]> {
      const config = namecheap.getConfig();
      const domains = await namecheap.listNamecheapDomains(config);
      return domains.map((d) => ({
        domain: d.domain,
        registrar: "Namecheap",
        created: "",
        expires: d.expiry,
        nameservers: [],
        status: "active",
        auto_renew: d.autoRenew,
      }));
    },

    async getDomainInfo(domain: string): Promise<ProviderDomainInfo> {
      const config = namecheap.getConfig();
      const info = await namecheap.getDomainInfo(domain, config);
      return {
        domain: info.domain,
        registrar: info.registrar,
        created: info.created,
        expires: info.expires,
        nameservers: info.nameservers,
        status: "active",
        auto_renew: true,
      };
    },

    async renewDomain(domain: string): Promise<ProviderRenewResult> {
      const config = namecheap.getConfig();
      const result = await namecheap.renewDomain(domain, 1, config);
      return {
        domain: result.domain,
        success: result.success,
        orderId: result.orderId,
        chargedAmount: result.chargedAmount,
      };
    },

    async getDnsRecords(domain: string): Promise<ProviderDnsRecord[]> {
      const config = namecheap.getConfig();
      const { sld, tld } = namecheap.splitDomain(domain);
      const records = await namecheap.getDnsRecords(domain, sld, tld, config);
      return records.map((r) => ({
        type: r.type,
        name: r.name,
        value: r.address,
        ttl: r.ttl,
        priority: r.mxPref,
      }));
    },

    async setDnsRecords(domain: string, records: ProviderDnsRecord[]): Promise<boolean> {
      const config = namecheap.getConfig();
      const { sld, tld } = namecheap.splitDomain(domain);
      const ncRecords = records.map((r) => ({
        type: r.type,
        name: r.name,
        address: r.value,
        ttl: r.ttl,
        mxPref: r.priority,
      }));
      return namecheap.setDnsRecords(domain, sld, tld, ncRecords, config);
    },

    async checkAvailability(domain: string): Promise<ProviderAvailability> {
      const config = namecheap.getConfig();
      const result = await namecheap.checkAvailability(domain, config);
      return { domain: result.domain, available: result.available };
    },

    async syncToLocalDb(dbFns: DbFunctions): Promise<ProviderSyncResult> {
      const result = await namecheap.syncToLocalDb(dbFns);
      return {
        synced: result.synced,
        created: 0,
        updated: 0,
        errors: result.errors,
      };
    },
  };
}

// ============================================================
// GoDaddy Provider Adapter
// ============================================================

function createGoDaddyProvider(): FullProvider {
  return {
    name: "godaddy",

    async listDomains(): Promise<ProviderDomainInfo[]> {
      const domains = await godaddy.listGoDaddyDomains();
      return domains.map((d) => ({
        domain: d.domain,
        registrar: "GoDaddy",
        created: "",
        expires: d.expires,
        nameservers: d.nameServers || [],
        status: d.status.toLowerCase(),
        auto_renew: d.renewAuto,
      }));
    },

    async getDomainInfo(domain: string): Promise<ProviderDomainInfo> {
      const detail = await godaddy.getDomainInfo(domain);
      return {
        domain: detail.domain,
        registrar: "GoDaddy",
        created: detail.createdAt || "",
        expires: detail.expires,
        nameservers: detail.nameServers || [],
        status: detail.status.toLowerCase(),
        auto_renew: detail.renewAuto,
      };
    },

    async renewDomain(domain: string): Promise<ProviderRenewResult> {
      const result = await godaddy.renewDomain(domain);
      return {
        domain,
        success: true,
        orderId: String(result.orderId),
        chargedAmount: String(result.total),
      };
    },

    async getDnsRecords(domain: string): Promise<ProviderDnsRecord[]> {
      const records = await godaddy.getDnsRecords(domain);
      return records.map((r) => ({
        type: r.type,
        name: r.name,
        value: r.data,
        ttl: r.ttl,
        priority: r.priority,
      }));
    },

    async setDnsRecords(domain: string, records: ProviderDnsRecord[]): Promise<boolean> {
      const gdRecords = records.map((r) => ({
        type: r.type,
        name: r.name,
        data: r.value,
        ttl: r.ttl,
        priority: r.priority,
      }));
      await godaddy.setDnsRecords(domain, gdRecords);
      return true;
    },

    async checkAvailability(domain: string): Promise<ProviderAvailability> {
      const result = await godaddy.checkAvailability(domain);
      return { domain: result.domain, available: result.available };
    },

    async syncToLocalDb(dbFns: DbFunctions): Promise<ProviderSyncResult> {
      const result = await godaddy.syncToLocalDb(dbFns);
      return {
        synced: result.synced,
        created: result.created,
        updated: result.updated,
        errors: result.errors,
      };
    },
  };
}

// ============================================================
// Provider Registry (data-driven — add new providers here only)
// ============================================================

interface RegistryEntry {
  info: ProviderInfo;
  createRegistrar?: () => RegistrarProvider;
  createDns?: () => DnsProvider;
}

const providerRegistry = new Map<string, RegistryEntry>([
  ["namecheap", {
    info: {
      name: "namecheap", type: "full" as const,
      configured: false,
      envVars: ["NAMECHEAP_API_KEY", "NAMECHEAP_USERNAME", "NAMECHEAP_CLIENT_IP"],
    },
    createRegistrar: createNamecheapProvider,
    createDns: createNamecheapProvider,
  }],
  ["godaddy", {
    info: {
      name: "godaddy", type: "full" as const,
      configured: false,
      envVars: ["GODADDY_API_KEY", "GODADDY_API_SECRET"],
    },
    createRegistrar: createGoDaddyProvider,
    createDns: createGoDaddyProvider,
  }],
  ["route53", {
    info: {
      name: "route53", type: "full",
      configured: false,
      envVars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
    },
    createRegistrar: () => createRoute53Provider() as unknown as RegistrarProvider,
    createDns: () => createRoute53Provider() as unknown as DnsProvider,
  }],
  ["cloudflare", {
    info: {
      name: "cloudflare", type: "dns" as const,
      configured: false,
      envVars: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    },
    createDns: createCloudflareProvider,
  }],
  ["brandsight", {
    info: {
      name: "brandsight", type: "registrar" as const,
      configured: false,
      envVars: ["BRANDSIGHT_API_KEY", "BRANDSIGHT_ACCOUNT_ID"],
    },
    createRegistrar: createBrandsightProvider,
  }],
]);

function isConfigured(envVars: string[]): boolean {
  // At least the first two env vars must be set (key + secret pattern)
  return envVars.slice(0, 2).every((v) => !!process.env[v]);
}

export function registerProvider(entry: RegistryEntry): void {
  providerRegistry.set(entry.info.name, entry);
}

export function getAvailableProviders(): ProviderInfo[] {
  return Array.from(providerRegistry.values()).map((e) => ({
    ...e.info,
    configured: isConfigured(e.info.envVars),
  }));
}

export function getRegistrarProvider(name: string): RegistrarProvider {
  const entry = providerRegistry.get(name);
  if (!entry?.createRegistrar) throw new Error(`No registrar provider: ${name}`);
  return entry.createRegistrar();
}

export function getDnsProvider(name: string): DnsProvider {
  const entry = providerRegistry.get(name);
  if (!entry?.createDns) throw new Error(`No DNS provider: ${name}`);
  return entry.createDns();
}

/** @deprecated Use getRegistrarProvider() */
export function getProvider(name: string): RegistrarProvider {
  return getRegistrarProvider(name);
}

export async function syncAll(dbFns: DbFunctions): Promise<SyncAllResult> {
  const available = getAvailableProviders().filter(
    (p) => p.configured && (p.type === "registrar" || p.type === "full") && p.name !== "brandsight"
  );

  const result: SyncAllResult = { providers: [], totalSynced: 0, totalErrors: [] };

  for (const info of available) {
    try {
      const provider = getRegistrarProvider(info.name);
      const syncResult = await provider.syncToLocalDb(dbFns);
      result.providers.push({ name: info.name, result: syncResult });
      result.totalSynced += syncResult.synced;
      result.totalErrors.push(...syncResult.errors.map((e) => `[${info.name}] ${e}`));
    } catch (error) {
      const msg = `[${info.name}] Sync failed: ${error instanceof Error ? error.message : String(error)}`;
      result.totalErrors.push(msg);
      result.providers.push({ name: info.name, result: { synced: 0, created: 0, updated: 0, errors: [msg] } });
    }
  }

  return result;
}

export function autoDetectRegistrar(
  domain: string,
  getDomainByName: (name: string) => Domain | null
): string | null {
  const dbDomain = getDomainByName(domain);
  if (!dbDomain?.registrar) return null;

  const r = dbDomain.registrar.toLowerCase();
  if (r.includes("namecheap")) return "namecheap";
  if (r.includes("godaddy")) return "godaddy";
  if (r.includes("route 53") || r.includes("route53") || r.includes("aws")) return "route53";
  if (r.includes("cloudflare")) return "cloudflare";
  if (r.includes("brandsight")) return "brandsight";
  return null;
}
