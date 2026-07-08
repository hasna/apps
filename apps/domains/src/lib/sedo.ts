/**
 * Sedo marketplace provider
 *
 * Wraps the Sedo domain marketplace connector for domain search,
 * availability, purchase, and portfolio management.
 *
 * Uses XML-based API (SOAP/XML-RPC over HTTP POST) as documented at
 * https://api.sedo.com/apidocs/v1/
 *
 * Auth: partnerid, signkey, username, password via env vars:
 *   SEDO_PARTNER_ID, SEDO_API_KEY (signkey), SEDO_USERNAME, SEDO_PASSWORD
 */

import { firstEnv, SEDO_ENV } from "./env-aliases.js";
import { createDomain, getDomainByName } from "../db/domains.js";
import { createHistoryEntry } from "../db/history.js";

// ============================================================
// Types
// ============================================================

export interface SedoConfig {
  partnerId: string;
  signKey: string;
  username: string;
  password: string;
  [key: string]: unknown;
}

export interface SedoDomain {
  domain: string;
  forSale: boolean;
  price?: number;
  currency?: string;
  status?: string;
  isPremium?: boolean;
}

export interface SedoSearchResult {
  domains: SedoDomain[];
  total: number;
}

export interface SedoStatusResult {
  domain: string;
  listed: boolean;
  forSale: boolean;
  price?: number;
  currency?: string;
  partnerId?: number;
  status?: string;
}

export interface SedoPurchaseResult {
  domain: string;
  success: boolean;
  error?: string;
  orderId?: string;
  price?: number;
}

// ============================================================
// Config
// ============================================================

export function resolveSedoConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Partial<SedoConfig> {
  return {
    partnerId: firstEnv(env, SEDO_ENV.partnerId)?.value,
    signKey: firstEnv(env, SEDO_ENV.signKey)?.value,
    username: firstEnv(env, SEDO_ENV.username)?.value,
    password: firstEnv(env, SEDO_ENV.password)?.value,
  };
}

export function getSedoConfig(): SedoConfig {
  const config = resolveSedoConfig();
  const { partnerId, signKey, username, password } = config;

  if (!partnerId || !signKey || !username || !password) {
    throw new Error(
      "Sedo credentials not configured. Required: SEDO_PARTNER_ID, SEDO_API_KEY, SEDO_USERNAME, SEDO_PASSWORD"
    );
  }

  return { partnerId, signKey, username, password };
}

export interface SedoCapability {
  configured: boolean;
  gated: boolean;
  notes: string;
}

export function sedoCapability(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): SedoCapability {
  const cfg = resolveSedoConfig(env);
  const configured = !!(cfg.partnerId && cfg.signKey && cfg.username && cfg.password);
  return {
    configured,
    gated: true,
    notes: configured
      ? "Credentials present; Sedo supports marketplace search, portfolio listing, listing edits, and recorded purchases, but not registrar DNS or direct self-serve registration through this CLI."
      : "Not configured; Sedo is marketplace-only here, not registrar DNS.",
  };
}

// ============================================================
// XML helpers for Sedo API
// ============================================================

const BASE_URL = "https://api.sedo.com/api/v1/";

/**
 * Sedo encodes currency as an integer code in API responses
 * (see DomainInsert / DomainSearch docs): 0 = EUR, 1 = USD, 2 = GBP.
 */
export const SEDO_CURRENCY_CODES: Record<string, string> = {
  "0": "EUR",
  "1": "USD",
  "2": "GBP",
};

export interface SedoFault {
  code: string;
  message: string;
}

function buildAuthParams(config: SedoConfig): Record<string, string> {
  return {
    partnerid: config.partnerId,
    signkey: config.signKey,
    username: config.username,
    password: config.password,
  };
}

async function sedoRequestRaw(
  action: string,
  config: SedoConfig,
  extraParams: Record<string, unknown> = {}
): Promise<string> {
  const params = new URLSearchParams({
    ...buildAuthParams(config),
    output_method: "xml",
    ...Object.fromEntries(
      Object.entries(extraParams).map(([k, v]) => [k, String(v)])
    ),
  });

  const url = `${BASE_URL}${action}?${params.toString()}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Sedo API ${action} failed: ${resp.status} ${resp.statusText}`);
  }

  return resp.text();
}

async function sedoRequest(
  action: string,
  config: SedoConfig,
  extraParams: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const text = await sedoRequestRaw(action, config, extraParams);

  // Surface API-level faults instead of silently returning empty results.
  const fault = parseSedoFault(text);
  if (fault) {
    throw new Error(`Sedo API ${action} fault ${fault.code}: ${fault.message}`);
  }

  return parseSedoXml(text);
}

/**
 * Detect and parse a Sedo <SEDOFAULT> error envelope.
 * Returns null when the response is not a fault.
 */
