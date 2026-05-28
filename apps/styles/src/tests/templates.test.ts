import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync, mkdirSync, rmdirSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  createTemplate,
  getTemplate,
  listTemplates,
  deleteTemplate,
  applyTemplate,
} from "../lib/templates.js";
import { resetDb, setDbPath } from "../lib/db.js";

let testDbPath = "";
let testProjectDir = "";

beforeEach(() => {
  testDbPath = join(tmpdir(), `styles-templates-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  testProjectDir = join(tmpdir(), `styles-tpl-proj-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testProjectDir, { recursive: true });
  setDbPath(testDbPath);
});

function rmRecursive(dir: string) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      rmRecursive(p);
    } else {
      unlinkSync(p);
    }
  }
  rmdirSync(dir);
}

afterEach(() => {
  resetDb();
  if (existsSync(testDbPath)) unlinkSync(testDbPath);
  for (const suffix of ["-wal", "-shm"]) {
    const p = testDbPath + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
  if (existsSync(testProjectDir)) {
    rmRecursive(testProjectDir);
  }
});

const FIXTURE_INPUT = {
  name: "basic-button",
  description: "A button template",
  styleProfileId: "builtin:minimalist",
  variables: {},
};

describe("templates CRUD", () => {
  test("createTemplate returns template with id", () => {
    const tpl = createTemplate(FIXTURE_INPUT);
    expect(tpl.id).toBeDefined();
    expect(tpl.name).toBe("basic-button");
    expect(tpl.createdAt).toBeGreaterThan(0);
  });

  test("getTemplate returns null for unknown id", () => {
    expect(getTemplate("nonexistent")).toBeNull();
  });

  test("getTemplate retrieves saved template", () => {
    const created = createTemplate(FIXTURE_INPUT);
    const retrieved = getTemplate(created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe("basic-button");
  });

  test("listTemplates returns all templates", () => {
    createTemplate({ ...FIXTURE_INPUT, name: "tpl-a" });
    createTemplate({ ...FIXTURE_INPUT, name: "tpl-b" });
    expect(listTemplates().length).toBe(2);
  });

  test("listTemplates filters by profileId", () => {
    createTemplate({ ...FIXTURE_INPUT, styleProfileId: "builtin:brutalist", name: "brutal-tpl" });
    createTemplate(FIXTURE_INPUT);
    const filtered = listTemplates("builtin:minimalist");
    expect(filtered.length).toBe(1);
  });

  test("deleteTemplate removes template", () => {
    const tpl = createTemplate(FIXTURE_INPUT);
    deleteTemplate(tpl.id);
    expect(getTemplate(tpl.id)).toBeNull();
  });
});

describe("applyTemplate", () => {
  test("returns error for unknown template", () => {
    const result = applyTemplate("nonexistent", testProjectDir);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("creates .styles/style.md by default", () => {
    const tpl = createTemplate(FIXTURE_INPUT);
    const result = applyTemplate(tpl.id, testProjectDir);
    expect(result.success).toBe(true);
    expect(result.filesCreated.length).toBeGreaterThan(0);
    const styleMdExists = result.filesCreated.some((f) => f.endsWith("style.md"));
    expect(styleMdExists).toBe(true);
  });

  test("creates output files from OUTPUT_FILES variable", () => {
    const files = [{ path: "css/theme.css", content: ":root { --color: {{ primaryColor }}; }" }];
    const tpl = createTemplate({
      ...FIXTURE_INPUT,
      variables: { OUTPUT_FILES: JSON.stringify(files), primaryColor: "#000" },
    });
    const result = applyTemplate(tpl.id, testProjectDir);
    expect(result.success).toBe(true);
    // Should have created css/theme.css + .styles/style.md
    const themeExists = result.filesCreated.some((f) => f.endsWith("theme.css"));
    expect(themeExists).toBe(true);
  });

  test("interpolates variables in file content", () => {
    const files = [{ path: "theme.css", content: "primary: {{ primary }};" }];
    const tpl = createTemplate({
      ...FIXTURE_INPUT,
      variables: { OUTPUT_FILES: JSON.stringify(files), primary: "#1a1a2e" },
    });
    applyTemplate(tpl.id, testProjectDir);
    // Content should be interpolated
    const result = applyTemplate(tpl.id, testProjectDir);
    expect(result.success).toBe(true);
  });

  test("handles _FILE suffix keys", () => {
    const tpl = createTemplate({
      ...FIXTURE_INPUT,
      variables: { "css_theme_FILE": ":root { --color: blue; }" },
    });
    const result = applyTemplate(tpl.id, testProjectDir);
    expect(result.success).toBe(true);
  });
});
