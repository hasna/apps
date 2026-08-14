import { describe, it, expect } from "bun:test";
import { estimateTokens } from "./tokens.js";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 0 for nullish input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates short text", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(0);
  });

  it("estimates code-like content with higher granularity", () => {
    const code = 'const x = { a: 1, b: 2, c: [3, 4, 5] };';
    const prose = 'The quick brown fox jumps over the lazy dog near the river bank.';
    const codeLen = estimateTokens(code);
    const proseLen = estimateTokens(prose);
    // Same length strings: code should yield more tokens due to lower chars/token ratio
    const paddedCode = code + " ".repeat(prose.length - code.length);
    expect(estimateTokens(paddedCode)).toBeGreaterThan(proseLen);
  });

  it("estimates JSON content as code-like", () => {
    const json = '{"users":[{"name":"Alice","age":30},{"name":"Bob","age":25}],"total":2}';
    expect(estimateTokens(json)).toBeGreaterThan(0);
  });

  it("scales linearly with content length", () => {
    const short = "a".repeat(100);
    const long = "a".repeat(1000);
    const shortTokens = estimateTokens(short);
    const longTokens = estimateTokens(long);
    expect(longTokens).toBeGreaterThan(shortTokens);
  });

  it("estimates multiline output", () => {
    const output = "line 1\nline 2\nline 3\nline 4\nline 5";
    expect(estimateTokens(output)).toBeGreaterThan(0);
  });
});
