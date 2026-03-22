import { describe, test, expect } from "bun:test";
import { executeCard } from "./card-executor";
import { MockLLMClient } from "../lib/llm-client.js";
import type { OmpCard, OmpDocument } from "../types/index.js";

function makeCard(overrides: Partial<OmpCard> = {}): OmpCard {
  return {
    type: "custom",
    id: "test",
    depends: [],
    headers: {},
    body: { raw: "Do something.", text: "Do something.", tables: [], inlineDirectives: [] },
    accepts: [],
    sourceFile: "test.omp.md",
    lineNumber: 1,
    ...overrides,
  };
}

function makeDoc(cards: OmpCard[] = []): OmpDocument {
  return { title: "Test", cards, patterns: [], imports: [], errors: [] };
}

describe("executeCard", () => {
  test("tree card generates file/dir actions deterministically", async () => {
    const card = makeCard({
      type: "tree",
      id: "structure",
      body: {
        raw: "src/\n  lib/\n  app/\n    page.tsx\n  index.ts",
        text: "src/\n  lib/\n  app/\n    page.tsx\n  index.ts",
        tables: [],
        inlineDirectives: [],
      },
    });

    const result = await executeCard(card, makeDoc([card]), undefined, "/tmp/omp-test-exec", true);
    expect(result.success).toBe(true);
    expect(result.llmCalls).toBe(0); // fully deterministic
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.actions.some((a) => a.type === "create-dir")).toBe(true);
    expect(result.actions.some((a) => a.type === "create-file")).toBe(true);
  });

  test("endpoint card calls LLM with method/path context", async () => {
    const card = makeCard({
      type: "endpoint",
      id: "list-notes",
      headers: { method: "GET", path: "/api/notes", auth: "required" },
      accepts: ["only user's notes returned"],
    });

    const mock = new MockLLMClient(["// route handler code"]);
    const result = await executeCard(card, makeDoc([card]), mock, "/tmp/test", true);

    expect(result.success).toBe(true);
    expect(result.llmCalls).toBe(1);
    expect(mock.calls[0].prompt).toContain("GET");
    expect(mock.calls[0].prompt).toContain("/api/notes");
    expect(mock.calls[0].prompt).toContain("only user's notes returned");
  });

  test("table card passes columns to LLM", async () => {
    const card = makeCard({
      type: "table",
      id: "users",
      headers: { db: "db" },
      body: {
        raw: "| col | type |\n|-----|------|\n| id | text |\n| name | text |",
        text: "| col | type |\n|-----|------|\n| id | text |\n| name | text |",
        tables: [{ headers: ["col", "type"], rows: [["id", "text"], ["name", "text"]], lineNumber: 1 }],
        inlineDirectives: [],
      },
    });

    const mock = new MockLLMClient(["// schema code"]);
    const result = await executeCard(card, makeDoc([card]), mock, "/tmp/test", true);

    expect(result.success).toBe(true);
    expect(result.llmCalls).toBe(1);
    expect(mock.calls[0].prompt).toContain("id | text");
  });

  test("page card calls LLM with path and auth", async () => {
    const card = makeCard({
      type: "page",
      id: "notes-list",
      headers: { path: "/notes", auth: "required" },
    });

    const mock = new MockLLMClient(["// page component"]);
    const result = await executeCard(card, makeDoc([card]), mock, "/tmp/test", true);

    expect(result.success).toBe(true);
    expect(result.llmCalls).toBe(1);
    expect(mock.calls[0].prompt).toContain("/notes");
  });

  test("card with no LLM produces no llm-generate actions", async () => {
    const card = makeCard({
      type: "endpoint",
      id: "ep",
      headers: { method: "GET", path: "/api" },
    });

    const result = await executeCard(card, makeDoc([card]), undefined, "/tmp/test", true);
    expect(result.success).toBe(true);
    expect(result.llmCalls).toBe(0);
    expect(result.actions.filter((a) => a.type === "llm-generate")).toHaveLength(0);
  });

  test("seed card passes users and sample data to LLM", async () => {
    const card = makeCard({
      type: "seed",
      id: "seed",
      headers: {
        users: ["admin@test.com", "demo@test.com"],
        "sample-notes": 5,
        "sample-tags": ["work", "personal"],
      },
    });

    const mock = new MockLLMClient(["// seed script"]);
    const result = await executeCard(card, makeDoc([card]), mock, "/tmp/test", true);

    expect(result.success).toBe(true);
    expect(result.llmCalls).toBe(1);
    expect(mock.calls[0].prompt).toContain("admin@test.com");
  });

  test("project card creates directory action", async () => {
    const card = makeCard({
      type: "project",
      id: "init",
      headers: { framework: "nextjs@14" },
    });

    const result = await executeCard(card, makeDoc([card]), undefined, "/tmp/test", true);
    expect(result.success).toBe(true);
    expect(result.actions.some((a) => a.type === "create-dir")).toBe(true);
  });

  test("handles execution errors gracefully", async () => {
    const card = makeCard({
      type: "endpoint",
      id: "broken",
      headers: { method: "GET", path: "/api" },
    });

    const errorLLM = new MockLLMClient([]);
    errorLLM.complete = async () => { throw new Error("API down"); };

    const result = await executeCard(card, makeDoc([card]), errorLLM, "/tmp/test", true);
    expect(result.success).toBe(false);
    expect(result.error).toContain("API down");
  });
});
