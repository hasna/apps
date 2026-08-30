import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import {
  addIdentity,
  resolveIdentity,
  resolveByPartial,
  getIdentities,
} from "./identity.js";
import { createContact, addEmailToContact } from "./contacts.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-identity-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("addIdentity", () => {
  it("adds an identity with minimal fields", () => {
    const contact = createContact({ display_name: "Alice" });
    const identity = addIdentity(contact.id, "github", "alice123");
    expect(identity.id).toBeTruthy();
    expect(identity.contact_id).toBe(contact.id);
    expect(identity.system).toBe("github");
    expect(identity.external_id).toBe("alice123");
    expect(identity.external_url).toBeNull();
    expect(identity.confidence).toBe("inferred");
    expect(identity.created_at).toBeTruthy();
  });

  it("adds an identity with all fields", () => {
    const contact = createContact({ display_name: "Bob" });
    const identity = addIdentity(
      contact.id, "linkedin", "bob-smith", "https://linkedin.com/in/bob-smith", "verified",
    );
    expect(identity.system).toBe("linkedin");
    expect(identity.external_id).toBe("bob-smith");
    expect(identity.external_url).toBe("https://linkedin.com/in/bob-smith");
    expect(identity.confidence).toBe("verified");
  });

  it("replaces identity with same system + external_id (INSERT OR REPLACE)", () => {
    const alice = createContact({ display_name: "Alice" });
    const bob = createContact({ display_name: "Bob" });
    addIdentity(alice.id, "github", "shared-id");
    // Adding same system+external_id for different contact replaces
    const identity = addIdentity(bob.id, "github", "shared-id");
    expect(identity.contact_id).toBe(bob.id);
    // Old one should be gone
    const aliceIdentities = getIdentities(alice.id);
    expect(aliceIdentities.filter(i => i.external_id === "shared-id").length).toBe(0);
  });

  it("allows multiple identities for different systems on same contact", () => {
    const contact = createContact({ display_name: "Carol" });
    addIdentity(contact.id, "github", "carol-gh");
    addIdentity(contact.id, "twitter", "carol-tw");
    addIdentity(contact.id, "slack", "U12345");
    const identities = getIdentities(contact.id);
    expect(identities.length).toBe(3);
  });
});

describe("resolveIdentity", () => {
  it("resolves a contact by system + external_id", () => {
    const contact = createContact({ display_name: "Alice Smith" });
    addIdentity(contact.id, "github", "alice123");
    const resolved = resolveIdentity("github", "alice123");
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(contact.id);
    expect(resolved!.display_name).toBe("Alice Smith");
  });

  it("returns null for non-existent identity", () => {
    expect(resolveIdentity("github", "nonexistent")).toBeNull();
  });

  it("returns null for wrong system", () => {
    const contact = createContact({ display_name: "Bob" });
    addIdentity(contact.id, "github", "bob123");
    expect(resolveIdentity("twitter", "bob123")).toBeNull();
  });
});

describe("resolveByPartial", () => {
  it("matches by email", () => {
    const contact = createContact({ display_name: "Alice" });
    addEmailToContact(contact.id, { address: "alice@example.com", type: "work" });
    const matches = resolveByPartial({ email: "alice@example.com" });
    expect(matches.length).toBe(1);
    expect(matches[0].contact.id).toBe(contact.id);
    expect(matches[0].confidence_score).toBe(90);
    expect(matches[0].match_reasons.length).toBe(1);
  });

  it("matches by name (partial/LIKE)", () => {
    createContact({ display_name: "Alice Smith" });
    createContact({ display_name: "Alice Johnson" });
    createContact({ display_name: "Bob Brown" });
    const matches = resolveByPartial({ name: "Alice" });
    expect(matches.length).toBe(2);
    expect(matches.every(m => m.confidence_score === 40)).toBe(true);
  });

  it("combines email and name match scores", () => {
    const contact = createContact({ display_name: "Alice Smith" });
    addEmailToContact(contact.id, { address: "alice@example.com", type: "work" });
    const matches = resolveByPartial({ email: "alice@example.com", name: "Alice" });
    expect(matches.length).toBe(1);
    // Score should be 90 (email) + 40 (name) = 130, but capped at 100
    expect(matches[0].confidence_score).toBe(100);
    expect(matches[0].match_reasons.length).toBe(2);
  });

  it("returns results sorted by confidence_score descending", () => {
    const alice = createContact({ display_name: "Alice Smith" });
    addEmailToContact(alice.id, { address: "alice@test.com", type: "work" });
    createContact({ display_name: "Alice Jones" });

    const matches = resolveByPartial({ email: "alice@test.com", name: "Alice" });
    // Alice Smith should be first (email+name match), Alice Jones second (name only)
    expect(matches[0].contact.display_name).toBe("Alice Smith");
    expect(matches[0].confidence_score).toBe(100);
    if (matches.length > 1) {
      expect(matches[1].confidence_score).toBeLessThan(matches[0].confidence_score);
    }
  });

  it("returns empty array when no matches found", () => {
    createContact({ display_name: "Alice" });
    const matches = resolveByPartial({ email: "nobody@example.com" });
    expect(matches).toEqual([]);
  });

  it("returns empty array for empty partial", () => {
    createContact({ display_name: "Alice" });
    const matches = resolveByPartial({});
    expect(matches).toEqual([]);
  });

  it("does not match archived contacts by name", () => {
    const contact = createContact({ display_name: "Archived Person" });
    // Manually archive the contact
    const { getDatabase } = require("./database.js");
    const db = getDatabase();
    db.run(`UPDATE contacts SET archived = 1 WHERE id = ?`, [contact.id]);
    const matches = resolveByPartial({ name: "Archived" });
    expect(matches).toEqual([]);
  });

  it("email match is case-insensitive", () => {
    const contact = createContact({ display_name: "Alice" });
    addEmailToContact(contact.id, { address: "Alice@Example.COM", type: "work" });
    const matches = resolveByPartial({ email: "alice@example.com" });
    expect(matches.length).toBe(1);
  });
});

describe("getIdentities", () => {
  it("returns all identities for a contact", () => {
    const contact = createContact({ display_name: "Alice" });
    addIdentity(contact.id, "github", "alice-gh");
    addIdentity(contact.id, "twitter", "alice-tw");
    const identities = getIdentities(contact.id);
    expect(identities.length).toBe(2);
  });

  it("returns identities in descending created_at order", () => {
    const contact = createContact({ display_name: "Bob" });
    addIdentity(contact.id, "github", "bob-gh");
    addIdentity(contact.id, "twitter", "bob-tw");
    addIdentity(contact.id, "slack", "bob-slack");
    const identities = getIdentities(contact.id);
    // Last added should be first (DESC)
    expect(identities[0].system).toBe("slack");
  });

  it("returns empty array for contact with no identities", () => {
    const contact = createContact({ display_name: "Carol" });
    expect(getIdentities(contact.id)).toEqual([]);
  });

  it("returns empty array for non-existent contact", () => {
    expect(getIdentities("non-existent")).toEqual([]);
  });
});
