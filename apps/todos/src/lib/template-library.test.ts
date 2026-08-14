import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import {
  TEMPLATE_LIBRARY_SCHEMA,
  listTemplateLibrary,
  previewBuiltinTemplate,
  installTemplateLibrary,
  exportTemplateLibraryCatalog,
  getBuiltinTemplate,
  getTemplateLibraryDocs,
} from "./template-library.js";
import { BUILTIN_TEMPLATES } from "../db/builtin-templates.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-tmpl-lib-"));
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("template library", () => {
  it("lists bundled templates with categories", () => {
    const list = listTemplateLibrary();
    expect(list.length).toBe(BUILTIN_TEMPLATES.length);
    expect(list.some((t) => t.name === "release")).toBe(true);
    expect(list.some((t) => t.name === "incident-response")).toBe(true);
    expect(list.every((t) => t.schema_version === TEMPLATE_LIBRARY_SCHEMA)).toBe(true);
  });

  it("previews builtin template with variables", () => {
    const preview = previewBuiltinTemplate("bug-fix", { bug: "auth timeout" });
    expect(preview?.tasks[0]!.title).toContain("auth timeout");
  });

  it("installs library templates idempotently", () => {
    const first = installTemplateLibrary();
    expect(first.created).toBe(BUILTIN_TEMPLATES.length);
    const second = installTemplateLibrary();
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(BUILTIN_TEMPLATES.length);
  });

  it("marks templates installed after init", () => {
    installTemplateLibrary();
    const list = listTemplateLibrary();
    expect(list.every((t) => t.installed)).toBe(true);
  });

  it("exports catalog to file", () => {
    const path = join(tempDir, "catalog.json");
    exportTemplateLibraryCatalog(path);
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.schema_version).toBe(TEMPLATE_LIBRARY_SCHEMA);
  });

  it("includes all required workflow templates", () => {
    const names = BUILTIN_TEMPLATES.map((t) => t.name);
    for (const required of ["bug-fix", "feature-implementation", "release", "security-review", "docs-refresh", "migration", "incident-response"]) {
      expect(names).toContain(required);
    }
  });

  it("documents library", () => {
    expect(getTemplateLibraryDocs()).toContain(TEMPLATE_LIBRARY_SCHEMA);
  });

  it("gets builtin by name", () => {
    expect(getBuiltinTemplate("migration")?.category).toBe("migration");
  });
});
