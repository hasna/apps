import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync, rmdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { FileViolation } from "../lib/health.js";

import { getFixSuggestions, applyFixes } from "../lib/fixer.js";

let testDir = "";

beforeEach(() => {
  testDir = join(tmpdir(), `styles-fixer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    for (const f of ["test.tsx", "test2.tsx"]) {
      const p = join(testDir, f);
      if (existsSync(p)) unlinkSync(p);
    }
    rmdirSync(testDir);
  }
});

describe("getFixSuggestions", () => {
  test("returns empty for missing file", () => {
    const violations: FileViolation[] = [{ filePath: "nonexistent.tsx", rule: "no-inline-styles", message: "inline", severity: "warning" }];
    const fixes = getFixSuggestions("nonexistent.tsx", violations);
    expect(fixes).toEqual([]);
  });

  test("creates suggestion for no-inline-styles", () => {
    const filePath = join(testDir, "test.tsx");
    writeFileSync(filePath, '<div style={{ color: "red" }}>hello</div>');
    const violations: FileViolation[] = [{ filePath, rule: "no-inline-styles", message: "Line 1: inline", severity: "warning", line: 1 }];
    const fixes = getFixSuggestions(filePath, violations);
    expect(fixes.length).toBe(1);
    expect(fixes[0].rule).toBe("no-inline-styles");
    expect(fixes[0].autoFixable).toBe(false);
  });

  test("creates auto-fixable suggestion for no-magic-colors", () => {
    const filePath = join(testDir, "test.tsx");
    writeFileSync(filePath, 'const color = "#1a1a2e";');
    const violations: FileViolation[] = [{ filePath, rule: "no-magic-colors", message: "magic color", severity: "warning", line: 1 }];
    const fixes = getFixSuggestions(filePath, violations);
    expect(fixes.length).toBe(1);
    expect(fixes[0].rule).toBe("no-magic-colors");
    expect(fixes[0].autoFixable).toBe(true);
    expect(fixes[0].fixedLine).toBeDefined();
  });

  test("maps known hex colors to Tailwind names in suggestion", () => {
    const filePath = join(testDir, "test.tsx");
    writeFileSync(filePath, 'const color = "#ef4444";');
    const violations: FileViolation[] = [{ filePath, rule: "no-magic-colors", message: "magic color", severity: "warning", line: 1 }];
    const fixes = getFixSuggestions(filePath, violations);
    expect(fixes[0].suggestion).toContain("red-500");
    expect(fixes[0].fixedLine!).toContain("/* #ef4444");
  });

  test("creates suggestion for no-card-nesting", () => {
    const filePath = join(testDir, "test.tsx");
    writeFileSync(filePath, "<Card><Card>nested</Card></Card>");
    const violations: FileViolation[] = [{ filePath, rule: "no-card-nesting", message: "nested card", severity: "warning", line: 1 }];
    const fixes = getFixSuggestions(filePath, violations);
    expect(fixes.length).toBe(1);
    expect(fixes[0].rule).toBe("no-card-nesting");
    expect(fixes[0].autoFixable).toBe(false);
  });

  test("creates suggestion for no-excessive-zindex", () => {
    const filePath = join(testDir, "test.tsx");
    writeFileSync(filePath, "z-index: 100;");
    const violations: FileViolation[] = [{ filePath, rule: "no-excessive-zindex", message: "excessive z-index", severity: "info", line: 1 }];
    const fixes = getFixSuggestions(filePath, violations);
    expect(fixes[0].rule).toBe("no-excessive-zindex");
  });

  test("creates suggestion for no-forbidden-fonts", () => {
    const filePath = join(testDir, "test.tsx");
    writeFileSync(filePath, 'font-family: "Comic Sans MS";');
    const violations: FileViolation[] = [{ filePath, rule: "no-forbidden-fonts", message: "forbidden font", severity: "warning", line: 1 }];
    const fixes = getFixSuggestions(filePath, violations);
    expect(fixes[0].rule).toBe("no-forbidden-fonts");
  });

  test("handles unknown rule with generic suggestion", () => {
    const filePath = join(testDir, "test.tsx");
    writeFileSync(filePath, "some code");
    const violations: FileViolation[] = [{ filePath, rule: "unknown-rule", message: "some custom message", severity: "info", line: 1 }];
    const fixes = getFixSuggestions(filePath, violations);
    expect(fixes.length).toBe(1);
    expect(fixes[0].rule).toBe("unknown-rule");
    expect(fixes[0].autoFixable).toBe(false);
    expect(fixes[0].suggestion).toBe("some custom message");
  });
});

describe("applyFixes", () => {
  test("applies auto-fixable changes to file", () => {
    const filePath = join(testDir, "test.tsx");
    writeFileSync(filePath, 'const color = "#ef4444";');
    const fixes = getFixSuggestions(filePath, [
      { filePath, rule: "no-magic-colors", message: "magic color", severity: "warning", line: 1 },
    ]);
    const applied = applyFixes(filePath, fixes);
    expect(applied).toBe(1);
    const updated = readFileSync(filePath, "utf-8");
    expect(updated).toContain("/* #ef4444 →");
  });

  test("returns 0 when no auto-fixable fixes", () => {
    const filePath = join(testDir, "test.tsx");
    writeFileSync(filePath, '<div style={{ color: "red" }}></div>');
    const fixes = getFixSuggestions(filePath, [
      { filePath, rule: "no-inline-styles", message: "inline", severity: "warning", line: 1 },
    ]);
    const applied = applyFixes(filePath, fixes);
    expect(applied).toBe(0);
  });

  test("returns 0 for missing file", () => {
    const nonexistent = join(testDir, "nonexistent.tsx");
    const fixes = [{ line: 1, rule: "no-magic-colors", current: "", suggestion: "", autoFixable: true, fixedLine: "fixed" }];
    expect(applyFixes(nonexistent, fixes)).toBe(0);
  });

  test("applies multiple fixes from bottom to top", () => {
    const filePath = join(testDir, "test.tsx");
    writeFileSync(filePath, 'const a = "#ff0000";\nconst b = "#00ff00";');
    const fixes = getFixSuggestions(filePath, [
      { filePath, rule: "no-magic-colors", message: "", severity: "warning", line: 1 },
      { filePath, rule: "no-magic-colors", message: "", severity: "warning", line: 2 },
    ]);
    const applied = applyFixes(filePath, fixes);
    expect(applied).toBe(2);
  });
});
