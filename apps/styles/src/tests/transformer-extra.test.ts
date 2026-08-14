import { describe, expect, test } from "bun:test";
import { toW3cTokens, toScss, toStyleDictionary, transform } from "../lib/transformer.js";
import type { DesignTokens } from "../lib/tokenizer.js";

const FIXTURE_TOKENS: DesignTokens = {
  colors: [
    { value: "#1a1a2e", frequency: 10, source: "css-var", name: "primary" },
    { value: "#e94560", frequency: 6, source: "computed" },
    { value: "#f5f5f5", frequency: 3, source: "computed" },
    { value: "#ffffff", frequency: 2, source: "computed" },
  ],
  typography: {
    fontFamilies: ["Inter", "Georgia"],
    fontSizes: ["0.875rem", "1rem", "1.25rem", "2rem"],
    fontWeights: ["400", "600", "700"],
    lineHeights: ["1.2", "1.5"],
    letterSpacings: ["0.01em", "-0.02em"],
    fontFaces: [],
    families: [{ name: "Inter", weights: ["400", "600", "700"], styles: [], isVariable: false }],
    scale: [],
  },
  spacing: ["0.5rem", "1rem", "1.5rem", "2rem"],
  borderRadius: ["4px", "6px", "12px", "9999px"],
  shadows: ["0 2px 8px rgba(0,0,0,0.15)", "0 4px 16px rgba(0,0,0,0.2)"],
  transitions: ["all 0.2s ease"],
  zIndices: ["1", "100"],
  gradients: ["linear-gradient(135deg, #1a1a2e 0%, #e94560 100%)"],
};

describe("toW3cTokens", () => {
  test("returns format='w3c' and valid JSON", () => {
    const result = toW3cTokens(FIXTURE_TOKENS);
    expect(result.format).toBe("w3c");
    const config = result.config as Record<string, Record<string, { $value: unknown; $type: string }>>;
    expect(config.color).toBeDefined();
    expect(config.borderRadius).toBeDefined();
    expect(config.spacing).toBeDefined();
    expect(config.shadow).toBeDefined();
  });

  test("uses correct $type annotations", () => {
    const result = toW3cTokens(FIXTURE_TOKENS);
    const config = result.config as Record<string, Record<string, { $value: unknown; $type: string }>>;
    // Colors have $type: color
    const firstColor = Object.values(config.color)[0];
    expect(firstColor.$type).toBe("color");
    // Border radii have $type: dimension
    const firstRadius = Object.values(config.borderRadius)[0];
    expect(firstRadius.$type).toBe("dimension");
    // Shadows have $type: shadow
    const firstShadow = Object.values(config.shadow)[0];
    expect(firstShadow.$type).toBe("shadow");
  });

  test("uses semantic names for border radii", () => {
    const result = toW3cTokens(FIXTURE_TOKENS);
    const config = result.config as Record<string, Record<string, unknown>>;
    const keys = Object.keys(config.borderRadius);
    expect(keys[0]).toBe("none");
    expect(keys[1]).toBe("sm");
  });

  test("uses semantic weight names", () => {
    const result = toW3cTokens(FIXTURE_TOKENS);
    const config = result.config as Record<string, Record<string, { $value: unknown }>>;
    const weightKeys = Object.keys(config.fontWeight);
    // 400 → "regular", 600 → "semibold", 700 → "bold"
    expect(weightKeys).toContain("regular");
    expect(weightKeys).toContain("semibold");
    expect(weightKeys).toContain("bold");
  });

  test("includes gradients when present", () => {
    const result = toW3cTokens(FIXTURE_TOKENS);
    const config = result.config as Record<string, Record<string, { $value: unknown; $type: string }>>;
    expect(config.gradient).toBeDefined();
    // First gradient should have $type: gradient
    const firstGrad = Object.values(config.gradient)[0];
    expect(firstGrad.$type).toBe("gradient");
  });

  test("handles empty tokens gracefully", () => {
    const empty: DesignTokens = {
      ...FIXTURE_TOKENS,
      colors: [],
      borderRadius: [],
      shadows: [],
      spacing: [],
      gradients: [],
    };
    const result = toW3cTokens(empty);
    expect(result.format).toBe("w3c");
    const config = result.config as Record<string, unknown>;
    expect(Object.keys(config).length).toBeGreaterThan(0); // still has typography
  });
});

describe("toScss", () => {
  test("returns format='scss' and non-empty code", () => {
    const result = toScss(FIXTURE_TOKENS);
    expect(result.format).toBe("scss");
    expect(result.code.length).toBeGreaterThan(50);
  });

  test("generates SCSS variable declarations", () => {
    const result = toScss(FIXTURE_TOKENS);
    expect(result.code).toContain("$primary:"); // named color
    expect(result.code).toContain("$font-sans");
    expect(result.code).toContain("$spacing-1");
    expect(result.code).toContain("$radius-sm");
  });

  test("sorts colors section", () => {
    const result = toScss(FIXTURE_TOKENS);
    expect(result.code).toContain("// Colors");
  });

  test("has typography, spacing, border radius, and shadow sections", () => {
    const result = toScss(FIXTURE_TOKENS);
    expect(result.code).toContain("// Typography");
    expect(result.code).toContain("// Spacing");
    expect(result.code).toContain("// Border radius");
    expect(result.code).toContain("// Shadows");
  });
});

describe("toStyleDictionary", () => {
  test("returns format='style-dictionary' and valid JSON", () => {
    const result = toStyleDictionary(FIXTURE_TOKENS);
    expect(result.format).toBe("style-dictionary");
    const config = result.config as { properties: Record<string, unknown> };
    expect(config.properties).toBeDefined();
    expect(config.properties.color).toBeDefined();
    expect(config.properties.font).toBeDefined();
    expect(config.properties.border_radius).toBeDefined();
    expect(config.properties.shadow).toBeDefined();
  });

  test("colors include frequency comment", () => {
    const result = toStyleDictionary(FIXTURE_TOKENS);
    const config = result.config as { properties: { color: Record<string, { value: string; comment: string }> } };
    const firstColor = Object.values(config.properties.color)[0];
    expect(firstColor.comment).toContain("frequency");
  });

  test("handles minimal tokens", () => {
    const minimal: DesignTokens = {
      ...FIXTURE_TOKENS,
      colors: [],
      borderRadius: [],
      shadows: [],
      spacing: [],
    };
    const result = toStyleDictionary(minimal);
    const config = result.config as { properties: Record<string, unknown> };
    expect(config.properties).toBeDefined();
  });
});

describe("transform unified entry — extra formats", () => {
  test("format=w3c", () => {
    const result = transform(FIXTURE_TOKENS, "w3c");
    expect(result.format).toBe("w3c");
    expect(result.code.length).toBeGreaterThan(10);
  });

  test("format=scss", () => {
    const result = transform(FIXTURE_TOKENS, "scss");
    expect(result.format).toBe("scss");
    expect(result.code.length).toBeGreaterThan(10);
  });

  test("format=style-dictionary", () => {
    const result = transform(FIXTURE_TOKENS, "style-dictionary");
    expect(result.format).toBe("style-dictionary");
    expect(result.code.length).toBeGreaterThan(10);
  });

  test("format=figma", () => {
    const result = transform(FIXTURE_TOKENS, "figma");
    expect(result.format).toBe("figma");
    expect(result.code.length).toBeGreaterThan(10);
  });

  test("unknown format defaults to shadcn", () => {
    const result = transform(FIXTURE_TOKENS, "unknown" as Parameters<typeof transform>[1]);
    expect(result.format).toBe("shadcn");
    expect(result.code).toContain("shadcn");
  });
});
