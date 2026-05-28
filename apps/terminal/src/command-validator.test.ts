import { describe, it, expect } from "bun:test";
import { validateCommand } from "./command-validator.js";

describe("validateCommand", () => {
  it("validates simple commands as valid", () => {
    const result = validateCommand("ls -la", process.cwd());
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("detects unmatched single quotes", () => {
    const result = validateCommand("echo 'hello", process.cwd());
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.includes("single quote"))).toBe(true);
  });

  it("detects unmatched double quotes", () => {
    const result = validateCommand("echo \"hello", process.cwd());
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.includes("double quote"))).toBe(true);
  });

  it("detects unmatched parentheses", () => {
    const result = validateCommand("echo (hello", process.cwd());
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.includes("parentheses"))).toBe(true);
  });

  it("detects pipe with no target", () => {
    const result = validateCommand("echo hello | ", process.cwd());
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.includes("pipe"))).toBe(true);
  });

  it("detects pipe with no source", () => {
    const result = validateCommand("| echo hello", process.cwd());
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.includes("pipe"))).toBe(true);
  });

  it("flags GNU flags on macOS", () => {
    const result = validateCommand("du --max-depth=1", process.cwd());
    expect(result.issues.some(i => i.includes("GNU"))).toBe(true);
  });

  it("flags complex pipe chains", () => {
    const cmd = "echo a | grep a | sed 's/a/b/' | awk '{print}' | sort | uniq | wc -l | cat | head";
    const result = validateCommand(cmd, process.cwd());
    expect(result.issues.some(i => i.includes("too complex"))).toBe(true);
  });

  it("flags grep -P (PCRE) on macOS", () => {
    const result = validateCommand("grep -P 'pattern' file.txt", process.cwd());
    expect(result.issues.some(i => i.includes("grep -P"))).toBe(true);
  });

  it("validates commands with matched quotes as valid", () => {
    const result = validateCommand("echo 'hello world'", process.cwd());
    expect(result.valid).toBe(true);
  });

  it("validates commands with matched parens as valid", () => {
    const result = validateCommand("(echo hello && echo world)", process.cwd());
    expect(result.valid).toBe(true);
  });

  it("skips glob patterns in path checks", () => {
    const result = validateCommand("ls *.ts", process.cwd());
    expect(result.issues.some(i => i.includes("file not found"))).toBe(false);
  });
});
