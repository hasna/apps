import type {
  HttpMethod,
  JsonBody,
  JsonRecord,
  QueryValue,
  TripleWhaleConfig,
  TripleWhaleRequestOptions,
} from "../types/index.js";
import { TripleWhaleApiError } from "../types/index.js";

export const DEFAULT_BASE_URL = "https://api.triplewhale.com";

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "").replace(/\/api\/v2$/i, "");
}

export function assertRelativePath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || /^https?:\/\//i.test(path)) {
    throw new Error("Triple Whale: path must be a relative API path that starts with /.");
  }
  return path;
}

export function toApiPath(path: string): string {
  const safePath = assertRelativePath(path);
  if (safePath === "/api/v2" || safePath.startsWith("/api/v2/")) return safePath;
  if (safePath.startsWith("/api/")) return safePath;
  return `/api/v2${safePath}`;
}

export function appendQuery(url: URL, query?: Record<string, QueryValue>): void {
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
      continue;
    }
    if (typeof value === "object") {
      url.searchParams.set(key, JSON.stringify(value));
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

export function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(toApiPath(path), `${normalizeBaseUrl(baseUrl)}/`);
  appendQuery(url, query);
  return url.toString();
}

function parseResponse(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export class TripleWhaleClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  readonly shopDomain?: string;

  constructor(config: TripleWhaleConfig) {
    if (!config.apiKey?.trim()) {
      throw new Error("Triple Whale API key is required");
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = normalizeBaseUrl(config.baseUrl || DEFAULT_BASE_URL);
    this.shopDomain = config.shopDomain?.trim() || undefined;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number): number {
    return 1000 * Math.pow(2, attempt) + Math.random() * 500;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  async request<T = unknown>(options: TripleWhaleRequestOptions): Promise<T> {
    const method: HttpMethod = options.method ?? "GET";
    const retries = options.retries ?? 3;
    const timeout = options.timeout ?? 30_000;
    const url = buildUrl(this.baseUrl, options.path, options.query);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": this.apiKey,
    };

    const body = method === "GET" ? undefined : JSON.stringify(options.body ?? {});

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const text = await response.text();
        const data = parseResponse(text);

        if (!response.ok) {
          const message = `Triple Whale: request failed (${response.status}): ${
            typeof data === "object" && data !== null
              ? JSON.stringify(data).slice(0, 500)
              : String(text).slice(0, 500)
          }`;

          if (this.isRetryableStatus(response.status) && attempt < retries) {
            await this.sleep(this.getRetryDelay(attempt));
            continue;
          }

          throw new TripleWhaleApiError(message, response.status);
        }

        return data as T;
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof TripleWhaleApiError) throw err;

        lastError = err instanceof Error ? err : new Error(String(err));
        const aborted = lastError.name === "AbortError";
        if ((aborted || attempt < retries) && attempt < retries) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }
        if (aborted) {
          throw new TripleWhaleApiError(`Triple Whale: request timed out after ${timeout}ms`, 408);
        }
        throw lastError;
      }
    }

    throw lastError ?? new TripleWhaleApiError("Triple Whale: request failed", 500);
  }
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

export function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function compactRecord(record: JsonRecord): JsonRecord {
  const output: JsonRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) output[key] = value;
  }
  return output;
}

export function dataBody(options: JsonRecord, nestedKey?: string): JsonRecord {
  const nested = nestedKey ? asRecord(options[nestedKey]) : undefined;
  const body = nested ?? asRecord(options.body) ?? options;
  return compactRecord({ ...body });
}

export function periodFromOptions(options: {
  period?: JsonRecord;
  startDate?: string;
  endDate?: string;
  start_date?: string;
  end_date?: string;
}): JsonRecord | undefined {
  const period = asRecord(options.period);
  if (period) return period;
  const startDate = pickString(options.startDate, options.start_date);
  const endDate = pickString(options.endDate, options.end_date);
  if (!startDate && !endDate) return undefined;
  return compactRecord({ startDate, endDate });
}

export function resolveShop(
  client: TripleWhaleClient,
  options: JsonRecord,
): string {
  const shop = pickString(options.shop, options.shopDomain, options.shopId, client.shopDomain);
  if (!shop) {
    throw new Error(
      "Triple Whale: provide --shop, --shop-domain, or set TRIPLE_WHALE_SHOP_DOMAIN / shop_domain in profile.",
    );
  }
  return shop;
}

export function bodyWithShop(
  client: TripleWhaleClient,
  options: JsonRecord,
  nestedKey: string | undefined,
  shopKey: "shop" | "shopDomain" | "shopId",
): JsonRecord {
  const body = dataBody(options, nestedKey);
  body[shopKey] = pickString(body[shopKey]) ?? resolveShop(client, options);
  return compactRecord(body);
}
