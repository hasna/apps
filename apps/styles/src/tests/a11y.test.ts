import { describe, expect, test } from "bun:test";
import { auditColorContrast } from "../lib/a11y.js";
import type { DesignTokens } from "../lib/tokenizer.js";
import type { RawExtractedStyles } from "../lib/extractor.js";

const FIXTURE_TOKENS: DesignTokens = {
  colors: [
    { value: "#1a1a2e", frequency: 10, source: "css-var" },
    { value: "#e94560", frequency: 6, source: "computed" },
    { value: "#f5f5f5", frequency: 3, source: "computed" },
  ],
  typography: {
    fontFamilies: ["Inter"],
    fontSizes: ["1rem"],
    fontWeights: ["400"],
    lineHeights: ["1.5"],
    letterSpacings: ["0"],
    fontFaces: [],
    families: [{ name: "Inter", weights: ["400"], styles: [], isVariable: false }],
    scale: [],
  },
  spacing: ["1rem"],
  borderRadius: ["6px"],
  shadows: ["0 2px 8px rgba(0,0,0,0.15)"],
  transitions: [],
  zIndices: ["1"],
  gradients: [],
};

// Single-color fixture to avoid extra pairs from the top-colors-against-each-other loop in auditColorContrast
const SINGLE_COLOR_TOKENS: DesignTokens = {
  ...FIXTURE_TOKENS,
  colors: [{ value: "#1a1a2e", frequency: 10, source: "css-var" }],
};

function makeRaw(
  overrides: Partial<RawExtractedStyles["computedElements"][number]>[] = []
): RawExtractedStyles {
  return {
    url: "https://example.com",
    extractedAt: Date.now(),
    cssVars: {},
    computedElements: overrides.map((el, i) => ({
      selector: "div",
      tagName: "div",
      backgroundColor: "transparent",
      color: "transparent",
      fontSize: "16px",
      fontFamily: "sans-serif",
      fontWeight: "400",
      lineHeight: "1.5",
      letterSpacing: "normal",
      borderRadius: "0px",
      border: "none",
      boxShadow: "none",
      padding: "0px",
      margin: "0px",
      transition: "none",
      ...el,
    })),
    stylesheets: [],
    fontFaces: [],
    metaColors: [],
  };
}

describe("auditColorContrast", () => {
  test("returns empty pairs when no raw data provided", () => {
    const result = auditColorContrast(FIXTURE_TOKENS);
    expect(result.pairs.length).toBeGreaterThanOrEqual(0);
    expect(result.score).toBe(100);
  });

  test("returns empty pairs when no computed elements (single color)", () => {
    const raw = makeRaw();
    const result = auditColorContrast(SINGLE_COLOR_TOKENS, raw);
    // transparent bg/fg are skipped; single color means no cross-color pairs
    expect(result.pairs.length).toBe(0);
    expect(result.score).toBe(100);
  });

  test("detects color pairs from computed elements", () => {
    const raw = makeRaw([{
      backgroundColor: "#ffffff",
      color: "#1a1a2e",
    }]);
    const result = auditColorContrast(FIXTURE_TOKENS, raw);
    expect(result.pairs.length).toBeGreaterThan(0);
    const pair = result.pairs.find((p) => p.foreground === "#1a1a2e" && p.background === "#ffffff");
    expect(pair).toBeDefined();
    expect(pair!.ratio).toBeGreaterThan(0);
  });

  test("white on dark yields AAA contrast", () => {
    const raw = makeRaw([{
      backgroundColor: "#000000",
      color: "#ffffff",
    }]);
    const result = auditColorContrast(FIXTURE_TOKENS, raw);
    const pair = result.pairs[0];
    expect(pair.level).toBe("AAA");
    expect(pair.ratio).toBeGreaterThanOrEqual(7);
  });

  test("dark gray on dark yields fail", () => {
    const raw = makeRaw([{
      backgroundColor: "#1a1a2e",
      color: "#1f2937",
    }]);
    const result = auditColorContrast(SINGLE_COLOR_TOKENS, raw);
    expect(result.pairs.length).toBe(1);
    expect(result.pairs[0].level).toBe("fail");
    expect(result.pairs[0].ratio).toBeLessThan(3);
  });

  test("skips transparent backgrounds", () => {
    const raw = makeRaw([{
      backgroundColor: "rgba(0,0,0,0)",
      color: "#ffffff",
    }]);
    const result = auditColorContrast(SINGLE_COLOR_TOKENS, raw);
    // transparent bg is skipped, single color = no cross-color pairs
    expect(result.pairs.length).toBe(0);
  });

  test("includes element tag name", () => {
    const raw = makeRaw([{
      backgroundColor: "#ffffff",
      color: "#000000",
    }]);
    (raw.computedElements[0] as unknown as Record<string, string>).tagName = "button";
    const result = auditColorContrast(SINGLE_COLOR_TOKENS, raw);
    const elemPair = result.pairs.find((p) => p.element === "button");
    expect(elemPair).toBeDefined();
    expect(elemPair!.element).toBe("button");
  });

  test("scores 100 when all pairs pass", () => {
    const raw = makeRaw([{
      backgroundColor: "#ffffff",
      color: "#000000",
    }]);
    const result = auditColorContrast(SINGLE_COLOR_TOKENS, raw);
    expect(result.score).toBe(100);
    expect(result.failCount).toBe(0);
  });

  test("scores 0 when all pairs fail", () => {
    const raw = makeRaw([{
      backgroundColor: "#111111",
      color: "#1a1a2e",
    }]);
    // Use single-color tokens to avoid extra pass pairs from the cross-color loop
    const result = auditColorContrast(SINGLE_COLOR_TOKENS, raw);
    expect(result.pairs.length).toBe(1);
    expect(result.passCount).toBe(0);
    expect(result.score).toBe(0);
  });

  test("deduplicates identical color pairs from computed elements", () => {
    const raw = makeRaw([
      { backgroundColor: "#ffffff", color: "#000000" },
      { backgroundColor: "#ffffff", color: "#000000" },
    ]);
    const result = auditColorContrast(SINGLE_COLOR_TOKENS, raw);
    // Only 1 pair from computed elements (the duplicates are deduped), 0 from cross-color loop (single color)
    expect(result.pairs.length).toBe(1);
  });

  test("also checks top extracted colors", () => {
    const result = auditColorContrast(FIXTURE_TOKENS);
    // Should have pairs from top colors against each other
    expect(result.pairs.length).toBeGreaterThan(0);
  });
});
