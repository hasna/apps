import { describe, expect, test } from "bun:test";
import { toShadcnConfig, toCssVariables, toTailwindTheme, toMuiTheme, toRadixConfig, transform } from "../lib/transformer.js";
import type { DesignTokens } from "../lib/tokenizer.js";

const FIXTURE_TOKENS: DesignTokens = {
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
  },
  spacing: ["0.5rem", "1rem", "1.5rem", "2rem"],
  borderRadius: ["4px", "6px", "12px", "9999px"],
  shadows: ["0 2px 8px rgba(0,0,0,0.15)", "0 4px 16px rgba(0,0,0,0.2)"],
  transitions: ["all 0.2s ease"],
  zIndices: ["1", "100", "200"],
  gradients: ["linear-gradient(135deg, #1a1a2e 0%, #e94560 100%)"],
};

describe("toShadcnConfig", () => {
  test("returns format='shadcn' and non-empty code", () => {
    const result = toShadcnConfig(FIXTURE_TOKENS);
    expect(result.format).toBe("shadcn");
    expect(result.code.length).toBeGreaterThan(50);
    expect(result.config).toBeDefined();
  });

  test("code contains tailwind extend", () => {
    const result = toShadcnConfig(FIXTURE_TOKENS);
    expect(result.code).toContain("theme");
    expect(result.code).toContain("extend");
  });

  test("config has theme.extend with colors", () => {
    const result = toShadcnConfig(FIXTURE_TOKENS);
    const cfg = result.config as { theme: { extend: { colors: Record<string, string> } } };
    expect(Object.keys(cfg.theme.extend.colors).length).toBeGreaterThan(0);
  });
});

describe("toCssVariables", () => {
  test("returns format='css-vars' and valid :root block", () => {
    const result = toCssVariables(FIXTURE_TOKENS);
    expect(result.format).toBe("css-vars");
    expect(result.code).toContain(":root");
    expect(result.code).toContain("--color-1");
    expect(result.code).toContain("--font-1");
  });

  test("includes border radius vars", () => {
    const result = toCssVariables(FIXTURE_TOKENS);
    expect(result.code).toContain("--radius-1");
  });
});

describe("toTailwindTheme", () => {
  test("returns format='tailwind' and non-empty code", () => {
    const result = toTailwindTheme(FIXTURE_TOKENS);
    expect(result.format).toBe("tailwind");
    expect(result.code.length).toBeGreaterThan(20);
    const cfg = result.config as { colors: Record<string, string> };
    expect(Object.keys(cfg.colors).length).toBeGreaterThan(0);
  });
});

describe("toMuiTheme", () => {
  test("returns format='mui' and uses first color as primary", () => {
    const result = toMuiTheme(FIXTURE_TOKENS);
    expect(result.format).toBe("mui");
    expect(result.code).toContain("createTheme");
    const cfg = result.config as { palette: { primary: { main: string } } };
    expect(cfg.palette.primary.main).toBe("#1a1a2e");
  });
});

describe("toRadixConfig", () => {
  test("returns format='radix' with CSS vars", () => {
    const result = toRadixConfig(FIXTURE_TOKENS);
    expect(result.format).toBe("radix");
    expect(result.code).toContain(":root");
    expect(result.code).toContain("--color-1");
  });
});

describe("transform (unified entry)", () => {
  const formats = ["shadcn", "tailwind", "css-vars", "mui", "radix"] as const;

  for (const fmt of formats) {
    test(`format=${fmt} returns non-empty code`, () => {
      const result = transform(FIXTURE_TOKENS, fmt);
      expect(result.format).toBe(fmt);
      expect(result.code.length).toBeGreaterThan(10);
    });
  }
});
