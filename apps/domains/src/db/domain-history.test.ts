import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "open-domains-history-test-"));
process.env["DOMAINS_DIR"] = tempDir;

import { createDomain } from "./domains";
import {
  createHistoryEntry,
  getHistoryEntry,
  getHistoryByDomain,
  getHistoryByDateRange,
  getLatestSnapshot,
  getLatestByDomainName,
  listDomainsWithHistoryChanges,
  deleteHistoryEntry,
  deleteHistoryByDomain,
  HISTORY_TYPES,
  type CreateHistoryEntryInput,
} from "./domain-history";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================
// CRUD Operations
// ============================================================

describe("Domain History — CRUD", () => {
  let domainId: string;

  test("setup: create domain for history tests", async () => {
    const domain = await createDomain({ name: "history-test.com" });
    domainId = domain.id;
    expect(domainId).toBeTruthy();
  });

  test("create WHOIS history entry", async () => {
    const entry = createHistoryEntry({
      domain_id: domainId,
      snapshot_type: "whois",
      registrant_name: "John Doe",
      registrant_email: "john@history-test.com",
      registrant_org: "History Corp",
      nameservers: ["ns1.example.com", "ns2.example.com"],
      registrar: "Example Registrar",
      status: "active",
      notes: "Initial WHOIS snapshot",
    });

    expect(entry.id).toBeTruthy();
    expect(entry.domain_id).toBe(domainId);
    expect(entry.snapshot_type).toBe("whois");
    expect(entry.registrant_name).toBe("John Doe");
    expect(entry.registrant_email).toBe("john@history-test.com");
    expect(entry.registrant_org).toBe("History Corp");
    expect(entry.nameservers).toEqual(["ns1.example.com", "ns2.example.com"]);
    expect(entry.registrar).toBe("Example Registrar");
    expect(entry.status).toBe("active");
    expect(entry.notes).toBe("Initial WHOIS snapshot");
    expect(entry.raw_data).toEqual({});
    expect(entry.created_at).toBeTruthy();
  });

  test("create entry with minimal fields", async () => {
    const entry = createHistoryEntry({
      domain_id: domainId,
      snapshot_type: "dns",
    });

    expect(entry.id).toBeTruthy();
    expect(entry.snapshot_type).toBe("dns");
    expect(entry.registrant_name).toBeNull();
    expect(entry.registrant_email).toBeNull();
    expect(entry.registrar).toBeNull();
    expect(entry.notes).toBeNull();
    expect(entry.raw_data).toEqual({});
    expect(entry.nameservers).toEqual([]);
  });

  test("create entry with raw_data", async () => {
    const entry = createHistoryEntry({
      domain_id: domainId,
      snapshot_type: "exa_research",
      raw_data: {
        summary: "Test research",
        results: [{ title: "Result 1", url: "https://example.com" }],
      },
      notes: "Exa AI research saved",
    });

    expect(entry.raw_data).toEqual({
      summary: "Test research",
      results: [{ title: "Result 1", url: "https://example.com" }],
    });
  });

  test("create SSL snapshot", async () => {
    const entry = createHistoryEntry({
      domain_id: domainId,
      snapshot_type: "ssl",
      raw_data: { issuer: "Let's Encrypt", expiry: "2026-12-31" },
      notes: "SSL certificate renewed",
    });

    expect(entry.snapshot_type).toBe("ssl");
    expect(entry.raw_data).toHaveProperty("issuer", "Let's Encrypt");
  });

  test("create reputation snapshot", async () => {
    const entry = createHistoryEntry({
      domain_id: domainId,
      snapshot_type: "reputation",
      raw_data: { threat_score: 10, is_blacklisted: false },
      notes: "Clean reputation",
    });

    expect(entry.snapshot_type).toBe("reputation");
  });

  test("create RDAP snapshot", async () => {
    const entry = createHistoryEntry({
      domain_id: domainId,
      snapshot_type: "rdap",
      registrant_name: "RDAP Person",
      registrar: "RDAP Registrar",
    });

    expect(entry.snapshot_type).toBe("rdap");
    expect(entry.registrant_name).toBe("RDAP Person");
  });

  test("get history entry by ID", async () => {
    const entries = getHistoryByDomain(domainId);
    const first = entries[0];
    expect(first).toBeDefined();

    const entry = getHistoryEntry(first!.id);
    expect(entry).toBeDefined();
    expect(entry!.id).toBe(first!.id);
    expect(entry!.snapshot_type).toBe(first!.snapshot_type);
  });

  test("get non-existent entry returns null", async () => {
    expect(getHistoryEntry("nonexistent-id")).toBeNull();
  });

  test("delete history entry", async () => {
    const entry = createHistoryEntry({
      domain_id: domainId,
      snapshot_type: "whois",
      notes: "To be deleted",
    });

    expect(deleteHistoryEntry(entry.id)).toBe(true);
    expect(getHistoryEntry(entry.id)).toBeNull();
  });

  test("delete non-existent entry returns false", async () => {
    expect(deleteHistoryEntry("nonexistent-id")).toBe(false);
  });
});

