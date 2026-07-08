/**
 * Namecheap API integration for domain management
 *
 * Requires environment variables:
 *   NAMECHEAP_API_KEY    — API key from Namecheap
 *   NAMECHEAP_USERNAME   — Namecheap account username
 *   NAMECHEAP_CLIENT_IP  — Whitelisted client IP address
 */

import type { ProviderRegistrationContact } from "./registrar.js";

// ============================================================
// Types
// ============================================================

export interface NamecheapConfig {
  apiKey: string;
  username: string;
  clientIp: string;
  sandbox?: boolean;
}

export interface NamecheapDomain {
  domain: string;
  expiry: string;
  autoRenew: boolean;
  isExpired: boolean;
  isLocked: boolean;
}

export interface NamecheapDomainInfo {
  domain: string;
  registrar: string;
  created: string;
  expires: string;
  nameservers: string[];
}

export interface NamecheapDnsRecord {
  type: string;
  name: string;
  address: string;
  ttl: number;
  mxPref?: number;
}

export interface NamecheapAvailability {
  domain: string;
  available: boolean;
  premium: boolean;
  price?: number;
}

export interface NamecheapRenewResult {
  domain: string;
  success: boolean;
  orderId?: string;
  chargedAmount?: string;
}

export interface NamecheapRegistrationResult {
  domain: string;
  success: boolean;
  orderId?: string;
  chargedAmount?: string;
}

export interface NamecheapSyncResult {
  synced: number;
  errors: string[];
  domains: string[];
}

// ============================================================
// Config
// ============================================================

export function getConfig(): NamecheapConfig {
  const apiKey = process.env["NAMECHEAP_API_KEY"];
  const username = process.env["NAMECHEAP_USERNAME"];
  const clientIp = process.env["NAMECHEAP_CLIENT_IP"];

  if (!apiKey) throw new Error("NAMECHEAP_API_KEY environment variable is not set");
  if (!username) throw new Error("NAMECHEAP_USERNAME environment variable is not set");
  if (!clientIp) throw new Error("NAMECHEAP_CLIENT_IP environment variable is not set");

  return {
    apiKey,
    username,
    clientIp,
    sandbox: process.env["NAMECHEAP_SANDBOX"] === "true",
  };
}

// ============================================================
// API Request Helper
// ============================================================

