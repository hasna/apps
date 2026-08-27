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
import { hasProviderCredentials, providerEnvNames } from "./env-aliases.js";

// ============================================================
// Types
// ============================================================

export interface ProviderDnsRecord {
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority?: number;
  proxied?: boolean;
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

export interface ProviderRegistrationContact {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line_1: string;
  city: string;
  state: string;
  country_code: string;
  zip_code: string;
  organization_name?: string;
}

export interface ProviderRegistrationOptions {
  years?: number;
  autoRenew?: boolean;
  premiumPrice?: number;
  nameservers?: string[];
  metadata?: Record<string, unknown>;
  privacy?: boolean;
}

export interface ProviderRegistrationResult {
  domain: string;
  success: boolean;
  orderId?: string;
  operationId?: string;
  chargedAmount?: string;
}

export interface ProviderNameserverUpdateResult {
  domain: string;
  success: boolean;
  operationId?: string;
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
  is_premium?: boolean;
  premium_price?: number;
  standard_price?: number;
  currency?: string;
}

export type DbFunctions = {
  getDomainByName: (name: string) => Promise<Domain | null>;
  createDomain: (input: CreateDomainInput) => Promise<Domain>;
  updateDomain: (id: string, input: UpdateDomainInput) => Promise<Domain | null>;
};

/** Handles domain inventory discovery and sync into the local portfolio. */
export interface DomainInventoryProvider {
  name: string;
  listDomains(): Promise<ProviderDomainInfo[]>;
  syncToLocalDb(dbFns: DbFunctions): Promise<ProviderSyncResult>;
}

/** Handles domain registration, renewal, and availability checks */
export interface RegistrarProvider extends DomainInventoryProvider {
  getDomainInfo(domain: string): Promise<ProviderDomainInfo>;
  renewDomain(domain: string, years?: number): Promise<ProviderRenewResult>;
  checkAvailability(domain: string): Promise<ProviderAvailability>;
  registerDomain?(domain: string, contact: ProviderRegistrationContact, options?: ProviderRegistrationOptions): Promise<ProviderRegistrationResult>;
  updateNameservers?(domain: string, nameservers: string[]): Promise<ProviderNameserverUpdateResult>;
}

/** Handles DNS zone and record management */
export type DnsWriteScope = "full-zone" | "changed-groups";

export interface DnsProvider {
  name: string;
  /** Omission is conservative: setDnsRecords receives the complete desired zone. */
  dnsWriteScope?: DnsWriteScope;
  getDnsRecords(domain: string): Promise<ProviderDnsRecord[]>;
  setDnsRecords(domain: string, records: ProviderDnsRecord[]): Promise<boolean>;
  /**
   * Delete the EXACT live records matching the given records.
   *
   * Omission is conservative: `dns apply` refuses a delete plan
   * (`delete-apply-unsupported`) unless the provider can converge on deletes through
   * this route, so a non-deletable provider is never written into a partial state.
   */
  deleteDnsRecords?(domain: string, records: ProviderDnsRecord[]): Promise<boolean>;
}

/** A provider that does both — e.g. Route 53 */
export type FullProvider = RegistrarProvider & DnsProvider;

export interface ProviderInfo {
  name: string;
  type: "registrar" | "dns" | "full" | "marketplace";
  configured: boolean;
  inventory?: boolean;
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

    async registerDomain(domain, contact, options = {}) {
      const config = namecheap.getConfig();
      const result = await namecheap.registerDomain(domain, contact, {
        years: options.years,
        premiumPrice: options.premiumPrice,
      }, config);
      return {
        domain: result.domain,
        success: result.success,
        orderId: result.orderId,
        chargedAmount: result.chargedAmount,
      };
    },

    async updateNameservers(domain, nameservers) {
      const config = namecheap.getConfig();
      const success = await namecheap.updateNameservers(domain, nameservers, config);
      return { domain, success };
    },

