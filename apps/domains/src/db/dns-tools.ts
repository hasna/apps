/**
 * DNS tools: WHOIS/RDAP lookup, DNS propagation, SSL check, zone file import/export,
 * subdomain discovery, and DNS validation
 */

import { execFileSync } from "node:child_process";
import { domainToASCII } from "node:url";
import { getStore } from "./store.js";
import type { UpdateDomainInput } from "./domain-records.js";
import type { DnsRecord } from "./dns-records.js";
import { USER_AGENT } from "../lib/version.js";

export class DnsToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DnsToolValidationError";
  }
}

const HOSTNAME_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DNS_QUERY_LABEL_RE = /^(?:\*|[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)$/;
const DNS_RECORD_TYPES = new Set([
  "A",
  "AAAA",
  "CAA",
  "CNAME",
  "DNSKEY",
  "DS",
  "HTTPS",
  "MX",
  "NAPTR",
  "NS",
  "PTR",
  "SOA",
  "SPF",
  "SRV",
  "SSHFP",
  "SVCB",
  "TLSA",
  "TXT",
]);

function normalizeDnsName(
  value: string,
  options: { allowUnderscore: boolean; allowWildcard: boolean }
): string {
  if (typeof value !== "string") {
    throw new DnsToolValidationError("Invalid domain name. Use a hostname such as example.com.");
  }

  const ascii = domainToASCII(value.trim().replace(/\.$/, ""));
  const labelRe = options.allowUnderscore ? DNS_QUERY_LABEL_RE : HOSTNAME_LABEL_RE;

  if (!ascii || ascii.length > 253) {
    throw new DnsToolValidationError("Invalid domain name. Use a hostname such as example.com.");
  }

  const normalized = ascii.toLowerCase();
  const labels = normalized.split(".");
  if (labels.length < 2) {
    throw new DnsToolValidationError("Invalid domain name. Use a hostname such as example.com.");
  }

  for (const [index, label] of labels.entries()) {
    if (!labelRe.test(label)) {
      throw new DnsToolValidationError("Invalid domain name. Use a hostname such as example.com.");
    }
    if (label === "*" && (!options.allowWildcard || index !== 0)) {
      throw new DnsToolValidationError("Invalid domain name. Use a hostname such as example.com.");
    }
  }

  return normalized;
}

export function normalizeDomainName(value: string): string {
  return normalizeDnsName(value, { allowUnderscore: false, allowWildcard: false });
}

function normalizeDnsQueryName(value: string): string {
  return normalizeDnsName(value, { allowUnderscore: true, allowWildcard: true });
}

function normalizeDnsRecordType(value: string): string {
  if (typeof value !== "string") {
    throw new DnsToolValidationError("Invalid DNS record type.");
  }

  const recordType = value.trim().toUpperCase();
  if (!DNS_RECORD_TYPES.has(recordType)) {
    throw new DnsToolValidationError("Invalid DNS record type.");
  }
  return recordType;
}

// ============================================================
// RDAP (Registration Data Access Protocol) — WHOIS successor
// Uses the public rdap.org bootstrap service (free, no API key)
// ============================================================

export interface RdapEntity {
  handle?: string;
  vcardArray?: [string, unknown[]];
  roles?: string[];
  entities?: RdapEntity[];
  remarks?: { title?: string; description?: string | string[] }[];
}

export interface RdapNameserver {
  ldhName?: string;
  unicodeName?: string;
}

export interface RdapEvent {
  eventAction: string;
  eventDate?: string;
  eventActor?: string;
}

export interface RdapResponse {
  handle?: string;
  rdapConformance?: string[];
  status?: string[];
  entities?: RdapEntity[];
  nameservers?: RdapNameserver[];
  events?: RdapEvent[];
  links?: { rel: string; href: string; type?: string }[];
  [key: string]: unknown;
}

/**
 * Query RDAP for a domain via rdap.org public bootstrap.
 * Returns structured JSON with registrant, registrar, expiry, nameservers.
 * Throws if the RDAP server returns an error.
 */
export async function rdapLookup(domainName: string): Promise<RdapResponse> {
  const domain = normalizeDomainName(domainName);
  const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      "Accept": "application/rdap+json, application/json",
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`RDAP: domain "${domain}" not found`);
    }
    throw new Error(`RDAP request failed with status ${response.status} for ${domain}`);
  }

  return response.json() as Promise<RdapResponse>;
}

