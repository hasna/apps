import { describe, expect, test } from "bun:test";
import { normalizeTmuxTargets, parseOptionalDelayMs } from "./tmux.js";

describe("parseOptionalDelayMs", () => {
  test("accepts 0 for immediate send", () => {
    expect(parseOptionalDelayMs(0)).toBe(0);
  });

  test("accepts positive delay values", () => {
    expect(parseOptionalDelayMs(250)).toBe(250);
  });

  test("returns undefined for negative or non-number values", () => {
    expect(parseOptionalDelayMs(-1)).toBeUndefined();
    expect(parseOptionalDelayMs("100")).toBeUndefined();
    expect(parseOptionalDelayMs(undefined)).toBeUndefined();
  });
});

describe("normalizeTmuxTargets", () => {
  test("trims target values", () => {
    expect(normalizeTmuxTargets(["  team:1 ", "team:2.0"])).toEqual(["team:1", "team:2.0"]);
  });

  test("throws on empty targets after trim", () => {
    expect(() => normalizeTmuxTargets(["team:1", "   "])).toThrow("targets must not contain empty values");
  });
});
