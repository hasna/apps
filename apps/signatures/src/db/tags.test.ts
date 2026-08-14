import { describe, test, expect, beforeEach } from "bun:test";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

import { closeDatabase } from "./database.js";
import { createTag, getTagById, getTagByName, listTags, getOrCreateTag, addTagToDocument, getTagsForDocument, deleteTag } from "./tags.js";
import { createDocument } from "./documents.js";
import { NotFoundError, DuplicateError } from "../types/index.js";

beforeEach(() => { closeDatabase(); });

describe("tags", () => {
  test("creates a tag", () => {
    const t = createTag({ name: "urgent" });
    expect(t.id).toMatch(/^tag-/);
    expect(t.name).toBe("urgent");
  });

  test("creates tag with color", () => {
    const t = createTag({ name: "red", color: "#ff0000" });
    expect(t.color).toBe("#ff0000");
  });

  test("throws DuplicateError on duplicate name", () => {
    createTag({ name: "dup-tag" });
    expect(() => createTag({ name: "dup-tag" })).toThrow(DuplicateError);
  });

  test("gets tag by ID", () => {
    const t = createTag({ name: "findme" });
    expect(getTagById(t.id).id).toBe(t.id);
  });

  test("throws NotFoundError for missing tag", () => {
    expect(() => getTagById("tag-missing")).toThrow(NotFoundError);
  });

  test("gets tag by name", () => {
    const t = createTag({ name: "byname" });
    expect(getTagByName("byname").id).toBe(t.id);
  });

  test("lists tags alphabetically", () => {
    createTag({ name: "z-tag" });
    createTag({ name: "a-tag" });
    const list = listTags();
    const names = list.map(t => t.name);
    expect(names.indexOf("a-tag")).toBeLessThan(names.indexOf("z-tag"));
  });

  test("getOrCreateTag returns existing", () => {
    const t = createTag({ name: "exist" });
    const t2 = getOrCreateTag("exist");
    expect(t2.id).toBe(t.id);
  });

  test("getOrCreateTag creates new", () => {
    const t = getOrCreateTag("new-tag-unique");
    expect(t.id).toMatch(/^tag-/);
  });

  test("adds tag to document", () => {
    const t = createTag({ name: "doc-tag" });
    const doc = createDocument({ name: "Doc", file_path: "/tmp/f.pdf", file_name: "f.pdf" });
    addTagToDocument(doc.id, t.id);
    const tags = getTagsForDocument(doc.id);
    expect(tags.some(tt => tt.id === t.id)).toBe(true);
  });

  test("deletes tag", () => {
    const t = createTag({ name: "delete-me" });
    deleteTag(t.id);
    expect(() => getTagById(t.id)).toThrow(NotFoundError);
  });
});