/**
 * Extract registrant contact info from RDAP entities.
 * Looks for entities with role "registrant" and parses vCard data.
 */
export function extractRegistrantFromRdap(rdap: RdapResponse): {
  name: string | null;
  email: string | null;
  phone: string | null;
  organization: string | null;
} {
  const result = {
    name: null as string | null,
    email: null as string | null,
    phone: null as string | null,
    organization: null as string | null,
  };

  if (!rdap.entities) return result;

  // Flatten: search all entities and nested entities for registrant
  const findRegistrant = (entities: RdapEntity[]): RdapEntity | null => {
    for (const entity of entities) {
      if (entity.roles?.some((r) => r === "registrant")) return entity;
      if (entity.entities) {
        const found = findRegistrant(entity.entities);
        if (found) return found;
      }
    }
    return null;
  };

  const registrant = findRegistrant(rdap.entities);
  if (!registrant?.vcardArray) return result;

  const vcard = registrant.vcardArray[1] as unknown[] | undefined;
  if (!vcard || !Array.isArray(vcard)) return result;

  for (const entry of vcard) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const [prop, _params, type] = entry;

    if (prop === "fn") result.name = type ?? null;
    else if (prop === "email") result.email = type ?? null;
    else if (prop === "tel") result.phone = type ?? null;
    else if (prop === "org") {
      result.organization = Array.isArray(type) ? type[0] ?? null : type ?? null;
    }
    // Also capture N (structured name) if fn is missing
    else if (prop === "n" && !result.name) {
      const parts = Array.isArray(type) ? type.filter(Boolean) : [type];
      result.name = parts.reverse().join(" ").trim() || null;
    }
  }

  // If still no name, try entity handle or remarks
  if (!result.name && registrant.handle) {
    result.name = registrant.handle;
  }

  return result;
}

/**
 * Extract registrar name from RDAP data.
 * Looks for entities with role "registrar" or "sponsor".
 */
export function extractRegistrarFromRdap(rdap: RdapResponse): string | null {
  if (!rdap.entities) return null;

  for (const entity of rdap.entities) {
    if (entity.roles?.some((r) => r === "registrar" || r === "sponsor")) {
      if (entity.vcardArray?.[1]) {
        const vcard = entity.vcardArray[1] as unknown[];
        for (const entry of vcard) {
          if (Array.isArray(entry) && entry[0] === "fn") return entry[2] ?? null;
        }
      }
      if (entity.remarks) {
        for (const remark of entity.remarks) {
          if (remark.title?.toLowerCase().includes("registrar")) {
            const desc = Array.isArray(remark.description) ? remark.description[0] : remark.description;
            if (desc) return desc;
          }
        }
      }
      return entity.handle ?? null;
    }
  }

  return null;
}

/**
 * Extract expiry date from RDAP events.
 */
export function extractExpiryFromRdap(rdap: RdapResponse): string | null {
  if (!rdap.events) return null;

  const expiryEvent = rdap.events.find(
    (e) => e.eventAction === "expiration" || e.eventAction === "expiry"
  );
  return expiryEvent?.eventDate ?? null;
}

/**
 * Extract nameservers from RDAP response.
 */
export function extractNameserversFromRdap(rdap: RdapResponse): string[] {
  if (!rdap.nameservers) return [];
  return rdap.nameservers
    .map((ns) => (ns.ldhName ?? ns.unicodeName ?? "").toLowerCase())
    .filter(Boolean);
}

// ============================================================
// WHOIS Lookup (RDAP primary, CLI fallback)
// ============================================================

export interface WhoisResult {
  domain: string;
  registrar: string | null;
  expires_at: string | null;
  nameservers: string[];
  raw: string;
  source: "rdap" | "cli";
  registrant: {
    name: string | null;
    email: string | null;
    phone: string | null;
    organization: string | null;
  };
}

