import { chromium } from "playwright";
import { readFileSync } from "fs";
import { extname } from "path";
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

export interface StateStyles {
  hover: Partial<ComputedElementStyles>[];
  focus: Partial<ComputedElementStyles>[];
}

export interface RawExtractedStyles {
  url: string;
  extractedAt: number;
  cssVars: Record<string, string>;
  computedElements: ComputedElementStyles[];
  stylesheets: string[];
  fontFaces: string[];
  metaColors: string[];
  stateStyles?: StateStyles;
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

// ── Screenshot-to-theme via AI vision ────────────────────────────────────────

export async function extractStylesFromScreenshot(imagePath: string): Promise<RawExtractedStyles> {
  const apiKey = process.env["CEREBRAS_API_KEY"];
  const imageBytes = readFileSync(imagePath);
  const base64 = imageBytes.toString("base64");
  const ext = extname(imagePath).slice(1).toLowerCase();
  const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : "image/png";

  // Pixel-sample fallback: extract dominant colors algorithmically
  function samplePixels(): string[] {
    const colors: string[] = [];
    // Sample every 50th byte triplet from raw PNG/JPEG data as crude color extraction
    // This is intentionally simple — the real value is the AI path
    for (let i = 0; i < Math.min(imageBytes.length - 3, 50000); i += 1500) {
      const r = imageBytes[i] ?? 0;
      const g = imageBytes[i + 1] ?? 0;
      const b = imageBytes[i + 2] ?? 0;
      // Skip near-white and near-black noise
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum > 240 || lum < 10) continue;
      colors.push(`#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`);
    }
    return [...new Set(colors)].slice(0, 20);
  }

  if (!apiKey) {
    // Fallback: return minimal RawExtractedStyles with sampled colors in cssVars
    const sampledColors = samplePixels();
    const cssVars: Record<string, string> = {};
    sampledColors.forEach((c, i) => { cssVars[`--sampled-color-${i + 1}`] = c; });
    return { url: `file://${imagePath}`, extractedAt: Date.now(), cssVars, computedElements: [], stylesheets: [], fontFaces: [], metaColors: [] };
  }

  const prompt = `You are a design systems expert analyzing a UI screenshot. Extract all visible design tokens from this image.

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "colors": ["#hex1", "#hex2", ...],
  "fontFamilies": ["Font Name", ...],
  "fontSizes": ["16px", "24px", ...],
  "fontWeights": ["400", "700", ...],
  "borderRadius": ["4px", "8px", ...],
  "shadows": ["0 2px 8px rgba(0,0,0,0.1)", ...],
  "spacing": ["8px", "16px", "24px", ...],
  "description": "2 sentence description of the design style"
}

Be precise — extract actual values visible in the design, not guesses.`;

  try {
    const res = await fetch(CEREBRAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: CEREBRAS_MODEL,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
            { type: "text", text: prompt },
          ],
        }],
        temperature: 0.1,
        max_tokens: 1024,
      }),
    });

    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const raw = (data.choices?.[0]?.message?.content ?? "").trim()
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(raw) as {
      colors?: string[]; fontFamilies?: string[]; fontSizes?: string[];
      fontWeights?: string[]; borderRadius?: string[]; shadows?: string[];
      spacing?: string[]; description?: string;
    };

    // Build cssVars from the AI-extracted colors
    const cssVars: Record<string, string> = {};
    (parsed.colors ?? []).forEach((c, i) => { cssVars[`--ai-color-${i + 1}`] = c; });

    // Build a minimal stylesheet text from what AI found
    const sheetLines: string[] = [":root {"];
    (parsed.colors ?? []).forEach((c, i) => sheetLines.push(`  --color-${i + 1}: ${c};`));
    (parsed.fontFamilies ?? []).forEach((f, i) => sheetLines.push(`  --font-${i + 1}: ${f};`));
    sheetLines.push("}");
    if (parsed.borderRadius?.length) {
      sheetLines.push("button {");
      sheetLines.push(`  border-radius: ${parsed.borderRadius[0]};`);
      sheetLines.push("}");
    }
    if (parsed.shadows?.length) {
      sheetLines.push(".card {");
      parsed.shadows.forEach((s) => sheetLines.push(`  box-shadow: ${s};`));
      sheetLines.push("}");
    }
    if (parsed.spacing?.length) {
      sheetLines.push("body {");
      sheetLines.push(`  padding: ${parsed.spacing.slice(0, 4).join(" ")};`);
      sheetLines.push("}");
    }
    // Add font-size rules so tokenizer picks them up
    if (parsed.fontSizes?.length) {
      parsed.fontSizes.forEach((s, i) => {
        sheetLines.push(`.text-${i + 1} { font-size: ${s}; }`);
      });
    }

    return {
      url: `file://${imagePath}`,
      extractedAt: Date.now(),
      cssVars,
      computedElements: [],
      stylesheets: [sheetLines.join("\n")],
      fontFaces: [],
      metaColors: [],
    };
  } catch {
    // Fallback to pixel sampling
    const sampledColors = samplePixels();
    const cssVars: Record<string, string> = {};
    sampledColors.forEach((c, i) => { cssVars[`--sampled-color-${i + 1}`] = c; });
    return { url: `file://${imagePath}`, extractedAt: Date.now(), cssVars, computedElements: [], stylesheets: [], fontFaces: [], metaColors: [] };
  }
}

