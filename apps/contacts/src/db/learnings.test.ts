import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import {
  saveLearning,
  getLearnings,
  searchLearnings,
  confirmLearning,
  decayLearnings,
  deleteLearning,
} from "./learnings.js";
import { createContact } from "./contacts.js";
import { getDatabase } from "./database.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-learnings-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("saveLearning", () => {
  it("saves a learning with minimal input", () => {
    const contact = createContact({ display_name: "Alice" });
    const learning = saveLearning(contact.id, { content: "Prefers email over phone" });
    expect(learning.id).toBeTruthy();
    expect(learning.contact_id).toBe(contact.id);
    expect(learning.content).toBe("Prefers email over phone");
    expect(learning.type).toBe("fact");
    expect(learning.confidence).toBe(70);
    expect(learning.importance).toBe(5);
    expect(learning.visibility).toBe("shared");
    expect(learning.tags).toEqual([]);
    expect(learning.confirmed_count).toBe(0);
    expect(learning.learned_by).toBeNull();
    expect(learning.session_id).toBeNull();
    expect(learning.contradicts_id).toBeNull();
  });

  it("saves a learning with all fields", () => {
    const contact = createContact({ display_name: "Bob" });
    const learning = saveLearning(contact.id, {
      content: "Allergic to shellfish",
      type: "warning",
      confidence: 95,
      importance: 9,
      learned_by: "agent-health",
      session_id: "session-xyz",
      visibility: "human",
      tags: ["health", "allergy"],
    });
    expect(learning.type).toBe("warning");
    expect(learning.confidence).toBe(95);
    expect(learning.importance).toBe(9);
    expect(learning.learned_by).toBe("agent-health");
    expect(learning.session_id).toBe("session-xyz");
    expect(learning.visibility).toBe("human");
    expect(learning.tags).toEqual(["health", "allergy"]);
  });

  it("stores multiple learnings for the same contact", () => {
    const contact = createContact({ display_name: "Carol" });
    saveLearning(contact.id, { content: "Learning 1" });
    saveLearning(contact.id, { content: "Learning 2" });
    saveLearning(contact.id, { content: "Learning 3" });
    const learnings = getLearnings(contact.id);
    expect(learnings.length).toBe(3);
  });
});

describe("getLearnings", () => {
  it("returns all learnings for a contact ordered by importance DESC, confidence DESC", () => {
    const contact = createContact({ display_name: "Alice" });
    saveLearning(contact.id, { content: "Low importance", importance: 2, confidence: 90 });
    saveLearning(contact.id, { content: "High importance", importance: 9, confidence: 80 });
    saveLearning(contact.id, { content: "Medium importance", importance: 5, confidence: 70 });
    const learnings = getLearnings(contact.id);
    expect(learnings[0].content).toBe("High importance");
    expect(learnings[1].content).toBe("Medium importance");
    expect(learnings[2].content).toBe("Low importance");
  });

  it("filters by type", () => {
    const contact = createContact({ display_name: "Bob" });
    saveLearning(contact.id, { content: "A fact", type: "fact" });
    saveLearning(contact.id, { content: "A warning", type: "warning" });
    saveLearning(contact.id, { content: "Another fact", type: "fact" });
    const facts = getLearnings(contact.id, { type: "fact" });
    expect(facts.length).toBe(2);
    expect(facts.every(l => l.type === "fact")).toBe(true);
  });

  it("filters by min_importance", () => {
    const contact = createContact({ display_name: "Carol" });
    saveLearning(contact.id, { content: "Low", importance: 2 });
    saveLearning(contact.id, { content: "High", importance: 8 });
    const high = getLearnings(contact.id, { min_importance: 7 });
    expect(high.length).toBe(1);
    expect(high[0].content).toBe("High");
  });

  it("filters by visibility", () => {
    const contact = createContact({ display_name: "Dave" });
    saveLearning(contact.id, { content: "Private", visibility: "private" });
    saveLearning(contact.id, { content: "Shared", visibility: "shared" });
    const priv = getLearnings(contact.id, { visibility: "private" });
    expect(priv.length).toBe(1);
    expect(priv[0].content).toBe("Private");
  });

  it("combines multiple filters", () => {
    const contact = createContact({ display_name: "Eve" });
    saveLearning(contact.id, { content: "Match", type: "warning", importance: 8, visibility: "human" });
    saveLearning(contact.id, { content: "Wrong type", type: "fact", importance: 8, visibility: "human" });
    saveLearning(contact.id, { content: "Low importance", type: "warning", importance: 2, visibility: "human" });
    const filtered = getLearnings(contact.id, { type: "warning", min_importance: 5, visibility: "human" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].content).toBe("Match");
  });

  it("returns empty array for contact with no learnings", () => {
    const contact = createContact({ display_name: "Frank" });
    expect(getLearnings(contact.id)).toEqual([]);
  });
});

describe("searchLearnings", () => {
  it("searches learnings by content", () => {
    const contact = createContact({ display_name: "Alice" });
    saveLearning(contact.id, { content: "Prefers morning meetings" });
    saveLearning(contact.id, { content: "Likes coffee" });
    saveLearning(contact.id, { content: "Morning person" });
    const results = searchLearnings("morning");
    expect(results.length).toBe(2);
  });

  it("filters by type", () => {
    const contact = createContact({ display_name: "Bob" });
    saveLearning(contact.id, { content: "Prefers email", type: "preference" });
    saveLearning(contact.id, { content: "Prefers chat", type: "fact" });
    const results = searchLearnings("Prefers", { type: "preference" });
    expect(results.length).toBe(1);
    expect(results[0].type).toBe("preference");
  });

  it("filters by contact_id", () => {
    const alice = createContact({ display_name: "Alice" });
    const bob = createContact({ display_name: "Bob" });
    saveLearning(alice.id, { content: "Likes cats" });
    saveLearning(bob.id, { content: "Likes cats too" });
    const results = searchLearnings("cats", { contact_id: alice.id });
    expect(results.length).toBe(1);
    expect(results[0].contact_id).toBe(alice.id);
  });

  it("returns empty array for no matches", () => {
    const contact = createContact({ display_name: "Carol" });
    saveLearning(contact.id, { content: "Something else" });
    expect(searchLearnings("nonexistent")).toEqual([]);
  });

  it("is case-insensitive via LIKE", () => {
    const contact = createContact({ display_name: "Dave" });
    saveLearning(contact.id, { content: "Prefers MORNING meetings" });
    const results = searchLearnings("morning");
    expect(results.length).toBe(1);
  });
});

