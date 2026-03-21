import { chromium } from "playwright";
import type { DesignTokens } from "./tokenizer.js";

export interface AiEnrichment {
  colorNames: Record<string, string>;
  detectedStyle: string;
  profileDescription: string;
  suggestedName: string;
}

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";
const CEREBRAS_MODEL = "llama-3.3-70b";

export interface ComputedElementStyles {
  selector: string;
  tagName: string;
  backgroundColor: string;
  color: string;
  fontSize: string;
  fontFamily: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  borderRadius: string;
  border: string;
  boxShadow: string;
  padding: string;
  margin: string;
  transition: string;
}

export interface RawExtractedStyles {
  url: string;
  extractedAt: number;
  cssVars: Record<string, string>;
  computedElements: ComputedElementStyles[];
  stylesheets: string[];
  fontFaces: string[];
  metaColors: string[];
}

const ELEMENT_SELECTORS = [
  { selector: "button", tagName: "button" },
  { selector: "input[type=text], input:not([type])", tagName: "input" },
  { selector: "a", tagName: "a" },
  { selector: "h1", tagName: "h1" },
  { selector: "h2", tagName: "h2" },
  { selector: "h3", tagName: "h3" },
  { selector: "p", tagName: "p" },
  { selector: "nav", tagName: "nav" },
  { selector: '[class*="card"]', tagName: "card" },
  { selector: "body", tagName: "body" },
];

// ── AI enrichment ─────────────────────────────────────────────────────────────

function closestNamedColor(hex: string): string {
  const named: Record<string, [number, number, number]> = {
    black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0],
    blue: [0, 0, 255], green: [0, 128, 0], yellow: [255, 255, 0],
    orange: [255, 165, 0], purple: [128, 0, 128], pink: [255, 192, 203],
    gray: [128, 128, 128], navy: [0, 0, 128], teal: [0, 128, 128],
    coral: [255, 127, 80], slate: [112, 128, 144], indigo: [75, 0, 130],
  };
  const h = hex.replace("#", "");
  if (h.length < 6) return "color";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  let best = "color";
  let bestDist = Infinity;
  for (const [name, [nr, ng, nb]] of Object.entries(named)) {
    const dist = Math.sqrt((r - nr) ** 2 + (g - ng) ** 2 + (b - nb) ** 2);
    if (dist < bestDist) { bestDist = dist; best = name; }
  }
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.2 ? `dark-${best}` : luminance > 0.8 ? `light-${best}` : best;
}

function algorithmicEnrich(tokens: DesignTokens): AiEnrichment {
  const colorNames: Record<string, string> = {};
  tokens.colors.forEach((c) => {
    if (c.value.startsWith("#")) colorNames[c.value] = closestNamedColor(c.value);
  });
  return {
    colorNames,
    detectedStyle: "custom",
    profileDescription: "Extracted from website",
    suggestedName: "extracted-style",
  };
}

export async function enrichTokensWithAi(tokens: DesignTokens, url: string): Promise<AiEnrichment> {
  const apiKey = process.env["CEREBRAS_API_KEY"];
  if (!apiKey) return algorithmicEnrich(tokens);

  const topColors = tokens.colors.slice(0, 12).map((c) => c.value);
  const fonts = tokens.typography.fontFamilies.slice(0, 3);

  const prompt = `You are a design systems expert. Analyze these extracted design tokens from "${url}":
Colors (top 12): ${topColors.join(", ")}
Fonts: ${fonts.join(", ")}
Border radii: ${tokens.borderRadius.slice(0, 4).join(", ")}
Shadows: ${tokens.shadows.length} shadows detected

Respond with ONLY valid JSON (no markdown):
{
  "colorNames": { "<hex>": "<descriptive-name>" },
  "detectedStyle": "<one of: minimalist|brutalist|corporate|startup|glassmorphism|editorial|retro|material|neubrutalism|neumorphic|custom>",
  "profileDescription": "<2 sentence description of the design system>",
  "suggestedName": "<kebab-case profile name like 'linear-dark' or 'stripe-minimal'>"
}`;

  try {
    const res = await fetch(CEREBRAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: CEREBRAS_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 512,
      }),
    });
    if (!res.ok) return algorithmicEnrich(tokens);
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const raw = (data.choices?.[0]?.message?.content ?? "").trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(raw) as AiEnrichment;
    return {
      colorNames: parsed.colorNames ?? {},
      detectedStyle: parsed.detectedStyle ?? "custom",
      profileDescription: parsed.profileDescription ?? "",
      suggestedName: parsed.suggestedName ?? "extracted-style",
    };
  } catch {
    return algorithmicEnrich(tokens);
  }
}

export async function extractStylesFromUrl(url: string): Promise<RawExtractedStyles> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    // Extract CSS custom properties from :root and body
    const cssVars = await page.evaluate(() => {
      const vars: Record<string, string> = {};
      const styles = getComputedStyle(document.documentElement);
      for (const prop of Array.from(styles)) {
        if (prop.startsWith("--")) {
          vars[prop] = styles.getPropertyValue(prop).trim();
        }
      }
      const bodyStyles = getComputedStyle(document.body);
      for (const prop of Array.from(bodyStyles)) {
        if (prop.startsWith("--") && !vars[prop]) {
          vars[prop] = bodyStyles.getPropertyValue(prop).trim();
        }
      }
      return vars;
    });

    // Extract computed styles from key elements
    const computedElements: ComputedElementStyles[] = await page.evaluate((selectors) => {
      const results: ComputedElementStyles[] = [];
      const props = [
        "backgroundColor", "color", "fontSize", "fontFamily", "fontWeight",
        "lineHeight", "letterSpacing", "borderRadius", "border", "boxShadow",
        "padding", "margin", "transition",
      ];
      for (const { selector, tagName } of selectors) {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) continue;
        const cs = getComputedStyle(el);
        const entry: Record<string, string> = { selector, tagName };
        for (const p of props) {
          entry[p] = cs.getPropertyValue(
            p.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`)
          );
        }
        results.push(entry as unknown as import("./extractor").ComputedElementStyles);
      }
      return results;
    }, ELEMENT_SELECTORS);

    // Capture all stylesheet text
    const stylesheets = await page.evaluate(() => {
      const sheets: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = Array.from(sheet.cssRules || []);
          sheets.push(rules.map((r) => r.cssText).join("\n"));
        } catch {
          // Cross-origin sheet — skip
        }
      }
      return sheets;
    });

    // Extract @font-face declarations
    const fontFaces = await page.evaluate(() => {
      const faces: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            if (rule instanceof CSSFontFaceRule) {
              faces.push(rule.cssText);
            }
          }
        } catch {
          // Cross-origin — skip
        }
      }
      return faces;
    });

    // Extract meta colors (theme-color, etc.)
    const metaColors = await page.evaluate(() => {
      const colors: string[] = [];
      const themeColor = document.querySelector('meta[name="theme-color"]');
      if (themeColor) {
        const c = themeColor.getAttribute("content");
        if (c) colors.push(c);
      }
      const msColor = document.querySelector('meta[name="msapplication-TileColor"]');
      if (msColor) {
        const c = msColor.getAttribute("content");
        if (c) colors.push(c);
      }
      return colors;
    });

    return {
      url,
      extractedAt: Date.now(),
      cssVars,
      computedElements,
      stylesheets,
      fontFaces,
      metaColors,
    };
  } finally {
    await browser.close();
  }
}
