/**
 * Brandsight — GoDaddy's enterprise brand protection and domain registrar platform
 *
 * Two distinct capabilities:
 *   1. Domain registrar (GoDaddy Corporate Domains via Brandsight)
 *   2. Brand monitoring / threat detection
 *
 * Env vars:
 *   BRANDSIGHT_API_KEY — API key for Brandsight
 *   BRANDSIGHT_ACCOUNT_ID — Account ID for corporate domain operations (optional)
 */

import { USER_AGENT } from "./version.js";

// ============================================================
// Types
// ============================================================

export interface BrandsightConfig {
  apiKey: string;
  accountId?: string;
  baseUrl?: string;
}

export interface BrandsightDomain {
  domain: string;
  status: string;
  expires: string;
  auto_renew: boolean;
  locked: boolean;
  nameservers: string[];
}

export interface BrandsightAvailability {
  domain: string;
  available: boolean;
  price?: number;
  currency?: string;
}

export interface BrandsightAlert {
  domain: string;
  type: "typosquat" | "homoglyph" | "keyword" | "tld_variation";
  registered_at: string;
}

export interface BrandMonitorResult {
  brand: string;
  alerts: BrandsightAlert[];
  stub: boolean;
}

export interface WhoisHistoryEntry {
  registrant: string;
  date: string;
  changes: string[];
}

export interface WhoisHistoryResult {
  domain: string;
  history: WhoisHistoryEntry[];
  stub: boolean;
}

export interface ThreatAssessment {
  domain: string;
  risk_level: "low" | "medium" | "high" | "critical";
  threats: string[];
  recommendation: string;
  stub: boolean;
}

export class BrandsightApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseBody?: string
  ) {
    super(message);
    this.name = "BrandsightApiError";
  }
}

// ============================================================
// Brandsight Client
// ============================================================

type FetchFn = typeof globalThis.fetch;

let _fetchFn: FetchFn | null = null;

export function _setFetch(fn: FetchFn | null): void {
  _fetchFn = fn;
}

export function getApiKey(): string {
  const key = process.env["BRANDSIGHT_API_KEY"];
  if (!key) {
    throw new BrandsightApiError(
      "BRANDSIGHT_API_KEY environment variable is not set"
    );
  }
  return key;
}

export function getConfig(): BrandsightConfig {
  return {
    apiKey: process.env["BRANDSIGHT_API_KEY"] ?? "",
    accountId: process.env["BRANDSIGHT_ACCOUNT_ID"],
  };
}

const BRANDSIGHT_BASE = "https://api.brandsight.com/v1";

async function apiRequest<T>(
  method: string,
  path: string,
  apiKey: string,
  body?: unknown,
  baseUrl: string = BRANDSIGHT_BASE
): Promise<{ data: T; stub: false } | { data: null; stub: true }> {
  const fetchFn = _fetchFn || globalThis.fetch;
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  try {
    const response = await fetchFn(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new BrandsightApiError(
        `Brandsight API ${method} ${path} failed with status ${response.status}`,
        response.status,
        await response.text()
      );
    }
    const data = (await response.json()) as T;
    return { data, stub: false };
  } catch (error) {
    if (error instanceof BrandsightApiError) throw error;
    return { data: null, stub: true };
  }
}

async function apiGet<T>(
  path: string,
  apiKey: string,
  baseUrl: string = BRANDSIGHT_BASE
): Promise<{ data: T; stub: false } | { data: null; stub: true }> {
  const fetchFn = _fetchFn || globalThis.fetch;
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };

  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new BrandsightApiError(
        `Brandsight API GET ${path} failed with status ${response.status}`,
        response.status,
        await response.text()
      );
    }

    const data = (await response.json()) as T;
    return { data, stub: false };
  } catch (error) {
    if (error instanceof BrandsightApiError) throw error;
    return { data: null, stub: true };
  }
}

// ============================================================
// Stub Data Generators
// ============================================================