describe("confirmLearning", () => {
  it("increments confirmed_count and increases confidence", () => {
    const contact = createContact({ display_name: "Alice" });
    const learning = saveLearning(contact.id, { content: "A fact", confidence: 70 });
    confirmLearning(learning.id, "agent-1");
    const updated = getLearnings(contact.id);
    expect(updated[0].confirmed_count).toBe(1);
    expect(updated[0].confidence).toBe(80); // 70 + 10
  });

  it("caps confidence at 100", () => {
    const contact = createContact({ display_name: "Bob" });
    const learning = saveLearning(contact.id, { content: "Very certain", confidence: 95 });
    confirmLearning(learning.id, "agent-1");
    const updated = getLearnings(contact.id);
    expect(updated[0].confidence).toBe(100);
  });

  it("can be confirmed multiple times", () => {
    const contact = createContact({ display_name: "Carol" });
    const learning = saveLearning(contact.id, { content: "A fact", confidence: 50 });
    confirmLearning(learning.id, "agent-1");
    confirmLearning(learning.id, "agent-2");
    confirmLearning(learning.id, "agent-3");
    const updated = getLearnings(contact.id);
    expect(updated[0].confirmed_count).toBe(3);
    expect(updated[0].confidence).toBe(80); // 50 + 30
  });
});

describe("decayLearnings", () => {
  it("decays unconfirmed old learnings", () => {
    const contact = createContact({ display_name: "Alice" });
    const learning = saveLearning(contact.id, { content: "Old fact", confidence: 70 });

    // Manually backdate the learning to > 30 days ago
    const db = getDatabase();
    const oldDate = new Date(Date.now() - 31 * 86400000).toISOString();
    db.run(`UPDATE contact_learnings SET created_at = ? WHERE id = ?`, [oldDate, learning.id]);

    const decayed = decayLearnings();
    expect(decayed).toBe(1);

    const updated = getLearnings(contact.id);
    expect(updated[0].confidence).toBe(65); // 70 - 5
  });

  it("does not decay confirmed learnings", () => {
    const contact = createContact({ display_name: "Bob" });
    const learning = saveLearning(contact.id, { content: "Confirmed fact", confidence: 70 });
    confirmLearning(learning.id, "agent-1");

    const db = getDatabase();
    const oldDate = new Date(Date.now() - 31 * 86400000).toISOString();
    db.run(`UPDATE contact_learnings SET created_at = ? WHERE id = ?`, [oldDate, learning.id]);

    const decayed = decayLearnings();
    expect(decayed).toBe(0);
  });

  it("does not decay recent learnings", () => {
    const contact = createContact({ display_name: "Carol" });
    saveLearning(contact.id, { content: "Recent fact", confidence: 70 });
    const decayed = decayLearnings();
    expect(decayed).toBe(0);
  });

  it("does not decay below 10", () => {
    const contact = createContact({ display_name: "Dave" });
    const learning = saveLearning(contact.id, { content: "Low confidence", confidence: 12 });

    const db = getDatabase();
    const oldDate = new Date(Date.now() - 31 * 86400000).toISOString();
    db.run(`UPDATE contact_learnings SET created_at = ? WHERE id = ?`, [oldDate, learning.id]);

    decayLearnings();
    const updated = getLearnings(contact.id);
    expect(updated[0].confidence).toBe(10); // MAX(10, 12-5) = 10
  });

  it("does not decay learnings already at 10", () => {
    const contact = createContact({ display_name: "Eve" });
    const learning = saveLearning(contact.id, { content: "Bottom", confidence: 10 });

    const db = getDatabase();
    const oldDate = new Date(Date.now() - 31 * 86400000).toISOString();
    db.run(`UPDATE contact_learnings SET created_at = ? WHERE id = ?`, [oldDate, learning.id]);

    const decayed = decayLearnings();
    expect(decayed).toBe(0); // confidence <= 10, so WHERE confidence>10 won't match
  });

  it("returns 0 when no learnings need decay", () => {
    expect(decayLearnings()).toBe(0);
  });
});

describe("deleteLearning", () => {
  it("deletes a learning by id", () => {
    const contact = createContact({ display_name: "Alice" });
    const learning = saveLearning(contact.id, { content: "To delete" });
    deleteLearning(learning.id);
    const learnings = getLearnings(contact.id);
    expect(learnings.length).toBe(0);
  });

  it("does not throw for non-existent learning", () => {
    expect(() => deleteLearning("non-existent")).not.toThrow();
  });

  it("only deletes the specified learning", () => {
    const contact = createContact({ display_name: "Bob" });
    const l1 = saveLearning(contact.id, { content: "Keep" });
    const l2 = saveLearning(contact.id, { content: "Delete" });
    deleteLearning(l2.id);
    const learnings = getLearnings(contact.id);
    expect(learnings.length).toBe(1);
    expect(learnings[0].id).toBe(l1.id);
  });
});
