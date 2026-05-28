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

import { getDatabase } from "../db/database.js";
import { createDomain, getDomainByName } from "../db/domains.js";
import { createHistoryEntry } from "../db/domain-history.js";

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

export function getSedoConfig(): SedoConfig {
  const partnerId = process.env.SEDO_PARTNER_ID;
  const signKey = process.env.SEDO_API_KEY;
  const username = process.env.SEDO_USERNAME;
  const password = process.env.SEDO_PASSWORD;

  if (!partnerId || !signKey || !username || !password) {
    throw new Error(
      "Sedo credentials not configured. Required: SEDO_PARTNER_ID, SEDO_API_KEY, SEDO_USERNAME, SEDO_PASSWORD"
    );
  }

  return { partnerId, signKey, username, password };
}

// ============================================================
// XML helpers for Sedo API
// ============================================================

const BASE_URL = "https://api.sedo.com/api/v1/";

function buildXmlParams(
  params: Record<string, unknown>
): Record<string, string> {
  return {
    partnerid: params.partnerId as string,
    signkey: params.signKey as string,
    username: params.username as string,
    password: params.password as string,
  };
}

async function sedoRequest(
  action: string,
  config: SedoConfig,
  extraParams: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    ...buildXmlParams(config),
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

  const text = await resp.text();
  return parseSedoXml(text);
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

/**
 * Search for domains for sale on Sedo.
 */
export async function searchSedoDomains(
  query: string,
  options: {
    tld?: string;
    limit?: number;
    minPrice?: number;
    maxPrice?: number;
  } = {}
): Promise<SedoSearchResult> {
  const config = getSedoConfig();

  const params: Record<string, unknown> = {
    searchword: query,
    limit: options.limit || 100,
  };

  if (options.tld) params.tld = options.tld;
  if (options.minPrice) params.price_min = options.minPrice;
  if (options.maxPrice) params.price_max = options.maxPrice;

  const response = await sedoRequest("DomainSearch", config, params);

  const items = (response.items as Record<string, unknown>[]) || [];
  const domains: SedoDomain[] = items.map((item) => ({
    domain: (item.domain as string) || "",
    forSale: item.for_sale === "1" || item.for_sale === "true",
    price: item.price ? parseFloat(item.price as string) : undefined,
    currency: (item.currency as string) || undefined,
    status: (item.status as string) || undefined,
    isPremium: item.premium === "1" || item.premium === "true",
  }));

  return {
    domains,
    total: parseInt((response.total as string) || "0") || items.length,
  };
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
export function recordSedoPurchase(
  domain: string,
  price: number,
  orderId?: string
) {
  const existing = getDomainByName(domain);
  if (existing) {
    throw new Error(`Domain '${domain}' already exists in local database`);
  }

  const created = createDomain({
    name: domain,
    registrar: "Sedo",
    status: "active",
    purchase_price: price,
    purchase_date: new Date().toISOString().split("T")[0],
    is_premium: price > 1000,
    premium_price: price > 1000 ? price : undefined,
    notes: orderId ? `Purchased via Sedo (order: ${orderId})` : "Purchased via Sedo",
  });

  createHistoryEntry({
    domain_id: created.id,
    snapshot_type: "purchase",
    raw_data: { price, orderId, source: "sedo" },
    notes: `Purchased ${domain} from Sedo for ${price}`,
  });

  return created;
}
