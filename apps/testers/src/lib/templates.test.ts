process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect } from "bun:test";
import { getTemplate, listTemplateNames, SCENARIO_TEMPLATES } from "./templates.js";

describe("templates", () => {
  describe("getTemplate", () => {
    test("returns array of scenarios for 'auth'", () => {
      const result = getTemplate("auth");
      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(true);
      expect(result!.length).toBeGreaterThan(0);
      for (const scenario of result!) {
        expect(scenario.name).toBeDefined();
        expect(scenario.description).toBeDefined();
      }
    });

    test("returns 4 scenarios for 'crud'", () => {
      const result = getTemplate("crud");
      expect(result).not.toBeNull();
      expect(result!.length).toBe(4);
      const names = result!.map((s) => s.name);
      expect(names).toContain("Create new item");
      expect(names).toContain("Read/view item details");
      expect(names).toContain("Update existing item");
      expect(names).toContain("Delete item");
    });

    test("returns scenarios for 'forms'", () => {
      const result = getTemplate("forms");
      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(true);
      expect(result!.length).toBeGreaterThan(0);
      for (const scenario of result!) {
        expect(scenario.tags).toBeDefined();
        expect(scenario.tags!.some((t) => t === "forms" || t === "validation")).toBe(true);
      }
    });

    test("returns scenarios for 'nav'", () => {
      const result = getTemplate("nav");
      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(true);
      expect(result!.length).toBe(2);
      const names = result!.map((s) => s.name);
      expect(names).toContain("Main navigation links work");
      expect(names).toContain("Mobile navigation");
    });

    test("returns scenarios for 'a11y'", () => {
      const result = getTemplate("a11y");
      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(true);
      expect(result!.length).toBe(2);
      const names = result!.map((s) => s.name);
      expect(names).toContain("Keyboard navigation");
      expect(names).toContain("Image alt text");
    });

    test("returns 4 scenarios for 'checkout'", () => {
      const result = getTemplate("checkout");
      expect(result).not.toBeNull();
      expect(result!.length).toBe(4);
      const names = result!.map((s) => s.name);
      expect(names).toContain("Add item to cart");
      expect(names).toContain("Cart page shows added items");
      expect(names).toContain("Checkout flow completion");
      expect(names).toContain("Apply coupon/discount code");
    });

    test("returns 4 scenarios for 'search'", () => {
      const result = getTemplate("search");
      expect(result).not.toBeNull();
      expect(result!.length).toBe(4);
      const names = result!.map((s) => s.name);
      expect(names).toContain("Search returns relevant results");
      expect(names).toContain("Empty search handling");
      expect(names).toContain("No results handling");
      expect(names).toContain("Search filters work");
    });

    test("returns null for nonexistent template", () => {
      const result = getTemplate("nonexistent");
      expect(result).toBeNull();
    });

    test("each template scenario has required fields", () => {
      for (const [, scenarios] of Object.entries(SCENARIO_TEMPLATES)) {
        for (const s of scenarios) {
          expect(typeof s.name).toBe("string");
          expect(typeof s.description).toBe("string");
          expect(s.name.length).toBeGreaterThan(0);
          expect(s.description.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("listTemplateNames", () => {
    test("returns all template names", () => {
      const names = listTemplateNames();
      expect(names).toEqual(["auth", "crud", "forms", "nav", "a11y", "checkout", "search"]);
    });

    test("returns an array of strings", () => {
      const names = listTemplateNames();
      expect(Array.isArray(names)).toBe(true);
      for (const name of names) {
        expect(typeof name).toBe("string");
      }
    });
  });
});
