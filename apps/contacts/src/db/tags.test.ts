import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import { createTag, getTag, getTagByName, listTags, updateTag, deleteTag, addTagToContact, removeTagFromContact, listContactsByTag } from "./tags.js";
import { createContact } from "./contacts.js";
import { DuplicateTagNameError, TagNotFoundError } from "../types/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-tags-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("createTag", () => {
  it("creates a tag with name and default color", () => {
    const tag = createTag({ name: "vip" });
    expect(tag.name).toBe("vip");
    expect(tag.color).toBe("#6366f1");
    expect(tag.id).toBeTruthy();
  });

  it("creates a tag with custom color and description", () => {
    const tag = createTag({ name: "hot-lead", color: "#ff0000", description: "Very hot" });
    expect(tag.color).toBe("#ff0000");
    expect(tag.description).toBe("Very hot");
  });

  it("throws DuplicateTagNameError for duplicate name", () => {
    createTag({ name: "unique" });
    expect(() => createTag({ name: "unique" })).toThrow(DuplicateTagNameError);
  });
});

describe("getTag", () => {
  it("retrieves tag by id", () => {
    const tag = createTag({ name: "test-tag" });
    const fetched = getTag(tag.id);
    expect(fetched.id).toBe(tag.id);
    expect(fetched.name).toBe("test-tag");
  });

  it("throws TagNotFoundError for missing id", () => {
    expect(() => getTag("nonexistent")).toThrow(TagNotFoundError);
  });
});

describe("getTagByName", () => {
  it("retrieves tag by name", () => {
    createTag({ name: "by-name-tag" });
    const tag = getTagByName("by-name-tag");
    expect(tag).not.toBeNull();
    expect(tag!.name).toBe("by-name-tag");
  });

  it("returns null for missing name", () => {
    expect(getTagByName("does-not-exist")).toBeNull();
  });
});

describe("listTags", () => {
  it("returns empty array when no tags", () => {
    expect(listTags()).toEqual([]);
  });

  it("returns all tags sorted by name", () => {
    createTag({ name: "zebra" });
    createTag({ name: "alpha" });
    const tags = listTags();
    expect(tags).toHaveLength(2);
    expect(tags[0]!.name).toBe("alpha");
    expect(tags[1]!.name).toBe("zebra");
  });
});

describe("updateTag", () => {
  it("updates tag name", () => {
    const tag = createTag({ name: "old-name" });
    const updated = updateTag(tag.id, { name: "new-name" });
    expect(updated.name).toBe("new-name");
  });

  it("updates tag color", () => {
    const tag = createTag({ name: "colorful" });
    const updated = updateTag(tag.id, { color: "#00ff00" });
    expect(updated.color).toBe("#00ff00");
  });

  it("throws TagNotFoundError for missing id", () => {
    expect(() => updateTag("nonexistent", { name: "x" })).toThrow(TagNotFoundError);
  });

  it("throws DuplicateTagNameError when renaming to existing name", () => {
    const t1 = createTag({ name: "first" });
    createTag({ name: "second" });
    expect(() => updateTag(t1.id, { name: "second" })).toThrow(DuplicateTagNameError);
  });
});

describe("deleteTag", () => {
  it("deletes a tag", () => {
    const tag = createTag({ name: "delete-me" });
    deleteTag(tag.id);
    expect(() => getTag(tag.id)).toThrow(TagNotFoundError);
  });

  it("throws TagNotFoundError for missing id", () => {
    expect(() => deleteTag("nonexistent")).toThrow(TagNotFoundError);
  });
});

describe("contact tag operations", () => {
  it("adds a tag to a contact", () => {
    const contact = createContact({ display_name: "Tagged Person" });
    const tag = createTag({ name: "customer" });
    addTagToContact(contact.id, tag.id);
    const tagged = listContactsByTag(tag.id);
    expect(tagged.some((c) => c.id === contact.id)).toBe(true);
  });

  it("removes a tag from a contact", () => {
    const contact = createContact({ display_name: "Remove Tag" });
    const tag = createTag({ name: "temp" });
    addTagToContact(contact.id, tag.id);
    removeTagFromContact(contact.id, tag.id);
    const tagged = listContactsByTag(tag.id);
    expect(tagged.some((c) => c.id === contact.id)).toBe(false);
  });

  it("is idempotent when adding same tag twice", () => {
    const contact = createContact({ display_name: "Idempotent" });
    const tag = createTag({ name: "double" });
    addTagToContact(contact.id, tag.id);
    addTagToContact(contact.id, tag.id); // should not throw
    const tagged = listContactsByTag(tag.id);
    expect(tagged.filter((c) => c.id === contact.id)).toHaveLength(1);
  });
});
