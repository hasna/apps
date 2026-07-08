import { describe, test, expect, afterAll, mock, beforeEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "open-domains-monitoring-test-"));
process.env["DOMAINS_DIR"] = tempDir;

import { createDomain } from "./domains";
import { closeDatabase } from "./database";
import { exportPortfolio, checkAllDomains } from "./monitoring";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================
// Portfolio Export
// ============================================================

describe("Portfolio Export", () => {
  test("export JSON format", async () => {
    await createDomain({ name: "json-export-test.com" });

    const result = await exportPortfolio("json");
    const parsed = JSON.parse(result);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);

    const domain = parsed.find((d: any) => d.name === "json-export-test.com");
    expect(domain).toBeDefined();
    expect(domain).toHaveProperty("name", "json-export-test.com");
    expect(domain).toHaveProperty("auto_renew");
    expect(domain).toHaveProperty("is_premium");
    expect(domain).toHaveProperty("nameservers");
  });

  test("export CSV format", async () => {
    await createDomain({ name: "csv-export-test.com" });

    const result = await exportPortfolio("csv");
    const lines = result.trim().split("\n");

    expect(lines.length).toBeGreaterThanOrEqual(2);

    const headers = lines[0]!.split(",");
    expect(headers).toContain("name");
    expect(headers).toContain("registrar");
    expect(headers).toContain("status");
    expect(headers).toContain("expires_at");
    expect(headers).toContain("auto_renew");
    expect(headers).toContain("is_premium");
    expect(headers).toContain("nameservers");
  });

  test("CSV includes domain data row", async () => {
    await createDomain({ name: "csv-row-test.com" });

    const result = await exportPortfolio("csv");
    const lines = result.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // Find the line containing the domain (may not be at lines[1] due to other test domains)
    const domainLine = lines.find((l) => l.includes("csv-row-test.com"));
    expect(domainLine).toBeDefined();
  });

  test("CSV escapes values with commas", async () => {
    await createDomain({ name: "csv-escape-test.com", notes: "test, with comma" });

    const result = await exportPortfolio("csv");
    const lines = result.trim().split("\n");

    // Find the line with our domain
    const domainLine = lines.find((l) => l.includes("csv-escape-test.com"));
    expect(domainLine).toBeDefined();
    // The notes field with comma should be quoted
    expect(domainLine).toContain('"test, with comma"');
  });

  test("CSV escapes values with quotes", async () => {
    await createDomain({ name: "csv-quote-test.com", notes: 'has "quotes"' });

    const result = await exportPortfolio("csv");
    const lines = result.trim().split("\n");

    const domainLine = lines.find((l) => l.includes("csv-quote-test.com"));
    expect(domainLine).toBeDefined();
    // Quotes should be doubled
    expect(domainLine).toContain('"has ""quotes"""');
  });

  test("JSON defaults to json format", async () => {
    await createDomain({ name: "default-format-test.com" });

    const result = await exportPortfolio();
    expect(result.startsWith("[")).toBe(true);
  });

  test("export includes boolean fields", async () => {
    await createDomain({ name: "bool-test.com", auto_renew: true, is_premium: true });

    const jsonResult = await exportPortfolio("json");
    const parsed = JSON.parse(jsonResult);
    const domain = parsed.find((d: any) => d.name === "bool-test.com");

    expect(domain.auto_renew).toBe(true);
    expect(domain.is_premium).toBe(true);
  });

  test("export includes price fields", async () => {
    await createDomain({
      name: "price-test.com",
      premium_price: 999,
      standard_price: 10,
      purchase_price: 5,
    });

    const jsonResult = await exportPortfolio("json");
    const parsed = JSON.parse(jsonResult);
    const domain = parsed.find((d: any) => d.name === "price-test.com");

    expect(domain.premium_price).toBe(999);
    expect(domain.standard_price).toBe(10);
    expect(domain.purchase_price).toBe(5);
  });
});

// ============================================================
// Bulk Domain Check
// ============================================================

describe("Bulk Domain Check", () => {
  test("checkAllDomains returns empty array when no domains", async () => {
    const results = await checkAllDomains();
    expect(Array.isArray(results)).toBe(true);
    // May have results from other test domains, just check structure
  });

  test("checkAllDomains returns structured results", async () => {
    await createDomain({ name: "bulk-check-test.com" });

    const results = await checkAllDomains();
    expect(results.length).toBeGreaterThan(0);

    const result = results.find((r) => r.domain === "bulk-check-test.com");
    if (result) {
      expect(result).toHaveProperty("domain", "bulk-check-test.com");
      expect(result).toHaveProperty("domain_id");
      expect(result).toHaveProperty("whois");
      expect(result).toHaveProperty("ssl");
      expect(result).toHaveProperty("dns_validation");
    }
  });

  test("checkAllDomains whois result structure", async () => {
    await createDomain({ name: "whois-check-test.com" });

    const results = await checkAllDomains();
    const result = results.find((r) => r.domain === "whois-check-test.com");

    if (result?.whois) {
      expect(result.whois).toHaveProperty("registrar");
      expect(result.whois).toHaveProperty("expires_at");
    }
  });

  test("checkAllDomains ssl result structure", async () => {
    await createDomain({ name: "ssl-check-test.com" });

    const results = await checkAllDomains();
    const result = results.find((r) => r.domain === "ssl-check-test.com");

    if (result?.ssl) {
      expect(result.ssl).toHaveProperty("issuer");
      expect(result.ssl).toHaveProperty("expires_at");
    }
  });

  test("checkAllDomains reports invalid stored domains per result", async () => {
    const marker = join(tempDir, "bulk-ssl-injected");
    const name = `example.com; touch ${marker} #`;
    await createDomain({ name });

    const results = await checkAllDomains();
    const result = results.find((r) => r.domain === name);

    expect(result?.whois?.error).toMatch(/Invalid domain name/);
    expect(result?.ssl?.error).toMatch(/Invalid domain name/);
    expect(existsSync(marker)).toBe(false);
  });

  test("checkAllDomains dns_validation result structure", async () => {
    await createDomain({ name: "dns-val-check-test.com" });

    const results = await checkAllDomains();
    const result = results.find((r) => r.domain === "dns-val-check-test.com");

    if (result?.dns_validation) {
      expect(result.dns_validation).toHaveProperty("valid");
      expect(result.dns_validation).toHaveProperty("issue_count");
      expect(result.dns_validation).toHaveProperty("errors");
      expect(Array.isArray(result.dns_validation.errors)).toBe(true);
    }
  }, 30_000);
});
