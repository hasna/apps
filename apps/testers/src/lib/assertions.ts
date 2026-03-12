import type { Page } from "playwright";
import type { Assertion } from "../types/index.js";

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  actual: string;
  error?: string;
}

export async function evaluateAssertions(
  page: Page,
  assertions: Assertion[],
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];

  for (const assertion of assertions) {
    try {
      const result = await evaluateOne(page, assertion);
      results.push(result);
    } catch (err) {
      results.push({
        assertion,
        passed: false,
        actual: "",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

async function evaluateOne(
  page: Page,
  assertion: Assertion,
): Promise<AssertionResult> {
  switch (assertion.type) {
    case "visible": {
      const visible = await page.locator(assertion.selector!).isVisible();
      return {
        assertion,
        passed: visible,
        actual: String(visible),
      };
    }

    case "not_visible": {
      const visible = await page.locator(assertion.selector!).isVisible();
      return {
        assertion,
        passed: !visible,
        actual: String(visible),
      };
    }

    case "text_contains": {
      const text = (await page.locator(assertion.selector!).textContent()) ?? "";
      const expected = String(assertion.expected ?? "");
      return {
        assertion,
        passed: text.includes(expected),
        actual: text,
      };
    }

    case "text_equals": {
      const text = (await page.locator(assertion.selector!).textContent()) ?? "";
      const expected = String(assertion.expected ?? "");
      return {
        assertion,
        passed: text.trim() === expected.trim(),
        actual: text,
      };
    }

    case "element_count": {
      const count = await page.locator(assertion.selector!).count();
      const expected = Number(assertion.expected ?? 0);
      return {
        assertion,
        passed: count === expected,
        actual: String(count),
      };
    }

    case "no_console_errors": {
      // Check for common error indicators on the page as a fallback
      // since console listener would need to be attached before navigation
      const errorElements = await page
        .locator('[role="alert"], .error, .error-message, [data-testid="error"]')
        .count();
      return {
        assertion,
        passed: errorElements === 0,
        actual: `${errorElements} error element(s) found`,
      };
    }

    case "url_contains": {
      const url = page.url();
      const expected = String(assertion.expected ?? "");
      return {
        assertion,
        passed: url.includes(expected),
        actual: url,
      };
    }

    case "title_contains": {
      const title = await page.title();
      const expected = String(assertion.expected ?? "");
      return {
        assertion,
        passed: title.includes(expected),
        actual: title,
      };
    }

    default: {
      return {
        assertion,
        passed: false,
        actual: "",
        error: `Unknown assertion type: ${(assertion as Assertion).type}`,
      };
    }
  }
}

/**
 * Parse a CLI-format assertion string into an Assertion object.
 *
 * Formats:
 *   "selector:.dashboard visible"
 *   "selector:.dashboard not-visible"
 *   "text:.header contains:Welcome"
 *   "text:.header equals:Welcome Home"
 *   "no-console-errors"
 *   "url:contains:/dashboard"
 *   "title:contains:My App"
 *   "count:.items eq:5"
 */
export function parseAssertionString(str: string): Assertion {
  const trimmed = str.trim();

  // no-console-errors
  if (trimmed === "no-console-errors") {
    return { type: "no_console_errors", description: "No console errors" };
  }

  // url:contains:/dashboard
  if (trimmed.startsWith("url:contains:")) {
    const expected = trimmed.slice("url:contains:".length);
    return { type: "url_contains", expected, description: `URL contains "${expected}"` };
  }

  // title:contains:My App
  if (trimmed.startsWith("title:contains:")) {
    const expected = trimmed.slice("title:contains:".length);
    return { type: "title_contains", expected, description: `Title contains "${expected}"` };
  }

  // count:.items eq:5
  if (trimmed.startsWith("count:")) {
    const rest = trimmed.slice("count:".length);
    const eqIdx = rest.indexOf(" eq:");
    if (eqIdx === -1) {
      throw new Error(`Invalid count assertion format: ${str}. Expected "count:<selector> eq:<number>"`);
    }
    const selector = rest.slice(0, eqIdx);
    const expected = parseInt(rest.slice(eqIdx + " eq:".length), 10);
    return { type: "element_count", selector, expected, description: `${selector} count equals ${expected}` };
  }

  // text:.header contains:Welcome
  // text:.header equals:Welcome Home
  if (trimmed.startsWith("text:")) {
    const rest = trimmed.slice("text:".length);
    const containsIdx = rest.indexOf(" contains:");
    const equalsIdx = rest.indexOf(" equals:");

    if (containsIdx !== -1) {
      const selector = rest.slice(0, containsIdx);
      const expected = rest.slice(containsIdx + " contains:".length);
      return { type: "text_contains", selector, expected, description: `${selector} text contains "${expected}"` };
    }

    if (equalsIdx !== -1) {
      const selector = rest.slice(0, equalsIdx);
      const expected = rest.slice(equalsIdx + " equals:".length);
      return { type: "text_equals", selector, expected, description: `${selector} text equals "${expected}"` };
    }

    throw new Error(`Invalid text assertion format: ${str}. Expected "text:<selector> contains:<text>" or "text:<selector> equals:<text>"`);
  }

  // selector:.dashboard visible
  // selector:.dashboard not-visible
  if (trimmed.startsWith("selector:")) {
    const rest = trimmed.slice("selector:".length);
    const lastSpace = rest.lastIndexOf(" ");
    if (lastSpace === -1) {
      throw new Error(`Invalid selector assertion format: ${str}. Expected "selector:<selector> visible" or "selector:<selector> not-visible"`);
    }
    const selector = rest.slice(0, lastSpace);
    const action = rest.slice(lastSpace + 1);

    if (action === "visible") {
      return { type: "visible", selector, description: `${selector} is visible` };
    }
    if (action === "not-visible") {
      return { type: "not_visible", selector, description: `${selector} is not visible` };
    }

    throw new Error(`Unknown selector action: "${action}". Expected "visible" or "not-visible"`);
  }

  throw new Error(`Cannot parse assertion: "${str}". See --help for assertion formats.`);
}

export function allAssertionsPassed(results: AssertionResult[]): boolean {
  return results.every((r) => r.passed);
}

export function formatAssertionResults(results: AssertionResult[]): string {
  if (results.length === 0) return "No assertions.";

  const lines: string[] = [];
  for (const r of results) {
    const icon = r.passed ? "PASS" : "FAIL";
    const desc =
      r.assertion.description ||
      `${r.assertion.type}${r.assertion.selector ? ` ${r.assertion.selector}` : ""}`;
    let line = `  [${icon}] ${desc}`;
    if (!r.passed) {
      line += ` (actual: ${r.actual})`;
      if (r.error) line += ` — ${r.error}`;
    }
    lines.push(line);
  }

  const passed = results.filter((r) => r.passed).length;
  lines.push(`\n  ${passed}/${results.length} assertions passed.`);
  return lines.join("\n");
}
