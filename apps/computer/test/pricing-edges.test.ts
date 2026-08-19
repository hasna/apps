// Test-gap lane: agent-authored analysis (SOL consult refused — gpt-5.6-sol consult timed out twice within the 2x600s protocol bound; no answer delivered). Authored by Paulinus.
import { describe, expect, test } from "bun:test";
import { calculateCost, formatCost, listPricing } from "../src/lib/pricing.js";

describe("pricing — formatCost boundaries", () => {
  test("0.001 is NOT below the <$0.001 floor (strict inequality)", () => {
    expect(formatCost(0.001)).toBe("$0.0010");
  });

  test("just under 0.001 renders as the floor string", () => {
    expect(formatCost(0.000999)).toBe("<$0.001");
  });

  test("0.0005 renders as the floor string", () => {
    expect(formatCost(0.0005)).toBe("<$0.001");
  });

  test("0.0099 keeps 4 decimals", () => {
    expect(formatCost(0.0099)).toBe("$0.0099");
  });

  test("0.01 switches to 3 decimals", () => {
    expect(formatCost(0.01)).toBe("$0.010");
  });

  test("0.999 keeps 3 decimals", () => {
    expect(formatCost(0.999)).toBe("$0.999");
  });

  test("1.0 switches to 2 decimals", () => {
    expect(formatCost(1.0)).toBe("$1.00");
  });

  test("large amounts keep 2 decimals", () => {
    expect(formatCost(123.456)).toBe("$123.46");
  });

  test("exact zero renders as the floor string (first branch is cost < 0.001)", () => {
    expect(formatCost(0)).toBe("<$0.001");
  });
});

describe("pricing — model matching", () => {
  test("exact alias match wins over prefix match (claude-opus-4-6 vs 4-5)", () => {
    const cost = calculateCost("claude-opus-4-6", 1_000_000, 0);
    expect(cost).toBe(15);
  });

  test("dated model names match by prefix", () => {
    const cost = calculateCost("claude-opus-4-6-20260701", 1_000_000, 1_000_000);
    expect(cost).toBe(90); // 15 + 75
  });

  test("prefix matching is case-insensitive", () => {
    const cost = calculateCost("CLAUDE-SONNET-4-5", 1_000_000, 0);
    expect(cost).toBe(3);
  });

  test("gpt-4o-turbo falls to the gpt-4o prefix", () => {
    const cost = calculateCost("gpt-4o-turbo", 1_000_000, 0);
    expect(cost).toBe(2.5);
  });

  test("o1 pricing", () => {
    const cost = calculateCost("o1", 1_000_000, 1_000_000);
    expect(cost).toBe(75);
  });

  test("exact unknown model with a known prefix still matches the prefix", () => {
    // "claude-sonnet-4-5-20250514" is an exact entry; a longer suffix variant matches prefix
    const cost = calculateCost("claude-sonnet-4-5-20250514-fine-tuned", 1_000_000, 0);
    expect(cost).toBe(3);
  });

  test("listPricing returns a copy — mutation does not affect the module", () => {
    const pricing = listPricing();
    pricing["gpt-4o"] = { input: 999, output: 999 };
    expect(calculateCost("gpt-4o", 1_000_000, 0)).toBe(2.5);
  });
});
