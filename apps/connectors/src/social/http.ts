/**
 * Shared, bundle-safe HTTP helper for the stateless social adapters.
 *
 * Provides an injectable `FetchLike` (so tests can mock the network) and a small
 * JSON request helper. Uses only `globalThis.fetch` / `URLSearchParams` / `Buffer`
 * — NO `node:fs`, NO `child_process`, NO db/runner/storage imports.
 */

/** Injectable fetch so tests can mock the network without real I/O. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: unknown },
) => Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  /** Present on real fetch Responses; some adapters (e.g. resumable uploads) read it. */
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  return fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
}

export interface JsonRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Override how the error message is extracted from a parsed error body. */
  errorLabel?: string;
}

function appendQuery(url: string, query?: JsonRequestOptions["query"]): string {
  if (!query) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}${url.includes("?") ? "&" : "?"}${s}` : url;
}

function extractError(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const candidates = [
      d.error_description,
      typeof d.error === "string" ? d.error : undefined,
      d.message,
      // nested google-style { error: { message } }
      d.error && typeof d.error === "object" ? (d.error as Record<string, unknown>).message : undefined,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c) return c;
    }
  }
  return fallback;
}

/**
 * Perform a JSON request and parse the response. Throws on non-2xx with a useful
 * message. `body` is JSON-serialized for non-GET requests unless it is already a
 * string or FormData.
 */
export async function jsonRequest<T>(
  fetchImpl: FetchLike,
  url: string,
  options: JsonRequestOptions = {},
): Promise<T> {
  const { method = "GET", query, body } = options;
  const finalUrl = appendQuery(url, query);
  const headers: Record<string, string> = { Accept: "application/json", ...(options.headers ?? {}) };

  let serialized: unknown;
  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    if (typeof body === "string" || body instanceof FormData) {
      serialized = body;
    } else {
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
      serialized = JSON.stringify(body);
    }
  }

  const res = await fetchImpl(finalUrl, { method, headers, body: serialized });
  const text = await res.text();
  const data = text ? safeJsonParse(text) : {};
  if (!res.ok) {
    const label = options.errorLabel ?? "request";
    throw new Error(`${label} ${res.status}: ${extractError(data, res.statusText || "failed")}`);
  }
  return data as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
