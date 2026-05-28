import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { extractFromSource, extractTodos, tagToPriority, EXTRACT_TAGS } from "./extract.js";
import type { ExtractedComment, ExtractTag } from "./extract.js";
import { createTask, listTasks } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import { listTaskFiles } from "../db/task-files.js";
import type { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("extractFromSource", () => {
  it("should extract // TODO comments", () => {
    const source = `const x = 1;
// TODO: Refactor this function
const y = 2;`;
    const results = extractFromSource(source, "test.ts");
    expect(results).toHaveLength(1);
    expect(results[0]!.tag).toBe("TODO");
    expect(results[0]!.message).toBe("Refactor this function");
    expect(results[0]!.line).toBe(2);
    expect(results[0]!.file).toBe("test.ts");
  });

  it("should extract // FIXME comments", () => {
    const source = `// FIXME: Memory leak in event handler`;
    const results = extractFromSource(source, "app.ts");
    expect(results).toHaveLength(1);
    expect(results[0]!.tag).toBe("FIXME");
    expect(results[0]!.message).toBe("Memory leak in event handler");
  });

  it("should extract # TODO comments (Python/Ruby style)", () => {
    const source = `# TODO: Add error handling for edge cases
x = 42`;
    const results = extractFromSource(source, "script.py");
    expect(results).toHaveLength(1);
    expect(results[0]!.tag).toBe("TODO");
    expect(results[0]!.message).toBe("Add error handling for edge cases");
  });

  it("should extract -- TODO comments (SQL/Lua style)", () => {
    const source = `-- TODO: Add index on user_id column
SELECT * FROM users;`;
    const results = extractFromSource(source, "query.sql");
    expect(results).toHaveLength(1);
    expect(results[0]!.tag).toBe("TODO");
    expect(results[0]!.message).toBe("Add index on user_id column");
  });

  it("should extract /* TODO */ comments", () => {
    const source = `/* TODO: Support pagination */
function getItems() {}`;
    const results = extractFromSource(source, "api.ts");
    expect(results).toHaveLength(1);
    expect(results[0]!.tag).toBe("TODO");
    expect(results[0]!.message).toBe("Support pagination");
  });

  it("should extract * TODO comments (inside block comments)", () => {
    const source = `/**
 * TODO: Implement caching layer
 */
function getData() {}`;
    const results = extractFromSource(source, "service.ts");
    expect(results).toHaveLength(1);
    expect(results[0]!.tag).toBe("TODO");
    expect(results[0]!.message).toBe("Implement caching layer");
  });

  it("should extract all supported tag types", () => {
    const source = `// TODO: First
// FIXME: Second
// HACK: Third
// XXX: Fourth
// BUG: Fifth
// NOTE: Sixth`;
    const results = extractFromSource(source, "test.ts");
    expect(results).toHaveLength(6);
    expect(results.map(r => r.tag)).toEqual(["TODO", "FIXME", "HACK", "XXX", "BUG", "NOTE"]);
  });

  it("should handle tags without colon", () => {
    const source = `// TODO refactor this
// FIXME handle null case`;
    const results = extractFromSource(source, "test.ts");
    expect(results).toHaveLength(2);
    expect(results[0]!.message).toBe("refactor this");
    expect(results[1]!.message).toBe("handle null case");
  });

  it("should be case-insensitive for tags", () => {
    const source = `// todo: lowercase
// Todo: mixed case
// TODO: uppercase`;
    const results = extractFromSource(source, "test.ts");
    expect(results).toHaveLength(3);
    expect(results.every(r => r.tag === "TODO")).toBe(true);
  });

  it("should filter by specific patterns", () => {
    const source = `// TODO: Keep this
// FIXME: Keep this too
// NOTE: Skip this one`;
    const results = extractFromSource(source, "test.ts", ["TODO", "FIXME"]);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.tag)).toEqual(["TODO", "FIXME"]);
  });

  it("should skip empty messages", () => {
    const source = `// TODO:
// FIXME: real message`;
    const results = extractFromSource(source, "test.ts");
    expect(results).toHaveLength(1);
    expect(results[0]!.tag).toBe("FIXME");
  });

  it("should return correct line numbers", () => {
    const source = `line1
line2
// TODO: on line 3
line4
// FIXME: on line 5`;
    const results = extractFromSource(source, "test.ts");
    expect(results[0]!.line).toBe(3);
    expect(results[1]!.line).toBe(5);
  });

  it("should include raw line content", () => {
    const source = `  // TODO: indented comment`;
    const results = extractFromSource(source, "test.ts");
    expect(results[0]!.raw).toBe("  // TODO: indented comment");
  });
});

describe("tagToPriority", () => {
  it("should map BUG and FIXME to high", () => {
    expect(tagToPriority("BUG")).toBe("high");
    expect(tagToPriority("FIXME")).toBe("high");
  });

  it("should map HACK, XXX, TODO to medium", () => {
    expect(tagToPriority("HACK")).toBe("medium");
    expect(tagToPriority("XXX")).toBe("medium");
    expect(tagToPriority("TODO")).toBe("medium");
  });

  it("should map NOTE to low", () => {
    expect(tagToPriority("NOTE")).toBe("low");
  });
});

