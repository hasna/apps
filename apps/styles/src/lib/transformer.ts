import type { DesignTokens, ColorToken } from "./tokenizer.js";
import { toFigmaVariables } from "./figma.js";

export type TransformFormat = "shadcn" | "tailwind" | "css-vars" | "mui" | "radix" | "w3c" | "scss" | "style-dictionary" | "figma";

export interface TransformResult {
  format: TransformFormat;
  config: unknown;
  code: string;
}

// Pick top N colors by frequency, return hex values
function topColors(tokens: DesignTokens, n = 20): ColorToken[] {
  return tokens.colors.slice(0, n);
}

function colorName(c: ColorToken, index: number): string {
  if (c.name) return c.name;
  // Try to derive from CSS var name if known, else use index
  return `color-${index + 1}`;
}

function buildColorMap(tokens: DesignTokens): Record<string, string> {
  const map: Record<string, string> = {};
  topColors(tokens).forEach((c, i) => {
    map[colorName(c, i)] = c.value;
  });
  return map;
}

// --- shadcn / tailwind ---

export function toShadcnConfig(tokens: DesignTokens): TransformResult {
  const colors = buildColorMap(tokens);
  const [primary, ...rest] = tokens.colors;

  const shadcnVars: Record<string, string> = {};
  if (primary) shadcnVars["--primary"] = primary.value;
  if (rest[0]) shadcnVars["--secondary"] = rest[0].value;
  if (rest[1]) shadcnVars["--accent"] = rest[1].value;
  if (rest[2]) shadcnVars["--muted"] = rest[2].value;

  const config = {
    theme: {
      extend: {
        colors,
        borderRadius: Object.fromEntries(
          tokens.borderRadius.slice(0, 8).map((r, i) => [`radius-${i + 1}`, r])
        ),
        fontFamily: Object.fromEntries(
          tokens.typography.fontFamilies.slice(0, 4).map((f, i) => [
            i === 0 ? "sans" : i === 1 ? "serif" : `font-${i + 1}`,
            [f, "sans-serif"],
          ])
        ),
        fontSize: Object.fromEntries(
          tokens.typography.fontSizes.slice(0, 10).map((s, i) => [`text-${i + 1}`, s])
        ),
        boxShadow: Object.fromEntries(
          tokens.shadows.slice(0, 6).map((s, i) => [`shadow-${i + 1}`, s])
        ),
      },
    },
    cssVars: shadcnVars,
  };

  const code = `// tailwind.config.ts (shadcn/ui compatible)
import type { Config } from "tailwindcss";

const config: Config = {
  theme: {
    extend: ${JSON.stringify(config.theme.extend, null, 2)},
  },
};

export default config;

// Add to globals.css:
// @layer base {
//   :root {
${Object.entries(shadcnVars)
  .map(([k, v]) => `//     ${k}: ${v};`)
  .join("\n")}
//   }
// }`;

  return { format: "shadcn", config, code };
}

export function toTailwindTheme(tokens: DesignTokens): TransformResult {
  const config = {
    colors: buildColorMap(tokens),
    borderRadius: Object.fromEntries(
      tokens.borderRadius.slice(0, 8).map((r, i) => [`r${i + 1}`, r])
    ),
    fontFamily: Object.fromEntries(
      tokens.typography.fontFamilies.slice(0, 4).map((f, i) => [
        `font${i + 1}`,
        [f],
      ])
    ),
    fontSize: Object.fromEntries(
      tokens.typography.fontSizes.slice(0, 10).map((s, i) => [`size${i + 1}`, s])
    ),
    boxShadow: Object.fromEntries(
      tokens.shadows.slice(0, 6).map((s, i) => [`shadow${i + 1}`, s])
    ),
    fontWeight: Object.fromEntries(
      tokens.typography.fontWeights.map((w) => [w, w])
    ),
  };

  const code = `// tailwind.config.ts — theme.extend
export const themeExtend = ${JSON.stringify(config, null, 2)};`;

  return { format: "tailwind", config, code };
}

// --- CSS variables ---

export function toCssVariables(tokens: DesignTokens): TransformResult {
  const vars: string[] = [];

  topColors(tokens).forEach((c, i) => {
    vars.push(`  --color-${i + 1}: ${c.value};`);
  });

  tokens.typography.fontFamilies.forEach((f, i) => {
    vars.push(`  --font-${i + 1}: "${f}", sans-serif;`);
  });

  tokens.typography.fontSizes.forEach((s, i) => {
    vars.push(`  --font-size-${i + 1}: ${s};`);
  });

  tokens.borderRadius.slice(0, 8).forEach((r, i) => {
    vars.push(`  --radius-${i + 1}: ${r};`);
  });

  tokens.shadows.slice(0, 6).forEach((s, i) => {
    vars.push(`  --shadow-${i + 1}: ${s};`);
  });

  tokens.spacing.slice(0, 12).forEach((s, i) => {
    vars.push(`  --spacing-${i + 1}: ${s};`);
  });

  const code = `:root {\n${vars.join("\n")}\n}`;

  return { format: "css-vars", config: { vars }, code };
}

// --- MUI ---

