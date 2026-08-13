/**
 * Self-healing selector resolution — when an element can't be found by its original selector,
 * try a cascade of fallback strategies before giving up.
 */

import type { Page, Locator } from "playwright";

export interface HealResult {
  found: boolean;
  locator: Locator | null;
  method: "original" | "ref" | "text" | "role" | "partial_id" | "partial_class" | "none";
  healed: boolean;  // true if a fallback was used
  attempts: string[];
}

/**
 * Try to find an element using a cascade of strategies.
 * Returns the first successful locator with metadata about what worked.
 */
export async function healSelector(page: Page, selector: string, sessionId?: string): Promise<HealResult> {
  const attempts: string[] = [];

  // 1. Original selector
  attempts.push(`selector: ${selector}`);
  try {
    const loc = page.locator(selector).first();
    if (await loc.count() > 0) {
      return { found: true, locator: loc, method: "original", healed: false, attempts };
    }
  } catch {}

  // 2. Try as text match (if selector looks like plain text, not CSS)
  if (!selector.startsWith("#") && !selector.startsWith(".") && !selector.startsWith("[") && !selector.includes(">") && !selector.includes(" ")) {
    attempts.push(`text: "${selector}"`);
    try {
      const loc = page.getByText(selector, { exact: false }).first();
      if (await loc.count() > 0) {
        return { found: true, locator: loc, method: "text", healed: true, attempts };
      }
    } catch {}
  }

  // 3. Try by role with name matching
  const roleMap: Record<string, string[]> = {
    button: ["button", "submit", "reset"],
    link: ["a"],
    input: ["input", "textarea"],
    heading: ["h1", "h2", "h3", "h4", "h5", "h6"],
  };
  // Extract possible name from selector (e.g. #submit-btn -> "submit")
  const nameHint = selector.replace(/^[#.]/, "").replace(/[-_]/g, " ").toLowerCase();
  for (const [role, tags] of Object.entries(roleMap)) {
    attempts.push(`role: ${role} name~="${nameHint}"`);
    try {
      const loc = page.getByRole(role as any, { name: new RegExp(nameHint.split(" ")[0], "i") }).first();
      if (await loc.count() > 0) {
        return { found: true, locator: loc, method: "role", healed: true, attempts };
      }
    } catch {}
  }

  // 4. Partial ID match (e.g. #old-submit -> [id*="submit"])
  if (selector.startsWith("#")) {
    const idPart = selector.slice(1).split("-").pop() ?? selector.slice(1);
    const partialSel = `[id*="${idPart}"]`;
    attempts.push(`partial_id: ${partialSel}`);
    try {
      const loc = page.locator(partialSel).first();
      if (await loc.count() > 0) {
        return { found: true, locator: loc, method: "partial_id", healed: true, attempts };
      }
    } catch {}
  }

  // 5. Partial class match
  if (selector.startsWith(".")) {
    const classPart = selector.slice(1).split("-").pop() ?? selector.slice(1);
    const partialSel = `[class*="${classPart}"]`;
    attempts.push(`partial_class: ${partialSel}`);
    try {
      const loc = page.locator(partialSel).first();
      if (await loc.count() > 0) {
        return { found: true, locator: loc, method: "partial_class", healed: true, attempts };
      }
    } catch {}
  }

  // 6. Give up
  return { found: false, locator: null, method: "none", healed: false, attempts };
}
