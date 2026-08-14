import { describe, expect, test } from "bun:test";
import { toFigmaVariables } from "../lib/figma.js";
import type { DesignTokens } from "../lib/tokenizer.js";

const FIXTURE_TOKENS: DesignTokens = {
  colors: [
    { value: "#1a1a2e", frequency: 10, source: "css-var" },
    { value: "#e94560", frequency: 6, source: "computed" },
    { value: "#ffffff", frequency: 3, source: "computed" },
  ],
  typography: {
    fontFamilies: ["Inter", "Georgia"],
    fontSizes: ["0.875rem", "1rem", "1.25rem", "2rem"],
    fontWeights: ["400", "600", "700"],
    lineHeights: ["1.2", "1.5"],
    letterSpacings: ["0.01em"],
    fontFaces: [],
    families: [{ name: "Inter", weights: ["400", "600"], styles: [], isVariable: false }],
    scale: [],
  },
  spacing: ["0.5rem", "1rem", "1.5rem", "2rem"],
  borderRadius: ["4px", "6px", "12px", "9999px"],
  shadows: ["0 2px 8px rgba(0,0,0,0.15)"],
  transitions: [],
  zIndices: ["1", "100"],
  gradients: [],
};

describe("toFigmaVariables", () => {
  test("returns variableCollections and variables", () => {
    const result = toFigmaVariables(FIXTURE_TOKENS);
    expect(result.variableCollections).toBeDefined();
    expect(result.variableCollections.length).toBe(1);
    expect(result.variableCollections[0].name).toBe("Extracted Tokens");
    expect(Array.isArray(result.variables)).toBe(true);
  });

  test("creates mode configuration", () => {
    const result = toFigmaVariables(FIXTURE_TOKENS);
    const coll = result.variableCollections[0];
    expect(coll.modes.length).toBe(1);
    expect(coll.modes[0].modeId).toBe("mode-1");
    expect(coll.modes[0].name).toBe("Default");
  });

  test("creates COLOR variables for top colors", () => {
    const result = toFigmaVariables(FIXTURE_TOKENS);
    const colorVars = result.variables.filter((v) => v.resolvedType === "COLOR");
    expect(colorVars.length).toBeGreaterThan(0);
    const first = colorVars[0];
    expect(first.name).toContain("color/");
    expect(first.valuesByMode["mode-1"]).toBeDefined();
    const val = first.valuesByMode["mode-1"] as { r: number; g: number; b: number };
    expect(val.r).toBeGreaterThanOrEqual(0);
    expect(val.r).toBeLessThanOrEqual(1);
  });

  test("includes named colors with proper path", () => {
    const tokens: DesignTokens = {
      ...FIXTURE_TOKENS,
      colors: [{ value: "#ff0000", frequency: 10, source: "css-var", name: "primary" }],
    };
    const result = toFigmaVariables(tokens);
    expect(result.variables[0].name).toBe("color/primary");
  });

  test("creates FLOAT variables for border radii", () => {
    const result = toFigmaVariables(FIXTURE_TOKENS);
    const radiusVars = result.variables.filter((v) => v.name.startsWith("radius/"));
    expect(radiusVars.length).toBeGreaterThan(0);
    expect(radiusVars[0].resolvedType).toBe("FLOAT");
    const val = radiusVars[0].valuesByMode["mode-1"] as number;
    expect(typeof val).toBe("number");
  });

  test("creates FLOAT variables for spacing (rem to px)", () => {
    const result = toFigmaVariables(FIXTURE_TOKENS);
    const spacingVars = result.variables.filter((v) => v.name.startsWith("spacing/"));
    expect(spacingVars.length).toBeGreaterThan(0);
    // 1rem → 16px
    const oneRem = spacingVars.find((v) => v.valuesByMode["mode-1"] === 16);
    expect(oneRem).toBeDefined();
  });

  test("creates STRING variables for font families", () => {
    const result = toFigmaVariables(FIXTURE_TOKENS);
    const fontVars = result.variables.filter((v) => v.name.startsWith("typography/"));
    const sans = fontVars.find((v) => v.name === "typography/font-sans");
    expect(sans).toBeDefined();
    expect(sans!.resolvedType).toBe("STRING");
    expect(sans!.valuesByMode["mode-1"]).toBe("Inter");
  });

  test("slices to max 40 colors", () => {
    const tokens: DesignTokens = {
      ...FIXTURE_TOKENS,
      colors: Array.from({ length: 50 }, (_, i) => ({
        value: `#${i.toString(16).padStart(6, "0")}`,
        frequency: 50 - i,
        source: "css-var" as const,
      })),
    };
    const result = toFigmaVariables(tokens);
    const colorVars = result.variables.filter((v) => v.resolvedType === "COLOR");
    expect(colorVars.length).toBeLessThanOrEqual(40);
  });

  test("skips unparseable hex colors", () => {
    const tokens: DesignTokens = {
      ...FIXTURE_TOKENS,
      colors: [{ value: "invalid-color", frequency: 1, source: "css-var" }],
    };
    const result = toFigmaVariables(tokens);
    const colorVars = result.variables.filter((v) => v.resolvedType === "COLOR");
    expect(colorVars.length).toBe(0);
  });
});
