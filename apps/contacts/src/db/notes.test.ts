import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import { addNote, listNotes, deleteNote, getNote } from "./notes.js";
import { createContact } from "./contacts.js";
import { ContactNotFoundError } from "../types/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-notes-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("addNote", () => {
  it("creates a structured note", () => {
    const contact = createContact({ display_name: "Alice" });
    const note = addNote(contact.id, "Called to discuss project");
    expect(note.id).toBeTruthy();
    expect(note.contact_id).toBe(contact.id);
    expect(note.body).toBe("Called to discuss project");
    expect(note.created_by).toBeNull();
    expect(note.created_at).toBeTruthy();
  });

  it("stores created_by", () => {
    const contact = createContact({ display_name: "Bob" });
    const note = addNote(contact.id, "Follow up next week", "agent-42");
    expect(note.created_by).toBe("agent-42");
  });

  it("throws ContactNotFoundError for invalid contact", () => {
    expect(() => addNote("bad-id", "note body")).toThrow(ContactNotFoundError);
  });
});

describe("listNotes", () => {
  it("returns notes in chronological order", () => {
    const contact = createContact({ display_name: "Carol" });
    addNote(contact.id, "First note");
    addNote(contact.id, "Second note");
    addNote(contact.id, "Third note");
    const notes = listNotes(contact.id);
    expect(notes).toHaveLength(3);
    expect(notes[0]!.body).toBe("First note");
    expect(notes[2]!.body).toBe("Third note");
  });

  it("returns empty array for contact with no notes", () => {
    const contact = createContact({ display_name: "Dave" });
    expect(listNotes(contact.id)).toHaveLength(0);
  });

  it("only returns notes for the specified contact", () => {
    const c1 = createContact({ display_name: "A" });
    const c2 = createContact({ display_name: "B" });
    addNote(c1.id, "Note for A");
    addNote(c2.id, "Note for B");
    const c1Notes = listNotes(c1.id);
    expect(c1Notes).toHaveLength(1);
    expect(c1Notes[0]!.body).toBe("Note for A");
  });
});

describe("deleteNote", () => {
  it("deletes a note by ID", () => {
    const contact = createContact({ display_name: "Eve" });
    const note = addNote(contact.id, "Delete me");
    deleteNote(note.id);
    expect(getNote(note.id)).toBeNull();
    expect(listNotes(contact.id)).toHaveLength(0);
  });

  it("does nothing for nonexistent ID", () => {
    deleteNote("nonexistent"); // should not throw
  });
});

describe("getNote", () => {
  it("returns a note by ID", () => {
    const contact = createContact({ display_name: "Frank" });
    const note = addNote(contact.id, "Get this");
    const fetched = getNote(note.id);
    expect(fetched?.body).toBe("Get this");
  });

  it("returns null for nonexistent ID", () => {
    expect(getNote("nonexistent")).toBeNull();
  });
});
