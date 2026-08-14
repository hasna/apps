import { describe, test, expect, beforeEach } from "bun:test";

process.env["SIGNATURES_DB_PATH"] = ":memory:";

import { closeDatabase } from "./database.js";
import { getStats } from "./stats.js";
import { createDocument } from "./documents.js";
import { createSignature } from "./signatures.js";
import { createProject } from "./projects.js";
import { createTag } from "./tags.js";

beforeEach(() => { closeDatabase(); });

describe("stats", () => {
  test("returns zero stats for empty DB", () => {
    const stats = getStats();
    expect(stats.total_documents).toBe(0);
    expect(stats.total_signatures).toBe(0);
    expect(stats.total_projects).toBe(0);
    expect(stats.total_tags).toBe(0);
  });

  test("counts documents correctly", () => {
    createDocument({ name: "D1", file_path: "/f.pdf", file_name: "f.pdf", slug: "d1x" });
    createDocument({ name: "D2", file_path: "/f.pdf", file_name: "f.pdf", slug: "d2x" });
    expect(getStats().total_documents).toBe(2);
  });

  test("groups documents by status", () => {
    createDocument({ name: "Draft", file_path: "/f.pdf", file_name: "f.pdf", slug: "draftx", status: "draft" });
    createDocument({ name: "Done", file_path: "/f.pdf", file_name: "f.pdf", slug: "compx", status: "completed" });
    const stats = getStats();
    expect(stats.by_status["draft"]).toBe(1);
    expect(stats.by_status["completed"]).toBe(1);
  });

  test("counts signatures", () => {
    createSignature({ name: "S1", type: "text" });
    createSignature({ name: "S2", type: "drawing" });
    expect(getStats().total_signatures).toBe(2);
  });

  test("counts projects", () => {
    createProject({ name: "P1" });
    expect(getStats().total_projects).toBe(1);
  });

  test("counts tags", () => {
    createTag({ name: "t1" });
    createTag({ name: "t2" });
    expect(getStats().total_tags).toBe(2);
  });
});
