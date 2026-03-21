import type { DesignTokens, ColorToken } from "./tokenizer.js";

export type TransformFormat = "shadcn" | "tailwind" | "css-vars" | "mui" | "radix";

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

// --- Unified entry ---

export function transform(tokens: DesignTokens, format: TransformFormat): TransformResult {
  switch (format) {
    case "shadcn": return toShadcnConfig(tokens);
    case "tailwind": return toTailwindTheme(tokens);
    case "css-vars": return toCssVariables(tokens);
    case "mui": return toMuiTheme(tokens);
    case "radix": return toRadixConfig(tokens);
    default: return toShadcnConfig(tokens);
  }
}
