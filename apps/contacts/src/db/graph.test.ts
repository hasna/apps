import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase, getDatabase } from "./database.js";
import {
  computeRelationshipStrength,
  findWarmPath,
  findConnectionsAtCompany,
  detectCoolingRelationships,
} from "./graph.js";
import { createContact } from "./contacts.js";
import { createCompany } from "./companies.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("computeRelationshipStrength", () => {
  it("returns 0 for non-existent contact", () => {
    const strength = computeRelationshipStrength("nonexistent");
    expect(strength).toBe(0);
  });

  it("returns a base score for a contact with no interactions", () => {
    const c = createContact({ display_name: "Fresh" });
    const strength = computeRelationshipStrength(c.id);
    // Base 50 - 20 (no last_contacted_at) = 30
    expect(strength).toBe(30);
  });

  it("returns higher score for recently contacted", () => {
    const c = createContact({ display_name: "Recent" });
    const db = getDatabase();
    const recentDate = new Date(Date.now() - 2 * 86400000).toISOString(); // 2 days ago
    db.query(`UPDATE contacts SET last_contacted_at = ? WHERE id = ?`).run(recentDate, c.id);
    const strength = computeRelationshipStrength(c.id);
    // Base 50 + 30 (< 7 days) = 80
    expect(strength).toBe(80);
  });

  it("gives moderate boost for contact within 30 days", () => {
    const c = createContact({ display_name: "Moderate" });
    const db = getDatabase();
    const date = new Date(Date.now() - 15 * 86400000).toISOString(); // 15 days ago
    db.query(`UPDATE contacts SET last_contacted_at = ? WHERE id = ?`).run(date, c.id);
    const strength = computeRelationshipStrength(c.id);
    // Base 50 + 20 = 70
    expect(strength).toBe(70);
  });

  it("gives small boost for contact within 90 days", () => {
    const c = createContact({ display_name: "Older" });
    const db = getDatabase();
    const date = new Date(Date.now() - 60 * 86400000).toISOString(); // 60 days ago
    db.query(`UPDATE contacts SET last_contacted_at = ? WHERE id = ?`).run(date, c.id);
    const strength = computeRelationshipStrength(c.id);
    // Base 50 + 5 = 55
    expect(strength).toBe(55);
  });

  it("penalizes very old contacts", () => {
    const c = createContact({ display_name: "Old" });
    const db = getDatabase();
    const date = new Date(Date.now() - 120 * 86400000).toISOString(); // 120 days ago
    db.query(`UPDATE contacts SET last_contacted_at = ? WHERE id = ?`).run(date, c.id);
    const strength = computeRelationshipStrength(c.id);
    // Base 50 - 20 = 30
    expect(strength).toBe(30);
  });

  it("adds interaction count bonus (capped at 20)", () => {
    const c = createContact({ display_name: "Active" });
    const db = getDatabase();
    db.query(`UPDATE contacts SET interaction_count_30d = ? WHERE id = ?`).run(10, c.id);
    const strength = computeRelationshipStrength(c.id);
    // Base 50 - 20 (no last_contacted_at) + min(20, 10*4=40) = 50
    expect(strength).toBe(50);
  });

  it("clamps score between 0 and 100", () => {
    const c = createContact({ display_name: "Clamped" });
    const db = getDatabase();
    const recentDate = new Date(Date.now() - 1 * 86400000).toISOString();
    db.query(`UPDATE contacts SET last_contacted_at = ?, interaction_count_30d = ? WHERE id = ?`).run(recentDate, 20, c.id);
    const strength = computeRelationshipStrength(c.id);
    // 50 + 30 + 20 = 100 (capped)
    expect(strength).toBeLessThanOrEqual(100);
    expect(strength).toBeGreaterThanOrEqual(0);
  });
});

describe("findWarmPath", () => {
  it("returns empty array when contacts are the same", () => {
    const c = createContact({ display_name: "Self" });
    const path = findWarmPath(c.id, c.id);
    expect(path).toEqual([]);
  });

  it("returns empty array when no path exists", () => {
    const a = createContact({ display_name: "A" });
    const b = createContact({ display_name: "B" });
    const path = findWarmPath(a.id, b.id);
    expect(path).toEqual([]);
  });

  it("finds a direct path via relationship", () => {
    const a = createContact({ display_name: "Alice" });
    const b = createContact({ display_name: "Bob" });
    const db = getDatabase();
    db.query(
      `INSERT INTO contact_relationships (id, contact_a_id, contact_b_id, relationship_type, strength_score) VALUES (?, ?, ?, ?, ?)`,
    ).run(crypto.randomUUID(), a.id, b.id, "colleague", 80);
    const path = findWarmPath(a.id, b.id);
    expect(path).toHaveLength(1);
    expect(path[0]!.contact_id).toBe(b.id);
    expect(path[0]!.display_name).toBe("Bob");
    expect(path[0]!.strength).toBe(80);
  });

  it("finds a multi-hop path", () => {
    const a = createContact({ display_name: "A" });
    const b = createContact({ display_name: "B" });
    const c = createContact({ display_name: "C" });
    const db = getDatabase();
    db.query(
      `INSERT INTO contact_relationships (id, contact_a_id, contact_b_id, relationship_type, strength_score) VALUES (?, ?, ?, ?, ?)`,
    ).run(crypto.randomUUID(), a.id, b.id, "colleague", 60);
    db.query(
      `INSERT INTO contact_relationships (id, contact_a_id, contact_b_id, relationship_type, strength_score) VALUES (?, ?, ?, ?, ?)`,
    ).run(crypto.randomUUID(), b.id, c.id, "friend", 70);
    const path = findWarmPath(a.id, c.id);
    expect(path).toHaveLength(2);
    expect(path[0]!.contact_id).toBe(b.id);
    expect(path[1]!.contact_id).toBe(c.id);
  });

  it("respects max 4 hops limit", () => {
    // Create a chain of 6 contacts: a -> b -> c -> d -> e -> f
    const contacts = Array.from({ length: 6 }, (_, i) =>
      createContact({ display_name: `Node${i}` }),
    );
    const db = getDatabase();
    for (let i = 0; i < 5; i++) {
      db.query(
        `INSERT INTO contact_relationships (id, contact_a_id, contact_b_id, relationship_type) VALUES (?, ?, ?, ?)`,
      ).run(crypto.randomUUID(), contacts[i]!.id, contacts[i + 1]!.id, "colleague");
    }
    // Path from first to last is 5 hops — should return empty (max 4)
    const path = findWarmPath(contacts[0]!.id, contacts[5]!.id);
    expect(path).toEqual([]);
    // But 4 hops should work
    const path4 = findWarmPath(contacts[0]!.id, contacts[4]!.id);
    expect(path4).toHaveLength(4);
  });
});

