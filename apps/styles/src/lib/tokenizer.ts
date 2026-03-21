import type { RawExtractedStyles } from "./extractor.js";

export interface DesignTokens {
  colors: ColorToken[];
  typography: TypographyTokens;
  spacing: string[];
  borderRadius: string[];
  shadows: string[];
  transitions: string[];
  zIndices: string[];
  gradients: string[];
}

export interface ColorToken {
  value: string;
  frequency: number;
  source: "css-var" | "computed" | "meta";
  name?: string;
}

export interface TypographyTokens {
  fontFamilies: string[];
  fontSizes: string[];
  fontWeights: string[];
  lineHeights: string[];
  letterSpacings: string[];
}

// Matches hex, rgb, rgba, hsl, hsla, named CSS colors (basic set)
const COLOR_RE =
  /#([0-9a-fA-F]{3,8})\b|rgba?\(\s*[\d.,%\s]+\)|hsla?\(\s*[\d.,%\s]+\)/g;

const GRADIENT_RE = /(linear|radial|conic)-gradient\([^)]+\)/g;

const SHADOW_RE =
  /(-?\d+px\s+-?\d+px(?:\s+-?\d+px)?(?:\s+-?\d+px)?\s+(?:rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|\w+)(?:\s+inset)?)/g;

function pxToRem(px: string): string {
  const val = parseFloat(px);
  if (Number.isNaN(val)) return px;
  return `${(val / 16).toFixed(3).replace(/\.?0+$/, "")}rem`;
}

function dedup<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function extractColorsFromText(text: string): string[] {
  return Array.from(text.matchAll(COLOR_RE)).map((m) => m[0]);
}

function normalizeColor(c: string): string {
  return c.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractGradients(text: string): string[] {
  return Array.from(text.matchAll(GRADIENT_RE)).map((m) => m[0]);
}

function parseShadow(val: string): string[] {
  if (!val || val === "none") return [];
  // Split multiple shadows by comma (not inside parens)
  const shadows: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of val) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      if (current.trim()) shadows.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) shadows.push(current.trim());
  return shadows.filter((s) => s !== "none");
}

function normalizeSpacing(val: string): string[] {
  if (!val || val === "0px") return [];
  return val
    .split(/\s+/)
    .filter((v) => /^\d/.test(v) && v !== "0px")
    .map((v) => (v.endsWith("px") ? pxToRem(v) : v));
}

