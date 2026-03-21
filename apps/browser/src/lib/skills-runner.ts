/**
 * open-skills integration — run pre-built reusable browser interaction patterns.
 */

import type { Page } from "playwright";

export interface SkillResult {
  success: boolean;
  data: Record<string, unknown>;
  steps_taken: number;
  tokens_saved_estimate: number;
  error?: string;
}

// ─── Skills SDK wrapper ───────────────────────────────────────────────────────

async function getSkillsSDK() {
  try {
    const mod = await import("@hasna/skills");
    return mod;
  } catch {
    return null;
  }
}

// ─── Built-in browser skills ──────────────────────────────────────────────────

type SkillFn = (page: Page, params: Record<string, unknown>) => Promise<Record<string, unknown>>;

const BUILT_IN_SKILLS: Record<string, SkillFn> = {
  // Extract all nav links from a page
  "extract-nav-links": async (page, params) => {
    const { getLinks } = await import("./extractor.js");
    const links = await getLinks(page);
    return { links, count: links.length };
  },

  // Extract pricing table
  "extract-pricing": async (page, params) => {
    const url = params.url as string | undefined;
    if (url) {
      await (page as any).goto(url, { waitUntil: "domcontentloaded" });
      await new Promise(r => setTimeout(r, 1000));
    }
    const { extract } = await import("./extractor.js");
    const text = await extract(page, { format: "text" });
    // Find pricing patterns
    const priceMatches = (text.text ?? "").match(/\$[\d,]+(?:\.\d{2})?(?:\s*\/\s*(?:mo|month|yr|year))?/gi) ?? [];
    return { raw_text: text.text?.slice(0, 2000), prices_found: priceMatches, count: priceMatches.length };
  },

  // Monitor price — extract a specific element's price
  "monitor-price": async (page, params) => {
    const { url, selector } = params as { url?: string; selector?: string };
    if (url) {
      await (page as any).goto(url, { waitUntil: "domcontentloaded" });
      await new Promise(r => setTimeout(r, 1000));
    }
    const sel = selector ?? "[class*='price'], [class*='cost'], [data-price]";
    const { getText } = await import("./extractor.js");
    const priceText = await getText(page, sel);
    const price = priceText.match(/\$?[\d,]+(?:\.\d{2})?/)?.[0] ?? priceText.trim();
    return { price, selector: sel, raw: priceText };
  },

  // Login to a service
  "login": async (page, params) => {
    const { service, login_url } = params as { service: string; login_url?: string };
    const { getCredentials, loginWithCredentials } = await import("./auth.js");
    const creds = await getCredentials(service);
    if (!creds) return { logged_in: false, error: `No credentials found for ${service}` };
    const result = await loginWithCredentials(page, creds, { loginUrl: login_url, saveProfile: service });
    return result as unknown as Record<string, unknown>;
  },

  // Extract all text content
  "extract-text": async (page, params) => {
    const { getText } = await import("./extractor.js");
    const text = await getText(page);
    return { text: text.slice(0, 5000), length: text.length };
  },

  // Get page metadata
  "get-metadata": async (page, params) => {
    const { getPageInfo } = await import("./extractor.js");
    const info = await getPageInfo(page);
    return info as unknown as Record<string, unknown>;
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runBrowserSkill(
  skillName: string,
  params: Record<string, unknown>,
  page: Page
): Promise<SkillResult> {
  const start = Date.now();

  // Try built-in skills first
  const builtIn = BUILT_IN_SKILLS[skillName];
  if (builtIn) {
    try {
      const data = await builtIn(page, params);
      return {
        success: true,
        data,
        steps_taken: 1,
        tokens_saved_estimate: 500, // rough estimate vs manual tool calls
      };
    } catch (err) {
      return {
        success: false,
        data: {},
        steps_taken: 0,
        tokens_saved_estimate: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Try open-skills SDK
  const sdk = await getSkillsSDK();
  if (sdk?.runSkill) {
    try {
      const result = await (sdk as any).runSkill(skillName, params);
      return {
        success: true,
        data: result,
        steps_taken: (result as any).steps ?? 1,
        tokens_saved_estimate: 300,
      };
    } catch (err) {
      return {
        success: false,
        data: {},
        steps_taken: 0,
        tokens_saved_estimate: 0,
        error: `Skill '${skillName}' not found. Available: ${Object.keys(BUILT_IN_SKILLS).join(", ")}`,
      };
    }
  }

  return {
    success: false,
    data: {},
    steps_taken: 0,
    tokens_saved_estimate: 0,
    error: `Skill '${skillName}' not found. Available: ${Object.keys(BUILT_IN_SKILLS).join(", ")}`,
  };
}

export function listBuiltInSkills(): string[] {
  return Object.keys(BUILT_IN_SKILLS);
}
