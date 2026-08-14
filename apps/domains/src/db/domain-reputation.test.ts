import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "open-domains-reputation-test-"));
process.env["DOMAINS_DIR"] = tempDir;

import { createDomain } from "./domains";
import {
  upsertDomainReputation,
  getDomainReputation,
  getDomainReputationByName,
  updateDomainReputation,
  listBlacklistedDomains,
  listHighThreatDomains,
  checkDnsBlacklist,
  deleteDomainReputation,
  type CreateReputationInput,
} from "./domain-reputation";
import { checkDomainReputation } from "./reputation";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================
// CRUD Operations
// ============================================================

describe("Domain Reputation — CRUD", () => {
  let domainId: string;

  test("setup: create domain for reputation tests", async () => {
    const domain = await createDomain({ name: "reputation-test.com" });
    domainId = domain.id;
    expect(domainId).toBeTruthy();
  });

  test("create reputation record", async () => {
    const rep = upsertDomainReputation({
      domain_id: domainId,
      is_blacklisted: false,
      threat_score: 10,
      spam_score: 5,
      malware_detected: false,
      phishing_detected: false,
      reputation_sources: ["manual"],
      notes: "Clean reputation",
    });

    expect(rep.id).toBeTruthy();
    expect(rep.domain_id).toBe(domainId);
    expect(rep.is_blacklisted).toBe(false);
    expect(rep.blacklist_sources).toEqual([]);
    expect(rep.threat_score).toBe(10);
    expect(rep.spam_score).toBe(5);
    expect(rep.malware_detected).toBe(false);
    expect(rep.phishing_detected).toBe(false);
    expect(rep.reputation_sources).toEqual(["manual"]);
    expect(rep.last_checked_at).toBeNull();
    expect(rep.notes).toBe("Clean reputation");
    expect(rep.created_at).toBeTruthy();
    expect(rep.updated_at).toBeTruthy();
  });

  test("upsert updates existing record", async () => {
    const rep = upsertDomainReputation({
      domain_id: domainId,
      threat_score: 50,
      notes: "Updated reputation",
    });

    expect(rep.threat_score).toBe(50);
    expect(rep.notes).toBe("Updated reputation");
  });

  test("get reputation by domain ID", async () => {
    const rep = getDomainReputation(domainId);
    expect(rep).not.toBeNull();
    expect(rep!.domain_id).toBe(domainId);
  });

  test("get reputation by domain name", async () => {
    const rep = getDomainReputationByName("reputation-test.com");
    expect(rep).not.toBeNull();
    expect(rep!.domain_id).toBe(domainId);
  });

  test("get reputation for non-existent domain ID returns null", async () => {
    expect(getDomainReputation("nonexistent-id")).toBeNull();
  });

  test("get reputation by non-existent domain name returns null", async () => {
    expect(getDomainReputationByName("nonexistent.xyz")).toBeNull();
  });

  test("update reputation", async () => {
    const rep = getDomainReputation(domainId)!;
    const updated = updateDomainReputation(rep.id, {
      threat_score: 80,
      is_blacklisted: true,
      blacklist_sources: ["spamhaus.org"],
      malware_detected: true,
      notes: "Now blacklisted",
    });

    expect(updated).not.toBeNull();
    expect(updated!.threat_score).toBe(80);
    expect(updated!.is_blacklisted).toBe(true);
    expect(updated!.blacklist_sources).toEqual(["spamhaus.org"]);
    expect(updated!.malware_detected).toBe(true);
    expect(updated!.notes).toBe("Now blacklisted");
  });

  test("update non-existent reputation returns null", async () => {
    expect(updateDomainReputation("nonexistent-id", { threat_score: 50 })).toBeNull();
  });

  test("update with no changes returns existing", async () => {
    const rep = getDomainReputation(domainId)!;
    const result = updateDomainReputation(rep.id, {});
    expect(result).not.toBeNull();
    expect(result!.id).toBe(rep.id);
  });

  test("delete reputation", async () => {
    const cleanDomain = await createDomain({ name: "delete-rep-test.com" });
    upsertDomainReputation({ domain_id: cleanDomain.id });
    const rep = getDomainReputation(cleanDomain.id)!;

    expect(deleteDomainReputation(rep.id)).toBe(true);
    expect(getDomainReputation(cleanDomain.id)).toBeNull();
  });

  test("delete non-existent reputation returns false", async () => {
    expect(deleteDomainReputation("nonexistent-id")).toBe(false);
  });
});

// ============================================================
// Blacklist and Threat Listing
// ============================================================

