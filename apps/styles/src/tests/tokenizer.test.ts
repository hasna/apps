import { describe, expect, test } from "bun:test";
import { tokenizeStyles } from "../lib/tokenizer.js";
import type { RawExtractedStyles } from "../lib/extractor.js";

const FIXTURE: RawExtractedStyles = {
  url: "https://example.com",
  extractedAt: Date.now(),
  cssVars: {
    "--primary": "#1a1a2e",
    "--secondary": "#e94560",
    "--background": "rgba(255,255,255,0.9)",
    "--radius-sm": "4px",
    "--radius-lg": "12px",
    "--shadow-md": "0 4px 16px rgba(0,0,0,0.2)",
  },
  computedElements: [
    {
      selector: "button",
      tagName: "button",
      backgroundColor: "rgb(26, 26, 46)",
      color: "#ffffff",
      fontSize: "14px",
      fontFamily: "Inter, sans-serif",
      fontWeight: "600",
      lineHeight: "1.5",
      letterSpacing: "0.01em",
      borderRadius: "6px",
      border: "1px solid #e94560",
      boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
      padding: "8px 16px",
      margin: "0px",
      transition: "all 0.2s ease",
    },
    {
      selector: "h1",
      tagName: "h1",
      backgroundColor: "transparent",
      color: "#1a1a2e",
      fontSize: "32px",
      fontFamily: "Inter, sans-serif",
      fontWeight: "700",
      lineHeight: "1.2",
      letterSpacing: "-0.02em",
      borderRadius: "0px",
      border: "none",
      boxShadow: "none",
      padding: "0px",
      margin: "0px 0px 16px 0px",
      transition: "none",
    },
  ],
  stylesheets: [
    "body { background-color: #f5f5f5; z-index: 1; } .modal { z-index: 100; } .tooltip { z-index: 200; }",
    "@keyframes fade { from { opacity: 0 } to { opacity: 1 } }",
  ],
  fontFaces: [
    `@font-face { font-family: "Inter"; src: url('/fonts/Inter.woff2'); }`,
  ],
  metaColors: ["#1a1a2e"],
};

describe("tokenizeStyles", () => {
  test("returns a DesignTokens object", () => {
    const tokens = tokenizeStyles(FIXTURE);
    expect(tokens).toBeDefined();
    expect(Array.isArray(tokens.colors)).toBe(true);
    expect(Array.isArray(tokens.borderRadius)).toBe(true);
    expect(Array.isArray(tokens.shadows)).toBe(true);
    expect(Array.isArray(tokens.spacing)).toBe(true);
    expect(Array.isArray(tokens.zIndices)).toBe(true);
    expect(tokens.typography).toBeDefined();
  });

  test("extracts colors and deduplicates", () => {
    const tokens = tokenizeStyles(FIXTURE);
    expect(tokens.colors.length).toBeGreaterThan(0);
    // All values should be unique
    const vals = tokens.colors.map((c) => c.value);
    expect(new Set(vals).size).toBe(vals.length);
  });

  test("sorts colors by frequency (highest first)", () => {
    const tokens = tokenizeStyles(FIXTURE);
    for (let i = 1; i < tokens.colors.length; i++) {
      expect(tokens.colors[i - 1].frequency).toBeGreaterThanOrEqual(tokens.colors[i].frequency);
    }
  });

  test("extracts font families", () => {
    const tokens = tokenizeStyles(FIXTURE);
    expect(tokens.typography.fontFamilies.length).toBeGreaterThan(0);
    expect(tokens.typography.fontFamilies[0]).toBe("Inter");
  });

  test("converts font sizes to rem", () => {
    const tokens = tokenizeStyles(FIXTURE);
    // 14px → 0.875rem, 32px → 2rem
    const hasRem = tokens.typography.fontSizes.some((s) => s.endsWith("rem"));
    expect(hasRem).toBe(true);
  });

  test("extracts border radii and deduplicates", () => {
    const tokens = tokenizeStyles(FIXTURE);
    expect(tokens.borderRadius.length).toBeGreaterThan(0);
    // Should contain 6px from button
    expect(tokens.borderRadius).toContain("6px");
  });

  test("extracts z-indices and sorts numerically", () => {
    const tokens = tokenizeStyles(FIXTURE);
    expect(tokens.zIndices.length).toBeGreaterThan(0);
    for (let i = 1; i < tokens.zIndices.length; i++) {
      expect(Number(tokens.zIndices[i - 1])).toBeLessThanOrEqual(Number(tokens.zIndices[i]));
    }
  });

  test("extracts shadows and filters 'none'", () => {
    const tokens = tokenizeStyles(FIXTURE);
    expect(tokens.shadows.every((s) => s !== "none")).toBe(true);
  });
});
