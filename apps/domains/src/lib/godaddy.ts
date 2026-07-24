/**
 * GoDaddy API integration for domain management
 *
 * Environment variables:
 *   GODADDY_API_KEY    — GoDaddy API key
 *   GODADDY_API_SECRET — GoDaddy API secret
 */

import type { CreateDomainInput, UpdateDomainInput, Domain } from "../db/domains.js";

// ============================================================
// Types
// ============================================================

export interface GoDaddyConfig {
  apiKey: string;
  apiSecret: string;
}

export interface GoDaddyDomain {
  domain: string;
  domainId?: number;
  status: string;
  expires: string;
  renewAuto: boolean;
  nameServers?: string[];
}

export interface GoDaddyDomainDetail extends GoDaddyDomain {
  createdAt?: string;
  locked?: boolean;
  privacy?: boolean;
  domainId?: number;
}

export interface GoDaddyDnsRecord {
  type: string;
  name: string;
  data: string;
  ttl: number;
  priority?: number;
}

export interface GoDaddyAvailability {
  domain: string;
  available: boolean;
  price?: number;
  currency?: string;
}

export interface GoDaddyRenewResponse {
  orderId: number;
  itemCount: number;
  total: number;
}

export class GoDaddyApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = "GoDaddyApiError";
  }
}

export interface GoDaddySyncResult {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}

// ============================================================
// Internal fetch override (allows test injection)
// ============================================================

type FetchFn = typeof globalThis.fetch;

let _overriddenFetch: FetchFn | null = null;

export function _setFetch(fn: FetchFn | null): void {
  _overriddenFetch = fn;
}

// ============================================================
// Config
// ============================================================

function getCredentials(): GoDaddyConfig {
  const apiKey = process.env["GODADDY_API_KEY"];
  const apiSecret = process.env["GODADDY_API_SECRET"];

  if (!apiKey || !apiSecret) {
    throw new Error(
      "GoDaddy API credentials not configured. Set GODADDY_API_KEY and GODADDY_API_SECRET environment variables."
    );
  }

  return { apiKey, apiSecret };
}