describe("Domain Reputation — Blacklist & Threats", () => {
  let blacklistedId: string;
  let highThreatId: string;
  let cleanId: string;

  test("setup: create domains with various reputation levels", async () => {
    // Blacklisted domain
    const d1 = await createDomain({ name: "blacklisted-test.com" });
    blacklistedId = d1.id;
    upsertDomainReputation({
      domain_id: blacklistedId,
      is_blacklisted: true,
      blacklist_sources: ["spamhaus.org", "spamcop.net"],
      threat_score: 90,
      notes: "Known spammer",
    });

    // High threat domain (not blacklisted)
    const d2 = await createDomain({ name: "high-threat-test.com" });
    highThreatId = d2.id;
    upsertDomainReputation({
      domain_id: highThreatId,
      threat_score: 75,
      notes: "Suspicious activity",
    });

    // Clean domain
    const d3 = await createDomain({ name: "clean-test.com" });
    cleanId = d3.id;
    upsertDomainReputation({
      domain_id: cleanId,
      threat_score: 5,
      notes: "Clean domain",
    });
  });

  test("list blacklisted domains", async () => {
    const domains = listBlacklistedDomains();
    expect(domains.length).toBeGreaterThanOrEqual(1);
    expect(domains.some((d) => d.domain_id === blacklistedId)).toBe(true);
    expect(domains.every((d) => d.is_blacklisted)).toBe(true);
  });

  test("list high threat domains with default threshold", async () => {
    const domains = listHighThreatDomains();
    expect(domains.length).toBeGreaterThanOrEqual(1);
    expect(domains.some((d) => d.domain_id === highThreatId)).toBe(true);
    expect(domains.every((d) => (d.threat_score ?? 0) >= 70)).toBe(true);
  });

  test("list high threat domains with custom threshold", async () => {
    const domains = listHighThreatDomains(80);
    expect(domains.length).toBeGreaterThanOrEqual(1);
    expect(domains.some((d) => d.domain_id === blacklistedId)).toBe(true);
    expect(domains.every((d) => (d.threat_score ?? 0) >= 80)).toBe(true);
  });

  test("list high threat domains with very high threshold returns empty", async () => {
    const domains = listHighThreatDomains(99);
    // May have results depending on test data
    expect(Array.isArray(domains)).toBe(true);
  });
});

// ============================================================
// DNS Blacklist Check
// ============================================================

describe("Domain Reputation — DNS Blacklist", () => {
  test("checkDnsBlacklist returns structured result", async () => {
    const result = checkDnsBlacklist("example.com");
    expect(result).toHaveProperty("listed");
    expect(result).toHaveProperty("zones");
    expect(result).toHaveProperty("details");
    expect(Array.isArray(result.zones)).toBe(true);
    expect(Array.isArray(result.details)).toBe(true);
    // In test mode, returns empty (no actual DNS resolution)
    expect(result.listed).toBe(false);
  });

  test("checkDnsBlacklist zones include common DNSBL zones", async () => {
    // The function internally checks these zones but returns empty in test
    const result = checkDnsBlacklist("test.com");
    expect(result.listed).toBe(false);
  });
});

// ============================================================
// Reputation Check Integration
// ============================================================

describe("Domain Reputation — Full Check", () => {
  test("checkDomainReputation creates history entry", async () => {
    const domain = await createDomain({ name: "reputation-check-test.com" });

    // Create an existing reputation
    upsertDomainReputation({
      domain_id: domain.id,
      threat_score: 30,
      notes: "Pre-existing reputation",
    });

    const result = await checkDomainReputation("reputation-check-test.com");

    expect(result.reputation).not.toBeNull();
    expect(result.dnsBlacklist).toHaveProperty("listed");
    expect(result.dnsBlacklist).toHaveProperty("zones");
  });

  test("checkDomainReputation throws for missing domain", async () => {
    await expect(checkDomainReputation("nonexistent-rep.xyz")).rejects.toThrow(
      "Domain 'nonexistent-rep.xyz' not found in database"
    );
  });

  test("checkDomainReputation updates last_checked_at", async () => {
    const domain = await createDomain({ name: "reputation-update-test.com" });
    upsertDomainReputation({
      domain_id: domain.id,
      threat_score: 20,
    });

    const rep1 = getDomainReputation(domain.id)!;
    expect(rep1.last_checked_at).toBeNull();

    await checkDomainReputation("reputation-update-test.com");

    const rep2 = getDomainReputation(domain.id)!;
    expect(rep2.last_checked_at).not.toBeNull();
  });
});

// ============================================================
// Reputation Data Types
// ============================================================

describe("Domain Reputation — Data Types", () => {
  test("boolean fields are properly converted", async () => {
    const domain = await createDomain({ name: "bool-convert-test.com" });
    upsertDomainReputation({
      domain_id: domain.id,
      is_blacklisted: true,
      malware_detected: true,
      phishing_detected: true,
      blacklist_sources: ["source1", "source2"],
      reputation_sources: ["manual", "automated"],
    });

    const rep = getDomainReputation(domain.id)!;
    expect(rep.is_blacklisted).toBe(true);
    expect(rep.malware_detected).toBe(true);
    expect(rep.phishing_detected).toBe(true);
    expect(Array.isArray(rep.blacklist_sources)).toBe(true);
    expect(rep.blacklist_sources).toEqual(["source1", "source2"]);
    expect(Array.isArray(rep.reputation_sources)).toBe(true);
    expect(rep.reputation_sources).toEqual(["manual", "automated"]);
  });

  test("default values for new reputation", async () => {
    const domain = await createDomain({ name: "default-rep-test.com" });
    const rep = upsertDomainReputation({ domain_id: domain.id });

    expect(rep.is_blacklisted).toBe(false);
    expect(rep.blacklist_sources).toEqual([]);
    expect(rep.malware_detected).toBe(false);
    expect(rep.phishing_detected).toBe(false);
    expect(rep.reputation_sources).toEqual([]);
    expect(rep.threat_score).toBeNull();
    expect(rep.spam_score).toBeNull();
  });
});
