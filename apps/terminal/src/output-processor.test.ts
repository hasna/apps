import { describe, it, expect } from "bun:test";
import { processOutput, shouldProcess } from "./output-processor.js";

describe("shouldProcess", () => {
  it("returns false for short output", () => {
    expect(shouldProcess("hello world")).toBe(false);
  });

  it("returns true for long output", () => {
    const long = Array(20).fill("line").join("\n");
    expect(shouldProcess(long)).toBe(true);
  });

  it("returns false at exact threshold", () => {
    const lines = Array(15).fill("line").join("\n");
    expect(shouldProcess(lines)).toBe(false);
  });
});

describe("processOutput deterministic summaries", () => {
  it("uses local git status summaries even when a prompt is present", async () => {
    const output = [
      "## main...origin/main",
      ...Array.from({ length: 40 }, (_, i) => ` M src/file-${i}.ts`),
      "?? src/new-file.ts",
    ].join("\n");

    const processed = await processOutput("git status --short --branch", output, "summarize the current changes");
    expect(processed.aiProcessed).toBe(false);
    expect(processed.summary).toContain("41 changed");
    expect(processed.summary).toContain("40 modified");
    expect(processed.tokensSaved).toBeGreaterThan(0);
  });

  it("uses local search summaries for prompt-framed ripgrep output", async () => {
    const output = Array.from({ length: 30 }, (_, i) => `src/file-${i % 3}.test.ts:${i + 1}:describe("case ${i}", () => {})`).join("\n");

    const processed = await processOutput("rg -n \"describe\" src", output, "find TODOs and tests");
    expect(processed.aiProcessed).toBe(false);
    expect(processed.summary).toContain("30 matches in 3 files");
    expect(processed.summary).not.toContain("No results");
    expect(processed.tokensSaved).toBeGreaterThan(0);
  });
});
