import { describe, test, expect } from "bun:test";
import { AGENT_NAMES } from "./names";

describe("AGENT_NAMES", () => {
  test("all names are lowercase kebab-case with adjective-animal format", () => {
    for (const name of AGENT_NAMES) {
      expect(name).toMatch(/^[a-z]+-[a-z]+$/);
    }
  });

  test("all names are unique", () => {
    const unique = new Set(AGENT_NAMES);
    expect(unique.size).toBe(AGENT_NAMES.length);
  });

  test("has enough names for many agents", () => {
    expect(AGENT_NAMES.length).toBeGreaterThan(200);
  });

  test("all names are under 20 characters", () => {
    for (const name of AGENT_NAMES) {
      expect(name.length).toBeLessThanOrEqual(20);
    }
  });
});
