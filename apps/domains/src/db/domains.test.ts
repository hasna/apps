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
  test("create and get domain", async () => {
    const domain = await createDomain({
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

    const fetched = await getDomain(domain.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(domain.id);
    expect(fetched!.name).toBe("example.com");
  });

  test("create domain with defaults", async () => {
    const domain = await createDomain({ name: "minimal.io" });
    expect(domain.status).toBe("active");
    expect(domain.auto_renew).toBe(true);
    expect(domain.nameservers).toEqual([]);
    expect(domain.metadata).toEqual({});
  });

  test("domain name is unique", async () => {
    await expect(createDomain({ name: "example.com" })).rejects.toThrow();
  });

  test("list domains", async () => {
    await createDomain({ name: "another.org", registrar: "GoDaddy" });
    const all = await listDomains();
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("list domains with limit and offset", async () => {
    await createDomain({ name: "aaa-first.com" });
    await createDomain({ name: "zzz-last.com" });

    const firstPage = await listDomains({ limit: 1 });
    expect(firstPage.length).toBe(1);

    const offsetPage = await listDomains({ offset: 1 });
    expect(offsetPage.length).toBeGreaterThanOrEqual(1);
    expect(offsetPage.length).toBeLessThan((await listDomains()).length);

    const emptyPage = await listDomains({ limit: 0 });
    expect(emptyPage).toHaveLength(0);
  });

  test("list domains with status filter", async () => {
    await createDomain({ name: "transferring.net", status: "transferring" });
    const result = await listDomains({ status: "transferring" });
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe("transferring.net");
  });

  test("list domains with registrar filter", async () => {
    const result = await listDomains({ registrar: "GoDaddy" });
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe("another.org");
  });

  test("list premium domains", async () => {
    await createDomain({ name: "premium-filter.com", is_premium: true, premium_price: 2500 });
    const premiumOnly = await listDomains({ is_premium: true });
    expect(premiumOnly.some((domain) => domain.name === "premium-filter.com")).toBe(true);
  });

  test("search domains", async () => {
    const results = await searchDomains("example");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("example.com");
  });

  test("get by registrar", async () => {
    const results = await getByRegistrar("Namecheap");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("example.com");
  });

  test("update domain", async () => {
    const domain = await createDomain({ name: "update-test.com" });
    const updated = await updateDomain(domain.id, {
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

  test("update domain returns null for missing", async () => {
    const result = await updateDomain("nonexistent-id", { registrar: "Test" });
    expect(result).toBeNull();
  });

  test("update domain with no changes returns existing", async () => {
    const domain = await createDomain({ name: "nochange.com" });
    const result = await updateDomain(domain.id, {});
    expect(result).toBeDefined();
    expect(result!.id).toBe(domain.id);
  });

  test("domain acquisition workflow tracks premium pricing, offers, purchases, and linked emails", async () => {
    const domain = await createDomain({ name: "brokered-domain.com", status: "discovered" });

    const premium = await markDomainPremium(domain.id, 5000, 12);
    expect(premium).not.toBeNull();
    expect(premium!.is_premium).toBe(true);
    expect(premium!.premium_price).toBe(5000);
    expect(premium!.standard_price).toBe(12);
    expect(premium!.status).toBe("premium_only");

    const offer = await createDomainOffer({
      domain_id: domain.id,
      our_offer: 2000,
      their_ask: 5000,
      status: "countered",
      notes: "Broker countered at 5k",
    });
    expect(offer.status).toBe("countered");
    expect(await listDomainOffers(domain.id)).toHaveLength(1);

    const email = await linkDomainEmail({
      domain_id: domain.id,
      email_id: "email_123",
      thread_id: "thread_123",
      type: "offer",
    });
    expect(email.type).toBe("offer");
    expect(await listDomainEmailLinks(domain.id)).toHaveLength(1);

    const purchased = await recordDomainPurchase(domain.id, {
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

    const active = await updateDomainLifecycleStatus(domain.id, "active");
    expect(active).not.toBeNull();
    expect(active!.status).toBe("active");

    const details = await getDomainDetails(domain.id);
    expect(details).not.toBeNull();
    expect(details!.offers).toHaveLength(1);
    expect(details!.emails).toHaveLength(1);
  });

  test("delete domain", async () => {
    const domain = await createDomain({ name: "deleteme.com" });
    expect(await deleteDomain(domain.id)).toBe(true);
    expect(await getDomain(domain.id)).toBeNull();
  });

  test("delete non-existent domain returns false", async () => {
    expect(await deleteDomain("nonexistent-id")).toBe(false);
  });

  test("cascade delete removes offer and email links", async () => {
    const domain = await createDomain({ name: "cascade-acquisition.com", status: "researching" });
    await createDomainOffer({ domain_id: domain.id, our_offer: 1500 });
    await linkDomainEmail({ domain_id: domain.id, email_id: "email_cascade", type: "inquiry" });

    await deleteDomain(domain.id);
    expect(await listDomainOffers(domain.id)).toHaveLength(0);
    expect(await listDomainEmailLinks(domain.id)).toHaveLength(0);
  });

  test("count domains", async () => {
    const count = await countDomains();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test("list expiring domains", async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    await createDomain({
      name: "expiring-soon.com",
      expires_at: futureDate.toISOString(),
    });

    const expiring = await listExpiring(30);
    expect(expiring.some((d) => d.name === "expiring-soon.com")).toBe(true);

    const expiringShort = await listExpiring(5);
    expect(expiringShort.some((d) => d.name === "expiring-soon.com")).toBe(false);
  });

  test("list SSL expiring domains", async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    await createDomain({
      name: "ssl-expiring.com",
      ssl_expires_at: futureDate.toISOString(),
      ssl_issuer: "Let's Encrypt",
    });

    const sslExpiring = await listSslExpiring(30);
    expect(sslExpiring.some((d) => d.name === "ssl-expiring.com")).toBe(true);
  });

  test("get domain stats", async () => {
    const stats = await getDomainStats();
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

  test("setup: create domain for DNS tests", async () => {
    const domain = await createDomain({ name: "dns-test.com" });
    domainId = domain.id;
    expect(domainId).toBeTruthy();
  });

  test("create and get DNS record", async () => {
    const record = await createDnsRecord({
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

    const fetched = await getDnsRecord(record.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(record.id);
  });

  test("create MX record with priority", async () => {
    const record = await createDnsRecord({
      domain_id: domainId,
      type: "MX",
      name: "@",
      value: "mail.dns-test.com",
      priority: 10,
    });

    expect(record.priority).toBe(10);
    expect(record.type).toBe("MX");
  });

  test("list DNS records for domain", async () => {
    const records = await listDnsRecords(domainId);
    expect(records.length).toBeGreaterThanOrEqual(2);
  });

  test("list DNS records filtered by type", async () => {
    const aRecords = await listDnsRecords(domainId, "A");
    expect(aRecords.length).toBe(1);
    expect(aRecords[0]!.type).toBe("A");
  });

  test("update DNS record", async () => {
    const record = await createDnsRecord({
      domain_id: domainId,
      type: "CNAME",
      name: "www",
      value: "dns-test.com",
    });

    const updated = await updateDnsRecord(record.id, {
      value: "cdn.dns-test.com",
      ttl: 600,
    });

    expect(updated).toBeDefined();
    expect(updated!.value).toBe("cdn.dns-test.com");
    expect(updated!.ttl).toBe(600);
  });

  test("update non-existent DNS record returns null", async () => {
    const result = await updateDnsRecord("nonexistent-id", { value: "test" });
    expect(result).toBeNull();
  });

  test("delete DNS record", async () => {
    const record = await createDnsRecord({
      domain_id: domainId,
      type: "TXT",
      name: "@",
      value: "v=spf1 include:_spf.google.com ~all",
    });

    expect(await deleteDnsRecord(record.id)).toBe(true);
    expect(await getDnsRecord(record.id)).toBeNull();
  });

  test("delete non-existent DNS record returns false", async () => {
    expect(await deleteDnsRecord("nonexistent-id")).toBe(false);
  });

  test("cascade delete: removing domain deletes DNS records", async () => {
    const domain = await createDomain({ name: "cascade-dns.com" });
    const record = await createDnsRecord({
      domain_id: domain.id,
      type: "A",
      name: "@",
      value: "10.0.0.1",
    });

    await deleteDomain(domain.id);
    expect(await getDnsRecord(record.id)).toBeNull();
  });
});

describe("Alerts", () => {
  let domainId: string;

  test("setup: create domain for alert tests", async () => {
    const domain = await createDomain({ name: "alert-test.com" });
    domainId = domain.id;
    expect(domainId).toBeTruthy();
  });

  test("create and get alert", async () => {
    const alert = await createAlert({
      domain_id: domainId,
      type: "expiry",
      trigger_days_before: 30,
    });

    expect(alert.id).toBeTruthy();
    expect(alert.type).toBe("expiry");
    expect(alert.trigger_days_before).toBe(30);
    expect(alert.sent_at).toBeNull();

    const fetched = await getAlert(alert.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(alert.id);
  });

  test("create SSL expiry alert", async () => {
    const alert = await createAlert({
      domain_id: domainId,
      type: "ssl_expiry",
      trigger_days_before: 14,
    });

    expect(alert.type).toBe("ssl_expiry");
    expect(alert.trigger_days_before).toBe(14);
  });

  test("list alerts for domain", async () => {
    const alerts = await listAlerts(domainId);
    expect(alerts.length).toBeGreaterThanOrEqual(2);
  });

  test("delete alert", async () => {
    const alert = await createAlert({
      domain_id: domainId,
      type: "dns_change",
    });

    expect(await deleteAlert(alert.id)).toBe(true);
    expect(await getAlert(alert.id)).toBeNull();
  });

  test("delete non-existent alert returns false", async () => {
    expect(await deleteAlert("nonexistent-id")).toBe(false);
  });

  test("cascade delete: removing domain deletes alerts", async () => {
    const domain = await createDomain({ name: "cascade-alert.com" });
    const alert = await createAlert({
      domain_id: domain.id,
      type: "expiry",
      trigger_days_before: 7,
    });

    await deleteDomain(domain.id);
    expect(await getAlert(alert.id)).toBeNull();
  });
});

// ============================================================
// Zone File Export / Import
// ============================================================

describe("Zone File Export/Import", () => {
  let domainId: string;

  test("setup: create domain with DNS records for zone tests", async () => {
    const domain = await createDomain({ name: "zone-test.com" });
    domainId = domain.id;

    await createDnsRecord({ domain_id: domainId, type: "A", name: "@", value: "93.184.216.34", ttl: 300 });
    await createDnsRecord({ domain_id: domainId, type: "AAAA", name: "@", value: "2606:2800:220:1:248:1893:25c8:1946" });
    await createDnsRecord({ domain_id: domainId, type: "CNAME", name: "www", value: "zone-test.com." });
    await createDnsRecord({ domain_id: domainId, type: "MX", name: "@", value: "mail.zone-test.com.", priority: 10 });
    await createDnsRecord({ domain_id: domainId, type: "TXT", name: "@", value: "v=spf1 include:_spf.google.com ~all" });
    await createDnsRecord({ domain_id: domainId, type: "NS", name: "@", value: "ns1.zone-test.com." });
  });

  test("export zone file produces valid BIND format", async () => {
    const zone = await exportZoneFile(domainId);
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

  test("export zone file returns null for missing domain", async () => {
    const result = await exportZoneFile("nonexistent-id");
    expect(result).toBeNull();
  });

  test("import zone file creates DNS records", async () => {
    const importDomain = await createDomain({ name: "import-zone.com" });
    const content = `
; Zone file for import-zone.com
$ORIGIN import-zone.com.
$TTL 3600

import-zone.com.  300  IN  A   10.0.0.1
www              3600  IN  CNAME  import-zone.com.
import-zone.com.  3600  IN  MX  10  mail.import-zone.com.
import-zone.com.  3600  IN  TXT  "v=spf1 -all"
`;

    const result = await importZoneFile(importDomain.id, content);
    expect(result).not.toBeNull();
    expect(result!.imported).toBe(4);
    expect(result!.skipped).toBe(0);
    expect(result!.errors.length).toBe(0);
    expect(result!.records.length).toBe(4);

    const records = await listDnsRecords(importDomain.id);
    expect(records.length).toBe(4);
    expect(records.some((r) => r.type === "A" && r.value === "10.0.0.1")).toBe(true);
    expect(records.some((r) => r.type === "CNAME" && r.name === "www")).toBe(true);
    expect(records.some((r) => r.type === "MX" && r.priority === 10)).toBe(true);
  });

  test("import zone file skips invalid lines", async () => {
    const importDomain = await createDomain({ name: "import-bad-zone.com" });
    const content = `
; Zone file
bad line
too  few
good.example.com.  3600  IN  A  1.2.3.4
bad.example.com.  3600  IN  INVALID  value
`;

    const result = await importZoneFile(importDomain.id, content);
    expect(result).not.toBeNull();
    expect(result!.imported).toBe(1);
    expect(result!.skipped).toBeGreaterThanOrEqual(2);
    expect(result!.errors.length).toBeGreaterThanOrEqual(2);
  });

  test("import zone file returns null for missing domain", async () => {
    const result = await importZoneFile("nonexistent-id", "some content");
    expect(result).toBeNull();
  });
});

// ============================================================
// DNS Validation
// ============================================================

describe("DNS Validation", () => {
  test("returns null for missing domain", async () => {
    const result = await validateDns("nonexistent-id");
    expect(result).toBeNull();
  });

  test("detects CNAME + A conflict", async () => {
    const domain = await createDomain({ name: "validate-cname-a.com" });
    await createDnsRecord({ domain_id: domain.id, type: "CNAME", name: "www", value: "example.com." });
    await createDnsRecord({ domain_id: domain.id, type: "A", name: "www", value: "1.2.3.4" });

    const result = await validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.issues.some((i) => i.type === "error" && i.message.includes("CNAME") && i.message.includes("A/AAAA"))).toBe(true);
  });

  test("detects CNAME + MX conflict", async () => {
    const domain = await createDomain({ name: "validate-cname-mx.com" });
    await createDnsRecord({ domain_id: domain.id, type: "CNAME", name: "@", value: "example.com." });
    await createDnsRecord({ domain_id: domain.id, type: "MX", name: "@", value: "mail.example.com.", priority: 10 });

    const result = await validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    expect(result!.issues.some((i) => i.type === "error" && i.message.includes("CNAME") && i.message.includes("MX"))).toBe(true);
  });

  test("warns about missing MX at root", async () => {
    const domain = await createDomain({ name: "validate-no-mx.com" });
    await createDnsRecord({ domain_id: domain.id, type: "A", name: "@", value: "1.2.3.4" });

    const result = await validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.issues.some((i) => i.type === "warning" && i.message.includes("No MX record"))).toBe(true);
  });

  test("warns about MX without priority", async () => {
    const domain = await createDomain({ name: "validate-mx-nopri.com" });
    await createDnsRecord({ domain_id: domain.id, type: "MX", name: "@", value: "mail.example.com." });

    const result = await validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.issues.some((i) => i.type === "warning" && i.message.includes("no priority"))).toBe(true);
  });

  test("valid configuration has no errors", async () => {
    const domain = await createDomain({ name: "validate-good.com" });
    await createDnsRecord({ domain_id: domain.id, type: "A", name: "@", value: "1.2.3.4" });
    await createDnsRecord({ domain_id: domain.id, type: "MX", name: "@", value: "mail.validate-good.com.", priority: 10 });
    await createDnsRecord({ domain_id: domain.id, type: "TXT", name: "@", value: "v=spf1 -all" });

    const result = await validateDns(domain.id);
    expect(result).not.toBeNull();
    expect(result!.valid).toBe(true);
    expect(result!.issues.filter((i) => i.type === "error").length).toBe(0);
  });
});

// ============================================================
// Portfolio Export
// ============================================================

describe("Portfolio Export", () => {
  test("export as JSON", async () => {
    const output = await exportPortfolio("json");
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

  test("export as CSV", async () => {
    const output = await exportPortfolio("csv");
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

  test("CSV escapes values with commas", async () => {
    await createDomain({ name: "csv-escape-test.com", notes: "has, comma" });
    const output = await exportPortfolio("csv");
    expect(output).toContain('"has, comma"');
  });
});

// ============================================================
// getDomainByName
// ============================================================

describe("getDomainByName", () => {
  test("finds domain by name", async () => {
    const domain = await getDomainByName("example.com");
    expect(domain).not.toBeNull();
    expect(domain!.name).toBe("example.com");
  });

  test("returns null for unknown name", async () => {
    const domain = await getDomainByName("nonexistent-domain.xyz");
    expect(domain).toBeNull();
  });

  test("finds domain by id or name identifier", async () => {
    const byName = await getDomainByIdentifier("example.com");
    expect(byName).not.toBeNull();
    const byId = await getDomainByIdentifier(byName!.id);
    expect(byId).not.toBeNull();
    expect(byId!.name).toBe("example.com");
  });
});

// ============================================================
// Subdomain Discovery (mocked)
// ============================================================

describe("Subdomain Discovery", () => {
  test("discoverSubdomains returns structured result", async () => {
    // Network call to crt.sh — allow extra time in CI/slow networks
    const result = await discoverSubdomains("example.com");
    expect(result).toHaveProperty("domain", "example.com");
    expect(result).toHaveProperty("subdomains");
    expect(result).toHaveProperty("source", "crt.sh");
    expect(Array.isArray(result.subdomains)).toBe(true);
  }, 30_000);
});
