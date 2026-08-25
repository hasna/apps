/**
 * Regression tests for the condition expression evaluator (slice A).
 */
import { describe, expect, test } from "bun:test";
import { evaluateExpr, ExprSyntaxError, type ExprValue } from "./expr.js";

const ctx: Record<string, unknown> = {
  i: 2,
  steps: {
    build: { exitCode: 0, ok: true, output: "built" },
    test: { exitCode: 1, ok: false },
  },
  count: 5,
  name: "demo",
};

describe("evaluateExpr", () => {
  test("evaluates boolean path lookups (conditions must yield a boolean)", () => {
    expect(evaluateExpr("steps.build.ok", ctx)).toBe(true);
    expect(evaluateExpr("steps.test.ok", ctx)).toBe(false);
    expect(evaluateExpr("i == 2", ctx)).toBe(true);
  });

  test("evaluates comparisons", () => {
    expect(evaluateExpr("steps.build.exitCode == 0", ctx)).toBe(true);
    expect(evaluateExpr("steps.test.exitCode != 0", ctx)).toBe(true);
    expect(evaluateExpr("steps.build.exitCode < 2", ctx)).toBe(true);
    expect(evaluateExpr("steps.build.exitCode <= 0", ctx)).toBe(true);
    expect(evaluateExpr("count > 4", ctx)).toBe(true);
    expect(evaluateExpr("count >= 5", ctx)).toBe(true);
    expect(evaluateExpr("steps.build.ok == true", ctx)).toBe(true);
    expect(evaluateExpr('name == "demo"', ctx)).toBe(true);
  });

  test("evaluates booleans and/or/not with parens", () => {
    expect(evaluateExpr("steps.build.ok and steps.test.ok", ctx)).toBe(false);
    expect(evaluateExpr("steps.build.ok or steps.test.ok", ctx)).toBe(true);
    expect(evaluateExpr("not steps.test.ok", ctx)).toBe(true);
    expect(evaluateExpr("(i > 1) and (count == 5)", ctx)).toBe(true);
    expect(evaluateExpr("not (count == 4)", ctx)).toBe(true);
  });

  test("evaluates literals (conditions yield a boolean)", () => {
    expect(evaluateExpr("true", ctx)).toBe(true);
    expect(evaluateExpr("false", ctx)).toBe(false);
    expect(evaluateExpr("3 == 3", ctx)).toBe(true);
    expect(evaluateExpr('"hello" == "hello"', ctx)).toBe(true);
  });

  test("evaluates the canonical while-loop condition with a loop counter", () => {
    // condition used in while nodes: i is the loop counter
    for (let i = 0; i < 3; i++) {
      expect(evaluateExpr("i < 3", { i })).toBe(true);
    }
    expect(evaluateExpr("i < 3", { i: 3 })).toBe(false);
  });

  test("throws ExprSyntaxError on malformed input", () => {
    expect(() => evaluateExpr("steps.build.exitCode ==", ctx)).toThrow(ExprSyntaxError);
    expect(() => evaluateExpr("and true", ctx)).toThrow(ExprSyntaxError);
    expect(() => evaluateExpr("(true", ctx)).toThrow(ExprSyntaxError);
    expect(() => evaluateExpr("", ctx)).toThrow(ExprSyntaxError);
  });

  test("throws on an unknown path", () => {
    expect(() => evaluateExpr("steps.missing.ok", ctx)).toThrow(/unknown path/);
  });

  test("throws on a type mismatch in comparison", () => {
    expect(() => evaluateExpr('steps.build.exitCode == "0"', ctx)).toThrow(/cannot compare/);
  });
});
