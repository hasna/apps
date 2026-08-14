import type { Page, Route } from "playwright";

export interface MockRule {
  /** URL pattern to intercept (string, regex pattern, or glob) */
  url: string | RegExp;
  /** HTTP method to match (omit for all methods) */
  method?: string;
  /** If true, abort the request with given error code */
  abort?: boolean | string;
  /** Override status code (e.g. 200, 404, 500) */
  status?: number;
  /** Override response headers */
  headers?: Record<string, string>;
  /** Override response body (JSON string or raw) */
  body?: string | object;
  /** Simulate network delay in ms */
  delay?: number;
}

/**
 * Sets up network interception and mocking on a Playwright page.
 * Returns the active rules count.
 */
export async function setupNetworkMocks(page: Page, rules: MockRule[]): Promise<number> {
  if (rules.length === 0) return 0;

  for (const rule of rules) {
    await page.route(rule.url, async (route: Route) => {
      // Method filter
      if (rule.method && route.request().method() !== rule.method) {
        await route.continue();
        return;
      }

      if (rule.abort) {
        await route.abort(typeof rule.abort === "string" ? rule.abort : "failed");
        return;
      }

      const responseBody = rule.body !== undefined
        ? typeof rule.body === "string"
          ? rule.body
          : JSON.stringify(rule.body)
        : "{}";

      const responseHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        ...(rule.headers ?? {}),
      };

      if (rule.delay) {
        await new Promise((resolve) => setTimeout(resolve, rule.delay));
      }

      await route.fulfill({
        status: rule.status ?? 200,
        headers: responseHeaders,
        body: responseBody,
      });
    });
  }

  return rules.length;
}

/**
 * Creates common mock patterns for testing.
 */
export const MockPresets = {
  /** Mock all API calls to return empty 200 */
  emptyApi: (): MockRule[] => [
    { url: "/api/**", status: 200, body: {} },
  ],

  /** Mock a specific endpoint to return 500 */
  serverError: (path: string): MockRule[] => [
    { url: path, status: 500, body: { error: "Internal Server Error" } },
  ],

  /** Mock a specific endpoint to timeout */
  timeout: (path: string, _delayMs = 30000): MockRule[] => [
    { url: path, abort: "timedout" },
  ],

  /** Block third-party trackers */
  blockTrackers: (): MockRule[] => [
    { url: /analytics\.|tracking\.|pixel\.|telemetry\./i, abort: true },
  ],

  /** Mock auth token endpoint */
  mockAuth: (token = "mock-jwt-token"): MockRule[] => [
    { url: "**/auth/**", status: 200, body: { token, expires_in: 3600 } },
  ],
};
