import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "open-domains-test-"));
process.env["DOMAINS_DIR"] = tempDir;

import {
  createDomain,
  getDomain,
  getDomainByIdentifier,
  getDomainDetails,
  listDomains,
  updateDomain,
  markDomainPremium,
  createDomainOffer,
  listDomainOffers,
  updateDomainLifecycleStatus,
  recordDomainPurchase,
  linkDomainEmail,
  listDomainEmailLinks,
  deleteDomain,
  countDomains,
  searchDomains,
  getByRegistrar,
  listExpiring,
  listSslExpiring,
  getDomainStats,
  createDnsRecord,
  getDnsRecord,
  listDnsRecords,
  updateDnsRecord,
  deleteDnsRecord,
  createAlert,
  getAlert,
  listAlerts,
  deleteAlert,
  exportZoneFile,
  importZoneFile,
  validateDns,
  exportPortfolio,
  getDomainByName,
  discoverSubdomains,
} from "./domains";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Domains", () => {
  test("create and get domain", () => {
    const domain = createDomain({
      name: "example.com",
      registrar: "Namecheap",
      status: "active",
      registered_at: "2020-01-01T00:00:00Z",
      expires_at: "2030-01-01T00:00:00Z",
      nameservers: ["ns1.example.com", "ns2.example.com"],
    });

    expect(domain.id).toBeTruthy();
    expect(domain.name).toBe("example.com");
    expect(domain.registrar).toBe("Namecheap");
    expect(domain.status).toBe("active");
    expect(domain.auto_renew).toBe(true);
    expect(domain.nameservers).toEqual(["ns1.example.com", "ns2.example.com"]);

    const fetched = getDomain(domain.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(domain.id);
    expect(fetched!.name).toBe("example.com");
  });

  test("create domain with defaults", () => {
    const domain = createDomain({ name: "minimal.io" });
    expect(domain.status).toBe("active");
    expect(domain.auto_renew).toBe(true);
    expect(domain.nameservers).toEqual([]);
    expect(domain.metadata).toEqual({});
  });

  test("domain name is unique", () => {
    expect(() => createDomain({ name: "example.com" })).toThrow();
  });

  test("list domains", () => {
    createDomain({ name: "another.org", registrar: "GoDaddy" });
    const all = listDomains();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("list domains with limit and offset", () => {
    createDomain({ name: "aaa-first.com" });
    createDomain({ name: "zzz-last.com" });

    const firstPage = listDomains({ limit: 1 });
    expect(firstPage.length).toBe(1);

    const offsetPage = listDomains({ offset: 1 });
    expect(offsetPage.length).toBeGreaterThanOrEqual(1);
    expect(offsetPage.length).toBeLessThan(listDomains().length);

    const emptyPage = listDomains({ limit: 0 });
    expect(emptyPage).toHaveLength(0);
  });

  test("list domains with status filter", () => {
    createDomain({ name: "transferring.net", status: "transferring" });
    const result = listDomains({ status: "transferring" });
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe("transferring.net");
  });

  test("list domains with registrar filter", () => {
    const result = listDomains({ registrar: "GoDaddy" });
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe("another.org");
  });

  test("list premium domains", () => {
    createDomain({ name: "premium-filter.com", is_premium: true, premium_price: 2500 });
    const premiumOnly = listDomains({ is_premium: true });
    expect(premiumOnly.some((domain) => domain.name === "premium-filter.com")).toBe(true);
  });

  test("search domains", () => {
    const results = searchDomains("example");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("example.com");
  });

  test("get by registrar", () => {
    const results = getByRegistrar("Namecheap");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("example.com");
  });

  test("update domain", () => {
    const domain = createDomain({ name: "update-test.com" });
    const updated = updateDomain(domain.id, {
      registrar: "Cloudflare",
      status: "expired",
      auto_renew: false,
      notes: "Updated domain",
    });

    expect(updated).toBeDefined();
    expect(updated!.registrar).toBe("Cloudflare");
    expect(updated!.status).toBe("expired");
    expect(updated!.auto_renew).toBe(false);
    expect(updated!.notes).toBe("Updated domain");
  });

  test("update domain returns null for missing", () => {
    const result = updateDomain("nonexistent-id", { registrar: "Test" });
    expect(result).toBeNull();
  });

  test("update domain with no changes returns existing", () => {
    const domain = createDomain({ name: "nochange.com" });
    const result = updateDomain(domain.id, {});
    expect(result).toBeDefined();
    expect(result!.id).toBe(domain.id);
  });

  test("domain acquisition workflow tracks premium pricing, offers, purchases, and linked emails", () => {
    const domain = createDomain({ name: "brokered-domain.com", status: "discovered" });

    const premium = markDomainPremium(domain.id, 5000, 12);
    expect(premium).not.toBeNull();
    expect(premium!.is_premium).toBe(true);
    expect(premium!.premium_price).toBe(5000);
    expect(premium!.standard_price).toBe(12);
    expect(premium!.status).toBe("premium_only");

    const offer = createDomainOffer({
      domain_id: domain.id,
      our_offer: 2000,
      their_ask: 5000,
      status: "countered",
      notes: "Broker countered at 5k",
    });
    expect(offer.status).toBe("countered");
    expect(listDomainOffers(domain.id)).toHaveLength(1);

    const email = linkDomainEmail({
      domain_id: domain.id,
      email_id: "email_123",
      thread_id: "thread_123",
      type: "offer",
    });
    expect(email.type).toBe("offer");
    expect(listDomainEmailLinks(domain.id)).toHaveLength(1);

    const purchased = recordDomainPurchase(domain.id, {
      price: 3200,
      registrar: "Broker",
      purchase_date: "2026-04-10T00:00:00Z",
      expires_at: "2027-04-10T00:00:00Z",
      auto_renew: false,
    });
    expect(purchased).not.toBeNull();
    expect(purchased!.status).toBe("purchased");
    expect(purchased!.purchase_price).toBe(3200);
    expect(purchased!.purchase_date).toBe("2026-04-10T00:00:00Z");
    expect(purchased!.registrar).toBe("Broker");

    const active = updateDomainLifecycleStatus(domain.id, "active");
    expect(active).not.toBeNull();
    expect(active!.status).toBe("active");

    const details = getDomainDetails(domain.id);
    expect(details).not.toBeNull();
    expect(details!.offers).toHaveLength(1);
    expect(details!.emails).toHaveLength(1);
  });

  test("delete domain", () => {
    const domain = createDomain({ name: "deleteme.com" });
    expect(deleteDomain(domain.id)).toBe(true);
    expect(getDomain(domain.id)).toBeNull();
  });

  test("delete non-existent domain returns false", () => {
    expect(deleteDomain("nonexistent-id")).toBe(false);
  });

  test("cascade delete removes offer and email links", () => {
    const domain = createDomain({ name: "cascade-acquisition.com", status: "researching" });
    createDomainOffer({ domain_id: domain.id, our_offer: 1500 });
    linkDomainEmail({ domain_id: domain.id, email_id: "email_cascade", type: "inquiry" });

    deleteDomain(domain.id);
    expect(listDomainOffers(domain.id)).toHaveLength(0);
    expect(listDomainEmailLinks(domain.id)).toHaveLength(0);
  });

  test("count domains", () => {
    const count = countDomains();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test("list expiring domains", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    createDomain({
      name: "expiring-soon.com",
      expires_at: futureDate.toISOString(),
    });

    const expiring = listExpiring(30);
    expect(expiring.some((d) => d.name === "expiring-soon.com")).toBe(true);

    const expiringShort = listExpiring(5);
    expect(expiringShort.some((d) => d.name === "expiring-soon.com")).toBe(false);
  });

  test("list SSL expiring domains", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    createDomain({
      name: "ssl-expiring.com",
      ssl_expires_at: futureDate.toISOString(),
      ssl_issuer: "Let's Encrypt",
    });

    const sslExpiring = listSslExpiring(30);
    expect(sslExpiring.some((d) => d.name === "ssl-expiring.com")).toBe(true);
  });

  test("get domain stats", () => {
    const stats = getDomainStats();
    expect(stats.total).toBeGreaterThanOrEqual(5);
    expect(stats.active).toBeGreaterThanOrEqual(1);
    expect(typeof stats.expired).toBe("number");
    expect(typeof stats.transferring).toBe("number");
    expect(typeof stats.redemption).toBe("number");
    expect(typeof stats.auto_renew_enabled).toBe("number");
    expect(typeof stats.expiring_30_days).toBe("number");
    expect(typeof stats.ssl_expiring_30_days).toBe("number");
  });
});

describe("DNS Records", () => {
  let domainId: string;

  test("setup: create domain for DNS tests", () => {
    const domain = createDomain({ name: "dns-test.com" });
    domainId = domain.id;
    expect(domainId).toBeTruthy();
  });

  test("create and get DNS record", () => {
    const record = createDnsRecord({
      domain_id: domainId,
      type: "A",
      name: "@",
      value: "192.168.1.1",
      ttl: 300,
    });

    expect(record.id).toBeTruthy();
    expect(record.type).toBe("A");
    expect(record.name).toBe("@");
    expect(record.value).toBe("192.168.1.1");
    expect(record.ttl).toBe(300);

    const fetched = getDnsRecord(record.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(record.id);
  });

  test("create MX record with priority", () => {
    const record = createDnsRecord({
      domain_id: domainId,
      type: "MX",
      name: "@",
      value: "mail.dns-test.com",
      priority: 10,
    });

    expect(record.priority).toBe(10);
    expect(record.type).toBe("MX");
  });

  test("list DNS records for domain", () => {
    const records = listDnsRecords(domainId);
    expect(records.length).toBeGreaterThanOrEqual(2);
  });

  test("list DNS records filtered by type", () => {
    const aRecords = listDnsRecords(domainId, "A");
    expect(aRecords.length).toBe(1);
    expect(aRecords[0]!.type).toBe("A");
  });

  test("update DNS record", () => {
    const record = createDnsRecord({
      domain_id: domainId,
      type: "CNAME",
      name: "www",
      value: "dns-test.com",
    });

    const updated = updateDnsRecord(record.id, {
      value: "cdn.dns-test.com",
      ttl: 600,
    });

    expect(updated).toBeDefined();
    expect(updated!.value).toBe("cdn.dns-test.com");
    expect(updated!.ttl).toBe(600);
  });

  test("update non-existent DNS record returns null", () => {
    const result = updateDnsRecord("nonexistent-id", { value: "test" });
    expect(result).toBeNull();
  });

  test("delete DNS record", () => {
    const record = createDnsRecord({
      domain_id: domainId,
      type: "TXT",
      name: "@",
      value: "v=spf1 include:_spf.google.com ~all",
    });

    expect(deleteDnsRecord(record.id)).toBe(true);
    expect(getDnsRecord(record.id)).toBeNull();
  });

  test("delete non-existent DNS record returns false", () => {
    expect(deleteDnsRecord("nonexistent-id")).toBe(false);
  });

  test("cascade delete: removing domain deletes DNS records", () => {
    const domain = createDomain({ name: "cascade-dns.com" });
    const record = createDnsRecord({
      domain_id: domain.id,
      type: "A",
      name: "@",
      value: "10.0.0.1",
    });

    deleteDomain(domain.id);
    expect(getDnsRecord(record.id)).toBeNull();
  });
});

describe("Alerts", () => {
  let domainId: string;

  test("setup: create domain for alert tests", () => {
    const domain = createDomain({ name: "alert-test.com" });
    domainId = domain.id;
    expect(domainId).toBeTruthy();
  });

  test("create and get alert", () => {
    const alert = createAlert({
      domain_id: domainId,
      type: "expiry",
      trigger_days_before: 30,
    });

    expect(alert.id).toBeTruthy();
    expect(alert.type).toBe("expiry");
    expect(alert.trigger_days_before).toBe(30);
    expect(alert.sent_at).toBeNull();

    const fetched = getAlert(alert.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(alert.id);
  });

  test("create SSL expiry alert", () => {
    const alert = createAlert({
      domain_id: domainId,
      type: "ssl_expiry",
      trigger_days_before: 14,
    });

    expect(alert.type).toBe("ssl_expiry");
    expect(alert.trigger_days_before).toBe(14);
  });

  test("list alerts for domain", () => {
    const alerts = listAlerts(domainId);
    expect(alerts.length).toBeGreaterThanOrEqual(2);
  });

  test("delete alert", () => {
    const alert = createAlert({
      domain_id: domainId,
      type: "dns_change",
    });

    expect(deleteAlert(alert.id)).toBe(true);
    expect(getAlert(alert.id)).toBeNull();
  });

  test("delete non-existent alert returns false", () => {
    expect(deleteAlert("nonexistent-id")).toBe(false);
  });

  test("cascade delete: removing domain deletes alerts", () => {
    const domain = createDomain({ name: "cascade-alert.com" });
    const alert = createAlert({
      domain_id: domain.id,
      type: "expiry",
      trigger_days_before: 7,
    });

    deleteDomain(domain.id);
    expect(getAlert(alert.id)).toBeNull();
  });
});

// ============================================================
// Zone File Export / Import
// ============================================================

describe("Zone File Export/Import", () => {
  let domainId: string;

  test("setup: create domain with DNS records for zone tests", () => {
    const domain = createDomain({ name: "zone-test.com" });
    domainId = domain.id;

    createDnsRecord({ domain_id: domainId, type: "A", name: "@", value: "93.184.216.34", ttl: 300 });
    createDnsRecord({ domain_id: domainId, type: "AAAA", name: "@", value: "2606:2800:220:1:248:1893:25c8:1946" });
    createDnsRecord({ domain_id: domainId, type: "CNAME", name: "www", value: "zone-test.com." });
    createDnsRecord({ domain_id: domainId, type: "MX", name: "@", value: "mail.zone-test.com.", priority: 10 });
    createDnsRecord({ domain_id: domainId, type: "TXT", name: "@", value: "v=spf1 include:_spf.google.com ~all" });
    createDnsRecord({ domain_id: domainId, type: "NS", name: "@", value: "ns1.zone-test.com." });
  });

  test("export zone file produces valid BIND format", () => {
    const zone = exportZoneFile(domainId);
    expect(zone).toBeDefined();
    expect(zone).not.toBeNull();

    expect(zone).toContain("$ORIGIN zone-test.com.");
    expect(zone).toContain("$TTL 3600");
    expect(zone).toContain("; Zone file for zone-test.com");

    expect(zone).toContain("IN\tA\t93.184.216.34");
    expect(zone).toContain("IN\tAAAA\t2606:2800:220:1:248:1893:25c8:1946");
    expect(zone).toContain("IN\tCNAME\tzone-test.com.");
    expect(zone).toContain("IN\tMX\t10\tmail.zone-test.com.");
    expect(zone).toContain("IN\tTXT\tv=spf1 include:_spf.google.com ~all");
    expect(zone).toContain("IN\tNS\tns1.zone-test.com.");
  });

  test("export zone file returns null for missing domain", () => {
    const result = exportZoneFile("nonexistent-id");
    expect(result).toBeNull();
  });

  test("import zone file creates DNS records", () => {
    const importDomain = createDomain({ name: "import-zone.com" });
    const content = `
; Zone file for import-zone.com
$ORIGIN import-zone.com.
$TTL 3600

import-zone.com.  300  IN  A   10.0.0.1
www              3600  IN  CNAME  import-zone.com.
import-zone.com.  3600  IN  MX  10  mail.import-zone.com.
import-zone.com.  3600  IN  TXT  "v=spf1 -all"
`;

    const result = importZoneFile(importDomain.id, content);
    expect(result).not.toBeNull();
    expect(result!.imported).toBe(4);
    expect(result!.skipped).toBe(0);
    expect(result!.errors.length).toBe(0);
    expect(result!.records.length).toBe(4);

    const records = listDnsRecords(importDomain.id);
    expect(records.length).toBe(4);
    expect(records.some((r) => r.type === "A" && r.value === "10.0.0.1")).toBe(true);
    expect(records.some((r) => r.type === "CNAME" && r.name === "www")).toBe(true);
    expect(records.some((r) => r.type === "MX" && r.priority === 10)).toBe(true);
  });

  test("import zone file skips invalid lines", () => {
    const importDomain = createDomain({ name: "import-bad-zone.com" });
    const content = `
; Zone file
bad line
too  few
good.example.com.  3600  IN  A  1.2.3.4
bad.example.com.  3600  IN  INVALID  value
`;

    const result = importZoneFile(importDomain.id, content);
    expect(result).not.toBeNull();
    expect(result!.imported).toBe(1);
    expect(result!.skipped).toBeGreaterThanOrEqual(2);
    expect(result!.errors.length).toBeGreaterThanOrEqual(2);
  });

  test("import zone file returns null for missing domain", () => {
    const result = importZoneFile("nonexistent-id", "some content");
    expect(result).toBeNull();
  });
});

// ============================================================
// DNS Validation
// ============================================================

describe("DNS Validation", () => {
  test("returns null for missing domain", () => {
    const result = validateDns("nonexistent-id");
    expect(result).toBeNull();
  });

  test("detects CNAME + A conflict", () => {
    const domain = createDomain({ name: "validate-cname-a.com" });
    createDnsRecord({ domain_id: domain.id, type: "CNAME", name: "www", value: "example.com." });
    createDnsRecord({ domain_id: domain.id, type: "A", name: "www", value: "1.2.3.4" });

    const result = validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.issues.some((i) => i.type === "error" && i.message.includes("CNAME") && i.message.includes("A/AAAA"))).toBe(true);
  });

  test("detects CNAME + MX conflict", () => {
    const domain = createDomain({ name: "validate-cname-mx.com" });
    createDnsRecord({ domain_id: domain.id, type: "CNAME", name: "@", value: "example.com." });
    createDnsRecord({ domain_id: domain.id, type: "MX", name: "@", value: "mail.example.com.", priority: 10 });

    const result = validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.issues.some((i) => i.type === "error" && i.message.includes("CNAME") && i.message.includes("MX"))).toBe(true);
  });

  test("warns about missing MX at root", () => {
    const domain = createDomain({ name: "validate-no-mx.com" });
    createDnsRecord({ domain_id: domain.id, type: "A", name: "@", value: "1.2.3.4" });

    const result = validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.issues.some((i) => i.type === "warning" && i.message.includes("No MX record"))).toBe(true);
  });

  test("warns about MX without priority", () => {
    const domain = createDomain({ name: "validate-mx-nopri.com" });
    createDnsRecord({ domain_id: domain.id, type: "MX", name: "@", value: "mail.example.com." });

    const result = validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.issues.some((i) => i.type === "warning" && i.message.includes("no priority"))).toBe(true);
  });

  test("valid configuration has no errors", () => {
    const domain = createDomain({ name: "validate-good.com" });
    createDnsRecord({ domain_id: domain.id, type: "A", name: "@", value: "1.2.3.4" });
    createDnsRecord({ domain_id: domain.id, type: "MX", name: "@", value: "mail.validate-good.com.", priority: 10 });
    createDnsRecord({ domain_id: domain.id, type: "TXT", name: "@", value: "v=spf1 -all" });

    const result = validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(true);
    expect(result!.issues.filter((i) => i.type === "error").length).toBe(0);
  });
});

