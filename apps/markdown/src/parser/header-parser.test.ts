import { describe, test, expect } from "bun:test";
import { parseHeader } from "./header-parser";

describe("parseHeader", () => {
  test("parses simple key:value headers", () => {
    const raw = `type: endpoint
id: list-notes
method: GET
path: /api/notes

Return all notes.`;

    const result = parseHeader(raw);
    expect(result.type).toBe("endpoint");
    expect(result.id).toBe("list-notes");
    expect(result.headers["method"]).toBe("GET");
    expect(result.headers["path"]).toBe("/api/notes");
    expect(result.bodyRaw).toBe("Return all notes.");
  });

  test("parses depends as comma-separated IDs", () => {
    const raw = `type: page
id: notes-list
depends: root-layout, list-notes, auth

Display the notes list.`;

    const result = parseHeader(raw);
    expect(result.depends).toEqual(["root-layout", "list-notes", "auth"]);
  });

  test("parses array values [a, b, c]", () => {
    const raw = `type: seed
id: seed
sample-tags: [work, personal, ideas]

Create seed data.`;

    const result = parseHeader(raw);
    expect(result.headers["sample-tags"]).toEqual(["work", "personal", "ideas"]);
  });

  test("parses object values { key: value }", () => {
    const raw = `type: endpoint
id: create-note
body: { title: string, content: string }

Create a note.`;

    const result = parseHeader(raw);
    expect(result.headers["body"]).toEqual({ title: "string", content: "string" });
  });

  test("parses numeric values", () => {
    const raw = `type: seed
id: seed
sample-notes: 5

Seed data.`;

    const result = parseHeader(raw);
    expect(result.headers["sample-notes"]).toBe(5);
  });

  test("parses list items with - prefix", () => {
    const raw = `type: seed
id: seed
users:
  - andrei@hasna.com
  - demo@example.com

Create users.`;

    const result = parseHeader(raw);
    expect(result.headers["users"]).toEqual(["andrei@hasna.com", "demo@example.com"]);
  });

  test("defaults type to custom when missing", () => {
    const raw = `id: something

Do something.`;

    const result = parseHeader(raw);
    expect(result.type).toBe("custom");
  });

  test("handles empty body", () => {
    const raw = `type: migration
id: db-push`;

    const result = parseHeader(raw);
    expect(result.type).toBe("migration");
    expect(result.id).toBe("db-push");
    expect(result.bodyRaw).toBe("");
  });

  test("body starts at first non-kv line when no blank separator", () => {
    const raw = `type: project
id: init
This is body text without blank line.`;

    const result = parseHeader(raw);
    expect(result.type).toBe("project");
    expect(result.id).toBe("init");
    expect(result.bodyRaw).toBe("This is body text without blank line.");
  });

  test("preserves multi-line body", () => {
    const raw = `type: endpoint
id: list-notes
method: GET
path: /api/notes

Return all notes belonging to the user.

When q is provided, filter by title and content.

accepts: only user's own notes; search works`;

    const result = parseHeader(raw);
    expect(result.bodyRaw).toContain("Return all notes");
    expect(result.bodyRaw).toContain("When q is provided");
    expect(result.bodyRaw).toContain("accepts:");
  });

  test("tracks body start line number", () => {
    const raw = `type: project
id: init
name: App

Body starts here.`;

    const result = parseHeader(raw, 10);
    // Header is 3 lines + blank line at idx 3 → body at idx 4 → line 10+4=14
    expect(result.bodyStartLine).toBe(14);
  });

  test("handles hyphenated keys", () => {
    const raw = `type: table
id: note-tags
primary-key: [note_id, tag_id]
on-delete: cascade

Join table.`;

    const result = parseHeader(raw);
    expect(result.id).toBe("note-tags");
    expect(result.headers["primary-key"]).toEqual(["note_id", "tag_id"]);
    expect(result.headers["on-delete"]).toBe("cascade");
  });
});
