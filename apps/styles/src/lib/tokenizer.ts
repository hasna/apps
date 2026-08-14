import type { RawExtractedStyles } from "./extractor.js";

export interface FontFaceDetail {
  family: string;
  weight?: string;
  style?: string;
  src?: string;
  format?: string;
}

export interface TypeScaleEntry {
  tag: string;
  family: string;
  size: string;
  weight: string;
  lineHeight: string;
  letterSpacing: string;
  color?: string;
}

export interface FontFamilyDetail {
  name: string;
  weights: string[];
  styles: string[];
  isVariable: boolean;
}

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
  fontFaces: FontFaceDetail[];
  families: FontFamilyDetail[];
  scale: TypeScaleEntry[];
}

// Matches hex, rgb, rgba, hsl, hsla
const COLOR_RE =
  /#([0-9a-fA-F]{3,8})\b|rgba?\(\s*[\d.,/%\s]+\)|hsla?\(\s*[\d.,/%\s]+\)/g;

const GRADIENT_RE = /(linear|radial|conic)-gradient\([^)]+\)/g;

// A valid shadow fragment must start with at least two offset values (e.g. "0px 4px")
const VALID_SHADOW_RE = /^-?\d+(\.\d+)?(px|rem|em)?\s+-?\d+(\.\d+)?(px|rem|em)?/;

function pxToRem(px: string): string {
  const val = parseFloat(px);
  if (Number.isNaN(val)) return px;
  return `${(val / 16).toFixed(3).replace(/\.?0+$/, "")}rem`;
}

function dedup<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

// ── Color normalization ───────────────────────────────────────────────────────

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

/** Convert any color string to lowercase hex (where possible) for reliable dedup */
function normalizeColor(c: string): string {
  const s = c.replace(/\s+/g, " ").trim().toLowerCase();

  // rgb(r, g, b) or rgb(r g b)
  const rgbMatch = s.match(/^rgba?\(\s*([\d.]+)[,\s]\s*([\d.]+)[,\s]\s*([\d.]+)/);
  if (rgbMatch) {
    const a = s.match(/,\s*([\d.]+)\s*\)$/);
    const alpha = a ? parseFloat(a[1]) : 1;
    if (alpha < 0.05) return ""; // fully transparent → discard
    return rgbToHex(parseFloat(rgbMatch[1]), parseFloat(rgbMatch[2]), parseFloat(rgbMatch[3]));
  }

  // Expand 3-char hex to 6-char
  const hex3 = s.match(/^#([0-9a-f]{3})$/);
  if (hex3) {
    const [, h] = hex3;
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }

  // 4-char hex (#rgba) → expand to 8-char (#rrggbbaa)
  const hex4 = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (hex4) {
    return `#${hex4[1]}${hex4[1]}${hex4[2]}${hex4[2]}${hex4[3]}${hex4[3]}${hex4[4]}${hex4[4]}`;
  }

  return s;
}

/** Returns true if the color is visible (not transparent/ghost) */
function isVisibleColor(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  // rgba with 0 alpha
  if (/rgba?\(\s*[\d.]+[,\s]\s*[\d.]+[,\s]\s*[\d.]+[,\s]\s*0\s*\)/.test(s)) return false;
  // 4-char hex shorthand with 0 alpha: #rgb0 (e.g. #0000, #fff0)
  if (/^#[0-9a-f]{3}0$/i.test(s)) return false;
  // hex with 00 alpha suffix (8-digit hex: #rrggbbaa where aa < 10)
  if (/^#[0-9a-f]{6}(00|01|02|03|04|05|06|07|08|09|0a|0b|0c|0d|0e|0f)$/i.test(s)) return false;
  // 4-char hex with very low alpha (e.g. #0001, #fff1) — keep these, they're barely visible but intentional
  return true;
}

function extractColorsFromText(text: string): string[] {
  return Array.from(text.matchAll(COLOR_RE)).map((m) => m[0]);
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
  // Validate: must look like a real shadow (starts with at least 2 offset values)
  return shadows.filter((s) => s !== "none" && s.length > 8 && VALID_SHADOW_RE.test(s));
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
    if (!isVisibleColor(c)) return;
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

  // Parse @font-face declarations into structured details
  const fontFaceDetails: FontFaceDetail[] = [];
  for (const face of raw.fontFaces) {
    const familyMatch = face.match(/font-family:\s*['"]?([^;'"]+)['"]?/i);
    const weightMatch = face.match(/font-weight:\s*([^;]+)/i);
    const styleMatch = face.match(/font-style:\s*([^;]+)/i);
    const srcMatch = face.match(/src:\s*url\(['"]?([^'")\s]+)['"]?\)/i);
    const formatMatch = face.match(/format\(['"]?([^'")\s]+)['"]?\)/i);
    if (familyMatch) {
      const family = familyMatch[1].trim();
      fontFamiliesRaw.push(family);
      fontFaceDetails.push({
        family,
        weight: weightMatch?.[1]?.trim(),
        style: styleMatch?.[1]?.trim(),
        src: srcMatch?.[1]?.trim(),
        format: formatMatch?.[1]?.trim(),
      });
    }
  }

  // Build type scale from computed elements
  const scaleEntries: TypeScaleEntry[] = [];
  for (const el of raw.computedElements) {
    if (el.fontSize && el.fontFamily) {
      scaleEntries.push({
        tag: el.tagName,
        family: el.fontFamily.split(",")[0].trim().replace(/['"]/g, ""),
        size: el.fontSize.endsWith("px") ? pxToRem(el.fontSize) : el.fontSize,
        weight: el.fontWeight || "400",
        lineHeight: el.lineHeight || "normal",
        letterSpacing: el.letterSpacing || "normal",
        color: el.color || undefined,
      });
    }
  }

  // Group font families with their available weights and styles
  const familyMap = new Map<string, { weights: Set<string>; styles: Set<string>; isVariable: boolean }>();
  for (const fd of fontFaceDetails) {
    let entry = familyMap.get(fd.family);
    if (!entry) { entry = { weights: new Set(), styles: new Set(), isVariable: false }; familyMap.set(fd.family, entry); }
    if (fd.weight) entry.weights.add(fd.weight);
    if (fd.style) entry.styles.add(fd.style);
    if (fd.weight?.includes(" ")) entry.isVariable = true; // "100 900" = variable
  }
  // Also add weights from computed elements
  for (const el of raw.computedElements) {
    if (el.fontFamily && el.fontWeight) {
      const name = el.fontFamily.split(",")[0].trim().replace(/['"]/g, "");
      let entry = familyMap.get(name);
      if (!entry) { entry = { weights: new Set(), styles: new Set(), isVariable: false }; familyMap.set(name, entry); }
      entry.weights.add(el.fontWeight);
    }
  }
  const familyDetails: FontFamilyDetail[] = Array.from(familyMap.entries()).map(([name, d]) => ({
    name,
    weights: Array.from(d.weights).sort(),
    styles: Array.from(d.styles),
    isVariable: d.isVariable,
  }));

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
      fontFaces: fontFaceDetails,
      families: familyDetails,
      scale: scaleEntries,
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