export function toMuiTheme(tokens: DesignTokens): TransformResult {
  const [primary, secondary, ...rest] = tokens.colors;
  const config = {
    palette: {
      primary: { main: primary?.value ?? "#000" },
      secondary: { main: secondary?.value ?? "#666" },
      background: {
        default: rest[0]?.value ?? "#fff",
        paper: rest[1]?.value ?? "#f5f5f5",
      },
    },
    typography: {
      fontFamily: tokens.typography.fontFamilies[0]
        ? `"${tokens.typography.fontFamilies[0]}", sans-serif`
        : undefined,
    },
    shape: {
      borderRadius: tokens.borderRadius[0]
        ? Number.parseInt(tokens.borderRadius[0]) || 4
        : 4,
    },
  };

  const code = `// MUI theme — createTheme(themeOptions)
import { createTheme } from "@mui/material/styles";

export const theme = createTheme(${JSON.stringify(config, null, 2)});`;

  return { format: "mui", config, code };
}

// --- Radix UI ---

export function toRadixConfig(tokens: DesignTokens): TransformResult {
  const vars: string[] = [];

  topColors(tokens, 12).forEach((c, i) => {
    vars.push(`  --color-${i + 1}: ${c.value};`);
  });

  tokens.borderRadius.slice(0, 6).forEach((r, i) => {
    vars.push(`  --radius-${i + 1}: ${r};`);
  });

  tokens.typography.fontFamilies.slice(0, 2).forEach((f, i) => {
    vars.push(`  --font-${i === 0 ? "sans" : "mono"}: "${f}", sans-serif;`);
  });

  const code = `/* Radix UI CSS variables */
:root {
${vars.join("\n")}
}`;

  return { format: "radix", config: { vars }, code };
}

// --- W3C DTCG tokens.json ---

export function toW3cTokens(tokens: DesignTokens): TransformResult {
  const result: Record<string, unknown> = {};

  // Colors
  if (tokens.colors.length > 0) {
    const colorGroup: Record<string, unknown> = {};
    topColors(tokens, 30).forEach((c, i) => {
      const key = c.name ? c.name.replace(/\s+/g, "-") : `color-${i + 1}`;
      // Avoid duplicate keys by appending index if needed
      const finalKey = colorGroup[key] ? `${key}-${i + 1}` : key;
      colorGroup[finalKey] = { $value: c.value, $type: "color" };
    });
    result["color"] = colorGroup;
  }

  // Border radius (dimension)
  if (tokens.borderRadius.length > 0) {
    const radiiGroup: Record<string, unknown> = {};
    const names = ["none", "sm", "md", "lg", "xl", "2xl", "full", "pill"];
    tokens.borderRadius.slice(0, 8).forEach((r, i) => {
      radiiGroup[names[i] ?? `r${i + 1}`] = { $value: r, $type: "dimension" };
    });
    result["borderRadius"] = radiiGroup;
  }

  // Spacing
  if (tokens.spacing.length > 0) {
    const spacingGroup: Record<string, unknown> = {};
    tokens.spacing.slice(0, 12).forEach((s, i) => {
      spacingGroup[`spacing-${i + 1}`] = { $value: s, $type: "dimension" };
    });
    result["spacing"] = spacingGroup;
  }

  // Shadows
  if (tokens.shadows.length > 0) {
    const shadowGroup: Record<string, unknown> = {};
    const shadowNames = ["sm", "md", "lg", "xl", "2xl", "inner"];
    tokens.shadows.slice(0, 6).forEach((s, i) => {
      shadowGroup[shadowNames[i] ?? `shadow-${i + 1}`] = { $value: s, $type: "shadow" };
    });
    result["shadow"] = shadowGroup;
  }

  // Typography
  if (tokens.typography.fontFamilies.length > 0) {
    const fontGroup: Record<string, unknown> = {};
    tokens.typography.fontFamilies.forEach((f, i) => {
      fontGroup[i === 0 ? "sans" : i === 1 ? "serif" : `font-${i + 1}`] = { $value: f, $type: "fontFamily" };
    });
    result["fontFamily"] = fontGroup;
  }

  if (tokens.typography.fontSizes.length > 0) {
    const sizeGroup: Record<string, unknown> = {};
    const sizeNames = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"];
    tokens.typography.fontSizes.slice(0, 10).forEach((s, i) => {
      sizeGroup[sizeNames[i] ?? `size-${i + 1}`] = { $value: s, $type: "dimension" };
    });
    result["fontSize"] = sizeGroup;
  }

  if (tokens.typography.fontWeights.length > 0) {
    const weightGroup: Record<string, unknown> = {};
    const weightNames: Record<string, string> = { "100": "thin", "200": "extralight", "300": "light", "400": "regular", "500": "medium", "600": "semibold", "700": "bold", "800": "extrabold", "900": "black" };
    tokens.typography.fontWeights.forEach((w) => {
      weightGroup[weightNames[w] ?? `weight-${w}`] = { $value: Number(w), $type: "fontWeight" };
    });
    result["fontWeight"] = weightGroup;
  }

  if (tokens.gradients.length > 0) {
    const gradientGroup: Record<string, unknown> = {};
    tokens.gradients.slice(0, 6).forEach((g, i) => {
      gradientGroup[`gradient-${i + 1}`] = { $value: g, $type: "gradient" };
    });
    result["gradient"] = gradientGroup;
  }

  const code = JSON.stringify(result, null, 2);
  return { format: "w3c", config: result, code };
}

