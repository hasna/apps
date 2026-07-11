import { describe, expect, test } from "bun:test";
import { DEFAULT_ROUTER_EVAL_CASES, evaluateRouterHeuristic } from "./router-eval.js";

describe("evaluateRouterHeuristic", () => {
  test("passes the built-in router regression cases", () => {
    const report = evaluateRouterHeuristic();
    expect(report.total).toBe(DEFAULT_ROUTER_EVAL_CASES.length);
    expect(report.failed).toBe(0);
    expect(report.passRate).toBe(1);
  });
});