function generateStubAlerts(brandName: string): BrandsightAlert[] {
  const now = new Date().toISOString();
  return [
    { domain: `${brandName}-deals.com`, type: "keyword", registered_at: now },
    { domain: `${brandName.replace(/a/gi, "4").replace(/e/gi, "3")}.com`, type: "homoglyph", registered_at: now },
    { domain: `${brandName}s.com`, type: "typosquat", registered_at: now },
  ];
}

function generateStubSimilarDomains(domain: string): string[] {
  const base = domain.replace(/\.[^.]+$/, "");
  const tld = domain.slice(base.length);
  return [
    `${base}-online${tld}`,
    `${base}s${tld}`,
    `${base.replace(/a/gi, "4")}${tld}`,
    `${base}-app${tld}`,
    `get${base}${tld}`,
  ];
}

function generateStubWhoisHistory(domain: string): WhoisHistoryEntry[] {
  void domain;
  return [
    {
      registrant: "Privacy Proxy Service",
      date: "2023-01-15T00:00:00Z",
      changes: ["registrant_changed", "nameserver_changed"],
    },
    {
      registrant: "Original Owner LLC",
      date: "2020-06-01T00:00:00Z",
      changes: ["initial_registration"],
    },
  ];
}

function generateStubThreatAssessment(domain: string): Omit<ThreatAssessment, "stub"> {
  return {
    domain,
    risk_level: "low",
    threats: [],
    recommendation: "No immediate threats detected. Continue routine monitoring.",
  };
}

// ============================================================
// API Functions
// ============================================================

export async function monitorBrand(brandName: string): Promise<BrandMonitorResult> {
  const apiKey = getApiKey();
  const result = await apiGet<{ alerts: BrandsightAlert[] }>(
    `/brands/${encodeURIComponent(brandName)}/monitor`,
    apiKey
  );

  if (result.stub) {
    return { brand: brandName, alerts: generateStubAlerts(brandName), stub: true };
  }

  return { brand: brandName, alerts: result.data!.alerts, stub: false };
}

export async function getSimilarDomains(domain: string): Promise<{ domain: string; similar: string[]; stub: boolean }> {
  const apiKey = getApiKey();
  const result = await apiGet<{ similar: string[] }>(
    `/domains/${encodeURIComponent(domain)}/similar`,
    apiKey
  );

  if (result.stub) {
    return { domain, similar: generateStubSimilarDomains(domain), stub: true };
  }

  return { domain, similar: result.data!.similar, stub: false };
}

export async function getWhoisHistory(domain: string): Promise<WhoisHistoryResult> {
  const apiKey = getApiKey();
  const result = await apiGet<{ history: WhoisHistoryEntry[] }>(
    `/domains/${encodeURIComponent(domain)}/whois-history`,
    apiKey
  );

  if (result.stub) {
    return { domain, history: generateStubWhoisHistory(domain), stub: true };
  }

  return { domain, history: result.data!.history, stub: false };
}

export async function getThreatAssessment(domain: string): Promise<ThreatAssessment> {
  const apiKey = getApiKey();
  const result = await apiGet<Omit<ThreatAssessment, "stub">>(
    `/domains/${encodeURIComponent(domain)}/threats`,
    apiKey
  );

  if (result.stub) {
    return { ...generateStubThreatAssessment(domain), stub: true };
  }

  return { ...result.data!, stub: false };
}

// ============================================================
// Registrar Functions (Brandsight Corporate Domains / GoDaddy)
// ============================================================

export async function listDomains(config?: BrandsightConfig): Promise<BrandsightDomain[]> {
  const cfg = config ?? getConfig();
  const result = await apiGet<{ domains: BrandsightDomain[] }>("/portfolio/domains", cfg.apiKey);
  if (result.stub) return [];
  return result.data!.domains ?? [];
}

export async function getDomainInfo(domain: string, config?: BrandsightConfig): Promise<BrandsightDomain | null> {
  const cfg = config ?? getConfig();
  const result = await apiGet<BrandsightDomain>(`/portfolio/domains/${encodeURIComponent(domain)}`, cfg.apiKey);
  if (result.stub) return null;
  return result.data;
}