export function parseSedoFault(xml: string): SedoFault | null {
  if (!/<SEDOFAULT\b/i.test(xml)) return null;
  const code = xml.match(/<faultcode[^>]*>([^<]*)<\/faultcode>/i)?.[1]?.trim() || "UNKNOWN";
  const message =
    xml.match(/<faultstring[^>]*>([^<]*)<\/faultstring>/i)?.[1]?.trim() || code;
  return { code, message };
}

function parseSedoXml(xml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Extract items from XML — handles most Sedo response formats
  const itemMatches = xml.match(/<item[^>]*>([\s\S]*?)<\/item>/g);
  if (itemMatches) {
    const items: Record<string, unknown>[] = [];
    for (const item of itemMatches) {
      items.push(parseSedoItemXml(item));
    }
    result.items = items;
    return result;
  }

  // Single response — parse direct tags
  return parseSedoItemXml(xml);
}

function parseSedoItemXml(itemXml: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};

  // Match <tag type="xsd:string">value</tag>
  const tagRegex = /<(\w+)[^>]*>([^<]*)<\/\1>/g;
  let match;
  while ((match = tagRegex.exec(itemXml)) !== null) {
    const [, key, value] = match;
    if (key && value !== undefined) {
      obj[key] = value.trim();
    }
  }

  return obj;
}

// ============================================================
// Domain Search
// ============================================================

export interface SedoSearchOptions {
  tld?: string;
  limit?: number;
  minPrice?: number;
  maxPrice?: number;
  /** Keyword match mode: B=begins with, C=contains, E=ends with. Default C. */
  kwtype?: "B" | "C" | "E";
  /** ISO 639-1 result language. Default "en". */
  language?: string;
}

/**
 * Build the Sedo DomainSearch request params using the documented
 * parameter names. The marketplace search action is `keyword` based —
 * `searchword`/`limit` are NOT recognized and yield an E1201 fault.
 * See https://api.sedo.com/apidocs/v1/Basic/functions/sedoapi_DomainSearch.html
 */
export function buildSedoSearchParams(
  query: string,
  options: SedoSearchOptions = {}
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    keyword: query,
    kwtype: options.kwtype || "C",
    resultsize: options.limit || 100,
    language: options.language || "en",
  };

  if (options.tld) params.tld = options.tld;
  if (options.minPrice) params.price_min = options.minPrice;
  if (options.maxPrice) params.price_max = options.maxPrice;

  return params;
}

/**
 * Parse a Sedo <SEDOSEARCH> XML response into domain listings.
 * Throws if the response is a <SEDOFAULT> error envelope.
 */
export function parseSedoSearchResponse(xml: string): SedoSearchResult {
  const fault = parseSedoFault(xml);
  if (fault) {
    throw new Error(`Sedo DomainSearch fault ${fault.code}: ${fault.message}`);
  }

  const response = parseSedoXml(xml);
  const items = (response.items as Record<string, unknown>[]) || [];

  const domains: SedoDomain[] = items.map((item) => {
    const rawPrice = item.price as string | undefined;
    const price = rawPrice !== undefined ? parseFloat(rawPrice) : undefined;
    const currencyCode = item.currency as string | undefined;
    const currency =
      currencyCode !== undefined
        ? SEDO_CURRENCY_CODES[currencyCode] || currencyCode
        : undefined;

    return {
      domain: (item.domain as string) || "",
      // Every result from DomainSearch is a marketplace listing for sale.
      forSale: true,
      // price 0 means "make offer" (no fixed price) — keep it undefined.
      price: price && price > 0 ? price : undefined,
      currency: price && price > 0 ? currency : undefined,
      status: (item.type as string) || undefined,
    };
  });

  return { domains, total: domains.length };
}

/**
 * Search for domains for sale on Sedo.
 */
export async function searchSedoDomains(
  query: string,
  options: SedoSearchOptions = {}
): Promise<SedoSearchResult> {
  const config = getSedoConfig();
  const params = buildSedoSearchParams(query, options);
  const xml = await sedoRequestRaw("DomainSearch", config, params);
  return parseSedoSearchResponse(xml);
}

/**
 * Search health/tech domains on Sedo — convenience method.
 */
export async function searchHealthDomains(
  options: { tld?: string; limit?: number } = {}
): Promise<SedoSearchResult> {
  return searchSedoDomains("health", { ...options, limit: options.limit || 100 });
}

// ============================================================
// Domain Status
// ============================================================

/**
 * Check domain status on Sedo — whether listed for sale.
 */
export async function checkSedoStatus(
  domains: string[]
): Promise<SedoStatusResult[]> {
  const config = getSedoConfig();

  const results: SedoStatusResult[] = [];

  for (const domain of domains) {
    try {
      const response = await sedoRequest("DomainStatus", config, { domain });
      results.push({
        domain: (response.domain as string) || domain,
        listed: response.listed === "1" || response.listed === "true",
        forSale: response.for_sale === "1" || response.for_sale === "true",
        price: response.price ? parseFloat(response.price as string) : undefined,
        currency: (response.currency as string) || undefined,
        status: (response.status as string) || undefined,
      });
    } catch {
      results.push({ domain, listed: false, forSale: false, status: "error" });
    }
  }

  return results;
}

