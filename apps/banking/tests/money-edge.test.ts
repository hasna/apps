/**
 * TEST-GAP suite: money primitive edge conditions.
 *
 * AGENT-AUTHORED — the gpt-5.6-sol advisory consult was attempted on two
 * distinct provider accounts and refused at the capacity wall on both
 * ("Selected model is at capacity. Please try a different model."), so this
 * spec was produced from direct source analysis, not attributed to SOL.
 *
 * Locks gaps in tests/core.test.ts "money primitives": scale-0 formatting,
 * negative amounts, zero normalization, currency-scale fallback, add/compare
 * guards, non-integer minor rejection, and bigint/number inputs.
 */
import { describe, expect, test } from "bun:test";
import {
  addMoney,
  compareMoney,
  currencyScale,
  formatMoney,
  isPositiveMoney,
  moneyFromDecimal,
  moneyFromMinor,
} from "../src/index.ts";

describe("money edge conditions", () => {
  test("moneyFromMinor accepts string, number, and bigint integer inputs", () => {
    expect(moneyFromMinor("1234", "USD")).toEqual({ currency: "USD", amountMinor: "1234", scale: 2 });
    expect(moneyFromMinor(1234, "USD")).toEqual({ currency: "USD", amountMinor: "1234", scale: 2 });
    expect(moneyFromMinor(1234n, "USD")).toEqual({ currency: "USD", amountMinor: "1234", scale: 2 });
    // A float loses nothing only when it is integral; the integer-string contract is what is pinned.
    expect(moneyFromMinor(12.0, "USD").amountMinor).toBe("12");
  });

  test("moneyFromMinor rejects non-integer and non-numeric strings", () => {
    expect(() => moneyFromMinor("10.5", "USD")).toThrow("Money minor units must be an integer string.");
    expect(() => moneyFromMinor("1e3", "USD")).toThrow("Money minor units must be an integer string.");
    expect(() => moneyFromMinor("abc", "USD")).toThrow("Money minor units must be an integer string.");
    expect(() => moneyFromMinor("", "USD")).toThrow("Money minor units must be an integer string.");
  });

  test("moneyFromMinor rejects negative and fractional scales", () => {
    expect(() => moneyFromMinor("1", "USD", -1)).toThrow("Money scale must be a non-negative integer.");
    expect(() => moneyFromMinor("1", "USD", 1.5)).toThrow("Money scale must be a non-negative integer.");
  });

  test("currencyScale falls back to 2 for unknown currencies and pins known ones", () => {
    for (const currency of ["EUR", "GBP", "RON", "USD"] as const) {
      expect(currencyScale(currency)).toBe(2);
    }
    expect(currencyScale("XYZ" as never)).toBe(2);
    expect(currencyScale("JPY" as never)).toBe(2);
  });

  test("moneyFromDecimal normalizes zeros, signs, and leading zeros deterministically", () => {
    expect(moneyFromDecimal("0.00", "USD")).toEqual({ currency: "USD", amountMinor: "0", scale: 2 });
    expect(moneyFromDecimal("-0.00", "USD")).toEqual({ currency: "USD", amountMinor: "0", scale: 2 });
    expect(moneyFromDecimal("007.50", "USD")).toEqual({ currency: "USD", amountMinor: "750", scale: 2 });
    expect(moneyFromDecimal("-12.3", "EUR")).toEqual({ currency: "EUR", amountMinor: "-1230", scale: 2 });
    expect(moneyFromDecimal("0.05", "USD")).toEqual({ currency: "USD", amountMinor: "5", scale: 2 });
  });

  test("moneyFromDecimal rejects malformed decimal strings", () => {
    expect(() => moneyFromDecimal("1.", "USD")).toThrow("Money amount must be a decimal string.");
    expect(() => moneyFromDecimal(".5", "USD")).toThrow("Money amount must be a decimal string.");
    expect(() => moneyFromDecimal("1,5", "USD")).toThrow("Money amount must be a decimal string.");
    expect(() => moneyFromDecimal("12.345", "EUR")).toThrow("more than 2 decimal places");
  });

  test("moneyFromDecimal honors a non-default scale", () => {
    expect(moneyFromDecimal("1.005", "XTS", 3)).toEqual({ currency: "XTS", amountMinor: "1005", scale: 3 });
    expect(moneyFromDecimal("42", "JPY", 0)).toEqual({ currency: "JPY", amountMinor: "42", scale: 0 });
    expect(() => moneyFromDecimal("42.5", "JPY", 0)).toThrow("more than 0 decimal places");
  });

  test("formatMoney pads, signs, and renders scale-0 amounts without a fraction", () => {
    expect(formatMoney(moneyFromMinor("5", "USD"))).toBe("0.05 USD");
    expect(formatMoney(moneyFromMinor("0", "USD"))).toBe("0.00 USD");
    expect(formatMoney(moneyFromMinor("-12345", "USD"))).toBe("-123.45 USD");
    expect(formatMoney(moneyFromMinor("42", "JPY", 0))).toBe("42 JPY");
    expect(formatMoney(moneyFromMinor("5", "XTS", 3))).toBe("0.005 XTS");
    expect(formatMoney(moneyFromMinor("1000000", "USD"))).toBe("10000.00 USD");
  });

  test("addMoney sums in minor units and rejects currency or scale mismatch", () => {
    const sum = addMoney(moneyFromMinor("5", "USD"), moneyFromMinor("125", "USD"));
    expect(sum).toEqual({ currency: "USD", amountMinor: "130", scale: 2 });
    expect(() => addMoney(moneyFromMinor("1", "USD"), moneyFromMinor("1", "EUR")))
      .toThrow("Money values must use the same currency and scale.");
    expect(() => addMoney(moneyFromMinor("1", "USD", 2), moneyFromMinor("1", "USD", 3)))
      .toThrow("Money values must use the same currency and scale.");
  });

  test("compareMoney orders by minor units with scale equality enforced", () => {
    expect(compareMoney(moneyFromMinor("5", "USD"), moneyFromMinor("5", "USD"))).toBe(0);
    expect(compareMoney(moneyFromMinor("4", "USD"), moneyFromMinor("5", "USD"))).toBe(-1);
    expect(compareMoney(moneyFromMinor("6", "USD"), moneyFromMinor("5", "USD"))).toBe(1);
    expect(compareMoney(moneyFromMinor("-1", "USD"), moneyFromMinor("0", "USD"))).toBe(-1);
    expect(() => compareMoney(moneyFromMinor("1", "USD"), moneyFromMinor("1", "EUR"))).toThrow();
  });

  test("isPositiveMoney rejects zero and negative, accepts positive", () => {
    expect(isPositiveMoney(moneyFromMinor("1", "USD"))).toBe(true);
    expect(isPositiveMoney(moneyFromMinor("0", "USD"))).toBe(false);
    expect(isPositiveMoney(moneyFromMinor("-1", "USD"))).toBe(false);
  });
});
