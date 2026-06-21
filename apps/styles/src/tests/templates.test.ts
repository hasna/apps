import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  unlinkSync,
  existsSync,
  mkdirSync,
  rmdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "fs";
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

  test("rejects OUTPUT_FILES paths that escape the project directory", () => {
    const escapeName = `escaped-${Date.now()}-${Math.random().toString(36).slice(2)}.css`;
    const escapePath = join(testProjectDir, "..", escapeName);
    const tpl = createTemplate({
      ...FIXTURE_INPUT,
      variables: {
        OUTPUT_FILES: JSON.stringify([{ path: `../${escapeName}`, content: "body { color: red; }" }]),
      },
    });

    const result = applyTemplate(tpl.id, testProjectDir);
    const escapedExists = existsSync(escapePath);
    if (escapedExists) unlinkSync(escapePath);

    expect(result.success).toBe(false);
    expect(result.errors).toContain(`Template output path escapes project directory: ../${escapeName}`);
    expect(escapedExists).toBe(false);
  });

  test("rejects _FILE keys that escape the project directory", () => {
    const escapeName = `escaped-${Date.now()}-${Math.random().toString(36).slice(2)}.css`;
    const escapePath = join(testProjectDir, "..", escapeName);
    const tpl = createTemplate({
      ...FIXTURE_INPUT,
      variables: { [`.._${escapeName}_FILE`]: "body { color: red; }" },
    });

    const result = applyTemplate(tpl.id, testProjectDir);
    const escapedExists = existsSync(escapePath);
    if (escapedExists) unlinkSync(escapePath);

    expect(result.success).toBe(false);
    expect(result.errors).toContain(`Template output path escapes project directory: ../${escapeName}`);
    expect(escapedExists).toBe(false);
  });

  test("rejects output files that escape through a symlinked directory", () => {
    const outsideDir = join(tmpdir(), `styles-tpl-outside-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(outsideDir, { recursive: true });
    symlinkSync(outsideDir, join(testProjectDir, "linked"), "dir");

    const tpl = createTemplate({
      ...FIXTURE_INPUT,
      variables: {
        OUTPUT_FILES: JSON.stringify([{ path: "linked/escaped.css", content: "body { color: red; }" }]),
      },
    });

    try {
      const result = applyTemplate(tpl.id, testProjectDir);
      const escapedPath = join(outsideDir, "escaped.css");
      const escapedExists = existsSync(escapedPath);
      if (escapedExists) unlinkSync(escapedPath);

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Template output path escapes project directory: linked/escaped.css");
      expect(escapedExists).toBe(false);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test("does not overwrite template-provided style context when project path is relative", () => {
    const baseDir = join(tmpdir(), `styles-tpl-relative-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const projectName = "project";
    const stylePath = join(baseDir, projectName, ".styles", "style.md");
    const previousCwd = process.cwd();

    mkdirSync(join(baseDir, projectName), { recursive: true });
    process.chdir(baseDir);

    try {
      const tpl = createTemplate({
        ...FIXTURE_INPUT,
        variables: {
          OUTPUT_FILES: JSON.stringify([{ path: ".styles/style.md", content: "CUSTOM STYLE" }]),
        },
      });

      const result = applyTemplate(tpl.id, projectName);

      expect(result.success).toBe(true);
      expect(readFileSync(stylePath, "utf-8")).toBe("CUSTOM STYLE");
      expect(result.filesCreated.filter((path) => path.endsWith(".styles/style.md")).length).toBe(1);
    } finally {
      process.chdir(previousCwd);
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test("allows in-project output path names that start with two dots", () => {
    const tpl = createTemplate({
      ...FIXTURE_INPUT,
      variables: {
        OUTPUT_FILES: JSON.stringify([{ path: "..generated/theme.css", content: "body { color: green; }" }]),
      },
    });

    const result = applyTemplate(tpl.id, testProjectDir);

    expect(result.success).toBe(true);
    expect(existsSync(join(testProjectDir, "..generated", "theme.css"))).toBe(true);
  });
});
