import type { FetchOptions, FetchResult } from "../types/index.js";
import { getConfig } from "./config.js";

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

export class RateLimiter {
  private lastRequest = new Map<string, number>();
  private delay: number;

  constructor(delay?: number) {
    this.delay = delay ?? getConfig().defaultDelay;
  }

  async wait(domain: string): Promise<void> {
    const now = Date.now();
    const last = this.lastRequest.get(domain) ?? 0;
    const elapsed = now - last;
    const delay = this.delay;

    if (elapsed < delay) {
      await sleep(delay - elapsed);
    }

    this.lastRequest.set(domain, Date.now());
  }
}

// ─── Shared rate limiter instance ─────────────────────────────────────────────

const globalRateLimiter = new RateLimiter();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchPage(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResult> {
  const config = getConfig();
  const userAgent = options.userAgent ?? config.userAgent;
  const timeout = options.timeout ?? 30_000;
  const maxRedirects = options.maxRedirects ?? 10;
  const delay = options.delay;

  const domain = extractDomain(url);

  // Apply per-domain rate limiting
  const rateLimiter =
    delay !== undefined ? new RateLimiter(delay) : globalRateLimiter;
  await rateLimiter.wait(domain);

  const requestHeaders: Record<string, string> = {
    "User-Agent": userAgent,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    ...options.headers,
  };

  if (options.cookies) {
    requestHeaders["Cookie"] = options.cookies;
  }

  const MAX_ATTEMPTS = 3;
  const RETRY_DELAYS = [1000, 2000, 4000];
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const backoff = RETRY_DELAYS[attempt - 1] ?? 4000;
      await sleep(backoff);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      let currentUrl = url;
      let redirectedTo: string | null = null;
      let redirectCount = 0;
      let response: Response;

      // Manual redirect following to track final URL
      while (true) {
        response = await fetch(currentUrl, {
          headers: requestHeaders,
          redirect: "manual",
          signal: controller.signal,
        });

        if (
          (response.status === 301 ||
            response.status === 302 ||
            response.status === 303 ||
            response.status === 307 ||
            response.status === 308) &&
          redirectCount < maxRedirects
        ) {
          const location = response.headers.get("location");
          if (!location) break;

          // Resolve relative redirects
          const nextUrl = location.startsWith("http")
            ? location
            : new URL(location, currentUrl).toString();

          redirectedTo = nextUrl;
          currentUrl = nextUrl;
          redirectCount++;
        } else {
          break;
        }
      }

      clearTimeout(timeoutId);

      const contentType = response.headers.get("content-type") ?? "";
      const responseHeaders = headersToRecord(response.headers);

      let html = "";
      let byteSize = 0;

      try {
        const buffer = await response.arrayBuffer();
        byteSize = buffer.byteLength;
        html = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
      } catch {
        html = "";
        byteSize = 0;
      }

      return {
        url,
        redirectedTo,
        statusCode: response.status,
        contentType,
        html,
        headers: responseHeaders,
        byteSize,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on abort (timeout)
      if (lastError.name === "AbortError") break;
    }
  }

  // All attempts exhausted — return an error result
  return {
    url,
    redirectedTo: null,
    statusCode: 0,
    contentType: "",
    html: "",
    headers: {},
    byteSize: 0,
  };
}
