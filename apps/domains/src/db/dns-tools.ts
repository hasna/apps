/**
 * DNS tools: WHOIS lookup, DNS propagation, SSL check, zone file import/export,
 * subdomain discovery, and DNS validation
 */

import { execSync } from "node:child_process";
import { getDatabase } from "./database.js";
import { getDomain, updateDomain, type UpdateDomainInput } from "./domain-records.js";
import { createDnsRecord, listDnsRecords, type DnsRecord } from "./dns-records.js";
import { USER_AGENT } from "../lib/version.js";

// ============================================================
// WHOIS Lookup
// ============================================================

export interface WhoisResult {
  domain: string;
  registrar: string | null;
  expires_at: string | null;
  nameservers: string[];
  raw: string;
}

export function whoisLookup(domainName: string): WhoisResult {
  let raw: string;
  try {
    raw = execSync(`whois ${domainName}`, { timeout: 15000, encoding: "utf-8" });
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string };
    raw = err.stdout || err.stderr || "";
    if (!raw) throw new Error(`whois command failed for ${domainName}`);
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

  // Update the DB record if a domain with this name exists
  const db = getDatabase();
  const row = db.prepare("SELECT id FROM domains WHERE name = ?").get(domainName) as { id: string } | null;
  if (row) {
    const updates: UpdateDomainInput = { whois: { raw } };
    if (registrar) updates.registrar = registrar;
    if (expires_at) updates.expires_at = expires_at;
    if (nameservers.length > 0) updates.nameservers = nameservers;
    updateDomain(row.id, updates);
  }

  return { domain: domainName, registrar, expires_at, nameservers, raw };
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
  const servers: DnsPropagationResult["servers"] = [];

  for (const server of DNS_SERVERS) {
    try {
      const output = execSync(
        `dig @${server} ${domain} ${recordType} +short +time=5 +tries=1`,
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

  return { domain, record_type: recordType, servers, consistent };
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

export function checkSsl(domainName: string): SslCheckResult {
  try {
    const output = execSync(
      `echo | openssl s_client -servername ${domainName} -connect ${domainName}:443 2>/dev/null | openssl x509 -noout -issuer -dates -subject 2>/dev/null`,
      { timeout: 15000, encoding: "utf-8" }
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

    // Update the DB record if exists
    const db = getDatabase();
    const row = db.prepare("SELECT id FROM domains WHERE name = ?").get(domainName) as { id: string } | null;
    if (row) {
      const updates: UpdateDomainInput = {};
      if (expires_at) updates.ssl_expires_at = expires_at;
      if (issuer) updates.ssl_issuer = issuer;
      updateDomain(row.id, updates);
    }

    return { domain: domainName, issuer, expires_at, subject };
  } catch (error: unknown) {
    return {
      domain: domainName,
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

export function exportZoneFile(domainId: string): string | null {
  const domain = getDomain(domainId);
  if (!domain) return null;

  const records = listDnsRecords(domainId);
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

export function importZoneFile(domainId: string, content: string): ZoneImportResult | null {
  const domain = getDomain(domainId);
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
      const record = createDnsRecord({
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

export function validateDns(domainId: string): DnsValidationResult | null {
  const domain = getDomain(domainId);
  if (!domain) return null;

  const records = listDnsRecords(domainId);
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
