import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { parseFromString, validate, compile, run } from "./pipeline";
import { MockLLMClient } from "./llm-client.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

const TMP = "/tmp/omp-pipeline-test";

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("parseFromString", () => {
  test("parses a simple OMP document", () => {
    const doc = parseFromString(`# MyApp

---

type: project
id: init
framework: nextjs

Set up the project.

---

type: database
id: db
engine: sqlite
depends: init

Configure database.`);

    expect(doc.title).toBe("MyApp");
    expect(doc.cards).toHaveLength(2);
    expect(doc.cards[0].type).toBe("project");
    expect(doc.cards[0].id).toBe("init");
    expect(doc.cards[1].type).toBe("database");
    expect(doc.cards[1].depends).toEqual(["init"]);
  });

  test("parses cards with tables", () => {
    const doc = parseFromString(`# App

---

type: table
id: users
db: db

| column | type |
|--------|------|
| id     | text |
| email  | text |

Users table.`);

    expect(doc.cards).toHaveLength(1);
    expect(doc.cards[0].body.tables).toHaveLength(1);
    expect(doc.cards[0].body.tables[0].headers).toEqual(["column", "type"]);
  });

  test("parses cards with inline directives", () => {
    const doc = parseFromString(`# App

---

type: seed
id: seed

Password: {{random(32, alphanumeric)}}
Welcome message: {{generate a friendly greeting}}`);

    expect(doc.cards).toHaveLength(1);
    expect(doc.cards[0].body.inlineDirectives).toHaveLength(2);
    expect(doc.cards[0].body.inlineDirectives[0].isBuiltinTool).toBe(true);
    expect(doc.cards[0].body.inlineDirectives[1].isBuiltinTool).toBe(false);
  });

  test("parses accepts lines", () => {
    const doc = parseFromString(`# App

---

type: endpoint
id: list
method: GET
path: /api/notes

Return notes.

accepts: only user's notes; sorted by date`);

    expect(doc.cards[0].accepts).toEqual(["only user's notes", "sorted by date"]);
  });
});

describe("validate", () => {
  test("valid document has no errors", () => {
    const doc = parseFromString(`# App

---

type: project
id: init

Setup.

---

type: database
id: db
engine: sqlite
depends: init

DB.`);

    const errors = validate(doc).filter((e) => e.level === "error");
    expect(errors).toHaveLength(0);
  });

  test("detects missing required keys", () => {
    const doc = parseFromString(`# App

---

type: endpoint
id: bad-endpoint

Missing method and path.`);

    const errors = validate(doc).filter((e) => e.level === "error");
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("compile", () => {
  test("compiles execution plan from DAG", () => {
    const doc = parseFromString(`# App

---

type: project
id: init

Setup.

---

type: database
id: db
depends: init

DB.

---

type: endpoint
id: api
method: GET
path: /api
depends: db

API.`);

    const plan = compile(doc);
    expect(plan.totalCards).toBe(3);
    expect(plan.steps).toHaveLength(3);
  });
});

describe("run (e2e)", () => {
  test("runs a simple document with dry-run", async () => {
    const filePath = join(TMP, "test.omp.md");
    writeFileSync(filePath, `# TestApp

---

type: project
id: init
framework: nextjs

Set up the project.

---

type: database
id: db
engine: sqlite
depends: init

Configure the database connection.`);

    const result = await run(filePath, {
      outputDir: TMP,
      dryRun: true,
      llm: new MockLLMClient(["// generated code"]),
    });

    expect(result.success).toBe(true);
    expect(result.cardsExecuted).toBe(2);
    expect(result.cardsTotal).toBe(2);
  });
});
