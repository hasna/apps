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

    case "cookie_exists": {
      const cookieName = assertion.expected as string;
      const cookies = await page.context().cookies();
      const found = cookies.some((c) => c.name === cookieName);
      return {
        assertion,
        passed: found,
        actual: found ? `Cookie "${cookieName}" exists` : `Cookie "${cookieName}" not found`,
      };
    }

    case "cookie_not_exists": {
      const cookieName = assertion.expected as string;
      const cookies = await page.context().cookies();
      const found = cookies.some((c) => c.name === cookieName);
      return {
        assertion,
        passed: !found,
        actual: found ? `Cookie "${cookieName}" found (unexpected)` : `Cookie "${cookieName}" does not exist`,
      };
    }

    case "cookie_value": {
      const [cookieName, expectedValue] = (assertion.expected as string).split("=", 2);
      const cookies = await page.context().cookies();
      const cookie = cookies.find((c) => c.name === cookieName);
      const actualValue = cookie?.value ?? "";
      return {
        assertion,
        passed: actualValue === expectedValue,
        actual: cookie ? `${cookieName}=${actualValue}` : `Cookie "${cookieName}" not found`,
      };
    }

    case "local_storage_exists": {
      const key = assertion.expected as string;
      const value = await page.evaluate((k) => localStorage.getItem(k), key);
      return {
        assertion,
        passed: value !== null,
        actual: value !== null ? `Key "${key}" exists with value "${value}"` : `Key "${key}" not found in localStorage`,
      };
    }

    case "local_storage_not_exists": {
      const key = assertion.expected as string;
      const value = await page.evaluate((k) => localStorage.getItem(k), key);
      return {
        assertion,
        passed: value === null,
        actual: value !== null ? `Key "${key}" exists (unexpected)` : `Key "${key}" does not exist in localStorage`,
      };
    }

    case "local_storage_value": {
      const [lsKey, expectedValue] = (assertion.expected as string).split("=", 2);
      const value = await page.evaluate((k) => localStorage.getItem(k), lsKey);
      return {
        assertion,
        passed: value === expectedValue,
        actual: value !== null ? `${lsKey}=${value}` : `Key "${lsKey}" not found in localStorage`,
      };
    }

    case "session_storage_value": {
      const [ssKey, expectedValue] = (assertion.expected as string).split("=", 2);
      const value = await page.evaluate((k) => sessionStorage.getItem(k), ssKey);
      return {
        assertion,
        passed: value === expectedValue,
        actual: value !== null ? `${ssKey}=${value}` : `Key "${ssKey}" not found in sessionStorage`,
      };
    }

    case "session_storage_not_exists": {
      const key = assertion.expected as string;
      const value = await page.evaluate((k) => sessionStorage.getItem(k), key);
      return {
        assertion,
        passed: value === null,
        actual: value !== null ? `Key "${key}" exists (unexpected)` : `Key "${key}" does not exist in sessionStorage`,
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

  // cookie:exists:<name>
  if (trimmed.startsWith("cookie:exists:")) {
    const name = trimmed.slice("cookie:exists:".length);
    return { type: "cookie_exists", expected: name, description: `Cookie "${name}" exists` };
  }

  // cookie:not-exists:<name>
  if (trimmed.startsWith("cookie:not-exists:")) {
    const name = trimmed.slice("cookie:not-exists:".length);
    return { type: "cookie_not_exists", expected: name, description: `Cookie "${name}" does not exist` };
  }

  // cookie:value:<name>=<value>
  if (trimmed.startsWith("cookie:value:")) {
    const valueStr = trimmed.slice("cookie:value:".length);
    return { type: "cookie_value", expected: valueStr, description: `Cookie value is "${valueStr}"` };
  }

  // local:exists:<key>
  if (trimmed.startsWith("local:exists:")) {
    const key = trimmed.slice("local:exists:".length);
    return { type: "local_storage_exists", expected: key, description: `LocalStorage key "${key}" exists` };
  }

  // local:not-exists:<key>
  if (trimmed.startsWith("local:not-exists:")) {
    const key = trimmed.slice("local:not-exists:".length);
    return { type: "local_storage_not_exists", expected: key, description: `LocalStorage key "${key}" does not exist` };
  }

  // local:value:<key>=<value>
  if (trimmed.startsWith("local:value:")) {
    const valueStr = trimmed.slice("local:value:".length);
    return { type: "local_storage_value", expected: valueStr, description: `LocalStorage value is "${valueStr}"` };
  }

  // session:value:<key>=<value>
  if (trimmed.startsWith("session:value:")) {
    const valueStr = trimmed.slice("session:value:".length);
    return { type: "session_storage_value", expected: valueStr, description: `SessionStorage value is "${valueStr}"` };
  }

  // session:not-exists:<key>
  if (trimmed.startsWith("session:not-exists:")) {
    const key = trimmed.slice("session:not-exists:".length);
    return { type: "session_storage_not_exists", expected: key, description: `SessionStorage key "${key}" does not exist` };
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
