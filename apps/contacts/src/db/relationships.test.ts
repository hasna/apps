import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import { createRelationship, listRelationships, getRelationship, deleteRelationship } from "./relationships.js";
import { createContact } from "./contacts.js";
import { ContactNotFoundError } from "../types/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-rel-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("createRelationship", () => {
  it("creates a relationship between two contacts", () => {
    const a = createContact({ display_name: "Alice" });
    const b = createContact({ display_name: "Bob" });
    const rel = createRelationship({
      contact_a_id: a.id,
      contact_b_id: b.id,
      relationship_type: "colleague",
    });
    expect(rel.id).toBeTruthy();
    expect(rel.contact_a_id).toBe(a.id);
    expect(rel.contact_b_id).toBe(b.id);
    expect(rel.relationship_type).toBe("colleague");
  });

  it("creates a relationship with notes", () => {
    const a = createContact({ display_name: "Alice" });
    const b = createContact({ display_name: "Bob" });
    const rel = createRelationship({
      contact_a_id: a.id,
      contact_b_id: b.id,
      relationship_type: "mentor",
      notes: "Alice mentors Bob",
    });
    expect(rel.notes).toBe("Alice mentors Bob");
  });

  it("throws ContactNotFoundError for missing contact_a_id", () => {
    const b = createContact({ display_name: "Bob" });
    expect(() =>
      createRelationship({ contact_a_id: "missing", contact_b_id: b.id, relationship_type: "friend" })
    ).toThrow(ContactNotFoundError);
  });

  it("throws ContactNotFoundError for missing contact_b_id", () => {
    const a = createContact({ display_name: "Alice" });
    expect(() =>
      createRelationship({ contact_a_id: a.id, contact_b_id: "missing", relationship_type: "friend" })
    ).toThrow(ContactNotFoundError);
  });
});

describe("listRelationships", () => {
  it("returns empty array when no relationships", () => {
    expect(listRelationships()).toEqual([]);
  });

  it("lists all relationships", () => {
    const a = createContact({ display_name: "A" });
    const b = createContact({ display_name: "B" });
    const c = createContact({ display_name: "C" });
    createRelationship({ contact_a_id: a.id, contact_b_id: b.id, relationship_type: "friend" });
    createRelationship({ contact_a_id: b.id, contact_b_id: c.id, relationship_type: "colleague" });
    expect(listRelationships()).toHaveLength(2);
  });

  it("filters by contact_id (either side)", () => {
    const a = createContact({ display_name: "A" });
    const b = createContact({ display_name: "B" });
    const c = createContact({ display_name: "C" });
    createRelationship({ contact_a_id: a.id, contact_b_id: b.id, relationship_type: "friend" });
    createRelationship({ contact_a_id: c.id, contact_b_id: b.id, relationship_type: "colleague" });
    createRelationship({ contact_a_id: a.id, contact_b_id: c.id, relationship_type: "mentor" });

    const forA = listRelationships({ contact_id: a.id });
    expect(forA).toHaveLength(2);

    const forB = listRelationships({ contact_id: b.id });
    expect(forB).toHaveLength(2);
  });

  it("filters by relationship_type", () => {
    const a = createContact({ display_name: "A" });
    const b = createContact({ display_name: "B" });
    const c = createContact({ display_name: "C" });
    createRelationship({ contact_a_id: a.id, contact_b_id: b.id, relationship_type: "friend" });
    createRelationship({ contact_a_id: a.id, contact_b_id: c.id, relationship_type: "colleague" });

    const friends = listRelationships({ relationship_type: "friend" });
    expect(friends).toHaveLength(1);
    expect(friends[0]!.relationship_type).toBe("friend");
  });
});

describe("getRelationship", () => {
  it("retrieves relationship by id", () => {
    const a = createContact({ display_name: "A" });
    const b = createContact({ display_name: "B" });
    const rel = createRelationship({ contact_a_id: a.id, contact_b_id: b.id, relationship_type: "partner" });
    const fetched = getRelationship(rel.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(rel.id);
  });

  it("returns null for missing id", () => {
    expect(getRelationship("nonexistent")).toBeNull();
  });
});

describe("deleteRelationship", () => {
  it("deletes a relationship", () => {
    const a = createContact({ display_name: "A" });
    const b = createContact({ display_name: "B" });
    const rel = createRelationship({ contact_a_id: a.id, contact_b_id: b.id, relationship_type: "client" });
    deleteRelationship(rel.id);
    expect(getRelationship(rel.id)).toBeNull();
  });

  it("does nothing for nonexistent id", () => {
    // Should not throw
    deleteRelationship("nonexistent");
  });
});
