import { describe, it, expect } from "bun:test";
import { stripAnsi, compress } from "./compression.js";

describe("stripAnsi", () => {
  it("strips basic color codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("strips bold codes", () => {
    expect(stripAnsi("\x1b[1mbold\x1b[0m")).toBe("bold");
  });

  it("strips multiple codes in one string", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m")).toBe("red green");
  });

  it("strips OSC sequences (window titles)", () => {
    expect(stripAnsi("\x1b]0;title\x07text")).toBe("text");
  });

  it("passes through plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("strips complex SGR sequences", () => {
    expect(stripAnsi("\x1b[38;5;200mcolored\x1b[0m")).toBe("colored");
  });
});

describe("compress", () => {
  it("passes through short output with no maxTokens", () => {
    const result = compress("echo hello", "hello world");
    expect(result.content).toBe("hello world");
    expect(result.originalTokens).toBe(result.compressedTokens);
  });

  it("strips ANSI codes when compressing", () => {
    const result = compress("echo hello", "\x1b[31mcolored\x1b[0m text");
    expect(result.content).toContain("colored text");
    expect(result.content).not.toContain("\x1b");
  });

  it("deduplicates consecutive similar lines", () => {
    const lines = Array(30).fill("Compiling module").map((_, i) => `Compiling module ${i + 1}`);
    const result = compress("build", lines.join("\n"));
    expect(result.content).toContain("similar lines");
  });

  it("does not deduplicate when there are few lines", () => {
    const result = compress("echo", "line 1\nline 2");
    expect(result.content).not.toContain("similar lines");
  });

  it("reports tokens saved", () => {
    const result = compress("echo", "short");
    expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
    expect(result.savingsPercent).toBeGreaterThanOrEqual(0);
  });

  it("truncates when maxTokens is set", () => {
    const long = Array(200).fill("test line").map((_, i) => `Line ${i} of output data`).join("\n");
    const result = compress("long", long, { maxTokens: 20 });
    expect(result.compressedTokens).toBeLessThanOrEqual(25); // some tolerance
  });

  it("does not strip ANSI when stripAnsi is false", () => {
    const result = compress("echo", "\x1b[31mtest\x1b[0m", { stripAnsi: false });
    expect(result.content).toContain("\x1b");
  });

  it("handles empty output", () => {
    const result = compress("echo", "");
    expect(result.content).toBe("");
  });

  it("calculates originalTokens correctly", () => {
    const input = "some output text here";
    const result = compress("echo", input);
    expect(result.originalTokens).toBeGreaterThan(0);
  });
});
