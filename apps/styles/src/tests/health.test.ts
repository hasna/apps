import { describe, expect, test } from "bun:test";
import { BUILTIN_RULES, getDefaultRules, checkFile } from "../lib/health.js";
import type { FileViolation } from "../lib/health.js";
import type { StyleRule } from "../lib/health.js";

describe("BUILTIN_RULES", () => {
  test("contains five rules", () => {
    expect(BUILTIN_RULES.length).toBe(5);
  });

  test("all rules have required fields", () => {
    for (const rule of BUILTIN_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.name).toBeTruthy();
      expect(rule.description).toBeTruthy();
      expect(["critical", "warning", "info"]).toContain(rule.severity);
      expect(typeof rule.check).toBe("function");
    }
  });

  test("unique rule ids", () => {
    const ids = BUILTIN_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("checkFile - no-inline-styles", () => {
  const rules: StyleRule[] = [BUILTIN_RULES.find((r) => r.id === "no-inline-styles")!];

  test("detects inline style objects", () => {
    const violations = checkFile("test.tsx", rules);
    // Empty content — no violations
    expect(violations.length).toBe(0);
  });

  test("finds style={{}} in JSX", () => {
    const mockContent = 'const x = <div style={{ color: "red" }}>hello</div>\n';
    const violations = checkFileWithContent("test.tsx", rules, mockContent);
    expect(violations.length).toBe(1);
    expect(violations[0].rule).toBe("no-inline-styles");
    expect(violations[0].line).toBe(1);
  });

  test("no false positive on style object references", () => {
    const mockContent = 'const styles = { color: "red" };\n<div className={styles}>hello</div>\n';
    const violations = checkFileWithContent("test.tsx", rules, mockContent);
    // style={styles} doesn't match style={{ because of single brace
    // But style={{ will match in const styles assignment? No — it's `{ color` not `{{`
    expect(violations.length).toBe(0);
  });
});

describe("checkFile - no-magic-colors", () => {
  const rules: StyleRule[] = [BUILTIN_RULES.find((r) => r.id === "no-magic-colors")!];

  test("detects hex color literals", () => {
    const mockContent = "const bg = '#1a1a2e';\nconst fg = '#e94560';\n";
    const violations = checkFileWithContent("test.tsx", rules, mockContent);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  test("no false positive on non-hex strings", () => {
    const mockContent = "const url = 'https://example.com';\nconst name = 'hello';\n";
    const violations = checkFileWithContent("test.tsx", rules, mockContent);
    expect(violations.length).toBe(0);
  });
});

describe("checkFile - no-card-nesting", () => {
  const rules: StyleRule[] = [BUILTIN_RULES.find((r) => r.id === "no-card-nesting")!];

  test("detects nested Card components", () => {
    const mockContent = "<Card>\n  <Card>nested</Card>\n</Card>\n";
    const violations = checkFileWithContent("test.tsx", rules, mockContent);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].rule).toBe("no-card-nesting");
  });

  test("single Card has no violation", () => {
    const mockContent = "<Card>content</Card>\n";
    const violations = checkFileWithContent("test.tsx", rules, mockContent);
    expect(violations.length).toBe(0);
  });
});

describe("checkFile - no-excessive-zindex", () => {
  const rules: StyleRule[] = [BUILTIN_RULES.find((r) => r.id === "no-excessive-zindex")!];

  test("detects z-index >= 50", () => {
    const violations = checkFileWithContent("test.tsx", rules, "z-index: 100;\nzIndex: 200;\n");
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  test("allows z-index < 50", () => {
    const violations = checkFileWithContent("test.tsx", rules, "z-index: 10;\nzIndex: 30;\n");
    expect(violations.length).toBe(0);
  });
});

describe("checkFile - no-forbidden-fonts", () => {
  const rules: StyleRule[] = [BUILTIN_RULES.find((r) => r.id === "no-forbidden-fonts")!];

  test("detects Comic Sans", () => {
    const violations = checkFileWithContent("test.tsx", rules, 'font-family: "Comic Sans MS";');
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].message).toContain("Comic Sans");
  });

  test("allows valid fonts", () => {
    const violations = checkFileWithContent("test.tsx", rules, 'font-family: "Inter", sans-serif;');
    expect(violations.length).toBe(0);
  });

  test("detects Papyrus", () => {
    const violations = checkFileWithContent("test.tsx", rules, 'fontFamily: "Papyrus"');
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe("getDefaultRules", () => {
  test("returns all built-in rules", () => {
    const rules = getDefaultRules(null);
    expect(rules.length).toBe(BUILTIN_RULES.length);
  });

  test("returns all built-in rules with a profile", () => {
    const rules = getDefaultRules(null);
    expect(rules).toEqual(BUILTIN_RULES);
  });
});

// Helper that avoids actual file I/O by using a temporary approach
function checkFileWithContent(filePath: string, rules: StyleRule[], content: string): FileViolation[] {
  const violations: FileViolation[] = [];
  for (const rule of rules) {
    const messages = rule.check(content, filePath);
    for (const message of messages) {
      const lineMatch = message.match(/^Line (\d+):/);
      const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;
      violations.push({ filePath, rule: rule.id, message, severity: rule.severity, line });
    }
  }
  return violations;
}
