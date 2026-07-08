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

import { BRANDSIGHT_ENV, firstEnv } from "./env-aliases.js";
import { USER_AGENT } from "./version.js";

// ============================================================
// Types
// ============================================================

export interface BrandsightConfig {
  apiKey: string;
  apiSecret?: string;
  customerId?: string;
  shopperId?: string;
  accountId?: string;
  baseUrl?: string;
}

/**
 * Resolve Brandsight (GoDaddy Corporate Domains) credentials from standard
 * BRANDSIGHT_* env vars. Pure / testable.
 */
export function resolveBrandsightConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): BrandsightConfig {
  const apiKey = firstEnv(env, BRANDSIGHT_ENV.apiKey)?.value ?? "";
  const apiSecret = firstEnv(env, BRANDSIGHT_ENV.apiSecret)?.value;
  const customerId = firstEnv(env, BRANDSIGHT_ENV.customerId)?.value;
  const shopperId = firstEnv(env, BRANDSIGHT_ENV.shopperId)?.value;
  const accountId = firstEnv(env, BRANDSIGHT_ENV.accountId)?.value;
  return {
    apiKey,
    apiSecret,
    customerId,
    shopperId,
    accountId,
    baseUrl: env["BRANDSIGHT_BASE_URL"],
  };
}

export interface BrandsightCapability {
  configured: boolean;
  gated: boolean;
  notes: string;
}

/**
 * Brandsight is GoDaddy Corporate Domains — an enterprise/contract-only
 * registrar. Even with credentials present, automated self-serve purchase is
 * gated, so callers must not attempt it blindly.
 */
export function brandsightCapability(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): BrandsightCapability {
  const cfg = resolveBrandsightConfig(env);
  const configured = !!(cfg.apiKey && cfg.apiSecret && cfg.customerId);
  return {
    configured,
    gated: true,
    notes: configured
      ? "Credentials present, but GoDaddy Corporate Domains (Brandsight) registration and renewal are enterprise/contract-gated."
      : "Not configured; GoDaddy Corporate Domains (Brandsight) is enterprise/contract-gated.",
  };
}

export interface BrandsightDomain {
  domain: string;
  status: string;
  expires: string;
  created?: string;
  auto_renew: boolean;
  locked: boolean;
  nameservers: string[];
  domainId?: string;
  createdAt?: string;
  expiresAt?: string;
  nameServers?: string[];
  renewAuto?: boolean;
  renewal?: { currency?: string; price?: number; renewable?: boolean };
}

export interface BrandsightAvailability {
  domain: string;
  available: boolean;
  price?: number;
  currency?: string;
  registryPremiumPricing?: boolean;
}

export interface BrandsightAgreement {
  agreementKey: string;
  content?: string;
  title?: string;
  url?: string;
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
  const key = resolveBrandsightConfig().apiKey;
  if (!key) {
    throw new BrandsightApiError(
      "Brandsight API key is not set. Set BRANDSIGHT_API_KEY."
    );
  }
  return key;
}

export function getConfig(): BrandsightConfig {
  return resolveBrandsightConfig();
}

const BRANDSIGHT_BASE = "https://api.brandsight.com/v1";
const BRANDSIGHT_DOMAIN_BASE = "https://api.godaddy.com/v2";

function allowDemoStubs(): boolean {
  return process.env["BRANDSIGHT_DEMO_STUBS"] === "1" || process.env["BRANDSIGHT_ALLOW_STUBS"] === "1";
}

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
    if (!allowDemoStubs()) {
      throw new BrandsightApiError(
        `Brandsight API ${method} ${path} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
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
    if (!allowDemoStubs()) {
      throw new BrandsightApiError(
        `Brandsight API GET ${path} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return { data: null, stub: true };
  }
}