export async function whoisLookup(domainName: string): Promise<WhoisResult> {
  const domain = normalizeDomainName(domainName);

  // Try RDAP first (structured, reliable, free)
  try {
    const rdap = await rdapLookupSync(domain);
    if (rdap) return rdap;
  } catch {
    // Fall through to CLI
  }

  // Fallback: system whois CLI
  return whoisCliLookup(domain);
}

/**
 * RDAP lookup via curl (sync subprocess). Persists the fetched fields to the
 * domain record through the resolved store when the domain is tracked.
 * Returns null if RDAP is unavailable (not an error).
 */
async function rdapLookupSync(domainName: string): Promise<WhoisResult | null> {
  const domain = normalizeDomainName(domainName);

  // Use sync HTTP via child process with curl (since fetch is async)
  let stdout: string;
  try {
    stdout = execFileSync(
      "curl",
      [
        "-s",
        "-m",
        "15",
        "-H",
        "Accept: application/rdap+json, application/json",
        "-A",
        USER_AGENT,
        `https://rdap.org/domain/${encodeURIComponent(domain)}`,
      ],
      { encoding: "utf-8", timeout: 16000 },
    );
  } catch {
    return null;
  }

  if (!stdout || !stdout.startsWith("{")) return null;

  let rdap: RdapResponse;
  try {
    rdap = JSON.parse(stdout) as RdapResponse;
  } catch {
    return null;
  }

  // Check for error response
  if ((rdap as { errorCode?: number }).errorCode) {
    return null;
  }

  const registrar = extractRegistrarFromRdap(rdap);
  const expires_at = extractExpiryFromRdap(rdap);
  const nameservers = extractNameserversFromRdap(rdap);
  const registrant = extractRegistrantFromRdap(rdap);

  // Update the domain record (via the resolved store) if it is tracked.
  const store = getStore();
  const existing = await store.getDomainByName(domain);
  if (existing) {
    const updates: UpdateDomainInput = { whois: rdap as Record<string, unknown> };
    if (registrar) updates.registrar = registrar;
    if (expires_at) updates.expires_at = expires_at;
    if (nameservers.length > 0) updates.nameservers = nameservers;
    await store.updateDomain(existing.id, updates);
  }

  return {
    domain,
    registrar,
    expires_at,
    nameservers,
    raw: stdout,
    source: "rdap",
    registrant,
  };
}

async function whoisCliLookup(domainName: string): Promise<WhoisResult> {
  const domain = normalizeDomainName(domainName);

  let raw: string;
  try {
    raw = execFileSync("whois", [domain], { timeout: 15000, encoding: "utf-8" });
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string };
    raw = err.stdout || err.stderr || "";
    if (!raw) throw new Error(`whois command failed for ${domain}`);
  }

  const registrarMatch = raw.match(/Registrar:\s*(.+)/i) || raw.match(/registrar:\s*(.+)/i);
  const registrar = registrarMatch ? registrarMatch[1]!.trim() : null;

  const expiresMatch =
    raw.match(/Registry Expiry Date:\s*(.+)/i) ||
    raw.match(/Expir(?:y|ation) Date:\s*(.+)/i) ||
    raw.match(/paid-till:\s*(.+)/i);
  let expires_at: string | null = null;
  if (expiresMatch) {
    try {
      expires_at = new Date(expiresMatch[1]!.trim()).toISOString();
    } catch {
      expires_at = expiresMatch[1]!.trim();
    }
  }

  const nsMatches = raw.matchAll(/Name Server:\s*(.+)/gi);
  const nameservers: string[] = [];
  for (const m of nsMatches) {
    const ns = m[1]!.trim().toLowerCase();
    if (ns && !nameservers.includes(ns)) nameservers.push(ns);
  }

  const store = getStore();
  const existing = await store.getDomainByName(domain);
  if (existing) {
    const updates: UpdateDomainInput = { whois: { raw } };
    if (registrar) updates.registrar = registrar;
    if (expires_at) updates.expires_at = expires_at;
    if (nameservers.length > 0) updates.nameservers = nameservers;
    await store.updateDomain(existing.id, updates);
  }

  return {
    domain,
    registrar,
    expires_at,
    nameservers,
    raw,
    source: "cli",
    registrant: { name: null, email: null, phone: null, organization: null },
  };
}