// ── Static CSS/SCSS file extraction (no browser needed) ───────────────────────

export function extractStylesFromFile(filePath: string): RawExtractedStyles {
  let text = readFileSync(filePath, "utf-8");

  // Strip SCSS-specific syntax so CSS parsers work cleanly
  // Remove single-line comments
  text = text.replace(/\/\/[^\n]*/g, "");
  // Remove SCSS variable declarations ($var: value;) — keep the values for token parsing
  // but convert to css vars so our extractor picks them up
  text = text.replace(/\$([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g, (_, name, value) => {
    return `--${name}: ${value.trim()};`;
  });
  // Remove @mixin, @include, @extend, @use, @forward, @function, @if, @each, @for, @while, @return
  text = text.replace(/@(mixin|include|extend|use|forward|function|if|else|each|for|while|return|debug|warn|error)[^{};]*[{};]/g, "");
  // Remove #{...} interpolations
  text = text.replace(/#\{[^}]+\}/g, "var(--unknown)");

  // Parse CSS vars from :root and body blocks
  const cssVars: Record<string, string> = {};
  const varMatches = text.matchAll(/--([\w-]+)\s*:\s*([^;}\n]+)/g);
  for (const m of varMatches) {
    cssVars[`--${m[1]}`] = m[2].trim();
  }

  // Extract @font-face blocks
  const fontFaces: string[] = [];
  const fontFaceMatches = text.matchAll(/@font-face\s*\{([^}]+)\}/g);
  for (const m of fontFaceMatches) {
    fontFaces.push(`@font-face { ${m[1]} }`);
  }

  return {
    url: `file://${filePath}`,
    extractedAt: Date.now(),
    cssVars,
    computedElements: [], // No DOM — computed styles not available from static files
    stylesheets: [text],
    fontFaces,
    metaColors: [],
  };
}

// Extract a single page and return its raw data
async function extractSinglePage(page: import("playwright").Page, url: string): Promise<Omit<RawExtractedStyles, "url" | "extractedAt">> {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

  const cssVars = await page.evaluate(() => {
    const vars: Record<string, string> = {};
    const styles = getComputedStyle(document.documentElement);
    for (const prop of Array.from(styles)) {
      if (prop.startsWith("--")) vars[prop] = styles.getPropertyValue(prop).trim();
    }
    const bodyStyles = getComputedStyle(document.body);
    for (const prop of Array.from(bodyStyles)) {
      if (prop.startsWith("--") && !vars[prop]) vars[prop] = bodyStyles.getPropertyValue(prop).trim();
    }
    return vars;
  });

  const computedElements = await page.evaluate((selectors) => {
    const results: ComputedElementStyles[] = [];
    const props = ["backgroundColor","color","fontSize","fontFamily","fontWeight","lineHeight","letterSpacing","borderRadius","border","boxShadow","padding","margin","transition"];
    for (const { selector, tagName } of selectors) {
      const els = Array.from(document.querySelectorAll(selector)).slice(0, 5) as HTMLElement[];
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const cs = getComputedStyle(el);
        const entry: Record<string, string> = { selector, tagName };
        for (const p of props) entry[p] = cs.getPropertyValue(p.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`));
        results.push(entry as unknown as ComputedElementStyles);
      }
    }
    return results;
  }, ELEMENT_SELECTORS);

  const stylesheets = await page.evaluate(() => {
    const sheets: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try { sheets.push(Array.from(sheet.cssRules || []).map((r) => r.cssText).join("\n")); } catch { /* cross-origin */ }
    }
    return sheets;
  });

  const fontFaces = await page.evaluate(() => {
    const faces: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try { for (const rule of Array.from(sheet.cssRules || [])) { if (rule instanceof CSSFontFaceRule) faces.push(rule.cssText); } } catch { /* cross-origin */ }
    }
    return faces;
  });

  const metaColors = await page.evaluate(() => {
    const colors: string[] = [];
    const tc = document.querySelector('meta[name="theme-color"]')?.getAttribute("content");
    if (tc) colors.push(tc);
    const ms = document.querySelector('meta[name="msapplication-TileColor"]')?.getAttribute("content");
    if (ms) colors.push(ms);
    return colors;
  });

  return { cssVars, computedElements, stylesheets, fontFaces, metaColors };
}

// Merge multiple RawExtractedStyles into one (for multi-page)
function mergeRaw(base: RawExtractedStyles, extra: Omit<RawExtractedStyles, "url" | "extractedAt">): RawExtractedStyles {
  return {
    ...base,
    cssVars: { ...base.cssVars, ...extra.cssVars },
    computedElements: [...base.computedElements, ...extra.computedElements],
    stylesheets: [...base.stylesheets, ...extra.stylesheets],
    fontFaces: [...new Set([...base.fontFaces, ...extra.fontFaces])],
    metaColors: [...new Set([...base.metaColors, ...extra.metaColors])],
  };
}

// Capture hover/focus state deltas for interactive elements
async function captureStateDelta(page: import("playwright").Page): Promise<StateStyles> {
  const stateProps = ["backgroundColor", "color", "borderColor", "outline", "boxShadow", "opacity", "transform"];
  const interactiveSelectors = ["button", "a", "input", '[role="button"]'];
  const hoverResults: Partial<ComputedElementStyles>[] = [];
  const focusResults: Partial<ComputedElementStyles>[] = [];

  for (const selector of interactiveSelectors) {
    try {
      const els = await page.$$(selector);
      const el = els.find(async (e) => {
        const box = await e.boundingBox();
        return box && box.width > 0 && box.height > 0;
      }) ?? els[0];
      if (!el) continue;

      // Capture base state
      const base = await el.evaluate((node, props) => {
        const cs = getComputedStyle(node as HTMLElement);
        const result: Record<string, string> = {};
        for (const p of props) result[p] = cs.getPropertyValue(p.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`));
        return result;
      }, stateProps);

      // Hover state
      await el.hover({ force: true }).catch(() => {});
      const hover = await el.evaluate((node, props) => {
        const cs = getComputedStyle(node as HTMLElement);
        const result: Record<string, string> = {};
        for (const p of props) result[p] = cs.getPropertyValue(p.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`));
        return result;
      }, stateProps);
      const hoverDelta: Record<string, string> = {};
      for (const p of stateProps) { if (hover[p] !== base[p]) hoverDelta[p] = hover[p]; }
      if (Object.keys(hoverDelta).length > 0) hoverResults.push({ selector, tagName: selector, ...hoverDelta } as Partial<ComputedElementStyles>);

      // Focus state
      await el.focus().catch(() => {});
      const focus = await el.evaluate((node, props) => {
        const cs = getComputedStyle(node as HTMLElement);
        const result: Record<string, string> = {};
        for (const p of props) result[p] = cs.getPropertyValue(p.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`));
        return result;
      }, stateProps);
      const focusDelta: Record<string, string> = {};
      for (const p of stateProps) { if (focus[p] !== base[p]) focusDelta[p] = focus[p]; }
      if (Object.keys(focusDelta).length > 0) focusResults.push({ selector, tagName: selector, ...focusDelta } as Partial<ComputedElementStyles>);
    } catch { /* skip elements that fail */ }
  }

  return { hover: hoverResults, focus: focusResults };
}

