import { LocalFeedbackStore } from "./storage.js";
import type { FeedbackListFilter, FeedbackStatus, FeedbackStore } from "./types.js";
import { parseFeedbackInput, parseFeedbackStatus, validationErrorMessage } from "./validation.js";
import { VERSION } from "./version.js";

export interface FeedbackApiOptions {
  store?: FeedbackStore;
  apiToken?: string;
  corsOrigin?: string;
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value, null, 2), { ...init, headers });
}

function textResponse(text: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(text, { ...init, headers });
}

function errorResponse(status: number, error: string): Response {
  return jsonResponse({ error }, { status });
}

function authTokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return request.headers.get("x-feedback-token");
}

function withCors(response: Response, origin = "*"): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
  headers.set("access-control-allow-headers", "authorization,content-type,x-feedback-token");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return undefined;
  return Math.min(parsed, 500);
}

function listFilterFromUrl(url: URL): FeedbackListFilter {
  const status = url.searchParams.get("status");
  return {
    appId: url.searchParams.get("appId") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    limit: parseLimit(url.searchParams.get("limit")),
    status: status ? parseFeedbackStatus(status) : undefined,
  };
}

export function createFeedbackHandler(options: FeedbackApiOptions = {}): (request: Request) => Promise<Response> {
  const store = options.store ?? new LocalFeedbackStore();
  const apiToken = options.apiToken ?? process.env["FEEDBACK_API_TOKEN"];
  const corsOrigin = options.corsOrigin ?? process.env["FEEDBACK_CORS_ORIGIN"] ?? "*";

  return async function handleFeedbackRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), corsOrigin);

    if (apiToken && authTokenFromRequest(request) !== apiToken) {
      return withCors(errorResponse(401, "Unauthorized"), corsOrigin);
    }

    try {
      if (request.method === "GET" && pathname === "/health") {
        return withCors(jsonResponse({ ok: true, service: "open-feedback", version: VERSION }), corsOrigin);
      }

      if (request.method === "POST" && pathname === "/v1/feedback") {
        const input = parseFeedbackInput(await request.json());
        const item = await store.createFeedback(input, { source: "api" });
        return withCors(jsonResponse(item, { status: 201 }), corsOrigin);
      }

      if (request.method === "GET" && pathname === "/v1/feedback") {
        return withCors(jsonResponse(await store.listFeedback(listFilterFromUrl(url))), corsOrigin);
      }

      if (request.method === "GET" && pathname.startsWith("/v1/feedback/")) {
        const id = decodeURIComponent(pathname.slice("/v1/feedback/".length));
        const item = await store.getFeedback(id);
        return withCors(item ? jsonResponse(item) : errorResponse(404, "Feedback not found"), corsOrigin);
      }

      if (request.method === "PATCH" && pathname.startsWith("/v1/feedback/")) {
        const id = decodeURIComponent(pathname.slice("/v1/feedback/".length));
        const body = (await request.json()) as { status?: FeedbackStatus };
        const item = await store.updateFeedbackStatus(id, parseFeedbackStatus(body.status));
        return withCors(item ? jsonResponse(item) : errorResponse(404, "Feedback not found"), corsOrigin);
      }

      if (request.method === "GET" && pathname === "/v1/stats") {
        return withCors(jsonResponse(await store.stats()), corsOrigin);
      }

      if (request.method === "GET" && pathname === "/v1/export.jsonl") {
        return withCors(textResponse(await store.exportJsonl(listFilterFromUrl(url))), corsOrigin);
      }

      return withCors(errorResponse(404, "Not found"), corsOrigin);
    } catch (error) {
      return withCors(errorResponse(400, validationErrorMessage(error)), corsOrigin);
    }
  };
}

