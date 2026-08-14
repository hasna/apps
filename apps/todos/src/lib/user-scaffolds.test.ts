import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTemplate } from "../db/templates.js";
import {
  USER_SCAFFOLD_SCHEMA,
  createUserScaffold,
  listUserScaffolds,
  previewUserScaffold,
  updateUserScaffold,
  exportUserScaffold,
  importUserScaffold,
  applyUserScaffold,
} from "./user-scaffolds.js";

let tempDir: string;
let prevCwd: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-scaffold-"));
  prevCwd = process.cwd();
  process.chdir(tempDir);
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(tempDir, { recursive: true, force: true });
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("user scaffolds", () => {
  it("creates and lists scaffolds", () => {
    const scaffold = createUserScaffold({ name: "My Plan", kind: "plan", payload: { name: "Sprint {n}" }, variables: [{ name: "n", default: "1" }] });
    expect(scaffold.schema_version).toBe(USER_SCAFFOLD_SCHEMA);
    expect(listUserScaffolds()).toHaveLength(1);
    expect(existsSync(join(tempDir, ".todos", "scaffolds", "store.json"))).toBe(true);
  });

  it("previews with variable substitution", () => {
    createUserScaffold({ name: "Release", kind: "plan", payload: { name: "Release {version}" }, variables: [{ name: "version", default: "1.0" }] });
    const preview = previewUserScaffold("release", { version: "2.0" });
    expect(preview.dry_run).toBe(true);
    expect((preview.preview.plan as { name: string }).name).toBe("Release 2.0");
  });

  it("versions on update", () => {
    const s = createUserScaffold({ name: "Checklist", kind: "checklist", payload: { items: ["a"] } });
    const updated = updateUserScaffold(s.id, { payload: { items: ["a", "b"] } });
    expect(updated.version).toBe(2);
  });

  it("applies task scaffold from linked template", () => {
    const template = createTemplate({ name: "bugfix", title_pattern: "Fix {area}", variables: [{ name: "area", required: true }] });
    createUserScaffold({ name: "Bugfix flow", kind: "task", payload: { template_id: template.id } });
    const result = applyUserScaffold("bugfix-flow", { area: "auth" });
    expect((result.tasks as unknown[]).length).toBeGreaterThan(0);
  });

  it("exports and imports scaffold bundle", () => {
    const template = createTemplate({ name: "feature", title_pattern: "Build {feature}" });
    createUserScaffold({
      name: "Feature",
      kind: "task",
      template_export: {
        name: template.name,
        title_pattern: template.title_pattern,
        priority: template.priority,
        tags: template.tags,
        variables: template.variables,
        metadata: template.metadata,
        tasks: [],
      },
    });

    const exported = exportUserScaffold("feature");
    rmSync(join(tempDir, ".todos", "scaffolds"), { recursive: true, force: true });
    const imported = importUserScaffold(exported, "overwrite");
    expect(imported.name).toBe("Feature");
  });
});
