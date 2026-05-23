import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { createRunRecord } from "../lib/run-records.js";
import {
  parseMentions,
  resolveMention,
  resolveMentionsInText,
  formatResolvedMention,
  MENTION_RESOLVER_SCHEMA,
} from "./mention-resolver.js";

let tempDir: string;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
  tempDir = mkdtempSync(join(tmpdir(), "mention-resolver-"));
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("parseMentions", () => {
  it("extracts explicit @kind mentions", () => {
    const text = "See @file:src/foo.ts and @task:abc12345 for @plan:launch";
    const mentions = parseMentions(text);
    expect(mentions.map((m) => m.kind)).toEqual(["file", "task", "plan"]);
    expect(mentions[0]?.target).toBe("src/foo.ts");
  });

  it("extracts GitHub PR URLs and generic URLs", () => {
    const text = "Fix in https://github.com/org/repo/pull/99 and docs at https://example.com/doc";
    const mentions = parseMentions(text);
    expect(mentions.some((m) => m.kind === "pr" && m.target === "99")).toBe(true);
    expect(mentions.some((m) => m.kind === "url")).toBe(true);
  });
});

describe("resolveMention — file", () => {
  it("resolves an existing file with line snippet", () => {
    const filePath = join(tempDir, "src", "demo.ts");
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(filePath, "line1\nline2\nline3\n");

    const resolved = resolveMention("file", "src/demo.ts:2", { cwd: tempDir, redact: false });
    expect(resolved.status).toBe("resolved");
    expect(resolved.link).toContain("file://");
    expect(resolved.snippet).toContain("2: line2");
  });

  it("returns missing for unknown file", () => {
    const resolved = resolveMention("file", "missing.ts", { cwd: tempDir, redact: false });
    expect(resolved.status).toBe("missing");
  });

  it("returns ambiguous when basename matches multiple files", () => {
    mkdirSync(join(tempDir, "a"), { recursive: true });
    mkdirSync(join(tempDir, "b"), { recursive: true });
    writeFileSync(join(tempDir, "a", "dup.ts"), "a");
    writeFileSync(join(tempDir, "b", "dup.ts"), "b");

    const resolved = resolveMention("file", "dup.ts", { cwd: tempDir, redact: false });
    expect(resolved.status).toBe("ambiguous");
    expect(resolved.candidates?.length).toBe(2);
  });
});

describe("resolveMention — symbol", () => {
  it("resolves a function symbol", () => {
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(join(tempDir, "src", "lib.ts"), "export function greet() {}\n");

    const resolved = resolveMention("symbol", "greet", { cwd: tempDir, redact: false });
    expect(resolved.status).toBe("resolved");
    expect(resolved.link).toContain("#L");
    expect(resolved.snippet).toContain("function greet");
  });

  it("returns missing for unknown symbol", () => {
    const resolved = resolveMention("symbol", "doesNotExist", { cwd: tempDir, redact: false });
    expect(resolved.status).toBe("missing");
  });
});

describe("resolveMention — task plan run", () => {
  it("resolves task by partial id", () => {
    const task = createTask({ title: "Resolver task" });
    const resolved = resolveMention("task", task.id.slice(0, 8), { redact: false });
    expect(resolved.status).toBe("resolved");
    expect(resolved.link).toBe(`todos://task/${task.id}`);
    expect(resolved.snippet).toBe("Resolver task");
  });

  it("returns missing for unknown task", () => {
    const resolved = resolveMention("task", "00000000", { redact: false });
    expect(resolved.status).toBe("missing");
  });

  it("resolves plan by name", () => {
    const plan = createPlan({ name: "Launch Plan" });
    const resolved = resolveMention("plan", "launch-plan", { redact: false });
    expect(resolved.status).toBe("resolved");
    expect(resolved.context?.id).toBe(plan.id);
  });

  it("resolves run record by partial id", () => {
    const run = createRunRecord({ objective: "test run" });
    const resolved = resolveMention("run", run.id.slice(0, 8), { redact: false });
    expect(resolved.status).toBe("resolved");
    expect(resolved.link).toBe(`todos://run/${run.id}`);
  });
});

describe("resolveMention — git refs", () => {
  it("resolves current repo HEAD commit when in git checkout", () => {
    const repoRoot = process.cwd();
    const resolved = resolveMention("commit", "HEAD", { cwd: repoRoot, redact: false });
    if (resolved.status === "resolved") {
      expect(resolved.context?.sha).toBeTruthy();
      expect(resolved.snippet).toBeTruthy();
    }
  });

  it("resolves PR number locally when gh is unavailable", () => {
    const resolved = resolveMention("pr", "42", { cwd: tempDir, redact: false });
    expect(resolved.status).toBe("resolved");
    expect(resolved.link).toContain("42");
  });
});

describe("resolveMentionsInText", () => {
  it("resolves all mentions in text with schema version", () => {
    const task = createTask({ title: "Linked" });
    const filePath = join(tempDir, "note.md");
    writeFileSync(filePath, "hello");

    const text = `Task @task:${task.id.slice(0, 8)} file @file:note.md`;
    const result = resolveMentionsInText(text, { cwd: tempDir, redact: false });
    expect(result.schema_version).toBe(MENTION_RESOLVER_SCHEMA);
    expect(result.mentions).toHaveLength(2);
    expect(result.mentions.every((m) => m.status === "resolved")).toBe(true);
  });

  it("redacts secrets in output text by default", () => {
    const text = "token=sk-1234567890abcdef in @url:https://example.com";
    const result = resolveMentionsInText(text, { cwd: tempDir });
    expect(result.redacted_text).toContain("[REDACTED]");
    expect(result.redacted_text).not.toContain("sk-1234567890abcdef");
  });
});

describe("formatResolvedMention", () => {
  it("includes ambiguous candidates in formatted output", () => {
    const line = formatResolvedMention({
      schema_version: MENTION_RESOLVER_SCHEMA,
      raw: "@file:dup.ts",
      kind: "file",
      target: "dup.ts",
      status: "ambiguous",
      candidates: ["a/dup.ts", "b/dup.ts"],
    });
    expect(line).toContain("ambiguous");
    expect(line).toContain("a/dup.ts");
  });
});