describe("extractTodos (integration)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "extract-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should scan a directory and find comments", () => {
    writeFileSync(join(tempDir, "app.ts"), `// TODO: Add authentication\nconst x = 1;\n// FIXME: Handle errors`);
    writeFileSync(join(tempDir, "utils.ts"), `// HACK: Temporary workaround`);

    const result = extractTodos({ path: tempDir, dry_run: true }, db);
    expect(result.comments).toHaveLength(3);
    expect(result.tasks).toHaveLength(0);
    expect(result.comments.map(c => c.tag).sort()).toEqual(["FIXME", "HACK", "TODO"]);
  });

  it("should create tasks from comments", () => {
    writeFileSync(join(tempDir, "main.ts"), `// TODO: Implement login flow\n// BUG: Crash on empty input`);

    const result = extractTodos({ path: tempDir }, db);
    expect(result.tasks).toHaveLength(2);
    expect(result.comments).toHaveLength(2);

    const todoTask = result.tasks.find(t => t.title.includes("[TODO]"));
    expect(todoTask).toBeDefined();
    expect(todoTask!.priority).toBe("medium");
    expect(todoTask!.tags).toContain("extracted");
    expect(todoTask!.tags).toContain("todo");
    expect(todoTask!.metadata["source"]).toBe("code_comment");
    expect(todoTask!.metadata["source_file"]).toBe("main.ts");

    const bugTask = result.tasks.find(t => t.title.includes("[BUG]"));
    expect(bugTask).toBeDefined();
    expect(bugTask!.priority).toBe("high");
    expect(bugTask!.tags).toContain("bug");
  });

  it("should link files to created tasks", () => {
    writeFileSync(join(tempDir, "service.ts"), `// TODO: Add caching`);

    const result = extractTodos({ path: tempDir }, db);
    expect(result.tasks).toHaveLength(1);

    const files = listTaskFiles(result.tasks[0]!.id, db);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("service.ts");
    expect(files[0]!.note).toContain("Line 1");
  });

  it("should deduplicate on re-runs", () => {
    writeFileSync(join(tempDir, "app.ts"), `// TODO: Add tests`);

    const first = extractTodos({ path: tempDir }, db);
    expect(first.tasks).toHaveLength(1);
    expect(first.skipped).toBe(0);

    const second = extractTodos({ path: tempDir }, db);
    expect(second.tasks).toHaveLength(0);
    expect(second.skipped).toBe(1);
  });

  it("should assign to project when project_id is given", () => {
    const project = createProject({ name: "test-project", path: tempDir }, db);
    writeFileSync(join(tempDir, "index.ts"), `// TODO: Setup routes`);

    const result = extractTodos({ path: tempDir, project_id: project.id }, db);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.project_id).toBe(project.id);
  });

  it("should add extra tags", () => {
    writeFileSync(join(tempDir, "app.ts"), `// TODO: Clean up`);

    const result = extractTodos({ path: tempDir, tags: ["tech-debt", "sprint-5"] }, db);
    expect(result.tasks[0]!.tags).toContain("tech-debt");
    expect(result.tasks[0]!.tags).toContain("sprint-5");
    expect(result.tasks[0]!.tags).toContain("extracted");
  });

  it("should filter by specific patterns", () => {
    writeFileSync(join(tempDir, "app.ts"), `// TODO: Keep\n// FIXME: Keep\n// NOTE: Skip`);

    const result = extractTodos({ path: tempDir, patterns: ["TODO", "FIXME"], dry_run: true }, db);
    expect(result.comments).toHaveLength(2);
  });

  it("should filter by file extensions", () => {
    writeFileSync(join(tempDir, "app.ts"), `// TODO: TypeScript file`);
    writeFileSync(join(tempDir, "app.py"), `# TODO: Python file`);

    const result = extractTodos({ path: tempDir, extensions: ["ts"], dry_run: true }, db);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]!.file).toBe("app.ts");
  });

  it("should skip node_modules", () => {
    mkdirSync(join(tempDir, "node_modules"), { recursive: true });
    writeFileSync(join(tempDir, "node_modules", "dep.js"), `// TODO: Should be skipped`);
    writeFileSync(join(tempDir, "app.ts"), `// TODO: Should be found`);

    const result = extractTodos({ path: tempDir, dry_run: true }, db);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]!.file).toBe("app.ts");
  });

  it("should scan a single file", () => {
    const filePath = join(tempDir, "single.ts");
    writeFileSync(filePath, `// TODO: Single file scan\n// FIXME: Another one`);

    const result = extractTodos({ path: filePath, dry_run: true }, db);
    expect(result.comments).toHaveLength(2);
  });

  it("should handle subdirectories", () => {
    mkdirSync(join(tempDir, "src", "lib"), { recursive: true });
    writeFileSync(join(tempDir, "src", "lib", "utils.ts"), `// TODO: Deep nested`);

    const result = extractTodos({ path: tempDir, dry_run: true }, db);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]!.file).toBe("src/lib/utils.ts");
  });

  it("should include description with source context", () => {
    writeFileSync(join(tempDir, "app.ts"), `// TODO: Important task`);

    const result = extractTodos({ path: tempDir }, db);
    expect(result.tasks[0]!.description).toContain("app.ts");
    expect(result.tasks[0]!.description).toContain("line 1");
    expect(result.tasks[0]!.description).toContain("// TODO: Important task");
  });

  it("should set assigned_to when provided", () => {
    writeFileSync(join(tempDir, "app.ts"), `// TODO: Assign me`);

    const result = extractTodos({ path: tempDir, assigned_to: "maximus" }, db);
    expect(result.tasks[0]!.assigned_to).toBe("maximus");
  });
});

describe("EXTRACT_TAGS", () => {
  it("should contain all expected tags", () => {
    expect(EXTRACT_TAGS).toContain("TODO");
    expect(EXTRACT_TAGS).toContain("FIXME");
    expect(EXTRACT_TAGS).toContain("HACK");
    expect(EXTRACT_TAGS).toContain("XXX");
    expect(EXTRACT_TAGS).toContain("BUG");
    expect(EXTRACT_TAGS).toContain("NOTE");
    expect(EXTRACT_TAGS).toHaveLength(6);
  });
});
