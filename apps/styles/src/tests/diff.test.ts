import { describe, expect, test } from "bun:test";
import { diffTokens } from "../lib/diff.js";
import type { DesignTokens } from "../lib/tokenizer.js";

const BASE_TOKENS: DesignTokens = {
  colors: [
    { value: "#1a1a2e", frequency: 10, source: "css-var" },
    { value: "#e94560", frequency: 6, source: "computed" },
    { value: "#f5f5f5", frequency: 3, source: "computed" },
  ],
  typography: {
    fontFamilies: ["Inter", "Georgia"],
    fontSizes: ["0.875rem", "1rem", "1.25rem", "2rem"],
    fontWeights: ["400", "600", "700"],
    lineHeights: ["1.2", "1.5"],
    letterSpacings: ["0.01em", "-0.02em"],
    fontFaces: [],
    families: [{ name: "Inter", weights: ["400", "600"], styles: [], isVariable: false }],
    scale: [],
  },
  spacing: ["0.5rem", "1rem", "1.5rem", "2rem"],
  borderRadius: ["4px", "6px", "12px"],
  shadows: ["0 2px 8px rgba(0,0,0,0.15)", "0 4px 16px rgba(0,0,0,0.2)"],
  transitions: ["all 0.2s ease"],
  zIndices: ["1", "100"],
  gradients: [],
};

describe("diffTokens", () => {
  test("returns no changes for identical tokens", () => {
    const result = diffTokens(BASE_TOKENS, BASE_TOKENS);
    expect(result.colors.added).toEqual([]);
    expect(result.colors.removed).toEqual([]);
    expect(result.colors.changed).toEqual([]);
    expect(result.summary.totalChanges).toBe(0);
    expect(result.summary.description).toBe("No significant changes");
  });

  test("detects added colors", () => {
    const next: DesignTokens = {
      ...BASE_TOKENS,
      colors: [...BASE_TOKENS.colors, { value: "#00ff00", frequency: 1, source: "computed" }],
    };
    const result = diffTokens(BASE_TOKENS, next);
    expect(result.colors.added.length).toBe(1);
    expect(result.colors.added[0].value).toBe("#00ff00");
    expect(result.colors.removed).toEqual([]);
  });

  test("detects removed colors", () => {
    const next: DesignTokens = {
      ...BASE_TOKENS,
      colors: BASE_TOKENS.colors.slice(1),
    };
    const result = diffTokens(BASE_TOKENS, next);
    expect(result.colors.removed.length).toBe(1);
    expect(result.colors.removed[0].value).toBe("#1a1a2e");
    expect(result.colors.added).toEqual([]);
  });

  test("detects name changes on same-value colors", () => {
    const a: DesignTokens = {
      ...BASE_TOKENS,
      colors: [{ value: "#1a1a2e", frequency: 10, source: "css-var", name: "old-name" }],
    };
    const b: DesignTokens = {
      ...BASE_TOKENS,
      colors: [{ value: "#1a1a2e", frequency: 10, source: "css-var", name: "new-name" }],
    };
    const result = diffTokens(a, b);
    expect(result.colors.changed.length).toBe(1);
    expect(result.colors.changed[0].before.name).toBe("old-name");
    expect(result.colors.changed[0].after.name).toBe("new-name");
  });

  test("detects frequency change above threshold", () => {
    const a: DesignTokens = {
      ...BASE_TOKENS,
      colors: [{ value: "#1a1a2e", frequency: 10, source: "css-var" }],
    };
    const b: DesignTokens = {
      ...BASE_TOKENS,
      colors: [{ value: "#1a1a2e", frequency: 20, source: "css-var" }],
    };
    const result = diffTokens(a, b);
    expect(result.colors.changed.length).toBe(1);
  });

  test("does not flag small frequency change", () => {
    const a: DesignTokens = {
      ...BASE_TOKENS,
      colors: [{ value: "#1a1a2e", frequency: 10, source: "css-var" }],
    };
    const b: DesignTokens = {
      ...BASE_TOKENS,
      colors: [{ value: "#1a1a2e", frequency: 11, source: "css-var" }],
    };
    const result = diffTokens(a, b);
    expect(result.colors.changed.length).toBe(0);
  });

  test("detects border radius changes", () => {
    const next: DesignTokens = {
      ...BASE_TOKENS,
      borderRadius: ["4px", "6px", "12px", "24px"],
    };
    const result = diffTokens(BASE_TOKENS, next);
    expect(result.borderRadius.added).toEqual(["24px"]);
    expect(result.borderRadius.removed).toEqual([]);
  });

  test("detects shadow changes", () => {
    const next: DesignTokens = {
      ...BASE_TOKENS,
      shadows: ["0 8px 32px rgba(0,0,0,0.3)"],
    };
    const result = diffTokens(BASE_TOKENS, next);
    expect(result.shadows.added.length).toBe(1);
    expect(result.shadows.removed.length).toBe(2);
  });

  test("detects typography font family changes", () => {
    const next: DesignTokens = {
      ...BASE_TOKENS,
      typography: { ...BASE_TOKENS.typography, fontFamilies: ["Inter", "Roboto"] },
    };
    const result = diffTokens(BASE_TOKENS, next);
    expect(result.typography.fontFamilies.added).toEqual(["Roboto"]);
    expect(result.typography.fontFamilies.removed).toEqual(["Georgia"]);
  });

  test("detects spacing changes", () => {
    const next: DesignTokens = {
      ...BASE_TOKENS,
      spacing: ["0.5rem", "1rem"],
    };
    const result = diffTokens(BASE_TOKENS, next);
    expect(result.spacing.added).toEqual([]);
    expect(result.spacing.removed).toEqual(["1.5rem", "2rem"]);
  });

  test("summary description reflects actual changes", () => {
    const next: DesignTokens = {
      ...BASE_TOKENS,
      colors: [...BASE_TOKENS.colors, { value: "#00ff00", frequency: 1, source: "computed" }],
      borderRadius: [...BASE_TOKENS.borderRadius, "24px"],
    };
    const result = diffTokens(BASE_TOKENS, next);
    expect(result.summary.description).toContain("colors");
    expect(result.summary.totalChanges).toBeGreaterThan(0);
  });

  test("empty colors arrays", () => {
    const empty: DesignTokens = { ...BASE_TOKENS, colors: [] };
    const next: DesignTokens = {
      ...BASE_TOKENS,
      colors: [{ value: "#000", frequency: 1, source: "meta" }],
    };
    const result = diffTokens(empty, next);
    expect(result.colors.added.length).toBe(1);
  });
});
