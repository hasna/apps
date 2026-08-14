import type { DesignTokens } from "./tokenizer.js";
import type { RawExtractedStyles } from "./extractor.js";

export type WcagLevel = "AAA" | "AA" | "AA-large" | "fail";

export interface ContrastResult {
  foreground: string;
  background: string;
  ratio: number;
  level: WcagLevel;
  element?: string;
}

export interface A11yReport {
  pairs: ContrastResult[];
  passCount: number;
  failCount: number;
  score: number; // 0-100
}

// ── WCAG relative luminance ────────────────────────────────────────────────────

function sRGBtoLinear(c: number): number {
  const n = c / 255;
  return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * sRGBtoLinear(r) + 0.7152 * sRGBtoLinear(g) + 0.0722 * sRGBtoLinear(b);
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function wcagLevel(ratio: number): WcagLevel {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-large";
  return "fail";
}

// Parse any color string to [r,g,b] — returns null if unparseable
function parseColor(raw: string): [number, number, number] | null {
  const s = raw.trim().toLowerCase();

  // hex 3: #rgb
  const hex3 = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (hex3) return [parseInt(hex3[1] + hex3[1], 16), parseInt(hex3[2] + hex3[2], 16), parseInt(hex3[3] + hex3[3], 16)];

  // hex 6: #rrggbb
  const hex6 = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/);
  if (hex6) return [parseInt(hex6[1], 16), parseInt(hex6[2], 16), parseInt(hex6[3], 16)];

  // rgb / rgba
  const rgb = s.match(/rgba?\(\s*([\d.]+)[,\s]\s*([\d.]+)[,\s]\s*([\d.]+)/);
  if (rgb) return [parseFloat(rgb[1]), parseFloat(rgb[2]), parseFloat(rgb[3])];

  return null;
}

// ── Audit functions ───────────────────────────────────────────────────────────

/** Audit color pairs found in computed element styles (foreground vs background on same element) */
export function auditColorContrast(tokens: DesignTokens, raw?: RawExtractedStyles): A11yReport {
  const pairs: ContrastResult[] = [];
  const seen = new Set<string>();

  // From computed elements — check each element's color vs backgroundColor
  if (raw?.computedElements) {
    for (const el of raw.computedElements) {
      const fg = el.color;
      const bg = el.backgroundColor;
      if (!fg || !bg) continue;

      const fgRgb = parseColor(fg);
      const bgRgb = parseColor(bg);
      if (!fgRgb || !bgRgb) continue;

      // Skip transparent backgrounds
      if (bgRgb[0] === 0 && bgRgb[1] === 0 && bgRgb[2] === 0 && bg.includes("0)")) continue;

      const key = `${fg}|${bg}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const fgL = relativeLuminance(...fgRgb);
      const bgL = relativeLuminance(...bgRgb);
      const ratio = contrastRatio(fgL, bgL);

      pairs.push({
        foreground: fg,
        background: bg,
        ratio: Math.round(ratio * 100) / 100,
        level: wcagLevel(ratio),
        element: el.tagName,
      });
    }
  }

  // Also check top extracted colors against each other (top 5 combos)
  const topColors = tokens.colors.slice(0, 10);
  for (let i = 0; i < Math.min(topColors.length, 5); i++) {
    for (let j = i + 1; j < Math.min(topColors.length, 10); j++) {
      const fg = topColors[i].value;
      const bg = topColors[j].value;
      const key = `${fg}|${bg}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const fgRgb = parseColor(fg);
      const bgRgb = parseColor(bg);
      if (!fgRgb || !bgRgb) continue;

      const fgL = relativeLuminance(...fgRgb);
      const bgL = relativeLuminance(...bgRgb);
      const ratio = contrastRatio(fgL, bgL);

      pairs.push({
        foreground: fg,
        background: bg,
        ratio: Math.round(ratio * 100) / 100,
        level: wcagLevel(ratio),
      });
    }
  }

  const passCount = pairs.filter((p) => p.level !== "fail").length;
  const failCount = pairs.length - passCount;
  const score = pairs.length === 0 ? 100 : Math.round((passCount / pairs.length) * 100);

  return { pairs, passCount, failCount, score };
}
