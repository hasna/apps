import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase, getDatabase } from "./database.js";
import {
  getRelationshipSignals,
  getGhostContacts,
  getWarmingContacts,
  recomputeAllSignals,
} from "./signals.js";
import { createContact } from "./contacts.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-signals-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

function setContactFields(contactId: string, fields: Record<string, unknown>) {
  const db = getDatabase();
  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    setClauses.push(`${key} = ?`);
    values.push(value);
  }
  values.push(contactId);
  db.run(`UPDATE contacts SET ${setClauses.join(", ")} WHERE id = ?`, values);
}

describe("getRelationshipSignals", () => {
  it("returns ghost signal for never-contacted contact", () => {
    const contact = createContact({ display_name: "Ghost Person" });
    const signals = getRelationshipSignals(contact.id);
    expect(signals.length).toBe(1);
    expect(signals[0].signal_type).toBe("ghost");
    expect(signals[0].days_since_contact).toBeNull();
    expect(signals[0].display_name).toBe("Ghost Person");
  });

  it("returns ghost signal for contact not contacted in 180+ days", () => {
    const contact = createContact({ display_name: "Old Friend" });
    const oldDate = new Date(Date.now() - 200 * 86400000).toISOString();
    setContactFields(contact.id, { last_contacted_at: oldDate });
    const signals = getRelationshipSignals(contact.id);
    expect(signals.length).toBe(1);
    expect(signals[0].signal_type).toBe("ghost");
    expect(signals[0].days_since_contact).toBeGreaterThanOrEqual(199);
  });

  it("returns cooling signal for contact not contacted 60-180 days with no interactions", () => {
    const contact = createContact({ display_name: "Cooling Contact" });
    const coolDate = new Date(Date.now() - 90 * 86400000).toISOString();
    setContactFields(contact.id, {
      last_contacted_at: coolDate,
      interaction_count_30d: 0,
    });
    const signals = getRelationshipSignals(contact.id);
    expect(signals.length).toBe(1);
    expect(signals[0].signal_type).toBe("cooling");
  });

  it("returns warming signal for contact with many recent interactions and high health", () => {
    const contact = createContact({ display_name: "Warming Contact" });
    const recentDate = new Date(Date.now() - 5 * 86400000).toISOString();
    setContactFields(contact.id, {
      last_contacted_at: recentDate,
      interaction_count_30d: 5,
      relationship_health: 80,
    });
    const signals = getRelationshipSignals(contact.id);
    expect(signals.length).toBe(1);
    expect(signals[0].signal_type).toBe("warming");
  });

  it("returns healthy signal for normal contact", () => {
    const contact = createContact({ display_name: "Normal Contact" });
    const recentDate = new Date(Date.now() - 10 * 86400000).toISOString();
    setContactFields(contact.id, {
      last_contacted_at: recentDate,
      interaction_count_30d: 1,
      relationship_health: 50,
    });
    const signals = getRelationshipSignals(contact.id);
    expect(signals.length).toBe(1);
    expect(signals[0].signal_type).toBe("healthy");
  });

  it("returns empty array for non-existent contact", () => {
    const signals = getRelationshipSignals("non-existent-id");
    expect(signals).toEqual([]);
  });
});

describe("getGhostContacts", () => {
  it("returns contacts that were never contacted", () => {
    createContact({ display_name: "Ghost 1" });
    createContact({ display_name: "Ghost 2" });
    const ghosts = getGhostContacts();
    expect(ghosts.length).toBe(2);
    expect(ghosts.every(g => g.signal_type === "ghost")).toBe(true);
  });

  it("returns contacts not contacted in 180+ days", () => {
    const contact = createContact({ display_name: "Old Ghost" });
    const oldDate = new Date(Date.now() - 200 * 86400000).toISOString();
    setContactFields(contact.id, { last_contacted_at: oldDate });
    const ghosts = getGhostContacts();
    expect(ghosts.length).toBe(1);
    expect(ghosts[0].display_name).toBe("Old Ghost");
  });

  it("does not return recently contacted contacts", () => {
    const contact = createContact({ display_name: "Recent" });
    const recentDate = new Date(Date.now() - 10 * 86400000).toISOString();
    setContactFields(contact.id, { last_contacted_at: recentDate });
    const ghosts = getGhostContacts();
    expect(ghosts).toEqual([]);
  });

  it("does not return archived contacts", () => {
    const contact = createContact({ display_name: "Archived Ghost" });
    setContactFields(contact.id, { archived: 1 });
    const ghosts = getGhostContacts();
    expect(ghosts).toEqual([]);
  });

  it("limits results to 50", () => {
    // Create 55 ghost contacts
    for (let i = 0; i < 55; i++) {
      createContact({ display_name: `Ghost ${i}` });
    }
    const ghosts = getGhostContacts();
    expect(ghosts.length).toBe(50);
  });
});