function requireDomainConfig(config?: BrandsightConfig): Required<Pick<BrandsightConfig, "apiKey" | "apiSecret" | "customerId">> & BrandsightConfig {
  const cfg = config ?? getConfig();
  if (!cfg.apiKey || !cfg.apiSecret || !cfg.customerId) {
    throw new BrandsightApiError(
      "Brandsight Domain API credentials are not configured. Set BRANDSIGHT_API_KEY, BRANDSIGHT_API_SECRET, and BRANDSIGHT_CUSTOMER_ID."
    );
  }
  return cfg as Required<Pick<BrandsightConfig, "apiKey" | "apiSecret" | "customerId">> & BrandsightConfig;
}

function domainBaseUrl(cfg: BrandsightConfig): string {
  return cfg.baseUrl ?? BRANDSIGHT_DOMAIN_BASE;
}

function domainHeaders(cfg: Required<Pick<BrandsightConfig, "apiKey" | "apiSecret">>): Record<string, string> {
  return {
    Authorization: `sso-key ${cfg.apiKey}:${cfg.apiSecret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
}

async function domainApiRequest<T>(
  method: string,
  path: string,
  config?: BrandsightConfig,
  body?: unknown,
): Promise<T> {
  const cfg = requireDomainConfig(config);
  const fetchFn = _fetchFn || globalThis.fetch;
  const response = await fetchFn(`${domainBaseUrl(cfg)}${path}`, {
    method,
    headers: domainHeaders(cfg),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new BrandsightApiError(
      `Brandsight Domain API ${method} ${path} failed with status ${response.status}`,
      response.status,
      text
    );
  }
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

function normalizeBrandsightDomain(raw: Partial<BrandsightDomain> & Record<string, unknown>): BrandsightDomain {
  const nameServers = (raw.nameServers as string[] | undefined) ?? raw.nameservers ?? [];
  const expiresAt = (raw.expiresAt as string | undefined) ?? raw.expires ?? "";
  const createdAt = (raw.createdAt as string | undefined) ?? raw.created ?? "";
  const renewAuto = (raw.renewAuto as boolean | undefined) ?? raw.auto_renew ?? false;
  return {
    ...raw,
    domain: String(raw.domain ?? ""),
    status: String(raw.status ?? "UNKNOWN"),
    created: createdAt,
    expires: expiresAt,
    auto_renew: renewAuto,
    locked: Boolean(raw.locked),
    nameservers: nameServers,
    createdAt,
    expiresAt,
    nameServers,
    renewAuto,
  };
}

function customerPath(cfg: Required<Pick<BrandsightConfig, "customerId">>, path: string): string {
  return `/customers/${encodeURIComponent(cfg.customerId)}${path}`;
}

function domainTld(domain: string): string {
  const parts = domain.split(".").filter(Boolean);
  if (parts.length < 2) throw new BrandsightApiError(`Invalid domain name: ${domain}`);
  return parts.slice(1).join(".");
}

function brandsightContact(contact: import("./registrar.js").ProviderRegistrationContact): Record<string, unknown> {
  return {
    addressMailing: {
      address1: contact.address_line_1,
      city: contact.city,
      country: contact.country_code,
      postalCode: contact.zip_code,
      state: contact.state,
    },
    email: contact.email,
    encoding: "ASCII",
    nameFirst: contact.first_name,
    nameLast: contact.last_name,
    organization: contact.organization_name,
    phone: contact.phone,
  };
}

async function domainAvailability(
  domain: string,
  cfg: Required<Pick<BrandsightConfig, "apiKey" | "apiSecret" | "customerId">> & BrandsightConfig,
  type: "REGISTRATION" | "RENEWAL",
  period = 1,
): Promise<BrandsightAvailability> {
  const params = new URLSearchParams({
    domain,
    period: String(period),
    type,
    optimizeFor: "ACCURACY",
  });
  const result = await domainApiRequest<{
    domain: string;
    available: boolean;
    price?: number;
    currency?: string;
    registryPremiumPricing?: boolean;
  }>("GET", `/domains/available?${params.toString()}`, cfg);
  return {
    domain: result.domain ?? domain,
    available: Boolean(result.available),
    price: result.price,
    currency: result.currency,
    registryPremiumPricing: result.registryPremiumPricing,
  };
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
  const cfg = requireDomainConfig(config);
  const domains: BrandsightDomain[] = [];
  const seenMarkers = new Set<string>();
  let marker: string | undefined;

  while (true) {
    const params = new URLSearchParams({ limit: "500" });
    if (marker) params.set("marker", marker);
    const batch = await domainApiRequest<Array<Partial<BrandsightDomain> & Record<string, unknown>>>(
      "GET",
      customerPath(cfg, `/domains?${params.toString()}`),
      cfg,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    domains.push(...batch.map(normalizeBrandsightDomain).filter((d) => d.domain));
    if (batch.length < 500) break;
    const nextMarker = String(batch[batch.length - 1]?.domain ?? "");
    if (!nextMarker || seenMarkers.has(nextMarker)) break;
    seenMarkers.add(nextMarker);
    marker = nextMarker;
  }

  return domains;
}

export async function getDomainInfo(domain: string, config?: BrandsightConfig): Promise<BrandsightDomain | null> {
  const cfg = requireDomainConfig(config);
  const result = await domainApiRequest<Partial<BrandsightDomain> & Record<string, unknown>>(
    "GET",
    customerPath(cfg, `/domains/${encodeURIComponent(domain)}`),
    cfg,
  );
  return normalizeBrandsightDomain(result);
}

export async function checkAvailability(domain: string, config?: BrandsightConfig): Promise<BrandsightAvailability> {
  const cfg = requireDomainConfig(config);
  return domainAvailability(domain, cfg, "REGISTRATION", 1);
}

export async function renewDomain(domain: string, years = 1, config?: BrandsightConfig): Promise<{ success: boolean; orderId?: string }> {
  const cfg = requireDomainConfig(config);
  const current = await getDomainInfo(domain, cfg);
  if (!current?.expires) throw new BrandsightApiError(`Cannot renew ${domain}: current expiry is unavailable`);
  const quote = await domainAvailability(domain, cfg, "RENEWAL", years);
  const price = quote.price ?? current.renewal?.price;
  const currency = quote.currency ?? current.renewal?.currency;
  if (price == null || !currency) {
    throw new BrandsightApiError(`Cannot renew ${domain}: renewal quote did not include an exact price and currency`);
  }
  const result = await domainApiRequest<{ orderId?: string; id?: string }>(
    "POST",
    customerPath(cfg, `/domains/${encodeURIComponent(domain)}/renew`),
    cfg,
    {
      consent: {
        agreedAt: new Date().toISOString(),
        agreedBy: cfg.shopperId ?? "domains-cli",
        currency,
        price,
        registryPremiumPricing: quote.registryPremiumPricing ?? false,
      },
      expires: current.expires,
      period: years,
    }
  );
  return { success: true, orderId: result.orderId ?? result.id };
}

export async function getLegalAgreements(tld: string, privacy = false, config?: BrandsightConfig): Promise<BrandsightAgreement[]> {
  const cfg = requireDomainConfig(config);
  const params = new URLSearchParams({
    privacy: String(privacy),
    tlds: tld,
  });
  return domainApiRequest<BrandsightAgreement[]>(
    "GET",
    customerPath(cfg, `/domains/agreements?${params.toString()}`),
    cfg,
  );
}

export async function getRegistrationSchema(tld: string, config?: BrandsightConfig): Promise<Record<string, unknown>> {
  const cfg = requireDomainConfig(config);
  return domainApiRequest<Record<string, unknown>>(
    "GET",
    customerPath(cfg, `/domains/register/schema/${encodeURIComponent(tld)}`),
    cfg,
  );
}

export async function validateRegistrationRequest(payload: Record<string, unknown>, config?: BrandsightConfig): Promise<boolean> {
  const cfg = requireDomainConfig(config);
  await domainApiRequest(
    "POST",
    customerPath(cfg, "/domains/register/validate"),
    cfg,
    payload,
  );
  return true;
}

export async function registerBrandsightDomain(
  domain: string,
  contact: import("./registrar.js").ProviderRegistrationContact,
  options: import("./registrar.js").ProviderRegistrationOptions = {},
  config?: BrandsightConfig,
): Promise<{ success: boolean; orderId?: string; operationId?: string; chargedAmount?: string }> {
  const cfg = requireDomainConfig(config);
  const period = options.years ?? 1;
  const availability = await domainAvailability(domain, cfg, "REGISTRATION", period);
  if (!availability.available) throw new BrandsightApiError(`${domain} is not available for registration`);
  const price = options.premiumPrice ?? availability.price;
  if (price == null || !availability.currency) {
    throw new BrandsightApiError(`Cannot register ${domain}: availability quote did not include an exact price and currency`);
  }

  const tld = domainTld(domain);
  const schema = await getRegistrationSchema(tld, cfg);
  const required = Array.isArray(schema["required"]) ? schema["required"] as string[] : [];
  if (required.includes("metadata") && !options.metadata) {
    throw new BrandsightApiError(`Cannot register ${domain}: ${tld} requires TLD-specific metadata; pass registration metadata before validation`);
  }
  const privacy = options.privacy ?? false;
  const agreements = await getLegalAgreements(tld, privacy, cfg);
  const agreementKeys = agreements.map((a) => a.agreementKey).filter(Boolean);
  const c = brandsightContact(contact);
  const payload: Record<string, unknown> = {
    consent: {
      agreedAt: new Date().toISOString(),
      agreedBy: contact.email || cfg.shopperId || "domains-cli",
      agreementKeys,
      currency: availability.currency,
      price,
      registryPremiumPricing: availability.registryPremiumPricing ?? !!options.premiumPrice,
    },
    contacts: {
      admin: c,
      billing: c,
      registrant: c,
      tech: c,
    },
    domain,
    metadata: options.metadata ?? {},
    nameServers: options.nameservers ?? [],
    period,
    privacy,
    renewAuto: options.autoRenew ?? true,
  };

  await validateRegistrationRequest(payload, cfg);
  const result = await domainApiRequest<{ orderId?: string; id?: string; operationId?: string }>(
    "POST",
    customerPath(cfg, "/domains/register"),
    cfg,
    payload,
  );
  return {
    success: true,
    orderId: result.orderId ?? result.id,
    operationId: result.operationId ?? result.id,
    chargedAmount: String(price),
  };
}

export async function updateNameservers(domain: string, nameservers: string[], config?: BrandsightConfig): Promise<{ success: boolean; operationId?: string }> {
  const cfg = requireDomainConfig(config);
  const result = await domainApiRequest<{ id?: string; operationId?: string }>(
    "PUT",
    customerPath(cfg, `/domains/${encodeURIComponent(domain)}/nameServers`),
    cfg,
    { nameServers: nameservers }
  );
  return { success: true, operationId: result.operationId ?? result.id };
}

export interface BrandsightDnsRecord {
  type: string;
  name: string;
  data: string;
  ttl: number;
  priority?: number;
  port?: number;
  protocol?: string;
  service?: string;
  weight?: number;
}

export async function getDnsRecords(domain: string, config?: BrandsightConfig): Promise<BrandsightDnsRecord[]> {
  const cfg = requireDomainConfig(config);
  const records: BrandsightDnsRecord[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const batch = await domainApiRequest<BrandsightDnsRecord[]>(
      "GET",
      customerPath(cfg, `/domains/${encodeURIComponent(domain)}/records?offset=${offset}&limit=${limit}`),
      cfg,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    records.push(...batch);
    if (batch.length < limit) break;
    offset++;
  }

  return records;
}

function normalizeBrandsightDnsRecord(record: BrandsightDnsRecord): BrandsightDnsRecord {
  return {
    ...record,
    ttl: Math.max(record.ttl || 600, 600),
  };
}

export async function setDnsRecords(domain: string, records: BrandsightDnsRecord[], config?: BrandsightConfig): Promise<boolean> {
  const cfg = requireDomainConfig(config);
  await domainApiRequest(
    "PUT",
    customerPath(cfg, `/domains/${encodeURIComponent(domain)}/records`),
    cfg,
    records.map(normalizeBrandsightDnsRecord)
  );
  return true;
}

export async function syncToLocalDb(
  dbFns: { getDomainByName: (name: string) => Promise<import("../db/domains.js").Domain | null>; createDomain: (input: import("../db/domains.js").CreateDomainInput) => Promise<import("../db/domains.js").Domain>; updateDomain: (id: string, input: import("../db/domains.js").UpdateDomainInput) => Promise<import("../db/domains.js").Domain | null>; },
  config?: BrandsightConfig
): Promise<{ synced: number; created: number; updated: number; errors: string[] }> {
  const domains = await listDomains(config);
  let synced = 0, created = 0, updated = 0;
  const errors: string[] = [];

  for (const d of domains) {
    try {
      const existing = await dbFns.getDomainByName(d.domain);
      if (existing) {
        await dbFns.updateDomain(existing.id, {
          registrar: "Brandsight",
          expires_at: d.expires || undefined,
          auto_renew: d.auto_renew,
          status: "active",
          nameservers: d.nameservers,
        });
        updated++;
      } else {
        await dbFns.createDomain({
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

import type {
  FullProvider,
  ProviderAvailability,
  ProviderDnsRecord,
  ProviderDomainInfo,
  ProviderNameserverUpdateResult,
  ProviderRegistrationContact,
  ProviderRegistrationOptions,
  ProviderRegistrationResult,
  ProviderRenewResult,
  ProviderSyncResult,
  DbFunctions,
} from "./registrar.js";

export function createBrandsightProvider(config?: BrandsightConfig): FullProvider {
  const cfg = config ?? getConfig();

  return {
    name: "brandsight",

    async listDomains(): Promise<ProviderDomainInfo[]> {
      const domains = await listDomains(cfg);
      return domains.map((d) => ({
        domain: d.domain,
        registrar: "Brandsight",
        created: d.created ?? "",
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
        created: d.created ?? "",
        expires: d.expires,
        nameservers: d.nameservers,
        status: d.status === "ACTIVE" ? "active" : d.status.toLowerCase(),
        auto_renew: d.auto_renew,
      };
    },

    async renewDomain(domain: string, years = 1): Promise<ProviderRenewResult> {
      const result = await renewDomain(domain, years, cfg);
      return { domain, success: result.success, orderId: result.orderId };
    },

    async registerDomain(domain: string, contact: ProviderRegistrationContact, options?: ProviderRegistrationOptions): Promise<ProviderRegistrationResult> {
      const result = await registerBrandsightDomain(domain, contact, options, cfg);
      return {
        domain,
        success: result.success,
        orderId: result.orderId,
        operationId: result.operationId,
        chargedAmount: result.chargedAmount,
      };
    },

    async updateNameservers(domain: string, nameservers: string[]): Promise<ProviderNameserverUpdateResult> {
      const result = await updateNameservers(domain, nameservers, cfg);
      return { domain, success: result.success, operationId: result.operationId };
    },

    async getDnsRecords(domain: string): Promise<ProviderDnsRecord[]> {
      const records = await getDnsRecords(domain, cfg);
      return records.map((r) => ({
        type: r.type,
        name: r.name,
        value: r.data,
        ttl: r.ttl,
        priority: r.priority,
      }));
    },

    async setDnsRecords(domain: string, records: ProviderDnsRecord[]): Promise<boolean> {
      return setDnsRecords(
        domain,
        records.map((r) => ({
          type: r.type,
          name: r.name,
          data: r.value,
          ttl: r.ttl,
          priority: r.priority,
        })),
        cfg
      );
    },

    async checkAvailability(domain: string): Promise<ProviderAvailability> {
      const result = await checkAvailability(domain, cfg);
      return {
        domain: result.domain,
        available: result.available,
        is_premium: result.registryPremiumPricing,
        premium_price: result.registryPremiumPricing ? result.price : undefined,
        standard_price: result.registryPremiumPricing ? undefined : result.price,
        currency: result.currency,
      };
    },

    async syncToLocalDb(dbFns: DbFunctions): Promise<ProviderSyncResult> {
      return syncToLocalDb(dbFns, cfg);
    },
  };
}
