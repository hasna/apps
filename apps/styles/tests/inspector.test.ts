import { describe, expect, test, beforeEach, afterEach } from "bun:test";

import {
  isCerebrasAvailable,
  inspectFile,
  inspectProject,
} from "../src/lib/inspector.js";

describe("isCerebrasAvailable", () => {
  test("returns false when CEREBRAS_API_KEY is not set", () => {
    const original = process.env["CEREBRAS_API_KEY"];
    delete process.env["CEREBRAS_API_KEY"];
    expect(isCerebrasAvailable()).toBe(false);
    if (original !== undefined) {
      process.env["CEREBRAS_API_KEY"] = original;
    }
  });

  test("returns true when CEREBRAS_API_KEY is set", () => {
    const original = process.env["CEREBRAS_API_KEY"];
    process.env["CEREBRAS_API_KEY"] = "test-key";
    expect(isCerebrasAvailable()).toBe(true);
    if (original !== undefined) {
      process.env["CEREBRAS_API_KEY"] = original;
    } else {
      delete process.env["CEREBRAS_API_KEY"];
    }
  });
});

describe("inspectFile", () => {
  test("returns empty result when Cerebras unavailable", async () => {
    const original = process.env["CEREBRAS_API_KEY"];
    delete process.env["CEREBRAS_API_KEY"];

    const fakeProfile = {
      id: "test",
      name: "minimalist",
      displayName: "Minimalist",
      description: "Clean design",
      category: "Minimalist",
      principles: [],
      antiPatterns: [],
      typography: {},
      colors: {},
      componentRules: {},
      tags: [],
      createdAt: 0,
      builtin: true,
    };

    const result = await inspectFile("/some/nonexistent/file.tsx", fakeProfile);
    expect(result.filePath).toBe("/some/nonexistent/file.tsx");
    expect(result.violations).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);

    if (original !== undefined) {
      process.env["CEREBRAS_API_KEY"] = original;
    }
  });
});

describe("inspectProject", () => {
  test("returns empty array when Cerebras unavailable", async () => {
    const original = process.env["CEREBRAS_API_KEY"];
    delete process.env["CEREBRAS_API_KEY"];

    const results = await inspectProject("/some/project");
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);

    if (original !== undefined) {
      process.env["CEREBRAS_API_KEY"] = original;
    }
  });
});