export function tokenizeStyles(raw: RawExtractedStyles): DesignTokens {
  const colorFreq = new Map<string, { freq: number; source: ColorToken["source"] }>();

  function addColor(c: string, source: ColorToken["source"]) {
    const key = normalizeColor(c);
    if (!key) return;
    const existing = colorFreq.get(key);
    if (existing) {
      existing.freq++;
    } else {
      colorFreq.set(key, { freq: 1, source });
    }
  }

  // Colors from CSS vars
  for (const [, val] of Object.entries(raw.cssVars)) {
    for (const c of extractColorsFromText(val)) addColor(c, "css-var");
  }

  // Colors from computed elements
  const colorProps = ["backgroundColor", "color", "border"];
  for (const el of raw.computedElements) {
    for (const prop of colorProps) {
      const val = (el as unknown as Record<string, string>)[prop];
      if (val) for (const c of extractColorsFromText(val)) addColor(c, "computed");
    }
  }

  // Meta colors
  for (const c of raw.metaColors) addColor(c, "meta");

  // Colors from stylesheets
  for (const sheet of raw.stylesheets) {
    for (const c of extractColorsFromText(sheet)) addColor(c, "computed");
  }

  const colors: ColorToken[] = Array.from(colorFreq.entries())
    .map(([value, { freq, source }]) => ({ value, frequency: freq, source }))
    .sort((a, b) => b.frequency - a.frequency);

  // Typography
  const fontFamiliesRaw: string[] = [];
  const fontSizesRaw: string[] = [];
  const fontWeightsRaw: string[] = [];
  const lineHeightsRaw: string[] = [];
  const letterSpacingsRaw: string[] = [];

  for (const el of raw.computedElements) {
    if (el.fontFamily) fontFamiliesRaw.push(el.fontFamily.split(",")[0].trim().replace(/['"]/g, ""));
    if (el.fontSize && el.fontSize !== "0px") {
      fontSizesRaw.push(el.fontSize.endsWith("px") ? pxToRem(el.fontSize) : el.fontSize);
    }
    if (el.fontWeight) fontWeightsRaw.push(el.fontWeight);
    if (el.lineHeight && el.lineHeight !== "normal") lineHeightsRaw.push(el.lineHeight);
    if (el.letterSpacing && el.letterSpacing !== "normal") letterSpacingsRaw.push(el.letterSpacing);
  }

  // Also extract font-family from @font-face
  for (const face of raw.fontFaces) {
    const match = face.match(/font-family:\s*['"]?([^;'"]+)['"]?/i);
    if (match) fontFamiliesRaw.push(match[1].trim());
  }

  // Border radii
  const radiiRaw: string[] = [];
  for (const el of raw.computedElements) {
    if (el.borderRadius && el.borderRadius !== "0px") radiiRaw.push(el.borderRadius);
  }
  // Also from CSS vars
  for (const [key, val] of Object.entries(raw.cssVars)) {
    if (key.includes("radius") || key.includes("rounded")) radiiRaw.push(val);
  }
  // From stylesheets
  for (const sheet of raw.stylesheets) {
    const matches = sheet.matchAll(/border-radius:\s*([^;]+)/gi);
    for (const m of matches) radiiRaw.push(m[1].trim());
  }

  // Shadows
  const shadowsRaw: string[] = [];
  for (const el of raw.computedElements) {
    if (el.boxShadow) shadowsRaw.push(...parseShadow(el.boxShadow));
  }
  for (const [key, val] of Object.entries(raw.cssVars)) {
    if (key.includes("shadow")) shadowsRaw.push(...parseShadow(val));
  }

  // Spacing
  const spacingRaw: string[] = [];
  for (const el of raw.computedElements) {
    spacingRaw.push(...normalizeSpacing(el.padding));
    spacingRaw.push(...normalizeSpacing(el.margin));
  }

  // Transitions
  const transitionsRaw: string[] = [];
  for (const el of raw.computedElements) {
    if (el.transition && el.transition !== "all 0s ease 0s") transitionsRaw.push(el.transition);
  }

  // Z-indices
  const zIndicesRaw: string[] = [];
  for (const sheet of raw.stylesheets) {
    const matches = sheet.matchAll(/z-index:\s*(\d+)/gi);
    for (const m of matches) zIndicesRaw.push(m[1]);
  }

  // Gradients
  const gradientsRaw: string[] = [];
  for (const sheet of raw.stylesheets) {
    gradientsRaw.push(...extractGradients(sheet));
  }
  for (const [, val] of Object.entries(raw.cssVars)) {
    gradientsRaw.push(...extractGradients(val));
  }

  return {
    colors,
    typography: {
      fontFamilies: dedup(fontFamiliesRaw).filter(Boolean),
      fontSizes: dedup(fontSizesRaw).filter(Boolean),
      fontWeights: dedup(fontWeightsRaw).filter(Boolean),
      lineHeights: dedup(lineHeightsRaw).filter(Boolean),
      letterSpacings: dedup(letterSpacingsRaw).filter(Boolean),
    },
    spacing: dedup(spacingRaw).filter(Boolean),
    borderRadius: dedup(radiiRaw).filter(Boolean),
    shadows: dedup(shadowsRaw).filter(Boolean),
    transitions: dedup(transitionsRaw).filter(Boolean),
    zIndices: dedup(zIndicesRaw)
      .filter(Boolean)
      .sort((a, b) => Number(a) - Number(b)),
    gradients: dedup(gradientsRaw).filter(Boolean),
  };
}