export async function checkAvailability(domain: string, config?: BrandsightConfig): Promise<BrandsightAvailability> {
  const cfg = config ?? getConfig();
  const result = await apiGet<BrandsightAvailability>(`/domains/check?domain=${encodeURIComponent(domain)}`, cfg.apiKey);
  if (result.stub) return { domain, available: false };
  return result.data!;
}

export async function renewDomain(domain: string, years = 1, config?: BrandsightConfig): Promise<{ success: boolean; orderId?: string }> {
  const cfg = config ?? getConfig();
  const result = await apiRequest<{ orderId: string }>(
    "POST", `/portfolio/domains/${encodeURIComponent(domain)}/renew`, cfg.apiKey, { years }
  );
  if (result.stub) return { success: false };
  return { success: true, orderId: result.data!.orderId };
}

export async function syncToLocalDb(
  dbFns: { getDomainByName: (name: string) => import("../db/domains.js").Domain | null; createDomain: (input: import("../db/domains.js").CreateDomainInput) => import("../db/domains.js").Domain; updateDomain: (id: string, input: import("../db/domains.js").UpdateDomainInput) => import("../db/domains.js").Domain | null; },
  config?: BrandsightConfig
): Promise<{ synced: number; created: number; updated: number; errors: string[] }> {
  const domains = await listDomains(config);
  let synced = 0, created = 0, updated = 0;
  const errors: string[] = [];

  for (const d of domains) {
    try {
      const existing = dbFns.getDomainByName(d.domain);
      if (existing) {
        dbFns.updateDomain(existing.id, {
          registrar: "Brandsight",
          expires_at: d.expires || undefined,
          auto_renew: d.auto_renew,
          status: "active",
          nameservers: d.nameservers,
        });
        updated++;
      } else {
        dbFns.createDomain({
          name: d.domain,
          registrar: "Brandsight",
          expires_at: d.expires || undefined,
          auto_renew: d.auto_renew,
          status: "active",
          nameservers: d.nameservers,
        });
        created++;
      }
      synced++;
    } catch (err) {
      errors.push(`${d.domain}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { synced, created, updated, errors };
}

// ============================================================
// RegistrarProvider Adapter
// ============================================================

import type { RegistrarProvider, ProviderDomainInfo, ProviderRenewResult, ProviderAvailability, ProviderSyncResult, DbFunctions } from "./registrar.js";

export function createBrandsightProvider(config?: BrandsightConfig): RegistrarProvider {
  const cfg = config ?? getConfig();

  return {
    name: "brandsight",

    async listDomains(): Promise<ProviderDomainInfo[]> {
      const domains = await listDomains(cfg);
      return domains.map((d) => ({
        domain: d.domain,
        registrar: "Brandsight",
        created: "",
        expires: d.expires,
        nameservers: d.nameservers,
        status: d.status === "ACTIVE" ? "active" : d.status.toLowerCase(),
        auto_renew: d.auto_renew,
      }));
    },

    async getDomainInfo(domain: string): Promise<ProviderDomainInfo> {
      const d = await getDomainInfo(domain, cfg);
      if (!d) throw new Error(`Domain not found in Brandsight: ${domain}`);
      return {
        domain: d.domain,
        registrar: "Brandsight",
        created: "",
        expires: d.expires,
        nameservers: d.nameservers,
        status: d.status === "ACTIVE" ? "active" : d.status.toLowerCase(),
        auto_renew: d.auto_renew,
      };
    },

    async renewDomain(domain: string): Promise<ProviderRenewResult> {
      const result = await renewDomain(domain, 1, cfg);
      return { domain, success: result.success, orderId: result.orderId };
    },

    async checkAvailability(domain: string): Promise<ProviderAvailability> {
      const result = await checkAvailability(domain, cfg);
      return { domain: result.domain, available: result.available };
    },

    async syncToLocalDb(dbFns: DbFunctions): Promise<ProviderSyncResult> {
      return syncToLocalDb(dbFns, cfg);
    },
  };
}