function getHeaders(): Record<string, string> {
  const { apiKey, apiSecret } = getCredentials();
  return {
    Authorization: `sso-key ${apiKey}:${apiSecret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// ============================================================
// API Request
// ============================================================

const GODADDY_API_BASE = "https://api.godaddy.com";

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const fetchFn = _overriddenFetch || globalThis.fetch;
  const url = `${GODADDY_API_BASE}${path}`;
  const headers = getHeaders();

  const options: RequestInit = { method, headers };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetchFn(url, options);

  if (!response.ok) {
    const text = await response.text();
    throw new GoDaddyApiError(
      `GoDaddy API ${method} ${path} failed with status ${response.status}: ${text}`,
      response.status,
      { responseBody: text }
    );
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return (await response.json()) as T;
}

// ============================================================
// API Functions
// ============================================================

export async function listGoDaddyDomains(): Promise<GoDaddyDomain[]> {
  return apiRequest<GoDaddyDomain[]>("GET", "/v1/domains");
}

export async function getDomainInfo(domain: string): Promise<GoDaddyDomainDetail> {
  return apiRequest<GoDaddyDomainDetail>("GET", `/v1/domains/${encodeURIComponent(domain)}`);
}

export async function renewDomain(domain: string): Promise<GoDaddyRenewResponse> {
  return apiRequest<GoDaddyRenewResponse>(
    "POST",
    `/v1/domains/${encodeURIComponent(domain)}/renew`,
    { period: 1 }
  );
}

export async function getDnsRecords(domain: string, type?: string): Promise<GoDaddyDnsRecord[]> {
  const path = type
    ? `/v1/domains/${encodeURIComponent(domain)}/records/${encodeURIComponent(type)}`
    : `/v1/domains/${encodeURIComponent(domain)}/records`;
  return apiRequest<GoDaddyDnsRecord[]>("GET", path);
}

export async function setDnsRecords(domain: string, records: GoDaddyDnsRecord[]): Promise<void> {
  await apiRequest<void>("PUT", `/v1/domains/${encodeURIComponent(domain)}/records`, records);
}

export async function checkAvailability(domain: string): Promise<GoDaddyAvailability> {
  return apiRequest<GoDaddyAvailability>(
    "GET",
    `/v1/domains/available?domain=${encodeURIComponent(domain)}`
  );
}

// ============================================================
// Status mapping
// ============================================================

function mapGoDaddyStatus(
  gdStatus: string
): "active" | "expired" | "transferring" | "redemption" {
  const s = gdStatus.toUpperCase();
  if (s === "ACTIVE") return "active";
  if (s === "EXPIRED") return "expired";
  if (s === "TRANSFERRED_OUT" || s === "TRANSFERRING" || s === "PENDING_TRANSFER")
    return "transferring";
  if (s === "REDEMPTION" || s === "PENDING_REDEMPTION") return "redemption";
  return "active";
}

// ============================================================
// Sync to Local DB
// ============================================================

export async function syncToLocalDb(dbFns: {
  getDomainByName: (name: string) => Promise<Domain | null>;
  createDomain: (input: CreateDomainInput) => Promise<Domain>;
  updateDomain: (id: string, input: UpdateDomainInput) => Promise<Domain | null>;
}): Promise<GoDaddySyncResult> {
  const result: GoDaddySyncResult = {
    synced: 0,
    created: 0,
    updated: 0,
    errors: [],
  };

  let gdDomains: GoDaddyDomain[];
  try {
    gdDomains = await listGoDaddyDomains();
  } catch (err) {
    result.errors.push(
      `Failed to list domains: ${err instanceof Error ? err.message : String(err)}`
    );
    return result;
  }

  for (const gd of gdDomains) {
    try {
      let detail: GoDaddyDomainDetail;
      try {
        detail = await getDomainInfo(gd.domain);
      } catch {
        detail = gd as GoDaddyDomainDetail;
      }

      const existing = await dbFns.getDomainByName(gd.domain);

      const domainData = {
        name: gd.domain,
        registrar: "GoDaddy",
        status: mapGoDaddyStatus(gd.status),
        expires_at: gd.expires ? new Date(gd.expires).toISOString() : undefined,
        auto_renew: gd.renewAuto,
        nameservers: gd.nameServers || [],
        registered_at: detail.createdAt ? new Date(detail.createdAt).toISOString() : undefined,
        metadata: {
          godaddy_domain_id: detail.domainId,
          provider: "godaddy",
          locked: detail.locked,
          privacy: detail.privacy,
        },
      };

      if (existing) {
        await dbFns.updateDomain(existing.id, domainData);
        result.updated++;
      } else {
        await dbFns.createDomain(domainData);
        result.created++;
      }
      result.synced++;
    } catch (err) {
      result.errors.push(
        `Failed to sync ${gd.domain}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}

export interface GodaddyCapability {
  configured: boolean;
  gated: boolean;
  notes: string;
}

/**
 * GoDaddy retail Domains API capability. Current GoDaddy docs say DNS/domain
 * management production API access is available with 1+ domain or qualifying
 * plan/spend, while availability remains under a higher anti-abuse threshold.
 * This CLI still does not expose direct automated purchase through GoDaddy.
 */
export function godaddyCapability(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): GodaddyCapability {
  const configured = !!(env["GODADDY_API_KEY"] && env["GODADDY_API_SECRET"]);
  return {
    configured,
    gated: true,
    notes: configured
      ? "Credentials present; DNS/domain management may work with qualifying account access, but availability remains threshold-gated and direct automated purchase is not exposed here. Prefer Route53 for purchases."
      : "Not configured; GoDaddy production availability remains threshold-gated and DNS/domain management requires qualifying account access.",
  };
}