export async function extractStylesFromUrl(url: string, options: { pages?: number; viewports?: boolean; states?: boolean } = {}): Promise<RawExtractedStyles> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const baseData = await extractSinglePage(page, url);
    let result: RawExtractedStyles = { url, extractedAt: Date.now(), ...baseData };

    // Hover/focus states
    if (options.states) {
      result.stateStyles = await captureStateDelta(page);
    }

    // Multi-page: find internal links and extract additional pages
    const maxPages = Math.min(options.pages ?? 1, 10);
    if (maxPages > 1) {
      const baseUrl = new URL(url);
      const internalLinks = await page.evaluate((origin) => {
        return Array.from(document.querySelectorAll("a[href]"))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((h) => { try { return new URL(h).origin === origin && !h.includes("#"); } catch { return false; } })
          .slice(0, 20);
      }, baseUrl.origin);

      // Deduplicate and pick up to maxPages-1 additional pages
      const seen = new Set([url]);
      const toVisit = internalLinks.filter((l) => !seen.has(l)).slice(0, maxPages - 1);

      for (const pageUrl of toVisit) {
        seen.add(pageUrl);
        try {
          const pageData = await extractSinglePage(page, pageUrl);
          result = mergeRaw(result, pageData);
        } catch { /* skip pages that fail */ }
      }
    }

    // Responsive breakpoints
    if (options.viewports) {
      const breakpoints = [{ width: 375, height: 812, name: "mobile" }, { width: 768, height: 1024, name: "tablet" }];
      for (const vp of breakpoints) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        const vpData = await extractSinglePage(page, url);
        result = mergeRaw(result, vpData);
      }
    }

    return result;
  } finally {
    await browser.close();
  }
}