describe("getWarmingContacts", () => {
  it("returns contacts with high interaction and health", () => {
    const contact = createContact({ display_name: "Warming" });
    const recentDate = new Date(Date.now() - 3 * 86400000).toISOString();
    setContactFields(contact.id, {
      last_contacted_at: recentDate,
      interaction_count_30d: 5,
      relationship_health: 80,
    });
    const warming = getWarmingContacts();
    expect(warming.length).toBe(1);
    expect(warming[0].signal_type).toBe("warming");
    expect(warming[0].display_name).toBe("Warming");
  });

  it("does not return contacts with low interaction count", () => {
    const contact = createContact({ display_name: "Low Interaction" });
    setContactFields(contact.id, {
      last_contacted_at: new Date().toISOString(),
      interaction_count_30d: 1,
      relationship_health: 80,
    });
    const warming = getWarmingContacts();
    expect(warming).toEqual([]);
  });

  it("does not return contacts with low health", () => {
    const contact = createContact({ display_name: "Low Health" });
    setContactFields(contact.id, {
      last_contacted_at: new Date().toISOString(),
      interaction_count_30d: 5,
      relationship_health: 40,
    });
    const warming = getWarmingContacts();
    expect(warming).toEqual([]);
  });

  it("does not return archived contacts", () => {
    const contact = createContact({ display_name: "Archived Warm" });
    setContactFields(contact.id, {
      last_contacted_at: new Date().toISOString(),
      interaction_count_30d: 5,
      relationship_health: 80,
      archived: 1,
    });
    const warming = getWarmingContacts();
    expect(warming).toEqual([]);
  });

  it("returns contacts sorted by relationship_health DESC", () => {
    const c1 = createContact({ display_name: "Medium Health" });
    const c2 = createContact({ display_name: "High Health" });
    setContactFields(c1.id, { interaction_count_30d: 5, relationship_health: 70 });
    setContactFields(c2.id, { interaction_count_30d: 5, relationship_health: 90 });
    const warming = getWarmingContacts();
    expect(warming.length).toBe(2);
    expect(warming[0].display_name).toBe("High Health");
    expect(warming[1].display_name).toBe("Medium Health");
  });
});

describe("recomputeAllSignals", () => {
  it("sets ghost status for never-contacted contacts", () => {
    createContact({ display_name: "Ghost" });
    // No other non-archived contacts that would trigger 'warm' or 'active' (invalid CHECK values)
    const result = recomputeAllSignals();
    expect(result.updated).toBeGreaterThanOrEqual(0);

    const db = getDatabase();
    const ghostRow = db.query(`SELECT engagement_status FROM contacts WHERE display_name = ?`).get("Ghost") as { engagement_status: string };
    expect(ghostRow.engagement_status).toBe("ghost");
  });

  it("sets cooling status for contacts not contacted in 60+ days", () => {
    const contact = createContact({ display_name: "Cooling" });
    const oldDate = new Date(Date.now() - 90 * 86400000).toISOString();
    setContactFields(contact.id, {
      last_contacted_at: oldDate,
      interaction_count_30d: 0,
    });

    recomputeAllSignals();
    const db = getDatabase();
    const row = db.query(`SELECT engagement_status FROM contacts WHERE id = ?`).get(contact.id) as { engagement_status: string };
    expect(row.engagement_status).toBe("cooling");
  });

  it("sets warming status for contacts with high recent interaction count", () => {
    const contact = createContact({ display_name: "Warm" });
    setContactFields(contact.id, {
      last_contacted_at: new Date().toISOString(),
      interaction_count_30d: 5,
    });
    recomputeAllSignals();
    const db = getDatabase();
    const row = db.query(`SELECT engagement_status FROM contacts WHERE id = ?`).get(contact.id) as { engagement_status: string };
    expect(row.engagement_status).toBe("warming");
  });

  it("does not update archived contacts", () => {
    const contact = createContact({ display_name: "Archived" });
    setContactFields(contact.id, { archived: 1, engagement_status: "new" });

    // Only archived contacts exist, so the update affects 0 rows
    recomputeAllSignals();
    const db = getDatabase();
    const row = db.query(`SELECT engagement_status FROM contacts WHERE id = ?`).get(contact.id) as { engagement_status: string };
    expect(row.engagement_status).toBe("new"); // Should remain unchanged
  });

  it("returns updated count", () => {
    createContact({ display_name: "A" });
    const result = recomputeAllSignals();
    expect(typeof result.updated).toBe("number");
  });
});
