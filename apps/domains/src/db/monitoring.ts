/**
 * Portfolio export and bulk domain check operations
 */

import { listDomains, type Domain } from "./domain-records.js";
import { validateDns, whoisLookup, checkSsl } from "./dns-tools.js";

// ============================================================
// Portfolio Export
// ============================================================

export function exportPortfolio(format: "csv" | "json" = "json"): string {
  const domains = listDomains();

  if (format === "json") {
    return JSON.stringify(
      domains.map((d: Domain) => ({
        name: d.name,
        registrar: d.registrar,
        status: d.status,
        registered_at: d.registered_at,
        expires_at: d.expires_at,
        auto_renew: d.auto_renew,
        is_premium: d.is_premium,
        premium_price: d.premium_price,
        standard_price: d.standard_price,
        purchase_price: d.purchase_price,
        purchase_date: d.purchase_date,
        nameservers: d.nameservers,
        ssl_expires_at: d.ssl_expires_at,
        ssl_issuer: d.ssl_issuer,
        notes: d.notes,
      })),
      null,
      2
    );
  }

  // CSV format
  const headers = [
    "name",
    "registrar",
    "status",
    "registered_at",
    "expires_at",
    "auto_renew",
    "is_premium",
    "premium_price",
    "standard_price",
    "purchase_price",
    "purchase_date",
    "nameservers",
    "ssl_expires_at",
    "ssl_issuer",
    "notes",
  ];
  const rows = domains.map((d: Domain) =>
    [
      csvEscape(d.name),
      csvEscape(d.registrar || ""),
      csvEscape(d.status),
      csvEscape(d.registered_at || ""),
      csvEscape(d.expires_at || ""),
      d.auto_renew ? "true" : "false",
      d.is_premium ? "true" : "false",
      csvEscape(d.premium_price?.toString() || ""),
      csvEscape(d.standard_price?.toString() || ""),
      csvEscape(d.purchase_price?.toString() || ""),
      csvEscape(d.purchase_date || ""),
      csvEscape(d.nameservers.join("; ")),
      csvEscape(d.ssl_expires_at || ""),
      csvEscape(d.ssl_issuer || ""),
      csvEscape(d.notes || ""),
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n") + "\n";
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ============================================================
// Bulk Domain Check
// ============================================================

export interface BulkCheckResult {
  domain: string;
  domain_id: string;
  whois?: { registrar: string | null; expires_at: string | null; error?: string };
  ssl?: { issuer: string | null; expires_at: string | null; error?: string };
  dns_validation?: { valid: boolean; issue_count: number; errors: string[] };
}

export function checkAllDomains(): BulkCheckResult[] {
  const domains = listDomains();
  const results: BulkCheckResult[] = [];

  for (const domain of domains) {
    const result: BulkCheckResult = {
      domain: domain.name,
      domain_id: domain.id,
    };

    // WHOIS check
    try {
      const whois = whoisLookup(domain.name);
      result.whois = {
        registrar: whois.registrar,
        expires_at: whois.expires_at,
      };
    } catch (error: unknown) {
      result.whois = {
        registrar: null,
        expires_at: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // SSL check
    try {
      const ssl = checkSsl(domain.name);
      result.ssl = {
        issuer: ssl.issuer,
        expires_at: ssl.expires_at,
        error: ssl.error,
      };
    } catch (error: unknown) {
      result.ssl = {
        issuer: null,
        expires_at: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // DNS validation
    const validation = validateDns(domain.id);
    if (validation) {
      result.dns_validation = {
        valid: validation.valid,
        issue_count: validation.issues.length,
        errors: validation.issues.map((i) => `[${i.type}] ${i.message}`),
      };
    }

    results.push(result);
  }

  return results;
}