async function apiRequest(
  config: NamecheapConfig,
  command: string,
  params: Record<string, string> = {}
): Promise<string> {
  const base = config.sandbox
    ? "https://api.sandbox.namecheap.com/xml.response"
    : "https://api.namecheap.com/xml.response";

  const url = new URL(base);
  url.searchParams.set("ApiUser", config.username);
  url.searchParams.set("ApiKey", config.apiKey);
  url.searchParams.set("UserName", config.username);
  url.searchParams.set("ClientIp", config.clientIp);
  url.searchParams.set("Command", command);

  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Namecheap API request failed with status ${response.status}`);
  }

  return response.text();
}

function parseXmlValue(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
  return match ? match[1]!.trim() : null;
}

function parseXmlAttributes(xml: string, tag: string): Record<string, string>[] {
  const results: Record<string, string>[] = [];
  const tagRegex = new RegExp(`<${tag}([^>]*)>`, "gi");
  let match;
  while ((match = tagRegex.exec(xml)) !== null) {
    const attrs: Record<string, string> = {};
    const attrStr = match[1]!;
    const attrRegex = /(\w+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
      attrs[attrMatch[1]!] = attrMatch[2]!;
    }
    results.push(attrs);
  }
  return results;
}

// ============================================================
// API Functions
// ============================================================

export async function listNamecheapDomains(config?: NamecheapConfig): Promise<NamecheapDomain[]> {
  const cfg = config || getConfig();
  const xml = await apiRequest(cfg, "namecheap.domains.getList", { PageSize: "100" });

  const domainAttrs = parseXmlAttributes(xml, "Domain");
  return domainAttrs.map((attrs) => ({
    domain: attrs["Name"] || "",
    expiry: attrs["Expires"] || "",
    autoRenew: attrs["AutoRenew"] === "true",
    isExpired: attrs["IsExpired"] === "true",
    isLocked: attrs["IsLocked"] === "true",
  }));
}

export async function getDomainInfo(domain: string, config?: NamecheapConfig): Promise<NamecheapDomainInfo> {
  const cfg = config || getConfig();
  const xml = await apiRequest(cfg, "namecheap.domains.getInfo", { DomainName: domain });

  const created = parseXmlValue(xml, "CreatedDate") || "";
  const expires = parseXmlValue(xml, "ExpiredDate") || "";

  // Parse nameservers
  const nsAttrs = parseXmlAttributes(xml, "Nameserver");
  const nameservers = nsAttrs.map((a) => a["NAME"] || "").filter(Boolean);

  return {
    domain,
    registrar: "Namecheap",
    created,
    expires,
    nameservers,
  };
}

export async function renewDomain(domain: string, years: number = 1, config?: NamecheapConfig): Promise<NamecheapRenewResult> {
  const cfg = config || getConfig();
  const xml = await apiRequest(cfg, "namecheap.domains.renew", {
    DomainName: domain,
    Years: String(years),
  });

  const orderId = parseXmlValue(xml, "OrderId");
  const chargedAmount = parseXmlValue(xml, "ChargedAmount");

  return {
    domain,
    success: xml.includes('Status="OK"'),
    orderId: orderId || undefined,
    chargedAmount: chargedAmount || undefined,
  };
}

function namecheapContactParams(contact: ProviderRegistrationContact): Record<string, string> {
  const organization = contact.organization_name || "NA";
  const base = {
    FirstName: contact.first_name,
    LastName: contact.last_name,
    OrganizationName: organization,
    Address1: contact.address_line_1,
    City: contact.city,
    StateProvince: contact.state,
    PostalCode: contact.zip_code,
    Country: contact.country_code,
    Phone: contact.phone,
    EmailAddress: contact.email,
  };
  const params: Record<string, string> = {};
  for (const prefix of ["Registrant", "Tech", "Admin", "AuxBilling"]) {
    for (const [key, value] of Object.entries(base)) {
      params[prefix + key] = value;
    }
  }
  return params;
}

export async function registerDomain(
  domain: string,
  contact: ProviderRegistrationContact,
  options: { years?: number; premiumPrice?: number; whoisGuard?: boolean } = {},
  config?: NamecheapConfig,
): Promise<NamecheapRegistrationResult> {
  const cfg = config || getConfig();
  const params: Record<string, string> = {
    DomainName: domain,
    Years: String(options.years ?? 1),
    AddFreeWhoisguard: options.whoisGuard === false ? "no" : "yes",
    WGEnabled: options.whoisGuard === false ? "no" : "yes",
    ...namecheapContactParams(contact),
  };

  if (options.premiumPrice !== undefined) {
    params.IsPremiumDomain = "true";
    params.PremiumPrice = String(options.premiumPrice);
  }

  const xml = await apiRequest(cfg, "namecheap.domains.create", params);
  return {
    domain,
    success: xml.includes('Status="OK"') || xml.includes('Registered="true"'),
    orderId: parseXmlValue(xml, "OrderId") || undefined,
    chargedAmount: parseXmlValue(xml, "ChargedAmount") || undefined,
  };
}

export async function updateNameservers(
  domain: string,
  nameservers: string[],
  config?: NamecheapConfig,
): Promise<boolean> {
  if (nameservers.length === 0) throw new Error("updateNameservers requires at least one nameserver");
  const cfg = config || getConfig();
  const { sld, tld } = splitDomain(domain);
  const xml = await apiRequest(cfg, "namecheap.domains.dns.setCustom", {
    SLD: sld,
    TLD: tld,
    Nameservers: nameservers.join(","),
  });
  return xml.includes('Status="OK"') || xml.includes('Updated="true"');
}

export async function getDnsRecords(
  _domain: string,
  sld: string,
  tld: string,
  config?: NamecheapConfig
): Promise<NamecheapDnsRecord[]> {
  const cfg = config || getConfig();
  const xml = await apiRequest(cfg, "namecheap.domains.dns.getHosts", {
    SLD: sld,
    TLD: tld,
  });

  const hostAttrs = parseXmlAttributes(xml, "host");
  return hostAttrs.map((attrs) => ({
    type: attrs["Type"] || "A",
    name: attrs["Name"] || "@",
    address: attrs["Address"] || "",
    ttl: parseInt(attrs["TTL"] || "3600"),
    mxPref: attrs["MXPref"] ? parseInt(attrs["MXPref"]) : undefined,
  }));
}

export async function setDnsRecords(
  _domain: string,
  sld: string,
  tld: string,
  records: NamecheapDnsRecord[],
  config?: NamecheapConfig
): Promise<boolean> {
  const cfg = config || getConfig();
  const params: Record<string, string> = {
    SLD: sld,
    TLD: tld,
  };

  records.forEach((r, i) => {
    params[`HostName${i + 1}`] = r.name;
    params[`RecordType${i + 1}`] = r.type;
    params[`Address${i + 1}`] = r.address;
    params[`TTL${i + 1}`] = String(r.ttl);
    if (r.mxPref !== undefined) {
      params[`MXPref${i + 1}`] = String(r.mxPref);
    }
  });

  const xml = await apiRequest(cfg, "namecheap.domains.dns.setHosts", params);
  return xml.includes('IsSuccess="true"');
}

export async function checkAvailability(domain: string, config?: NamecheapConfig): Promise<NamecheapAvailability> {
  const cfg = config || getConfig();
  const xml = await apiRequest(cfg, "namecheap.domains.check", { DomainList: domain });

  const domainAttrs = parseXmlAttributes(xml, "DomainCheckResult");
  const result = domainAttrs[0] || {};

  return {
    domain,
    available: result["Available"] === "true",
    premium: result["IsPremiumName"] === "true",
    price: result["PremiumRegistrationPrice"]
      ? parseFloat(result["PremiumRegistrationPrice"])
      : undefined,
  };
}

// ============================================================
// Domain Helpers
// ============================================================

export function splitDomain(domain: string): { sld: string; tld: string } {
  const parts = domain.split(".");
  if (parts.length < 2) {
    throw new Error(`Invalid domain: ${domain}`);
  }
  // Handle multi-part TLDs like .co.uk
  if (parts.length >= 3 && ["co", "com", "org", "net", "ac", "gov"].includes(parts[parts.length - 2]!)) {
    return {
      sld: parts.slice(0, -2).join("."),
      tld: parts.slice(-2).join("."),
    };
  }
  return {
    sld: parts.slice(0, -1).join("."),
    tld: parts[parts.length - 1]!,
  };
}

// ============================================================
// Sync to Local DB
// ============================================================

export async function syncToLocalDb(dbFunctions: {
  getDomainByName: (name: string) => Promise<{ id: string } | null>;
  createDomain: (input: {
    name: string;
    registrar?: string;
    status?: "active" | "expired" | "transferring" | "redemption";
    registered_at?: string;
    expires_at?: string;
    auto_renew?: boolean;
    nameservers?: string[];
  }) => Promise<{ id: string; name: string }>;
  updateDomain: (
    id: string,
    input: {
      registrar?: string;
      status?: "active" | "expired" | "transferring" | "redemption";
      registered_at?: string;
      expires_at?: string;
      auto_renew?: boolean;
      nameservers?: string[];
    }
  ) => Promise<unknown>;
}, config?: NamecheapConfig): Promise<NamecheapSyncResult> {
  const cfg = config || getConfig();
  const result: NamecheapSyncResult = { synced: 0, errors: [], domains: [] };

  let ncDomains: NamecheapDomain[];
  try {
    ncDomains = await listNamecheapDomains(cfg);
  } catch (error) {
    throw new Error(`Failed to list Namecheap domains: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const ncDomain of ncDomains) {
    try {
      let info: NamecheapDomainInfo;
      try {
        info = await getDomainInfo(ncDomain.domain, cfg);
      } catch {
        info = {
          domain: ncDomain.domain,
          registrar: "Namecheap",
          created: "",
          expires: ncDomain.expiry,
          nameservers: [],
        };
      }

      const expiresAt = normalizeDate(info.expires || ncDomain.expiry);
      const createdAt = normalizeDate(info.created);

      const existing = await dbFunctions.getDomainByName(ncDomain.domain);
      if (existing) {
        await dbFunctions.updateDomain(existing.id, {
          registrar: "Namecheap",
          status: "active",
          registered_at: createdAt || undefined,
          expires_at: expiresAt || undefined,
          auto_renew: ncDomain.autoRenew,
          nameservers: info.nameservers.length > 0 ? info.nameservers : undefined,
        });
      } else {
        await dbFunctions.createDomain({
          name: ncDomain.domain,
          registrar: "Namecheap",
          status: "active",
          registered_at: createdAt || undefined,
          expires_at: expiresAt || undefined,
          auto_renew: ncDomain.autoRenew,
          nameservers: info.nameservers,
        });
      }

      result.synced++;
      result.domains.push(ncDomain.domain);
    } catch (error) {
      result.errors.push(`${ncDomain.domain}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}

// ============================================================
// Helpers
// ============================================================

function normalizeDate(dateStr: string): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}
