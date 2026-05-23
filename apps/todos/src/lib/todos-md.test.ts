import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, listTasks } from "../db/tasks.js";
import {
  parseTodosMd,
  serializeTodosMd,
  exportTodosMd,
  importTodosMd,
  syncTodosMd,
  TODOS_MD_VERSION,
} from "./todos-md.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-md-test-"));
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("todos.md format", () => {
  it("round-trips parse and serialize", () => {
    const sample = `---
todos_md_version: 1
project: demo
---
# Tasks

## pending

- [ ] **APP-001** Fix bug | priority:high | tags:oss | id:abc-123
- [x] Done item | priority:low
`;
    const doc = parseTodosMd(sample);
    expect(doc.frontmatter.project).toBe("demo");
    expect(doc.sections.pending?.[0]?.short_id).toBe("APP-001");
    expect(doc.sections.pending?.[0]?.priority).toBe("high");
    const out = serializeTodosMd(doc);
    expect(out).toContain("APP-001");
    expect(out).toContain("todos_md_version: 1");
  });

  it("exports and imports tasks from markdown file", () => {
    createTask({ title: "Export me", status: "pending", priority: "high", tags: ["oss"] });
    const path = join(tempDir, "todos.md");
    exportTodosMd({ path, include_completed: true });
    expect(readFileSync(path, "utf8")).toContain("Export me");

    resetDatabase();
    getDatabase();
    const result = importTodosMd(path);
    expect(result.created).toBeGreaterThan(0);
    expect(listTasks().some((t) => t.title === "Export me")).toBe(true);
  });

  it("sync keeps markdown and db aligned", () => {
    createTask({ title: "Synced", status: "pending" });
    const path = join(tempDir, "todos.md");
    const result = syncTodosMd(path);
    expect(result.exported).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("Synced");
  });

  it("schema version is local-only constant", () => {
    expect(TODOS_MD_VERSION).toBe(1);
    expect(serializeTodosMd({ frontmatter: { todos_md_version: 1 }, sections: {} })).not.toMatch(/platform-todos|cloudflare/i);
  });
});
