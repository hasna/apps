import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolveImports } from "./import-resolver";
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from "fs";
import { dirname, join } from "path";

const TMP = "/tmp/omp-test-imports";
const OUTSIDE = "/tmp/omp-test-imports-outside";

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

    const result = resolveImports(doc, join(TMP, "main.omp.md"));
    expect(result.errors).toHaveLength(0);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].type).toBe("project");
    expect(result.cards[0].id).toBe("init");
  });

  test("resolves a single @import", () => {
    writeOmp("schema.omp.md", `type: table
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

@import ./schema.omp.md`;

    writeOmp("main.omp.md", doc);
    const result = resolveImports(doc, join(TMP, "main.omp.md"));
    expect(result.errors).toHaveLength(0);
    expect(result.cards).toHaveLength(3); // init + users + notes
    expect(result.cards.map((c) => c.id)).toContain("users");
    expect(result.cards.map((c) => c.id)).toContain("notes");
  });

  test("resolves nested imports (A imports B which imports C)", () => {
    writeOmp("c.omp.md", `type: table
id: tags

Tags table.`);

    writeOmp("b.omp.md", `type: table
id: notes

Notes table.

---

@import ./c.omp.md`);

    const doc = `# App

---

type: project
id: init

---

@import ./b.omp.md`;

    writeOmp("main.omp.md", doc);
    const result = resolveImports(doc, join(TMP, "main.omp.md"));
    expect(result.errors).toHaveLength(0);
    expect(result.cards).toHaveLength(3); // init + notes + tags
    expect(result.cards.map((c) => c.id)).toContain("tags");
  });

  test("detects circular imports", () => {
    writeOmp("a.omp.md", `type: table
id: a-table

---

@import ./b.omp.md`);

    writeOmp("b.omp.md", `type: table
id: b-table

---

@import ./a.omp.md`);

    const doc = `# App

---

@import ./a.omp.md`;

    writeOmp("main.omp.md", doc);
    const result = resolveImports(doc, join(TMP, "main.omp.md"));
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Circular import");
  });

  test("reports missing import file", () => {
    const doc = `# App

---

@import ./nonexistent.omp.md`;

    const result = resolveImports(doc, join(TMP, "main.omp.md"));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Import not found");
  });

  test("rejects absolute imports", () => {
    const importedPath = join(TMP, "absolute.omp.md");
    writeFileSync(importedPath, `type: table
id: imported`);

    const doc = `# App

---

@import ${importedPath}`;

    const result = resolveImports(doc, join(TMP, "main.omp.md"));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("absolute imports are not allowed");
    expect(result.cards).toHaveLength(0);
  });

  test("rejects non-.omp.md imports", () => {
    writeFileSync(join(TMP, "not-omp.txt"), `type: table
id: imported`);

    const doc = `# App

---

@import ./not-omp.txt`;

    const result = resolveImports(doc, join(TMP, "main.omp.md"));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(".omp.md");
    expect(result.cards).toHaveLength(0);
  });

  test("rejects imports without explicit relative prefix", () => {
    writeOmp("schema.omp.md", `type: table
id: imported`);

    const doc = `# App

---

@import schema.omp.md`;

    const result = resolveImports(doc, join(TMP, "main.omp.md"));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("imports must start with ./ or ../");
    expect(result.cards).toHaveLength(0);
  });

  test("rejects imports that escape the root document boundary", () => {
    mkdirSync(OUTSIDE, { recursive: true });
    writeFileSync(join(OUTSIDE, "shared.omp.md"), `type: table
id: outside`);

    const doc = `# App

---

@import ../omp-test-imports-outside/shared.omp.md`;

    const result = resolveImports(doc, join(TMP, "main.omp.md"));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("escapes the allowed boundary");
    expect(result.cards).toHaveLength(0);
  });

  test("rejects symlinked imports that escape the root document boundary", () => {
    mkdirSync(OUTSIDE, { recursive: true });
    writeFileSync(join(OUTSIDE, "shared.omp.md"), `type: table
id: outside`);
    try {
      symlinkSync(OUTSIDE, join(TMP, "link"), "dir");
    } catch {
      return;
    }

    const doc = `# App

---

@import ./link/shared.omp.md`;

    const result = resolveImports(doc, join(TMP, "main.omp.md"));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("escapes the allowed boundary");
    expect(result.cards).toHaveLength(0);
  });

  test("allows nested imports to traverse within the root document boundary", () => {
    writeOmp("shared/table.omp.md", `type: table
id: shared-table

Shared table.`);

    writeOmp("features/feature.omp.md", `@import ../shared/table.omp.md`);

    const doc = `# App

---

@import ./features/feature.omp.md`;

    const result = resolveImports(doc, join(TMP, "main.omp.md"));
    expect(result.errors).toHaveLength(0);
    expect(result.cards.map((card) => card.id)).toContain("shared-table");
  });

  test("collects patterns from imported files", () => {
    writeOmp("patterns.omp.md", `@pattern crud(entity)
Standard CRUD for {{entity}}.`);

    const doc = `# App

---

@import ./patterns.omp.md

---

type: project
id: init`;

    writeOmp("main.omp.md", doc);
    const result = resolveImports(doc, join(TMP, "main.omp.md"));
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].name).toBe("crud");
  });

  test("tracks source file on each card", () => {
    writeOmp("extra.omp.md", `type: table
id: extra-table

Extra table.`);

    const doc = `# App

---

type: project
id: init

---

@import ./extra.omp.md`;

    writeOmp("main.omp.md", doc);
    const mainPath = join(TMP, "main.omp.md");
    const result = resolveImports(doc, mainPath);

    const initCard = result.cards.find((c) => c.id === "init");
    const extraCard = result.cards.find((c) => c.id === "extra-table");
    expect(initCard?.sourceFile).toBe(mainPath);
    expect(extraCard?.sourceFile).toContain("extra.omp.md");
  });
});