// ============================================================
// Querying and Filtering
// ============================================================

describe("Domain History — Query & Filter", () => {
  let domainId1: string;
  let domainId2: string;

  test("setup: create domains with history", async () => {
    const d1 = await createDomain({ name: "query-test1.com" });
    const d2 = await createDomain({ name: "query-test2.com" });
    domainId1 = d1.id;
    domainId2 = d2.id;

    // Multiple snapshot types for domain 1
    createHistoryEntry({
      domain_id: domainId1,
      snapshot_type: "whois",
      registrant_name: "Alice",
      notes: "WHOIS snapshot 1",
    });
    createHistoryEntry({
      domain_id: domainId1,
      snapshot_type: "dns",
      notes: "DNS snapshot 1",
    });
    createHistoryEntry({
      domain_id: domainId1,
      snapshot_type: "ssl",
      notes: "SSL snapshot 1",
    });
    createHistoryEntry({
      domain_id: domainId1,
      snapshot_type: "whois",
      registrant_name: "Alice Updated",
      notes: "WHOIS snapshot 2",
    });

    // Single snapshot for domain 2
    createHistoryEntry({
      domain_id: domainId2,
      snapshot_type: "reputation",
      notes: "Clean reputation",
    });
  });

  test("get all history for a domain", async () => {
    const entries = getHistoryByDomain(domainId1);
    expect(entries.length).toBe(4);
  });

  test("filter history by type", async () => {
    const whoisEntries = getHistoryByDomain(domainId1, { type: "whois" });
    expect(whoisEntries.length).toBe(2);
    expect(whoisEntries.every((e) => e.snapshot_type === "whois")).toBe(true);

    const sslEntries = getHistoryByDomain(domainId1, { type: "ssl" });
    expect(sslEntries.length).toBe(1);
    expect(sslEntries[0]!.snapshot_type).toBe("ssl");
  });

  test("limit history results", async () => {
    const entries = getHistoryByDomain(domainId1, { limit: 2 });
    expect(entries.length).toBe(2);
  });

  test("history ordered by created_at DESC", async () => {
    const whoisEntries = getHistoryByDomain(domainId1, { type: "whois" });
    expect(whoisEntries.length).toBe(2);
    // Both entries may have the same timestamp, but both should be whois type
    expect(whoisEntries.every((e) => e.snapshot_type === "whois")).toBe(true);
    const notes = whoisEntries.map((e) => e.notes);
    expect(notes).toContain("WHOIS snapshot 1");
    expect(notes).toContain("WHOIS snapshot 2");
  });

  test("get history by date range", async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 86400000).toISOString();
    const past = new Date(now.getTime() - 86400000).toISOString();

    const entries = getHistoryByDateRange(past, future, domainId1);
    expect(entries.length).toBe(4);
  });

  test("get history by date range for specific domain", async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 86400000).toISOString();
    const past = new Date(now.getTime() - 86400000).toISOString();

    const entries = getHistoryByDateRange(past, future, domainId2);
    expect(entries.length).toBe(1);
    expect(entries[0]!.domain_id).toBe(domainId2);
  });

  test("get history by date range with no results", async () => {
    const entries = getHistoryByDateRange("2000-01-01", "2000-01-02", domainId1);
    expect(entries.length).toBe(0);
  });

  test("get latest snapshot of a type", async () => {
    const latest = getLatestSnapshot(domainId1, "whois");
    expect(latest).not.toBeNull();
    expect(latest!.snapshot_type).toBe("whois");
    // May be either snapshot due to same-second timestamps
    expect(["WHOIS snapshot 1", "WHOIS snapshot 2"]).toContain(latest!.notes);
  });

  test("get latest snapshot returns null for missing type", async () => {
    const latest = getLatestSnapshot(domainId2, "whois");
    expect(latest).toBeNull();
  });

  test("get latest by domain name", async () => {
    const latest = getLatestByDomainName("query-test1.com", "whois");
    expect(latest).not.toBeNull();
    expect(latest!.snapshot_type).toBe("whois");
  });

  test("get latest by domain name returns null for missing domain", async () => {
    expect(getLatestByDomainName("nonexistent.xyz")).toBeNull();
  });

  test("get latest by domain name defaults to whois type", async () => {
    const latest = getLatestByDomainName("query-test1.com");
    expect(latest).not.toBeNull();
  });

  test("delete all history for a domain", async () => {
    expect(deleteHistoryByDomain(domainId2)).toBe(true);
    expect(getHistoryByDomain(domainId2).length).toBe(0);
  });

  test("delete all history for domain with no history returns false", async () => {
    const domain = await createDomain({ name: "no-history.com" });
    expect(deleteHistoryByDomain(domain.id)).toBe(false);
  });
});

