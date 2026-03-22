import { describe, test, expect } from "bun:test";
import { buildPrompt, MockLLMClient } from "./llm-client";
import type { OmpCard, CardContext } from "../types/index.js";

function makeCard(overrides: Partial<OmpCard> = {}): OmpCard {
  return {
    type: "endpoint",
    id: "list-notes",
    depends: [],
    headers: { method: "GET", path: "/api/notes" },
    body: { raw: "Return all notes.", text: "Return all notes.", tables: [], inlineDirectives: [] },
    accepts: ["only user's notes returned"],
    sourceFile: "test.omp.md",
    lineNumber: 1,
    ...overrides,
  };
}

describe("buildPrompt", () => {
  test("builds prompt without context", () => {
    const prompt = buildPrompt("generate 5 note titles");
    expect(prompt).toContain("generate 5 note titles");
    expect(prompt).toContain("Open Markdown Protocol");
    expect(prompt).toContain("ONLY the answer");
  });

  test("includes card type and id", () => {
    const context: CardContext = {
      card: makeCard(),
      relatedCards: [],
      document: { title: "Test", cards: [], patterns: [], imports: [], errors: [] },
    };
    const prompt = buildPrompt("suggest an icon", context);
    expect(prompt).toContain("Card type: endpoint");
    expect(prompt).toContain("Card id: list-notes");
  });

  test("includes structured header data", () => {
    const context: CardContext = {
      card: makeCard(),
      relatedCards: [],
      document: { title: "Test", cards: [], patterns: [], imports: [], errors: [] },
    };
    const prompt = buildPrompt("describe search strategy", context);
    expect(prompt).toContain("method: GET");
    expect(prompt).toContain("path: /api/notes");
  });

  test("includes accepts as constraints", () => {
    const context: CardContext = {
      card: makeCard(),
      relatedCards: [],
      document: { title: "Test", cards: [], patterns: [], imports: [], errors: [] },
    };
    const prompt = buildPrompt("describe search", context);
    expect(prompt).toContain("only user's notes returned");
  });

  test("includes related cards", () => {
    const related = makeCard({ type: "table", id: "notes-table", body: { raw: "Notes schema.", text: "Notes schema.", tables: [], inlineDirectives: [] } });
    const context: CardContext = {
      card: makeCard(),
      relatedCards: [related],
      document: { title: "Test", cards: [], patterns: [], imports: [], errors: [] },
    };
    const prompt = buildPrompt("describe query", context);
    expect(prompt).toContain("[table:notes-table]");
    expect(prompt).toContain("Notes schema.");
  });
});

describe("MockLLMClient", () => {
  test("returns configured responses", async () => {
    const client = new MockLLMClient(["hello", "world"]);
    expect(await client.complete("first")).toBe("hello");
    expect(await client.complete("second")).toBe("world");
  });

  test("cycles through responses", async () => {
    const client = new MockLLMClient(["only-one"]);
    expect(await client.complete("a")).toBe("only-one");
    expect(await client.complete("b")).toBe("only-one");
  });

  test("records calls", async () => {
    const client = new MockLLMClient(["resp"]);
    await client.complete("my prompt");
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].prompt).toBe("my prompt");
  });
});