// ============================================================
// DNS Propagation Check
// ============================================================

const DNS_SERVERS = ["8.8.8.8", "1.1.1.1", "9.9.9.9", "208.67.222.222"];
const DNS_SERVER_NAMES: Record<string, string> = {
  "8.8.8.8": "Google",
  "1.1.1.1": "Cloudflare",
  "9.9.9.9": "Quad9",
  "208.67.222.222": "OpenDNS",
};

export interface DnsPropagationResult {
  domain: string;
  record_type: string;
  servers: {
    server: string;
    name: string;
    values: string[];
    status: "ok" | "error";
    error?: string;
  }[];
  consistent: boolean;
}

export function checkDnsPropagation(
  domain: string,
  recordType: string = "A"
): DnsPropagationResult {
  const queryName = normalizeDnsQueryName(domain);
  const normalizedRecordType = normalizeDnsRecordType(recordType);
  const servers: DnsPropagationResult["servers"] = [];

  for (const server of DNS_SERVERS) {
    try {
      const output = execFileSync(
        "dig",
        [`@${server}`, queryName, normalizedRecordType, "+short", "+time=5", "+tries=1"],
        { timeout: 10000, encoding: "utf-8" }
      );
      const values = output
        .trim()
        .split("\n")
        .filter((l) => l.length > 0);
      servers.push({
        server,
        name: DNS_SERVER_NAMES[server] || server,
        values,
        status: "ok",
      });
    } catch (error: unknown) {
      servers.push({
        server,
        name: DNS_SERVER_NAMES[server] || server,
        values: [],
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Check consistency: all servers with "ok" should have the same sorted values
  const okServers = servers.filter((s) => s.status === "ok");
  const consistent =
    okServers.length > 0 &&
    okServers.every(
      (s) => JSON.stringify(s.values.sort()) === JSON.stringify(okServers[0]!.values.sort())
    );

  return { domain: queryName, record_type: normalizedRecordType, servers, consistent };
}

// ============================================================
// SSL Certificate Check
// ============================================================

export interface SslCheckResult {
  domain: string;
  issuer: string | null;
  expires_at: string | null;
  subject: string | null;
  error?: string;
}

export async function checkSsl(domainName: string): Promise<SslCheckResult> {
  const domain = normalizeDomainName(domainName);

  try {
    const certificate = execFileSync(
      "openssl",
      ["s_client", "-servername", domain, "-connect", `${domain}:443`],
      { timeout: 15000, encoding: "utf-8", input: "\n", stdio: ["pipe", "pipe", "ignore"] }
    );
    const output = execFileSync(
      "openssl",
      ["x509", "-noout", "-issuer", "-dates", "-subject"],
      { timeout: 15000, encoding: "utf-8", input: certificate, stdio: ["pipe", "pipe", "ignore"] }
    );

    const issuerMatch = output.match(/issuer\s*=\s*(.+)/i);
    const notAfterMatch = output.match(/notAfter\s*=\s*(.+)/i);
    const subjectMatch = output.match(/subject\s*=\s*(.+)/i);

    const issuer = issuerMatch ? issuerMatch[1]!.trim() : null;
    const subject = subjectMatch ? subjectMatch[1]!.trim() : null;
    let expires_at: string | null = null;

    if (notAfterMatch) {
      try {
        expires_at = new Date(notAfterMatch[1]!.trim()).toISOString();
      } catch {
        expires_at = notAfterMatch[1]!.trim();
      }
    }

    // Update the domain record via the resolved store if it is tracked.
    const store = getStore();
    const existing = await store.getDomainByName(domain);
    if (existing) {
      const updates: UpdateDomainInput = {};
      if (expires_at) updates.ssl_expires_at = expires_at;
      if (issuer) updates.ssl_issuer = issuer;
      await store.updateDomain(existing.id, updates);
    }

    return { domain, issuer, expires_at, subject };
  } catch (error: unknown) {
    return {
      domain,
      issuer: null,
      expires_at: null,
      subject: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================
// Zone File Export / Import
// ============================================================

export async function exportZoneFile(domainId: string): Promise<string | null> {
  const store = getStore();
  const domain = await store.getDomain(domainId);
  if (!domain) return null;

  const records = await store.listDnsRecords(domainId);
  const lines: string[] = [];

  lines.push(`; Zone file for ${domain.name}`);
  lines.push(`; Exported at ${new Date().toISOString()}`);
  lines.push(`$ORIGIN ${domain.name}.`);
  lines.push(`$TTL 3600`);
  lines.push("");

  for (const r of records) {
    const name = r.name === "@" ? domain.name + "." : r.name;
    if (r.type === "MX" || r.type === "SRV") {
      const priority = r.priority ?? 10;
      lines.push(`${name}\t${r.ttl}\tIN\t${r.type}\t${priority}\t${r.value}`);
    } else {
      lines.push(`${name}\t${r.ttl}\tIN\t${r.type}\t${r.value}`);
    }
  }

  return lines.join("\n") + "\n";
}

export interface ZoneImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  records: DnsRecord[];
}

export async function importZoneFile(domainId: string, content: string): Promise<ZoneImportResult | null> {
  const store = getStore();
  const domain = await store.getDomain(domainId);
  if (!domain) return null;

  const result: ZoneImportResult = { imported: 0, skipped: 0, errors: [], records: [] };
  const lines = content.split("\n");
  const validTypes = new Set(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV"]);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("$")) {
      continue;
    }

    // Parse zone file line: name ttl class type [priority] value
    const parts = line.split(/\s+/);
    if (parts.length < 4) {
      result.errors.push(`Could not parse line: ${line}`);
      result.skipped++;
      continue;
    }

    let name = parts[0]!;
    let idx = 1;

    // Skip optional TTL (numeric)
    let ttl = 3600;
    if (/^\d+$/.test(parts[idx]!)) {
      ttl = parseInt(parts[idx]!);
      idx++;
    }

    // Skip class (IN)
    if (parts[idx] && parts[idx]!.toUpperCase() === "IN") {
      idx++;
    }

    const type = parts[idx]?.toUpperCase();
    idx++;

    if (!type || !validTypes.has(type)) {
      result.errors.push(`Unknown record type '${type}' in: ${line}`);
      result.skipped++;
      continue;
    }

    let priority: number | undefined;
    if (type === "MX" || type === "SRV") {
      if (parts[idx] && /^\d+$/.test(parts[idx]!)) {
        priority = parseInt(parts[idx]!);
        idx++;
      }
    }

    const value = parts.slice(idx).join(" ");
    if (!value) {
      result.errors.push(`Missing value in: ${line}`);
      result.skipped++;
      continue;
    }

    // Normalize name: remove trailing dot, replace domain name with @
    if (name.endsWith(".")) name = name.slice(0, -1);
    if (name === domain.name || name === "") name = "@";

    try {
      const record = await store.createDnsRecord({
        domain_id: domainId,
        type: type as DnsRecord["type"],
        name,
        value,
        ttl,
        priority,
      });
      result.records.push(record);
      result.imported++;
    } catch (error: unknown) {
      result.errors.push(
        `Failed to create record: ${error instanceof Error ? error.message : String(error)}`
      );
      result.skipped++;
    }
  }

  return result;
}

// ============================================================
// Subdomain Discovery (crt.sh)
// ============================================================

export interface SubdomainResult {
  domain: string;
  subdomains: string[];
  source: string;
  error?: string;
}

export async function discoverSubdomains(domain: string): Promise<SubdomainResult> {
  try {
    const url = `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": USER_AGENT },
    });

    if (!response.ok) {
      return {
        domain,
        subdomains: [],
        source: "crt.sh",
        error: `crt.sh returned ${response.status}`,
      };
    }

    const data = (await response.json()) as { common_name?: string; name_value?: string }[];
    const subdomainSet = new Set<string>();

    for (const entry of data) {
      for (const field of [entry.common_name, entry.name_value]) {
        if (!field) continue;
        for (const name of field.split("\n")) {
          const cleaned = name.trim().toLowerCase().replace(/^\*\./, "");
          if (cleaned.endsWith(domain.toLowerCase()) && cleaned !== domain.toLowerCase()) {
            subdomainSet.add(cleaned);
          }
        }
      }
    }

    const subdomains = [...subdomainSet].sort();
    return { domain, subdomains, source: "crt.sh" };
  } catch (error: unknown) {
    return {
      domain,
      subdomains: [],
      source: "crt.sh",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================
// DNS Validation
// ============================================================

export interface DnsValidationIssue {
  type: "error" | "warning";
  record_id?: string;
  message: string;
}

export interface DnsValidationResult {
  domain_id: string;
  domain_name: string;
  issues: DnsValidationIssue[];
  valid: boolean;
}

export async function validateDns(domainId: string): Promise<DnsValidationResult | null> {
  const store = getStore();
  const domain = await store.getDomain(domainId);
  if (!domain) return null;

  const records = await store.listDnsRecords(domainId);
  const issues: DnsValidationIssue[] = [];

  // Group records by name
  const byName = new Map<string, DnsRecord[]>();
  for (const r of records) {
    const key = r.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(r);
  }

  // Check: CNAME should not coexist with A or MX at the same name
  for (const [name, recs] of byName) {
    const hasCname = recs.some((r) => r.type === "CNAME");
    const hasA = recs.some((r) => r.type === "A" || r.type === "AAAA");
    const hasMx = recs.some((r) => r.type === "MX");
    const hasNs = recs.some((r) => r.type === "NS");

    if (hasCname && hasA) {
      issues.push({
        type: "error",
        message: `CNAME record at '${name}' conflicts with A/AAAA record — CNAME cannot coexist with other record types`,
      });
    }
    if (hasCname && hasMx) {
      issues.push({
        type: "error",
        message: `CNAME record at '${name}' conflicts with MX record — CNAME cannot coexist with other record types`,
      });
    }
    if (hasCname && hasNs) {
      issues.push({
        type: "error",
        message: `CNAME record at '${name}' conflicts with NS record — CNAME cannot coexist with other record types`,
      });
    }
    if (hasCname && recs.filter((r) => r.type === "CNAME").length > 1) {
      issues.push({
        type: "error",
        message: `Multiple CNAME records at '${name}' — only one CNAME is allowed per name`,
      });
    }
  }

  // Check: Missing MX records for root domain (warning)
  const rootRecords = byName.get("@") || [];
  const hasMxAtRoot = rootRecords.some((r) => r.type === "MX");
  if (!hasMxAtRoot && records.length > 0) {
    issues.push({
      type: "warning",
      message: `No MX record found at root (@) — email delivery may not work for ${domain.name}`,
    });
  }

  // Check: Orphan records — records pointing to names with no A/AAAA resolution
  for (const r of records) {
    if (r.type === "CNAME") {
      const target = r.value.toLowerCase().replace(/\.$/, "");
      // Check if target is within this domain and has no records
      if (target.endsWith(domain.name.toLowerCase())) {
        const targetName = target === domain.name.toLowerCase() ? "@" : target.replace(`.${domain.name.toLowerCase()}`, "");
        const targetRecords = byName.get(targetName.toLowerCase());
        if (!targetRecords || targetRecords.length === 0) {
          issues.push({
            type: "warning",
            record_id: r.id,
            message: `CNAME '${r.name}' points to '${r.value}' which has no records in this zone`,
          });
        }
      }
    }
  }

  // Check: MX records should have priority
  for (const r of records) {
    if (r.type === "MX" && r.priority === null) {
      issues.push({
        type: "warning",
        record_id: r.id,
        message: `MX record '${r.name}' -> '${r.value}' has no priority set`,
      });
    }
  }

  return {
    domain_id: domainId,
    domain_name: domain.name,
    issues,
    valid: issues.filter((i) => i.type === "error").length === 0,
  };
}