    async renewDomain(domain: string, years = 1): Promise<ProviderRenewResult> {
      const config = namecheap.getConfig();
      const result = await namecheap.renewDomain(domain, years, config);
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
      return {
        domain: result.domain,
        available: result.available,
        is_premium: result.premium,
        premium_price: result.price,
      };
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
      return {
        domain: result.domain,
        available: result.available,
        standard_price: result.price,
        currency: result.currency,
      };
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
  createInventory?: () => DomainInventoryProvider;
  createRegistrar?: () => RegistrarProvider;
  createDns?: () => DnsProvider;
}

const providerRegistry = new Map<string, RegistryEntry>([
  ["namecheap", {
    info: {
      name: "namecheap", type: "full" as const,
      configured: false,
      envVars: providerEnvNames("namecheap"),
    },
    createInventory: createNamecheapProvider,
    createRegistrar: createNamecheapProvider,
    createDns: createNamecheapProvider,
  }],
  ["godaddy", {
    info: {
      name: "godaddy", type: "full" as const,
      configured: false,
      envVars: providerEnvNames("godaddy"),
    },
    createInventory: createGoDaddyProvider,
    createRegistrar: createGoDaddyProvider,
    createDns: createGoDaddyProvider,
  }],
  ["route53", {
    info: {
      name: "route53", type: "full",
      configured: false,
      envVars: providerEnvNames("route53"),
    },
    createInventory: () => createRoute53Provider() as unknown as DomainInventoryProvider,
    createRegistrar: () => createRoute53Provider() as unknown as RegistrarProvider,
    createDns: () => createRoute53Provider() as unknown as DnsProvider,
  }],
  ["cloudflare", {
    info: {
      name: "cloudflare", type: "dns" as const,
      configured: false,
      envVars: providerEnvNames("cloudflare"),
    },
    createInventory: () => createCloudflareProvider() as unknown as DomainInventoryProvider,
    createDns: createCloudflareProvider,
  }],
  ["brandsight", {
    info: {
      name: "brandsight", type: "full" as const,
      configured: false,
      envVars: providerEnvNames("brandsight"),
    },
    createInventory: createBrandsightProvider,
    createRegistrar: createBrandsightProvider,
    createDns: createBrandsightProvider,
  }],
  ["sedo", {
    info: {
      name: "sedo", type: "marketplace" as const,
      configured: false,
      envVars: providerEnvNames("sedo"),
    },
  }],
]);

function isConfigured(providerName: string): boolean {
  return hasProviderCredentials(providerName);
}

export function registerProvider(entry: RegistryEntry): void {
  providerRegistry.set(entry.info.name.toLowerCase(), entry);
}

export function getAvailableProviders(): ProviderInfo[] {
  return Array.from(providerRegistry.values()).map((e) => ({
    ...e.info,
    configured: isConfigured(e.info.name),
    inventory: !!e.createInventory,
  }));
}

export function getProviderInfo(name: string): ProviderInfo | null {
  const entry = providerRegistry.get(name.toLowerCase());
  if (!entry) return null;
  return { ...entry.info, configured: isConfigured(entry.info.name), inventory: !!entry.createInventory };
}

export function providerHasRegistrar(name: string): boolean {
  return !!providerRegistry.get(name.toLowerCase())?.createRegistrar;
}

export function providerHasDns(name: string): boolean {
  return !!providerRegistry.get(name.toLowerCase())?.createDns;
}

export function providerHasInventory(name: string): boolean {
  return !!providerRegistry.get(name.toLowerCase())?.createInventory;
}

export function getDomainInventoryProvider(name: string): DomainInventoryProvider {
  const entry = providerRegistry.get(name.toLowerCase());
  if (!entry?.createInventory) throw new Error(`No domain inventory provider: ${name}`);
  return entry.createInventory();
}

export function getRegistrarProvider(name: string): RegistrarProvider {
  const entry = providerRegistry.get(name.toLowerCase());
  if (!entry?.createRegistrar) throw new Error(`No registrar provider: ${name}`);
  return entry.createRegistrar();
}

export function getDnsProvider(name: string): DnsProvider {
  const entry = providerRegistry.get(name.toLowerCase());
  if (!entry?.createDns) throw new Error(`No DNS provider: ${name}`);
  return entry.createDns();
}

/** @deprecated Use getRegistrarProvider() */
export function getProvider(name: string): RegistrarProvider {
  return getRegistrarProvider(name);
}

export async function syncAll(dbFns: DbFunctions): Promise<SyncAllResult> {
  const available = getAvailableProviders().filter(
    (p) => p.configured && providerHasInventory(p.name)
  );

  const result: SyncAllResult = { providers: [], totalSynced: 0, totalErrors: [] };

  for (const info of available) {
    try {
      const provider = getDomainInventoryProvider(info.name);
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

export async function autoDetectRegistrar(
  domain: string,
  getDomainByName: (name: string) => Promise<Domain | null>
): Promise<string | null> {
  const dbDomain = await getDomainByName(domain);
  if (!dbDomain?.registrar) return null;

  const r = dbDomain.registrar.toLowerCase();
  if (r.includes("cloudflare dns") || r.includes("route 53 dns") || r.includes("route53 dns")) return null;
  if (r.includes("namecheap")) return "namecheap";
  if (r.includes("godaddy")) return "godaddy";
  if (r.includes("route 53") || r.includes("route53")) return "route53";
  if (r.includes("cloudflare")) return null;
  if (r.includes("brandsight")) return "brandsight";
  return null;
}
