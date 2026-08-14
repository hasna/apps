import { describe, test, expect } from "bun:test";
import { calculateCost, formatCost, stepCost, listPricing } from "../src/lib/pricing.js";

describe("pricing", () => {
  test("calculateCost for Claude Sonnet 4.5", () => {
    // $3/1M input, $15/1M output
    const cost = calculateCost("claude-sonnet-4-5-20250514", 1_000_000, 1_000_000);
    expect(cost).toBe(18); // $3 + $15
  });

  test("calculateCost for Claude Sonnet with short name", () => {
    const cost = calculateCost("claude-sonnet-4-5", 1_000_000, 0);
    expect(cost).toBe(3);
  });

  test("calculateCost for GPT-4o", () => {
    // $2.50/1M input, $10/1M output
    const cost = calculateCost("gpt-4o", 500_000, 100_000);
    expect(cost).toBeCloseTo(2.25, 2); // $1.25 + $1.00
  });

  test("calculateCost for computer-use-preview", () => {
    // $3/1M input, $12/1M output
    const cost = calculateCost("computer-use-preview", 100_000, 50_000);
    expect(cost).toBeCloseTo(0.9, 2); // $0.30 + $0.60
  });

  test("calculateCost for unknown model uses fallback", () => {
    const cost = calculateCost("some-unknown-model", 1_000_000, 1_000_000);
    expect(cost).toBe(15); // $3 + $12 (default)
  });

  test("calculateCost with zero tokens", () => {
    expect(calculateCost("gpt-4o", 0, 0)).toBe(0);
  });

  test("formatCost for tiny amounts", () => {
    expect(formatCost(0.0001)).toBe("<$0.001");
  });

  test("formatCost for small amounts", () => {
    expect(formatCost(0.005)).toBe("$0.0050");
  });

  test("formatCost for medium amounts", () => {
    expect(formatCost(0.15)).toBe("$0.150");
  });

  test("formatCost for large amounts", () => {
    expect(formatCost(5.67)).toBe("$5.67");
  });

  test("stepCost returns formatted string", () => {
    const result = stepCost("gpt-4o", 10_000, 5_000);
    expect(result).toMatch(/^\$\d/);
  });

  test("listPricing returns known models", () => {
    const pricing = listPricing();
    expect(pricing["gpt-4o"]).toBeDefined();
    expect(pricing["gpt-4o"].input).toBe(2.5);
    expect(pricing["gpt-4o"].output).toBe(10);
    expect(pricing["claude-sonnet-4-5"]).toBeDefined();
  });
});
