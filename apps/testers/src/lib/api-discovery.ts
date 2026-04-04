import type { Page, Route, Request as PWRequest } from "playwright";

export interface DiscoveredEndpoint {
  url: string;
  method: string;
  status: number;
  resourceType: string;
  responseSize: number;
  responseTime: number;
  hasAuth: boolean;
}

export interface ApiDiscoveryOptions {
  /** Duration to monitor network traffic (ms) */
  durationMs?: number;
  /** Filter to only XHR/fetch requests */
  onlyXhr?: boolean;
  /** Filter URLs by pattern */
  urlPattern?: string | RegExp;
}

/**
 * Discover API endpoints by monitoring network traffic during page navigation.
 * Useful for generating API health check scenarios from actual network activity.
 */
export async function discoverApiEndpoints(
  page: Page,
  options: ApiDiscoveryOptions = {},
): Promise<DiscoveredEndpoint[]> {
  const {
    durationMs = 10000,
    onlyXhr = true,
    urlPattern,
  } = options;

  const endpoints = new Map<string, DiscoveredEndpoint>();
  const responseTimes = new Map<string, number>();

  page.on("request", (req: PWRequest) => {
    responseTimes.set(req.url(), Date.now());
  });

  page.on("response", async (response) => {
    const request = response.request();
    const url = request.url();

    // Filter to API-like requests
    if (onlyXhr) {
      const type = request.resourceType();
      if (!["xhr", "fetch"].includes(type)) return;
    }

    // Filter by URL pattern
    if (urlPattern) {
      const matches = typeof urlPattern === "string"
        ? url.includes(urlPattern)
        : urlPattern.test(url);
      if (!matches) return;
    }

    const urlObj = new URL(url);
    // Normalize URL: replace path params with placeholders
    const normalizedPath = urlObj.pathname.replace(/\/[a-f0-9-]{8,}/g, "/:id");
    const normalizedUrl = `${urlObj.origin}${normalizedPath}`;

    const key = `${request.method()} ${normalizedUrl}`;

    if (!endpoints.has(key)) {
      const responseTime = Date.now() - (responseTimes.get(url) ?? Date.now());
      endpoints.set(key, {
        url: normalizedUrl,
        method: request.method(),
        status: response.status(),
        resourceType: request.resourceType(),
        responseSize: (await response.body().catch(() => Buffer.alloc(0))).length,
        responseTime,
        hasAuth: !!request.headers()["authorization"] || !!request.headers()["cookie"],
      });
    }
  });

  // Wait for the specified duration
  await page.waitForTimeout(durationMs);

  return Array.from(endpoints.values());
}

/**
 * Generate API check scenarios from discovered endpoints.
 * Returns CreateScenarioInput objects ready to insert into the DB.
 */
export function generateApiScenarios(endpoints: DiscoveredEndpoint[]): Array<{
  name: string;
  description: string;
  type: string;
  apiUrl: string;
  method: string;
  expectedStatus: number;
  tags: string[];
  priority: string;
}> {
  return endpoints.map((ep) => {
    const pathName = new URL(ep.url).pathname;
    const shortName = pathName.replace(/^\//, "").replace(/\//g, "_").replace(/[^a-zA-Z0-9_]/g, "") || "root";

    return {
      name: `API: ${ep.method} ${pathName}`,
      description: `Auto-discovered API endpoint: ${ep.method} ${ep.url} (status: ${ep.status}, avg response: ${ep.responseTime}ms)`,
      type: "api",
      apiUrl: ep.url,
      method: ep.method,
      expectedStatus: ep.status,
      tags: ["api", "auto-discovered", ep.resourceType],
      priority: ep.status >= 500 ? "critical" : "medium",
    };
  });
}

/**
 * Group endpoints by base URL pattern.
 */
export function groupEndpoints(endpoints: DiscoveredEndpoint[]): Record<string, DiscoveredEndpoint[]> {
  const groups: Record<string, DiscoveredEndpoint[]> = {};

  for (const ep of endpoints) {
    const pathParts = new URL(ep.url).pathname.split("/").filter(Boolean);
    const group = pathParts.length > 0 ? pathParts[0] : "root";
    if (!groups[group]) groups[group] = [];
    groups[group].push(ep);
  }

  return groups;
}

/**
 * Summarize discovered endpoints.
 */
export function summarizeEndpoints(endpoints: DiscoveredEndpoint[]): string {
  const total = endpoints.length;
  const byMethod: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const authEndpoints = endpoints.filter((e) => e.hasAuth).length;
  const errorEndpoints = endpoints.filter((e) => e.status >= 400).length;
  const avgResponseTime = endpoints.length > 0
    ? Math.round(endpoints.reduce((sum, e) => sum + e.responseTime, 0) / endpoints.length)
    : 0;

  for (const ep of endpoints) {
    byMethod[ep.method] = (byMethod[ep.method] ?? 0) + 1;
    const statusGroup = ep.status >= 500 ? "5xx" : ep.status >= 400 ? "4xx" : ep.status >= 300 ? "3xx" : ep.status >= 200 ? "2xx" : "other";
    byStatus[statusGroup] = (byStatus[statusGroup] ?? 0) + 1;
  }

  const lines = [
    `Discovered ${total} API endpoints`,
    `Methods: ${Object.entries(byMethod).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
    `Status: ${Object.entries(byStatus).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
    `Auth-protected: ${authEndpoints}`,
    `Error endpoints: ${errorEndpoints}`,
    `Avg response time: ${avgResponseTime}ms`,
  ];

  return lines.join("\n");
}
