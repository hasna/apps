import type { DesignTokens } from "./tokenizer.js";

export interface FigmaVariable {
  name: string;
  resolvedType: "COLOR" | "FLOAT" | "STRING";
  valuesByMode: Record<string, unknown>;
}

export interface FigmaVariablesPayload {
  variableCollections: Array<{
    name: string;
    modes: Array<{ name: string; modeId: string }>;
  }>;
  variables: FigmaVariable[];
}

const DEFAULT_MODE_ID = "mode-1";

// ── Build Figma Variables payload from tokens ─────────────────────────────────

export function toFigmaVariables(tokens: DesignTokens): FigmaVariablesPayload {
  const variables: FigmaVariable[] = [];

  // Colors
  tokens.colors.slice(0, 40).forEach((c, i) => {
    const name = c.name ? `color/${c.name}` : `color/color-${i + 1}`;
    const rgb = hexToFigmaRgb(c.value);
    if (!rgb) return;
    variables.push({
      name,
      resolvedType: "COLOR",
      valuesByMode: { [DEFAULT_MODE_ID]: { r: rgb[0], g: rgb[1], b: rgb[2], a: rgb[3] ?? 1 } },
    });
  });

  // Border radii
  tokens.borderRadius.slice(0, 8).forEach((r, i) => {
    const val = parseFloat(r);
    if (Number.isNaN(val)) return;
    const names = ["none", "sm", "md", "lg", "xl", "2xl", "full", "pill"];
    variables.push({
      name: `radius/${names[i] ?? `r${i + 1}`}`,
      resolvedType: "FLOAT",
      valuesByMode: { [DEFAULT_MODE_ID]: val },
    });
  });

  // Spacing
  tokens.spacing.slice(0, 12).forEach((s, i) => {
    const val = parseFloat(s) * (s.endsWith("rem") ? 16 : 1);
    if (Number.isNaN(val)) return;
    variables.push({
      name: `spacing/spacing-${i + 1}`,
      resolvedType: "FLOAT",
      valuesByMode: { [DEFAULT_MODE_ID]: val },
    });
  });

  // Font families
  tokens.typography.fontFamilies.slice(0, 4).forEach((f, i) => {
    variables.push({
      name: `typography/font-${i === 0 ? "sans" : i === 1 ? "serif" : `family-${i + 1}`}`,
      resolvedType: "STRING",
      valuesByMode: { [DEFAULT_MODE_ID]: f },
    });
  });

  // Font sizes
  tokens.typography.fontSizes.slice(0, 8).forEach((s, i) => {
    const val = parseFloat(s) * (s.endsWith("rem") ? 16 : 1);
    if (Number.isNaN(val)) return;
    const names = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl"];
    variables.push({
      name: `typography/size-${names[i] ?? `size-${i + 1}`}`,
      resolvedType: "FLOAT",
      valuesByMode: { [DEFAULT_MODE_ID]: val },
    });
  });

  return {
    variableCollections: [{
      name: "Extracted Tokens",
      modes: [{ name: "Default", modeId: DEFAULT_MODE_ID }],
    }],
    variables,
  };
}

// ── Publish to Figma via REST API ─────────────────────────────────────────────

export async function publishToFigma(
  tokens: DesignTokens,
  figmaFileKey: string,
  accessToken: string
): Promise<{ success: boolean; message: string; variableCount: number }> {
  const payload = toFigmaVariables(tokens);

  // Figma Variables API: POST /v1/files/:file_key/variables
  const res = await fetch(`https://api.figma.com/v1/files/${figmaFileKey}/variables`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Figma-Token": accessToken,
    },
    body: JSON.stringify({
      variableCollections: payload.variableCollections,
      variables: payload.variables.map((v, i) => ({
        ...v,
        id: `variable-${i}`,
        description: "Extracted by open-styles",
      })),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    return { success: false, message: `Figma API error ${res.status}: ${errText.slice(0, 200)}`, variableCount: 0 };
  }

  return {
    success: true,
    message: `Published ${payload.variables.length} variables to Figma file ${figmaFileKey}`,
    variableCount: payload.variables.length,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToFigmaRgb(hex: string): [number, number, number, number] | null {
  const s = hex.trim().toLowerCase();

  const rgb = s.match(/^rgba?\(\s*([\d.]+)[,\s]\s*([\d.]+)[,\s]\s*([\d.]+)(?:[,\s]\s*([\d.]+))?\s*\)/);
  if (rgb) return [parseFloat(rgb[1]) / 255, parseFloat(rgb[2]) / 255, parseFloat(rgb[3]) / 255, rgb[4] ? parseFloat(rgb[4]) : 1];

  const h6 = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?/);
  if (h6) return [parseInt(h6[1], 16) / 255, parseInt(h6[2], 16) / 255, parseInt(h6[3], 16) / 255, h6[4] ? parseInt(h6[4], 16) / 255 : 1];

  const h3 = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (h3) return [parseInt(h3[1] + h3[1], 16) / 255, parseInt(h3[2] + h3[2], 16) / 255, parseInt(h3[3] + h3[3], 16) / 255, 1];

  return null;
}