// ============================================================
// Portfolio — list domains managed via Sedo
// ============================================================

/**
 * List domains in your Sedo portfolio.
 */
export async function listSedoPortfolio(options: { limit?: number } = {}): Promise<SedoDomain[]> {
  const config = getSedoConfig();

  const response = await sedoRequest("DomainList", config, {
    limit: options.limit || 100,
  });

  const items = (response.items as Record<string, unknown>[]) || [];
  return items.map((item) => ({
    domain: (item.domain as string) || "",
    forSale: item.for_sale === "1" || item.for_sale === "true",
    price: item.price ? parseFloat(item.price as string) : undefined,
    currency: (item.currency as string) || undefined,
    status: (item.status as string) || undefined,
  }));
}

// ============================================================
// Add/Edit/Remove domains from Sedo
// ============================================================

export interface SedoDomainInput {
  domain: string;
  price?: number;
  currency?: string;
  forSale?: boolean;
  parkingEnabled?: boolean;
  buyNowPrice?: number;
}

/**
 * Add a domain to Sedo marketplace.
 */
export async function addDomainToSedo(input: SedoDomainInput): Promise<SedoStatusResult> {
  const config = getSedoConfig();

  const params: Record<string, unknown> = {
    domain: input.domain,
  };

  if (input.price) params.price = input.price;
  if (input.currency) params.currency = input.currency;
  if (input.forSale !== undefined) params.for_sale = input.forSale ? 1 : 0;
  if (input.buyNowPrice) params.buy_now_price = input.buyNowPrice;
  if (input.parkingEnabled !== undefined) params.parking = input.parkingEnabled ? 1 : 0;

  const response = await sedoRequest("DomainInsert", config, params);

  return {
    domain: (response.domain as string) || input.domain,
    listed: true,
    forSale: input.forSale ?? true,
    price: input.price,
    currency: input.currency,
    status: (response.status as string) || undefined,
  };
}

/**
 * Update an existing domain on Sedo.
 */
export async function editDomainOnSedo(input: SedoDomainInput): Promise<SedoStatusResult> {
  const config = getSedoConfig();

  const params: Record<string, unknown> = { domain: input.domain };
  if (input.price) params.price = input.price;
  if (input.currency) params.currency = input.currency;
  if (input.forSale !== undefined) params.for_sale = input.forSale ? 1 : 0;
  if (input.buyNowPrice) params.buy_now_price = input.buyNowPrice;

  const response = await sedoRequest("DomainEdit", config, params);

  return {
    domain: (response.domain as string) || input.domain,
    listed: true,
    forSale: input.forSale ?? true,
    price: input.price,
    currency: input.currency,
    status: (response.status as string) || undefined,
  };
}

/**
 * Remove a domain from Sedo marketplace.
 */
export async function removeDomainFromSedo(domain: string): Promise<boolean> {
  const config = getSedoConfig();
  const response = await sedoRequest("DomainDelete", config, { domain });
  return response.status === "ok";
}

// ============================================================
// Blacklist Check
// ============================================================

/**
 * Check if domains are blacklisted at Sedo.
 */
export async function checkSedoBlacklist(
  domains: string[]
): Promise<{ domain: string; blacklisted: boolean }[]> {
  const config = getSedoConfig();
  const response = await sedoRequest("CheckBlacklist", config, {
    blacklist: domains,
  });

  const items = (response.items as Record<string, unknown>[]) || [];
  return items.map((item) => ({
    domain: (item.domain as string) || "",
    blacklisted: item.blacklisted === "1" || item.blacklisted === "true",
  }));
}

// ============================================================
// Purchase via Sedo — requires external payment
// ============================================================

/**
 * Record a Sedo domain purchase in the local DB.
 * Sedo doesn't have a direct purchase API — purchases go through
 * their marketplace UI. This records the acquisition locally.
 */
export async function recordSedoPurchase(
  domain: string,
  price: number,
  orderId?: string
) {
  const existing = await getDomainByName(domain);
  if (existing) {
    throw new Error(`Domain '${domain}' already exists in local database`);
  }

  const created = await createDomain({
    name: domain,
    registrar: "Sedo",
    status: "active",
    purchase_price: price,
    purchase_date: new Date().toISOString().split("T")[0],
    is_premium: price > 1000,
    premium_price: price > 1000 ? price : undefined,
    notes: orderId ? `Purchased via Sedo (order: ${orderId})` : "Purchased via Sedo",
  });

  await createHistoryEntry({
    domain_id: created.id,
    snapshot_type: "purchase",
    raw_data: { price, orderId, source: "sedo" },
    notes: `Purchased ${domain} from Sedo for ${price}`,
  });

  return created;
}
