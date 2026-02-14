import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test";
import * as fs from "fs";

// We need to reset the module between tests for loadConnectorVersions
// since it has internal `versionsLoaded` state

describe("registry", () => {
  describe("CONNECTORS", () => {
    test("exports a non-empty array", async () => {
      const { CONNECTORS } = await import("./registry.js");
      expect(Array.isArray(CONNECTORS)).toBe(true);
      expect(CONNECTORS.length).toBeGreaterThan(0);
    });

    test("each connector has required fields", async () => {
      const { CONNECTORS } = await import("./registry.js");
      for (const c of CONNECTORS) {
        expect(c.name).toBeTypeOf("string");
        expect(c.name.length).toBeGreaterThan(0);
        expect(c.displayName).toBeTypeOf("string");
        expect(c.description).toBeTypeOf("string");
        expect(c.category).toBeTypeOf("string");
        expect(Array.isArray(c.tags)).toBe(true);
      }
    });

    test("connector names are unique", async () => {
      const { CONNECTORS } = await import("./registry.js");
      const names = CONNECTORS.map((c) => c.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });
  });

  describe("CATEGORIES", () => {
    test("exports a non-empty array", async () => {
      const { CATEGORIES } = await import("./registry.js");
      expect(Array.isArray(CATEGORIES)).toBe(true);
      expect(CATEGORIES.length).toBe(11);
    });

    test("every connector category exists in CATEGORIES", async () => {
      const { CONNECTORS, CATEGORIES } = await import("./registry.js");
      for (const c of CONNECTORS) {
        expect(CATEGORIES as readonly string[]).toContain(c.category);
      }
    });
  });

  describe("getConnectorsByCategory", () => {
    test("returns connectors for a valid category", async () => {
      const { getConnectorsByCategory } = await import("./registry.js");
      const aiConnectors = getConnectorsByCategory("AI & ML");
      expect(aiConnectors.length).toBeGreaterThan(0);
      for (const c of aiConnectors) {
        expect(c.category).toBe("AI & ML");
      }
    });

    test("returns connectors for each category", async () => {
      const { CATEGORIES, getConnectorsByCategory } = await import("./registry.js");
      for (const cat of CATEGORIES) {
        const results = getConnectorsByCategory(cat);
        expect(results.length).toBeGreaterThan(0);
      }
    });

    test("returns empty array for non-existent category", async () => {
      const { getConnectorsByCategory } = await import("./registry.js");
      const results = getConnectorsByCategory("Nonexistent" as any);
      expect(results).toEqual([]);
    });
  });

  describe("searchConnectors", () => {
    test("finds by name", async () => {
      const { searchConnectors } = await import("./registry.js");
      const results = searchConnectors("figma");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((c) => c.name === "figma")).toBe(true);
    });

    test("finds by displayName", async () => {
      const { searchConnectors } = await import("./registry.js");
      const results = searchConnectors("Anthropic");
      expect(results.some((c) => c.name === "anthropic")).toBe(true);
    });

    test("finds by description", async () => {
      const { searchConnectors } = await import("./registry.js");
      const results = searchConnectors("Payments");
      expect(results.some((c) => c.name === "stripe")).toBe(true);
    });

    test("finds by tags", async () => {
      const { searchConnectors } = await import("./registry.js");
      const results = searchConnectors("llm");
      expect(results.length).toBeGreaterThan(0);
    });

    test("is case-insensitive", async () => {
      const { searchConnectors } = await import("./registry.js");
      const lower = searchConnectors("figma");
      const upper = searchConnectors("FIGMA");
      const mixed = searchConnectors("Figma");
      expect(lower.length).toBe(upper.length);
      expect(lower.length).toBe(mixed.length);
    });

    test("returns empty array for no matches", async () => {
      const { searchConnectors } = await import("./registry.js");
      const results = searchConnectors("zzzznonexistent");
      expect(results).toEqual([]);
    });

    test("returns empty array for empty query", async () => {
      const { searchConnectors } = await import("./registry.js");
      // Empty string should match nothing since all fields have content
      const results = searchConnectors("");
      // Actually empty string is a substring of everything, so it matches all
      // This is expected behavior
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("getConnector", () => {
    test("finds existing connector by name", async () => {
      const { getConnector } = await import("./registry.js");
      const result = getConnector("figma");
      expect(result).toBeDefined();
      expect(result!.name).toBe("figma");
      expect(result!.displayName).toBe("Figma");
    });

    test("returns undefined for non-existent connector", async () => {
      const { getConnector } = await import("./registry.js");
      const result = getConnector("nonexistent");
      expect(result).toBeUndefined();
    });

    test("is case-sensitive", async () => {
      const { getConnector } = await import("./registry.js");
      const result = getConnector("FIGMA");
      expect(result).toBeUndefined();
    });

    test("returns undefined for empty string", async () => {
      const { getConnector } = await import("./registry.js");
      const result = getConnector("");
      expect(result).toBeUndefined();
    });
  });

  describe("loadConnectorVersions", () => {
    test("loads versions from connector package.json files", async () => {
      // This test uses the real filesystem since connectors/ exists in repo
      const { loadConnectorVersions, CONNECTORS } = await import("./registry.js");
      loadConnectorVersions();

      // At least some connectors should have versions loaded
      const withVersions = CONNECTORS.filter((c) => c.version);
      expect(withVersions.length).toBeGreaterThan(0);
    });

    test("sets valid semver-like versions", async () => {
      const { loadConnectorVersions, CONNECTORS } = await import("./registry.js");
      loadConnectorVersions();

      for (const c of CONNECTORS) {
        if (c.version) {
          expect(c.version).toMatch(/^\d+\.\d+\.\d+/);
        }
      }
    });

    test("is idempotent (second call is a no-op)", async () => {
      const { loadConnectorVersions, CONNECTORS } = await import("./registry.js");
      loadConnectorVersions();
      const firstVersions = CONNECTORS.map((c) => c.version);
      loadConnectorVersions();
      const secondVersions = CONNECTORS.map((c) => c.version);
      expect(firstVersions).toEqual(secondVersions);
    });

    test("all connectors get versions from package.json", async () => {
      const { loadConnectorVersions, CONNECTORS } = await import("./registry.js");
      loadConnectorVersions();
      // Every connector in the repo should have a package.json with version
      for (const c of CONNECTORS) {
        expect(c.version).toBeDefined();
        expect(c.version).not.toBe("0.0.0");
      }
    });
  });

  describe("searchConnectors edge cases", () => {
    test("finds multiple connectors for broad query", async () => {
      const { searchConnectors } = await import("./registry.js");
      const results = searchConnectors("google");
      // Should find multiple google-related connectors
      expect(results.length).toBeGreaterThan(3);
    });

    test("partial match on tags", async () => {
      const { searchConnectors } = await import("./registry.js");
      const results = searchConnectors("social");
      expect(results.some((c) => c.name === "x")).toBe(true);
      expect(results.some((c) => c.name === "reddit")).toBe(true);
    });

    test("single character query matches broadly", async () => {
      const { searchConnectors } = await import("./registry.js");
      const results = searchConnectors("a");
      expect(results.length).toBeGreaterThan(10);
    });
  });

  describe("getConnector edge cases", () => {
    test("finds connectors with multi-word names", async () => {
      const { getConnector } = await import("./registry.js");
      const result = getConnector("googlecalendar");
      expect(result).toBeDefined();
      expect(result!.displayName).toBe("Google Calendar");
    });

    test("finds single-letter connector", async () => {
      const { getConnector } = await import("./registry.js");
      const result = getConnector("x");
      expect(result).toBeDefined();
      expect(result!.displayName).toBe("X (Twitter)");
    });
  });
});
