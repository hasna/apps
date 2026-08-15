import { describe, expect, test } from "bun:test";
import { resolveAgentMaxTurns } from "./runner.js";

describe("runner option resolution", () => {
  test("uses the standard turn budget by default", () => {
    expect(resolveAgentMaxTurns({})).toBe(30);
  });

  test("uses the smaller turn budget for minimal runs", () => {
    expect(resolveAgentMaxTurns({ minimal: true })).toBe(10);
  });

  test("honors an explicit max-turns override", () => {
    expect(resolveAgentMaxTurns({ minimal: true, maxTurns: 48 })).toBe(48);
  });

  test("ignores invalid max-turns values", () => {
    expect(resolveAgentMaxTurns({ maxTurns: 0 })).toBe(30);
    expect(resolveAgentMaxTurns({ minimal: true, maxTurns: -2 })).toBe(10);
  });
});