// ============================================================
// Portfolio Export
// ============================================================

describe("Portfolio Export", () => {
  test("export as JSON", () => {
    const output = exportPortfolio("json");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty("name");
    expect(parsed[0]).toHaveProperty("registrar");
    expect(parsed[0]).toHaveProperty("status");
    expect(parsed[0]).toHaveProperty("expires_at");
    expect(parsed[0]).toHaveProperty("auto_renew");
    expect(parsed[0]).toHaveProperty("is_premium");
    expect(parsed[0]).toHaveProperty("premium_price");
    expect(parsed[0]).toHaveProperty("standard_price");
    expect(parsed[0]).toHaveProperty("purchase_price");
    expect(parsed[0]).toHaveProperty("purchase_date");
    expect(parsed[0]).toHaveProperty("ssl_expires_at");
    expect(parsed[0]).toHaveProperty("ssl_issuer");
  });

  test("export as CSV", () => {
    const output = exportPortfolio("csv");
    const lines = output.trim().split("\n");
    expect(lines.length).toBeGreaterThan(1);

    const header = lines[0]!;
    expect(header).toContain("name");
    expect(header).toContain("registrar");
    expect(header).toContain("status");
    expect(header).toContain("expires_at");
    expect(header).toContain("auto_renew");
    expect(header).toContain("is_premium");
    expect(header).toContain("premium_price");
    expect(header).toContain("standard_price");
    expect(header).toContain("purchase_price");
    expect(header).toContain("purchase_date");
    expect(header).toContain("ssl_expires_at");
    expect(header).toContain("ssl_issuer");

    expect(lines.length).toBeGreaterThan(2);
  });

  test("CSV escapes values with commas", () => {
    createDomain({ name: "csv-escape-test.com", notes: "has, comma" });
    const output = exportPortfolio("csv");
    expect(output).toContain('"has, comma"');
  });
});

// ============================================================
// getDomainByName
// ============================================================

describe("getDomainByName", () => {
  test("finds domain by name", () => {
    const domain = getDomainByName("example.com");
    expect(domain).not.toBeNull();
    expect(domain!.name).toBe("example.com");
  });

  test("returns null for unknown name", () => {
    const domain = getDomainByName("nonexistent-domain.xyz");
    expect(domain).toBeNull();
  });

  test("finds domain by id or name identifier", () => {
    const byName = getDomainByIdentifier("example.com");
    expect(byName).not.toBeNull();
    const byId = getDomainByIdentifier(byName!.id);
    expect(byId).not.toBeNull();
    expect(byId!.name).toBe("example.com");
  });
});

// ============================================================
// Subdomain Discovery (mocked)
// ============================================================

describe("Subdomain Discovery", () => {
  test("discoverSubdomains returns structured result", async () => {
    // We test the function structure — network call may fail in CI
    const result = await discoverSubdomains("example.com");
    expect(result).toHaveProperty("domain", "example.com");
    expect(result).toHaveProperty("subdomains");
    expect(result).toHaveProperty("source", "crt.sh");
    expect(Array.isArray(result.subdomains)).toBe(true);
  });
});
