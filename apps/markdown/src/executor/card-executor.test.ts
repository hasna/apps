import { describe, test, expect } from "bun:test";
import { executeCard } from "./card-executor";
import { MockLLMClient } from "../lib/llm-client.js";
import type { OmpCard, OmpDocument } from "../types/index.js";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function makeCard(overrides: Partial<OmpCard> = {}): OmpCard {
  return {
    type: "custom",
    id: "test",
    depends: [],
    headers: {},
    body: { raw: "Do something.", text: "Do something.", tables: [], inlineDirectives: [] },
    accepts: [],
    sourceFile: "test.markdown.md",
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

    const result = await executeCard(card, makeDoc([card]), undefined, "/tmp/markdown-test-exec", true);
    expect(result.success).toBe(true);
    expect(result.llmCalls).toBe(0); // fully deterministic
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.actions.some((a) => a.type === "create-dir")).toBe(true);
    expect(result.actions.some((a) => a.type === "create-file")).toBe(true);
  });

  test("tree card rejects parent traversal without writing outside output dir", async () => {
    const root = mkdtempSync(join(tmpdir(), "markdown-exec-"));
    const outputDir = join(root, "out");
    try {
      const card = makeCard({
        type: "tree",
        id: "structure",
        body: {
          raw: "../escaped.txt\nsafe.txt",
          text: "../escaped.txt\nsafe.txt",
          tables: [],
          inlineDirectives: [],
        },
      });

      const result = await executeCard(card, makeDoc([card]), undefined, outputDir, false);
      expect(result.success).toBe(false);
      expect(result.error).toContain("parent directory traversal");
      expect(existsSync(join(root, "escaped.txt"))).toBe(false);
      expect(existsSync(join(outputDir, "safe.txt"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("tree card rejects absolute paths", async () => {
    for (const unsafePath of ["/tmp/escaped.txt", "C:\\tmp\\escaped.txt", "\\\\server\\share\\escaped.txt"]) {
      const card = makeCard({
        type: "tree",
        id: "structure",
        body: {
          raw: unsafePath,
          text: unsafePath,
          tables: [],
          inlineDirectives: [],
        },
      });

      const result = await executeCard(card, makeDoc([card]), undefined, "/tmp/markdown-test-exec", true);
      expect(result.success).toBe(false);
      expect(result.error).toContain("absolute paths are not allowed");
    }
  });

  test("tree card rejects backslash parent traversal", async () => {
    const card = makeCard({
      type: "tree",
      id: "structure",
      body: {
        raw: "..\\escaped.txt",
        text: "..\\escaped.txt",
        tables: [],
        inlineDirectives: [],
      },
    });

    const result = await executeCard(card, makeDoc([card]), undefined, "/tmp/markdown-test-exec", true);
    expect(result.success).toBe(false);
    expect(result.error).toContain("parent directory traversal");
  });

  test("tree card rejects symlink escapes beneath output dir", async () => {
    const root = mkdtempSync(join(tmpdir(), "markdown-symlink-"));
    const outputDir = join(root, "out");
    const outsideDir = join(root, "outside");
    try {
      mkdirSync(outputDir, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
      try {
        symlinkSync(outsideDir, join(outputDir, "link"), "dir");
      } catch {
        return;
      }

      const card = makeCard({
        type: "tree",
        id: "structure",
        body: {
          raw: "link/escaped.txt",
          text: "link/escaped.txt",
          tables: [],
          inlineDirectives: [],
        },
      });

      const result = await executeCard(card, makeDoc([card]), undefined, outputDir, false);
      expect(result.success).toBe(false);
      expect(result.error).toContain("symbolic link");
      expect(existsSync(join(outsideDir, "escaped.txt"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  test("functions card rejects unsafe file paths before calling the LLM", async () => {
    const root = mkdtempSync(join(tmpdir(), "markdown-functions-"));
    try {
      for (const file of ["../escaped.ts", "..\\escaped.ts", "/tmp/escaped.ts", "C:\\tmp\\escaped.ts"]) {
        const card = makeCard({
          type: "functions",
          id: `functions-${file}`,
          headers: { file, exports: ["handler"] },
        });
        const mock = new MockLLMClient(["// generated code"]);

        const result = await executeCard(card, makeDoc([card]), mock, join(root, "out"), false);

        expect(result.success).toBe(false);
        expect(result.llmCalls).toBe(0);
        expect(mock.calls).toHaveLength(0);
      }
      expect(existsSync(join(root, "escaped.ts"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("functions card rejects symlink escapes before calling the LLM", async () => {
    const root = mkdtempSync(join(tmpdir(), "markdown-functions-link-"));
    const outputDir = join(root, "out");
    const outsideDir = join(root, "outside");
    try {
      mkdirSync(outputDir, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
      try {
        symlinkSync(outsideDir, join(outputDir, "link"), "dir");
      } catch {
        return;
      }

      const card = makeCard({
        type: "functions",
        id: "functions-link",
        headers: { file: "link/escaped.ts", exports: ["handler"] },
      });
      const mock = new MockLLMClient(["// generated code"]);

      const result = await executeCard(card, makeDoc([card]), mock, outputDir, false);

      expect(result.success).toBe(false);
      expect(result.error).toContain("symbolic link");
      expect(result.llmCalls).toBe(0);
      expect(mock.calls).toHaveLength(0);
      expect(existsSync(join(outsideDir, "escaped.ts"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