describe("findConnectionsAtCompany", () => {
  it("returns contacts at a given company", () => {
    const company = createCompany({ name: "TestCo" });
    createContact({ display_name: "Employee1", company_id: company.id, job_title: "Dev" });
    createContact({ display_name: "Employee2", company_id: company.id, job_title: "PM" });
    const connections = findConnectionsAtCompany(company.id);
    expect(connections).toHaveLength(2);
    expect(connections[0]!.display_name).toBeTruthy();
    expect(typeof connections[0]!.strength).toBe("number");
  });

  it("returns empty array for company with no contacts", () => {
    const company = createCompany({ name: "EmptyCo" });
    const connections = findConnectionsAtCompany(company.id);
    expect(connections).toEqual([]);
  });

  it("excludes archived contacts", () => {
    const company = createCompany({ name: "MixedCo" });
    const active = createContact({ display_name: "Active", company_id: company.id });
    const archived = createContact({ display_name: "Gone", company_id: company.id });
    const db = getDatabase();
    db.query(`UPDATE contacts SET archived = 1 WHERE id = ?`).run(archived.id);
    const connections = findConnectionsAtCompany(company.id);
    expect(connections).toHaveLength(1);
    expect(connections[0]!.display_name).toBe("Active");
  });

  it("orders by relationship_health descending", () => {
    const company = createCompany({ name: "SortCo" });
    const low = createContact({ display_name: "Low" , company_id: company.id });
    const high = createContact({ display_name: "High", company_id: company.id });
    const db = getDatabase();
    db.query(`UPDATE contacts SET relationship_health = ? WHERE id = ?`).run(20, low.id);
    db.query(`UPDATE contacts SET relationship_health = ? WHERE id = ?`).run(90, high.id);
    const connections = findConnectionsAtCompany(company.id);
    expect(connections[0]!.display_name).toBe("High");
    expect(connections[1]!.display_name).toBe("Low");
  });
});

describe("detectCoolingRelationships", () => {
  it("returns empty array when no contacts have old last_contacted_at", () => {
    createContact({ display_name: "Recent" });
    const cooling = detectCoolingRelationships();
    expect(cooling).toEqual([]);
  });

  it("detects contacts not contacted in over 45 days", () => {
    const c = createContact({ display_name: "Cooling" });
    const db = getDatabase();
    const oldDate = new Date(Date.now() - 60 * 86400000).toISOString();
    db.query(`UPDATE contacts SET last_contacted_at = ?, engagement_status = 'stable' WHERE id = ?`).run(oldDate, c.id);
    const cooling = detectCoolingRelationships();
    expect(cooling.length).toBeGreaterThanOrEqual(1);
    const found = cooling.find(r => r.contact_id === c.id);
    expect(found).toBeTruthy();
    expect(found!.days_since).toBeGreaterThanOrEqual(45);
  });

  it("excludes ghost contacts", () => {
    const c = createContact({ display_name: "Ghost" });
    const db = getDatabase();
    const oldDate = new Date(Date.now() - 90 * 86400000).toISOString();
    db.query(`UPDATE contacts SET last_contacted_at = ?, engagement_status = 'ghost' WHERE id = ?`).run(oldDate, c.id);
    const cooling = detectCoolingRelationships();
    const found = cooling.find(r => r.contact_id === c.id);
    expect(found).toBeUndefined();
  });

  it("excludes archived contacts", () => {
    const c = createContact({ display_name: "ArchivedCool" });
    const db = getDatabase();
    const oldDate = new Date(Date.now() - 90 * 86400000).toISOString();
    db.query(`UPDATE contacts SET last_contacted_at = ?, archived = 1 WHERE id = ?`).run(oldDate, c.id);
    const cooling = detectCoolingRelationships();
    const found = cooling.find(r => r.contact_id === c.id);
    expect(found).toBeUndefined();
  });

  it("excludes contacts with null last_contacted_at", () => {
    createContact({ display_name: "NeverContacted" });
    const cooling = detectCoolingRelationships();
    const found = cooling.find(r => r.display_name === "NeverContacted");
    expect(found).toBeUndefined();
  });
});
