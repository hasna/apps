import { describe, test, expect } from "bun:test";
import { resolveBuiltinTool, resolveInlineDirectives } from "./inline-executor";
import { MockLLMClient } from "../lib/llm-client.js";
import type { OmpCard, OmpDocument, OmpInlineDirective } from "../types/index.js";

function makeDirective(overrides: Partial<OmpInlineDirective> = {}): OmpInlineDirective {
  return {
    raw: "{{test}}",
    content: "test",
    isBuiltinTool: true,
    toolName: "uuid",
    toolArgs: [],
    start: 0,
    end: 8,
    ...overrides,
  };
}

function makeCard(overrides: Partial<OmpCard> = {}): OmpCard {
  return {
    type: "custom",
    id: "test-card",
    depends: [],
    headers: {},
    body: { raw: "", text: "", tables: [], inlineDirectives: [] },
    accepts: [],
    sourceFile: "test.omp.md",
    lineNumber: 1,
    ...overrides,
  };
}

function makeDoc(cards: OmpCard[] = []): OmpDocument {
  return { title: "Test", cards, patterns: [], imports: [], errors: [] };
}

describe("resolveBuiltinTool", () => {
  test("uuid generates valid UUID", () => {
    const dir = makeDirective({ toolName: "uuid", toolArgs: [] });
    const result = resolveBuiltinTool(dir, makeCard(), makeDoc());
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("random generates string of correct length", () => {
    const dir = makeDirective({ toolName: "random", toolArgs: ["16", "alphanumeric"] });
    const result = resolveBuiltinTool(dir, makeCard(), makeDoc());
    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[A-Za-z0-9]+$/);
  });

  test("random with hex charset", () => {
    const dir = makeDirective({ toolName: "random", toolArgs: ["8", "hex"] });
    const result = resolveBuiltinTool(dir, makeCard(), makeDoc());
    expect(result).toHaveLength(8);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  test("timestamp returns ISO string", () => {
    const dir = makeDirective({ toolName: "timestamp", toolArgs: [] });
    const result = resolveBuiltinTool(dir, makeCard(), makeDoc());
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("timestamp with format", () => {
    const dir = makeDirective({ toolName: "timestamp", toolArgs: ["YYYY-MM-DD"] });
    const result = resolveBuiltinTool(dir, makeCard(), makeDoc());
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("env reads environment variable", () => {
    process.env.__OMP_TEST_VAR = "hello123";
    const dir = makeDirective({ toolName: "env", toolArgs: ["__OMP_TEST_VAR"] });
    const result = resolveBuiltinTool(dir, makeCard(), makeDoc());
    expect(result).toBe("hello123");
    delete process.env.__OMP_TEST_VAR;
  });

  test("env throws on missing variable", () => {
    const dir = makeDirective({ toolName: "env", toolArgs: ["__NONEXISTENT_VAR_12345"] });
    expect(() => resolveBuiltinTool(dir, makeCard(), makeDoc())).toThrow("not set");
  });

  test("ref reads another card's header", () => {
    const dbCard = makeCard({ id: "db", headers: { engine: "sqlite" } });
    const card = makeCard({ id: "test", depends: ["db"] });
    const doc = makeDoc([dbCard, card]);
    const dir = makeDirective({ toolName: "ref", toolArgs: ["db.engine"] });
    const result = resolveBuiltinTool(dir, card, doc);
    expect(result).toBe("sqlite");
  });

  test("ref returns placeholder for missing card", () => {
    const dir = makeDirective({ toolName: "ref", toolArgs: ["nonexistent.key"] });
    const result = resolveBuiltinTool(dir, makeCard(), makeDoc());
    expect(result).toContain("not found");
  });

  test("count counts cards by type", () => {
    const cards = [
      makeCard({ id: "a", type: "endpoint" }),
      makeCard({ id: "b", type: "endpoint" }),
      makeCard({ id: "c", type: "table" }),
    ];
    const dir = makeDirective({ toolName: "count", toolArgs: ["endpoint"] });
    const result = resolveBuiltinTool(dir, makeCard(), makeDoc(cards));
    expect(result).toBe("2");
  });

  test("index returns repeat index", () => {
    const dir = makeDirective({ toolName: "index", toolArgs: [] });
    const result = resolveBuiltinTool(dir, makeCard(), makeDoc(), 3);
    expect(result).toBe("3");
  });

  test("hash generates sha256", () => {
    const dir = makeDirective({ toolName: "hash", toolArgs: ["sha256", "hello"] });
    const result = resolveBuiltinTool(dir, makeCard(), makeDoc());
    expect(result).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});

describe("resolveInlineDirectives", () => {
  test("resolves mixed built-in and LLM directives", async () => {
    const card = makeCard({
      id: "seed",
      body: {
        raw: "ID: {{uuid}} Name: {{generate a name}}",
        text: "ID: {{uuid}} Name: {{generate a name}}",
        tables: [],
        inlineDirectives: [
          { raw: "{{uuid}}", content: "uuid", isBuiltinTool: true, toolName: "uuid", toolArgs: [], start: 4, end: 12 },
          { raw: "{{generate a name}}", content: "generate a name", isBuiltinTool: false, start: 19, end: 38 },
        ],
      },
    });

    const mock = new MockLLMClient(["Alice"]);
    const result = await resolveInlineDirectives(card, makeDoc([card]), mock);

    expect(result).toMatch(/^ID: [0-9a-f-]+ Name: Alice$/);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].prompt).toBe("generate a name");
  });

  test("leaves placeholder when no LLM provided", async () => {
    const card = makeCard({
      body: {
        raw: "Hello {{suggest greeting}}",
        text: "Hello {{suggest greeting}}",
        tables: [],
        inlineDirectives: [
          { raw: "{{suggest greeting}}", content: "suggest greeting", isBuiltinTool: false, start: 6, end: 26 },
        ],
      },
    });

    const result = await resolveInlineDirectives(card, makeDoc([card]));
    expect(result).toContain("[LLM: suggest greeting]");
  });

  test("handles card with no directives", async () => {
    const card = makeCard({
      body: { raw: "Plain text only.", text: "Plain text only.", tables: [], inlineDirectives: [] },
    });

    const result = await resolveInlineDirectives(card, makeDoc([card]));
    expect(result).toBe("Plain text only.");
  });
});
