import { describe, expect, test } from "bun:test";
import { mergeLoopLabels, normalizeLoopLabels, removeLoopLabels } from "./labels.js";

describe("loop labels", () => {
  test("normalizes lowercase, preserves first-seen order, and deduplicates", () => {
    expect(normalizeLoopLabels([" BrowserPlan ", "nightly", "browserplan"])).toEqual(["browserplan", "nightly"]);
  });

  test("validates syntax and the 32-label ceiling", () => {
    expect(() => normalizeLoopLabels(["bad label"])).toThrow("label");
    expect(() => normalizeLoopLabels(["-leading-dash"])).toThrow("label");
    expect(() => normalizeLoopLabels(Array.from({ length: 33 }, (_, index) => `label-${index}`))).toThrow(
      "at most 32 labels",
    );
  });

  test("merges and removes normalized labels", () => {
    expect(mergeLoopLabels(["BrowserPlan"], ["nightly", "browserplan"])).toEqual(["browserplan", "nightly"]);
    expect(removeLoopLabels(["BrowserPlan", "nightly"], ["BROWSERPLAN"])).toEqual(["nightly"]);
  });
});