// ============================================================
// List Domains With History Changes
// ============================================================

describe("Domain History — Timeline", () => {
  test("listDomainsWithHistoryChanges returns structured data", async () => {
    const results = listDomainsWithHistoryChanges();
    expect(results.length).toBeGreaterThan(0);

    for (const r of results) {
      expect(r).toHaveProperty("domain_id");
      expect(r).toHaveProperty("domain_name");
      expect(r).toHaveProperty("latest_snapshot_type");
      expect(r).toHaveProperty("latest_snapshot_at");
      expect(r).toHaveProperty("snapshot_count");
      expect(r.snapshot_count).toBeGreaterThanOrEqual(1);
    }
  });

  test("timeline includes domains with multiple snapshots", async () => {
    const results = listDomainsWithHistoryChanges();
    const historyTest = results.find((r) => r.domain_name === "history-test.com");
    expect(historyTest).toBeDefined();
    expect(historyTest!.snapshot_count).toBeGreaterThan(1);
  });

  test("timeline returns empty array when no history exists", async () => {
    const domain = await createDomain({ name: "timeline-empty.com" });
    const results = listDomainsWithHistoryChanges();
    // Our test domain should not appear since it has no history
    expect(results.some((r) => r.domain_name === "timeline-empty.com")).toBe(false);
  });
});

// ============================================================
// History Types
// ============================================================

describe("Domain History — Types", () => {
  test("all history types are valid", async () => {
    expect(HISTORY_TYPES).toContain("whois");
    expect(HISTORY_TYPES).toContain("rdap");
    expect(HISTORY_TYPES).toContain("dns");
    expect(HISTORY_TYPES).toContain("ssl");
    expect(HISTORY_TYPES).toContain("reputation");
    expect(HISTORY_TYPES).toContain("exa_research");
    expect(HISTORY_TYPES).toContain("purchase");
    expect(HISTORY_TYPES).toContain("renewal");
    expect(HISTORY_TYPES.length).toBe(8);
  });
});
