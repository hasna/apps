import { describe, expect, test } from "bun:test";
import {
  registerGatherer,
  getRegisteredSources,
  getGatherer,
  getProvider,
  getAllProviders,
} from "./registry.js";
import type { GatherResult } from "./types.js";

describe("registry", () => {
  test("getRegisteredSources returns sorted list of built-in sources", () => {
    const sources = getRegisteredSources();
    expect(Array.isArray(sources)).toBe(true);
    expect(sources.length).toBeGreaterThan(0);
    // built-ins
    expect(sources).toContain("todos");
    expect(sources).toContain("mementos");
    expect(sources).toContain("conversations");
    expect(sources).toContain("sessions");
    // sorted
    expect([...sources].sort()).toEqual(sources);
  });

  test("getGatherer returns function for known sources", () => {
    const fn = getGatherer("todos");
    expect(typeof fn).toBe("function");
  });

  test("getGatherer returns undefined for unknown source", () => {
    const fn = getGatherer("__unknown_source__");
    expect(fn).toBeUndefined();
  });

  test("getProvider returns provider for known sources", () => {
    const p = getProvider("todos");
    expect(p).toBeDefined();
    expect(p?.name).toBe("todos");
    expect(typeof p?.gather).toBe("function");
    expect(typeof p?.description).toBe("string");
  });

  test("getProvider returns undefined for unknown source", () => {
    const p = getProvider("__unknown_source__");
    expect(p).toBeUndefined();
  });

  test("getAllProviders returns array of all providers", () => {
    const providers = getAllProviders();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
    for (const p of providers) {
      expect(typeof p.name).toBe("string");
      expect(typeof p.gather).toBe("function");
    }
  });

  test("registerGatherer adds a new provider", () => {
    const mockGather = async (): Promise<GatherResult> => ({
      source: "test-source-xyz",
      examples: [],
      count: 0,
    });
    registerGatherer({
      name: "test-source-xyz",
      gather: mockGather,
      description: "Test gatherer",
    });
    expect(getRegisteredSources()).toContain("test-source-xyz");
    expect(getGatherer("test-source-xyz")).toBe(mockGather);
    expect(getProvider("test-source-xyz")?.description).toBe("Test gatherer");
  });
});
