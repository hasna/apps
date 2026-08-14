import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolveImports } from "./import-resolver";
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from "fs";
import { dirname, join } from "path";

const TMP = "/tmp/markdown-test-imports";
const OUTSIDE = "/tmp/markdown-test-imports-outside";

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  rmSync(OUTSIDE, { recursive: true, force: true });
});

function writeOmp(name: string, content: string) {
  const filePath = join(TMP, name);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

describe("resolveImports", () => {
  test("parses document with no imports", () => {
    const doc = `# App

---

type: project
id: init

Set up the project.`;

    const result = resolveImports(doc, join(TMP, "main.markdown.md"));
    expect(result.errors).toHaveLength(0);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].type).toBe("project");
    expect(result.cards[0].id).toBe("init");
  });

  test("resolves a single @import", () => {
    writeOmp("schema.markdown.md", `type: table
id: users

| column | type |
|--------|------|
| id     | text |

---

type: table
id: notes

| column | type |
|--------|------|
| id     | text |`);

    const doc = `# App

---

type: project
id: init

---

@import ./schema.markdown.md`;

    writeOmp("main.markdown.md", doc);
    const result = resolveImports(doc, join(TMP, "main.markdown.md"));
    expect(result.errors).toHaveLength(0);
    expect(result.cards).toHaveLength(3); // init + users + notes
    expect(result.cards.map((c) => c.id)).toContain("users");
    expect(result.cards.map((c) => c.id)).toContain("notes");
  });

  test("resolves nested imports (A imports B which imports C)", () => {
    writeOmp("c.markdown.md", `type: table
id: tags

Tags table.`);

    writeOmp("b.markdown.md", `type: table
id: notes

Notes table.

---

@import ./c.markdown.md`);

    const doc = `# App

---

type: project
id: init

---

@import ./b.markdown.md`;

    writeOmp("main.markdown.md", doc);
    const result = resolveImports(doc, join(TMP, "main.markdown.md"));
    expect(result.errors).toHaveLength(0);
    expect(result.cards).toHaveLength(3); // init + notes + tags
    expect(result.cards.map((c) => c.id)).toContain("tags");
  });

  test("detects circular imports", () => {
    writeOmp("a.markdown.md", `type: table
id: a-table

---

@import ./b.markdown.md`);

    writeOmp("b.markdown.md", `type: table
id: b-table

---

@import ./a.markdown.md`);

    const doc = `# App

---

@import ./a.markdown.md`;

    writeOmp("main.markdown.md", doc);
    const result = resolveImports(doc, join(TMP, "main.markdown.md"));
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Circular import");
  });

  test("reports missing import file", () => {
    const doc = `# App

---

@import ./nonexistent.markdown.md`;

    const result = resolveImports(doc, join(TMP, "main.markdown.md"));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Import not found");
  });

  test("rejects absolute imports", () => {
    const importedPath = join(TMP, "absolute.markdown.md");
    writeFileSync(importedPath, `type: table
id: imported`);

    const doc = `# App

---

@import ${importedPath}`;

    const result = resolveImports(doc, join(TMP, "main.markdown.md"));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("absolute imports are not allowed");
    expect(result.cards).toHaveLength(0);
  });

  test("rejects non-.markdown.md imports", () => {
    writeFileSync(join(TMP, "not-markdown.txt"), `type: table
id: imported`);

    const doc = `# App

---

@import ./not-markdown.txt`;

    const result = resolveImports(doc, join(TMP, "main.markdown.md"));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(".markdown.md");
    expect(result.cards).toHaveLength(0);
  });

  test("rejects imports without explicit relative prefix", () => {
    writeOmp("schema.markdown.md", `type: table
id: imported`);

    const doc = `# App

---

@import schema.markdown.md`;

    const result = resolveImports(doc, join(TMP, "main.markdown.md"));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("imports must start with ./ or ../");
    expect(result.cards).toHaveLength(0);
  });

  test("rejects imports that escape the root document boundary", () => {
    mkdirSync(OUTSIDE, { recursive: true });
    writeFileSync(join(OUTSIDE, "shared.markdown.md"), `type: table
id: outside`);

    const doc = `# App

---

@import ../markdown-test-imports-outside/shared.markdown.md`;

    const result = resolveImports(doc, join(TMP, "main.markdown.md"));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("escapes the allowed boundary");
    expect(result.cards).toHaveLength(0);
  });

  test("rejects symlinked imports that escape the root document boundary", () => {
    mkdirSync(OUTSIDE, { recursive: true });
    writeFileSync(join(OUTSIDE, "shared.markdown.md"), `type: table
id: outside`);
    try {
      symlinkSync(OUTSIDE, join(TMP, "link"), "dir");
    } catch {
      return;
    }

    const doc = `# App

---

@import ./link/shared.markdown.md`;

    const result = resolveImports(doc, join(TMP, "main.markdown.md"));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("escapes the allowed boundary");
    expect(result.cards).toHaveLength(0);
  });

  test("allows nested imports to traverse within the root document boundary", () => {
    writeOmp("shared/table.markdown.md", `type: table
id: shared-table

Shared table.`);

    writeOmp("features/feature.markdown.md", `@import ../shared/table.markdown.md`);

    const doc = `# App

---

@import ./features/feature.markdown.md`;

    const result = resolveImports(doc, join(TMP, "main.markdown.md"));
    expect(result.errors).toHaveLength(0);
    expect(result.cards.map((card) => card.id)).toContain("shared-table");
  });

  test("collects patterns from imported files", () => {
    writeOmp("patterns.markdown.md", `@pattern crud(entity)
Standard CRUD for {{entity}}.`);

    const doc = `# App

---

@import ./patterns.markdown.md

---

type: project
id: init`;

    writeOmp("main.markdown.md", doc);
    const result = resolveImports(doc, join(TMP, "main.markdown.md"));
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].name).toBe("crud");
  });

  test("tracks source file on each card", () => {
    writeOmp("extra.markdown.md", `type: table
id: extra-table

Extra table.`);

    const doc = `# App

---

type: project
id: init

---

@import ./extra.markdown.md`;

    writeOmp("main.markdown.md", doc);
    const mainPath = join(TMP, "main.markdown.md");
    const result = resolveImports(doc, mainPath);

    const initCard = result.cards.find((c) => c.id === "init");
    const extraCard = result.cards.find((c) => c.id === "extra-table");
    expect(initCard?.sourceFile).toBe(mainPath);
    expect(extraCard?.sourceFile).toContain("extra.markdown.md");
  });
});