// --- SCSS variables ---

export function toScss(tokens: DesignTokens): TransformResult {
  const lines: string[] = ["// Design tokens — auto-generated\n"];

  // Colors
  if (tokens.colors.length > 0) {
    lines.push("// Colors");
    topColors(tokens, 20).forEach((c, i) => {
      const name = c.name ? c.name.replace(/\s+/g, "-") : `color-${i + 1}`;
      lines.push(`$${name}: ${c.value};`);
    });
    lines.push("");
  }

  // Typography
  if (tokens.typography.fontFamilies.length > 0) {
    lines.push("// Typography");
    tokens.typography.fontFamilies.forEach((f, i) => {
      lines.push(`$font-${i === 0 ? "sans" : i === 1 ? "serif" : i + 1}: "${f}", sans-serif;`);
    });
    tokens.typography.fontSizes.slice(0, 8).forEach((s, i) => {
      const names = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl"];
      lines.push(`$font-size-${names[i] ?? i + 1}: ${s};`);
    });
    tokens.typography.fontWeights.forEach((w) => {
      const names: Record<string, string> = { "300": "light", "400": "regular", "500": "medium", "600": "semibold", "700": "bold" };
      lines.push(`$font-weight-${names[w] ?? w}: ${w};`);
    });
    lines.push("");
  }

  // Spacing
  if (tokens.spacing.length > 0) {
    lines.push("// Spacing");
    tokens.spacing.slice(0, 10).forEach((s, i) => {
      lines.push(`$spacing-${i + 1}: ${s};`);
    });
    lines.push("");
  }

  // Border radius
  if (tokens.borderRadius.length > 0) {
    lines.push("// Border radius");
    const names = ["none", "sm", "md", "lg", "xl", "2xl", "full", "pill"];
    tokens.borderRadius.slice(0, 8).forEach((r, i) => {
      lines.push(`$radius-${names[i] ?? i + 1}: ${r};`);
    });
    lines.push("");
  }

  // Shadows
  if (tokens.shadows.length > 0) {
    lines.push("// Shadows");
    const names = ["sm", "md", "lg", "xl", "2xl", "inner"];
    tokens.shadows.slice(0, 6).forEach((s, i) => {
      lines.push(`$shadow-${names[i] ?? i + 1}: ${s};`);
    });
  }

  const code = lines.join("\n");
  return { format: "scss", config: { variables: lines }, code };
}

// --- Style Dictionary ---

export function toStyleDictionary(tokens: DesignTokens): TransformResult {
  const properties: Record<string, unknown> = {};

  if (tokens.colors.length > 0) {
    properties["color"] = {};
    topColors(tokens, 20).forEach((c, i) => {
      const name = c.name ? c.name.replace(/[\s-]+/g, "_") : `color_${i + 1}`;
      (properties["color"] as Record<string, unknown>)[name] = { value: c.value, comment: `frequency: ${c.frequency}` };
    });
  }

  if (tokens.typography.fontFamilies.length > 0) {
    properties["font"] = { family: {} };
    tokens.typography.fontFamilies.forEach((f, i) => {
      ((properties["font"] as Record<string, unknown>)["family"] as Record<string, unknown>)[i === 0 ? "sans" : `font_${i + 1}`] = { value: f };
    });
  }

  if (tokens.borderRadius.length > 0) {
    properties["border_radius"] = {};
    const names = ["none", "sm", "md", "lg", "xl", "xxl", "full", "pill"];
    tokens.borderRadius.slice(0, 8).forEach((r, i) => {
      (properties["border_radius"] as Record<string, unknown>)[names[i] ?? `r${i + 1}`] = { value: r };
    });
  }

  if (tokens.shadows.length > 0) {
    properties["shadow"] = {};
    tokens.shadows.slice(0, 6).forEach((s, i) => {
      (properties["shadow"] as Record<string, unknown>)[`shadow_${i + 1}`] = { value: s };
    });
  }

  const code = JSON.stringify({ properties }, null, 2);
  return { format: "style-dictionary", config: { properties }, code };
}

// --- Unified entry ---

export function transform(tokens: DesignTokens, format: TransformFormat): TransformResult {
  switch (format) {
    case "shadcn": return toShadcnConfig(tokens);
    case "tailwind": return toTailwindTheme(tokens);
    case "css-vars": return toCssVariables(tokens);
    case "mui": return toMuiTheme(tokens);
    case "radix": return toRadixConfig(tokens);
    case "w3c": return toW3cTokens(tokens);
    case "scss": return toScss(tokens);
    case "style-dictionary": return toStyleDictionary(tokens);
    case "figma": {
      const payload = toFigmaVariables(tokens);
      return { format: "figma", config: payload, code: JSON.stringify(payload, null, 2) };
    }
    default: return toShadcnConfig(tokens);
  }
}
