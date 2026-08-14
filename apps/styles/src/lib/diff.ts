import type { DesignTokens, ColorToken } from "./tokenizer.js";

export interface TokenDiff {
  colors: {
    added: ColorToken[];
    removed: ColorToken[];
    changed: Array<{ before: ColorToken; after: ColorToken }>;
  };
  typography: {
    fontFamilies: { added: string[]; removed: string[] };
    fontSizes: { added: string[]; removed: string[] };
    fontWeights: { added: string[]; removed: string[] };
  };
  borderRadius: { added: string[]; removed: string[] };
  shadows: { added: string[]; removed: string[] };
  spacing: { added: string[]; removed: string[] };
  summary: {
    totalChanges: number;
    description: string;
  };
}

function setDiff<T>(a: T[], b: T[]): { added: T[]; removed: T[] } {
  const setA = new Set(a.map(String));
  const setB = new Set(b.map(String));
  return {
    added: b.filter((x) => !setA.has(String(x))),
    removed: a.filter((x) => !setB.has(String(x))),
  };
}

export function diffTokens(a: DesignTokens, b: DesignTokens): TokenDiff {
  // Colors: match by value
  const aColorMap = new Map(a.colors.map((c) => [c.value, c]));
  const bColorMap = new Map(b.colors.map((c) => [c.value, c]));

  const addedColors = b.colors.filter((c) => !aColorMap.has(c.value));
  const removedColors = a.colors.filter((c) => !bColorMap.has(c.value));

  // Detect name/frequency changes for same-value colors
  const changedColors: TokenDiff["colors"]["changed"] = [];
  for (const [value, aColor] of aColorMap) {
    const bColor = bColorMap.get(value);
    if (bColor && (aColor.name !== bColor.name || Math.abs(aColor.frequency - bColor.frequency) > 3)) {
      changedColors.push({ before: aColor, after: bColor });
    }
  }

  const totalChanges =
    addedColors.length +
    removedColors.length +
    changedColors.length +
    (setDiff(a.borderRadius, b.borderRadius).added.length + setDiff(a.borderRadius, b.borderRadius).removed.length) +
    (setDiff(a.shadows, b.shadows).added.length + setDiff(a.shadows, b.shadows).removed.length);

  const parts: string[] = [];
  if (addedColors.length) parts.push(`+${addedColors.length} colors`);
  if (removedColors.length) parts.push(`-${removedColors.length} colors`);
  const faDiff = setDiff(a.typography.fontFamilies, b.typography.fontFamilies);
  if (faDiff.added.length || faDiff.removed.length) parts.push("font families changed");
  const radiiDiff = setDiff(a.borderRadius, b.borderRadius);
  if (radiiDiff.added.length || radiiDiff.removed.length) parts.push("radii changed");

  return {
    colors: { added: addedColors, removed: removedColors, changed: changedColors },
    typography: {
      fontFamilies: setDiff(a.typography.fontFamilies, b.typography.fontFamilies),
      fontSizes: setDiff(a.typography.fontSizes, b.typography.fontSizes),
      fontWeights: setDiff(a.typography.fontWeights, b.typography.fontWeights),
    },
    borderRadius: setDiff(a.borderRadius, b.borderRadius),
    shadows: setDiff(a.shadows, b.shadows),
    spacing: setDiff(a.spacing, b.spacing),
    summary: {
      totalChanges,
      description: parts.length ? parts.join(", ") : "No significant changes",
    },
  };
}
