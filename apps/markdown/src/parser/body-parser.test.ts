import { describe, test, expect } from "bun:test";
import { parseBody, extractTables, extractInlineDirectives, extractAccepts } from "./body-parser";

describe("extractTables", () => {
  test("extracts a simple markdown table", () => {
    const raw = `Some text before.

| column | type | constraints |
|--------|------|-------------|
| id     | text | primary key |
| name   | text | not null    |

Some text after.`;

    const tables = extractTables(raw);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(["column", "type", "constraints"]);
    expect(tables[0].rows).toHaveLength(2);
    expect(tables[0].rows[0]).toEqual(["id", "text", "primary key"]);
    expect(tables[0].rows[1]).toEqual(["name", "text", "not null"]);
  });

  test("extracts multiple tables", () => {
    const raw = `| a | b |
|---|---|
| 1 | 2 |

Some text.

| x | y | z |
|---|---|---|
| 3 | 4 | 5 |`;

    const tables = extractTables(raw);
    expect(tables).toHaveLength(2);
    expect(tables[0].headers).toEqual(["a", "b"]);
    expect(tables[1].headers).toEqual(["x", "y", "z"]);
  });

  test("returns empty array when no tables", () => {
    const tables = extractTables("Just some text\nwith no tables.");
    expect(tables).toHaveLength(0);
  });

  test("tracks line numbers", () => {
    const raw = `Line 1
Line 2
| h1 | h2 |
|----|-----|
| a  | b   |`;

    const tables = extractTables(raw, 10);
    expect(tables).toHaveLength(1);
    expect(tables[0].lineNumber).toBe(12); // base 10 + 0-based offset 2
  });
});

describe("extractInlineDirectives", () => {
  test("extracts LLM directive", () => {
    const raw = "Create {{generate 5 realistic note titles}} for the seed.";
    const directives = extractInlineDirectives(raw);
    expect(directives).toHaveLength(1);
    expect(directives[0].content).toBe("generate 5 realistic note titles");
    expect(directives[0].isBuiltinTool).toBe(false);
  });

  test("extracts built-in uuid", () => {
    const directives = extractInlineDirectives("The id is {{uuid}}.");
    expect(directives).toHaveLength(1);
    expect(directives[0].isBuiltinTool).toBe(true);
    expect(directives[0].toolName).toBe("uuid");
  });

  test("extracts built-in random with args", () => {
    const directives = extractInlineDirectives("Password: {{random(32, alphanumeric)}}");
    expect(directives).toHaveLength(1);
    expect(directives[0].isBuiltinTool).toBe(true);
    expect(directives[0].toolName).toBe("random");
    expect(directives[0].toolArgs).toEqual(["32", "alphanumeric"]);
  });

  test("extracts env directive", () => {
    const directives = extractInlineDirectives("Key: {{env:API_KEY}}");
    expect(directives).toHaveLength(1);
    expect(directives[0].isBuiltinTool).toBe(true);
    expect(directives[0].toolName).toBe("env");
    expect(directives[0].toolArgs).toEqual(["API_KEY"]);
  });

  test("extracts ref directive", () => {
    const directives = extractInlineDirectives("DB: {{ref:db.engine}}");
    expect(directives).toHaveLength(1);
    expect(directives[0].isBuiltinTool).toBe(true);
    expect(directives[0].toolName).toBe("ref");
    expect(directives[0].toolArgs).toEqual(["db.engine"]);
  });

  test("extracts count directive", () => {
    const directives = extractInlineDirectives("Total: {{count:endpoint}}");
    expect(directives).toHaveLength(1);
    expect(directives[0].isBuiltinTool).toBe(true);
    expect(directives[0].toolName).toBe("count");
    expect(directives[0].toolArgs).toEqual(["endpoint"]);
  });

  test("extracts timestamp", () => {
    const directives = extractInlineDirectives("Now: {{timestamp}}");
    expect(directives).toHaveLength(1);
    expect(directives[0].isBuiltinTool).toBe(true);
    expect(directives[0].toolName).toBe("timestamp");
  });

  test("extracts hash directive", () => {
    const directives = extractInlineDirectives("Hash: {{hash:sha256:mysecret}}");
    expect(directives).toHaveLength(1);
    expect(directives[0].isBuiltinTool).toBe(true);
    expect(directives[0].toolName).toBe("hash");
    expect(directives[0].toolArgs).toEqual(["sha256", "mysecret"]);
  });

  test("extracts multiple directives mixed", () => {
    const raw = "Use {{uuid}} as id and {{generate a friendly greeting}} as welcome.";
    const directives = extractInlineDirectives(raw);
    expect(directives).toHaveLength(2);
    expect(directives[0].isBuiltinTool).toBe(true);
    expect(directives[1].isBuiltinTool).toBe(false);
  });

  test("captures start/end positions", () => {
    const raw = "Hello {{uuid}} world";
    const directives = extractInlineDirectives(raw);
    expect(directives[0].start).toBe(6);
    expect(directives[0].end).toBe(14);
  });

  test("returns empty array when no directives", () => {
    const directives = extractInlineDirectives("No directives here.");
    expect(directives).toHaveLength(0);
  });
});

describe("extractAccepts", () => {
  test("extracts single accepts line", () => {
    const raw = `Some description.

accepts: passwords hashed; unique emails enforced`;

    const accepts = extractAccepts(raw);
    expect(accepts).toEqual(["passwords hashed", "unique emails enforced"]);
  });

  test("extracts multiple accepts lines", () => {
    const raw = `Description.

accepts: first criterion
accepts: second criterion; third criterion`;

    const accepts = extractAccepts(raw);
    expect(accepts).toEqual(["first criterion", "second criterion", "third criterion"]);
  });

  test("returns empty when no accepts", () => {
    const accepts = extractAccepts("Just text, no accepts.");
    expect(accepts).toHaveLength(0);
  });
});

describe("parseBody", () => {
  test("parses a complete body with tables, directives, and accepts", () => {
    const raw = `Return all notes for {{ref:auth.method}} users.

| param | type   | description |
|-------|--------|-------------|
| q     | string | search term |
| tag   | string | filter tag  |

Filter using {{describe an efficient SQLite search strategy}}.

accepts: only user's notes; search case-insensitive`;

    const body = parseBody(raw);
    expect(body.tables).toHaveLength(1);
    expect(body.tables[0].headers).toEqual(["param", "type", "description"]);
    expect(body.inlineDirectives).toHaveLength(2);
    expect(body.inlineDirectives[0].isBuiltinTool).toBe(true); // ref:
    expect(body.inlineDirectives[1].isBuiltinTool).toBe(false); // LLM
    expect(body.raw).toContain("Return all notes");
  });
});
