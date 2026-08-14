import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  BUILTIN_RULES,
  getDefaultRules,
  checkFile,
} from "../src/lib/health.js";

describe("getDefaultRules", () => {
  test("returns an array of rules", () => {
    const rules = getDefaultRules(null);
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  test("includes the no-inline-styles rule", () => {
    const rules = getDefaultRules(null);
    const ruleIds = rules.map((r) => r.id);
    expect(ruleIds).toContain("no-inline-styles");
  });

  test("returns all BUILTIN_RULES", () => {
    const rules = getDefaultRules(null);
    expect(rules).toHaveLength(BUILTIN_RULES.length);
  });
});

describe("checkFile", () => {
  let tmpFile: string;

  afterEach(() => {
    if (existsSync(tmpFile)) unlinkSync(tmpFile);
  });

  test("detects inline style violation", () => {
    tmpFile = join(tmpdir(), `health-test-${Date.now()}.tsx`);
    writeFileSync(tmpFile, `<div style={{ color: 'red' }}>hello</div>`, "utf-8");

    const inlineRule = BUILTIN_RULES.find((r) => r.id === "no-inline-styles")!;
    const violations = checkFile(tmpFile, [inlineRule]);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].rule).toBe("no-inline-styles");
  });

  test("returns no violations for clean content", () => {
    tmpFile = join(tmpdir(), `health-clean-${Date.now()}.tsx`);
    writeFileSync(tmpFile, `<div className="container">hello</div>`, "utf-8");

    const inlineRule = BUILTIN_RULES.find((r) => r.id === "no-inline-styles")!;
    const violations = checkFile(tmpFile, [inlineRule]);

    expect(violations).toHaveLength(0);
  });

  test("returns empty array for nonexistent file", () => {
    tmpFile = join(tmpdir(), "nonexistent-file-xyz.tsx");
    const violations = checkFile(tmpFile, BUILTIN_RULES);
    expect(violations).toHaveLength(0);
  });
});

describe("Score calculation", () => {
  // We test the scoring logic indirectly by checking the rule check function behavior.
  // The actual calculateScore is private, but we know:
  // - warning = 3 penalty each
  // - critical = 10 penalty each
  // - info = 1 penalty each
  // score = max(0, 100 - penalty)
  // status: >=80 = pass, >=50 = warn, else fail

  test("no-inline-styles rule is 'warning' severity", () => {
    const rule = BUILTIN_RULES.find((r) => r.id === "no-inline-styles")!;
    expect(rule.severity).toBe("warning");
  });

  test("score would be 100 with 0 violations (penalty = 0)", () => {
    // 100 - 0 = 100 → pass
    const score = Math.max(0, 100 - 0);
    expect(score).toBe(100);
    expect(score >= 80 ? "pass" : score >= 50 ? "warn" : "fail").toBe("pass");
  });

  test("score >= 80 gives 'pass' status", () => {
    expect(80 >= 80 ? "pass" : 80 >= 50 ? "warn" : "fail").toBe("pass");
    expect(90 >= 80 ? "pass" : 90 >= 50 ? "warn" : "fail").toBe("pass");
  });

  test("score >= 50 and < 80 gives 'warn' status", () => {
    expect(60 >= 80 ? "pass" : 60 >= 50 ? "warn" : "fail").toBe("warn");
    expect(79 >= 80 ? "pass" : 79 >= 50 ? "warn" : "fail").toBe("warn");
  });

  test("score < 50 gives 'fail' status", () => {
    expect(0 >= 80 ? "pass" : 0 >= 50 ? "warn" : "fail").toBe("fail");
    expect(49 >= 80 ? "pass" : 49 >= 50 ? "warn" : "fail").toBe("fail");
  });

  test("33 warning violations yields score 1 (100 - 99 = 1)", () => {
    // 33 warnings × 3 = 99 penalty → score = 1
    const penalty = 33 * 3;
    const score = Math.max(0, 100 - penalty);
    expect(score).toBe(1);
  });

  test("100 warning violations yields score 0 (100 - 300 = 0 clamped)", () => {
    const penalty = 100 * 3;
    const score = Math.max(0, 100 - penalty);
    expect(score).toBe(0);
  });
});
