import { createFeedbackStore, FeedbackStoreBusyError } from "./storage.js";
import type { FeedbackListFilter, FeedbackStatus, FeedbackStore } from "./types.js";
import { parseFeedbackInput, parseFeedbackStatus, validationErrorMessage } from "./validation.js";
import { VERSION } from "./version.js";
import { resolveRequestClientIp, resolveTrustProxy, trustedProxiesFromEnv } from "./client-ip.js";

export type FeedbackApiScope = "submit" | "read" | "triage" | "export";

export interface FeedbackApiOptions {
  store?: FeedbackStore;
  apiToken?: string;
  tokens?: Partial<Record<FeedbackApiScope, string>>;
  publicSubmit?: boolean;
  sharedDeployment?: boolean;
  rateLimit?: { windowMs?: number; maxSubmissions?: number };
  corsOrigin?: string;
  /**
   * Trust `x-forwarded-for` & friends when keying the rate limiter (true only
   * when this service genuinely sits behind the trusted proxies — e.g. the
   * api.hasna.com gateway + ALB). Defaults to FEEDBACK_TRUST_PROXY env; off by
   * default, so local/dev behavior is unchanged (socket peer keying).
   */
  trustProxy?: boolean;
  /**
   * Exact IPs / CIDRs of proxies operated in front of this service. Hops
   * matching these are stepped over when identifying a caller. Defaults to
   * FEEDBACK_TRUSTED_PROXIES (comma separated).
   */
  trustedProxies?: readonly string[];
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const defaultRateWindowMs = 60_000;
const defaultMaxSubmissions = 20;

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

function envName(parts: string[]): string {
  return parts.join("_");
}

function scopedToken(scope: FeedbackApiScope, options: FeedbackApiOptions): string | undefined {
  const configured = options.tokens?.[scope];
  if (configured) return configured;
  const env = process.env[envName(["FEEDBACK", scope.toUpperCase(), "TOKEN"])];
  return env && env.trim() ? env : undefined;
}

function legacyToken(options: FeedbackApiOptions): string | undefined {
  const configured = options.apiToken;
  if (configured) return configured;
  const env = process.env[envName(["FEEDBACK", "API", "TOKEN"])];
  return env && env.trim() ? env : undefined;
}

function isSharedDeployment(options: FeedbackApiOptions, legacy?: string): boolean {
  if (typeof options.sharedDeployment === "boolean") return options.sharedDeployment;
  const mode = process.env[envName(["FEEDBACK", "DEPLOYMENT", "MODE"])]?.trim().toLowerCase();
  if (mode && mode !== "local") return true;
  return Boolean(legacy || process.env[envName(["FEEDBACK", "READ", "TOKEN"])] || process.env[envName(["FEEDBACK", "EXPORT", "TOKEN"])] || process.env[envName(["FEEDBACK", "TRIAGE", "TOKEN"])]);
}

function resolveAuth(options: FeedbackApiOptions) {
  const legacy = legacyToken(options);
  const tokens: Record<FeedbackApiScope, string | undefined> = {
    submit: scopedToken("submit", options) ?? legacy,
    read: scopedToken("read", options) ?? legacy,
    triage: scopedToken("triage", options) ?? legacy,
    export: scopedToken("export", options) ?? legacy,
  };
  return {
    tokens,
    shared: isSharedDeployment(options, legacy),
    publicSubmit: options.publicSubmit ?? process.env[envName(["FEEDBACK", "PUBLIC", "SUBMIT"])] === "1",
  };
}

function authorize(request: Request, scope: FeedbackApiScope, auth: ReturnType<typeof resolveAuth>): Response | null {
  if (scope === "submit" && auth.publicSubmit) return null;
  const required = auth.tokens[scope];
  if (!required) {
    if (auth.shared) return errorResponse(503, `Hasna Feedback ${scope} access is disabled until a scoped token is configured.`);
    return null;
  }
  return authTokenFromRequest(request) === required ? null : errorResponse(401, "Unauthorized");
}

/**
 * Rate-limit bucket key for a submission. The raw leftmost X-Forwarded-For
 * entry is attacker-controlled (rotating it mints a fresh bucket per guess),
 * so it is only consulted — validated, right-to-left, skipping trusted
 * proxies — when the operator explicitly trusts the forwarding hop
 * (FEEDBACK_TRUST_PROXY), and only ever with the socket peer as the fallback
 * that no header can forge (see ./client-ip.ts). Produces "local" as the last
 * resort for in-process test requests.
 */
function clientKey(
  request: Request,
  peer: string | null | undefined,
  trustProxy: boolean,
  trustedProxies: readonly string[],
): string {
  return resolveRequestClientIp({
    headers: request.headers,
    socketAddress: peer,
    trustProxy,
    trustedProxies,
  }) ?? "local";
}

function isSpammy(input: { message?: unknown; appId?: unknown }): boolean {
  const appId = typeof input.appId === "string" ? input.appId.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!appId || !message) return true;
  if (message.length < 3 || message.length > 10_000) return true;
  const linkCount = (message.match(/https?:\/\//gi) ?? []).length;
  if (linkCount > 3) return true;
  if (/(.)\1{40,}/.test(message)) return true;
  return false;
}

function fingerprint(input: { appId?: unknown; message?: unknown; userId?: unknown; email?: unknown }): string {
  return [
    typeof input.appId === "string" ? input.appId.trim().toLowerCase() : "",
    typeof input.message === "string" ? input.message.trim().replace(/\s+/g, " ").toLowerCase() : "",
    typeof input.userId === "string" ? input.userId.trim().toLowerCase() : "",
    typeof input.email === "string" ? input.email.trim().toLowerCase() : "",
  ].join("|");
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
    search: url.searchParams.get("search") ?? undefined,
    since: url.searchParams.get("since") ?? undefined,
    until: url.searchParams.get("until") ?? undefined,
    limit: parseLimit(url.searchParams.get("limit")),
    status: status ? parseFeedbackStatus(status) : undefined,
  };
}

export interface FeedbackRequestContext {
  /** Socket peer address (`server.requestIP`); never a client header. */
  peer?: string | null;
}

export function createFeedbackHandler(options: FeedbackApiOptions = {}): (
  request: Request,
  context?: FeedbackRequestContext,
) => Promise<Response> {
  const store = options.store ?? createFeedbackStore();
  const auth = resolveAuth(options);
  const corsOrigin = options.corsOrigin ?? process.env["FEEDBACK_CORS_ORIGIN"] ?? "*";
  const trustProxy = options.trustProxy ?? resolveTrustProxy();
  const trustedProxies = options.trustedProxies ?? trustedProxiesFromEnv();
  const buckets = new Map<string, RateBucket>();
  const recentFingerprints = new Map<string, number>();
  const windowMs = options.rateLimit?.windowMs ?? defaultRateWindowMs;
  const maxSubmissions = options.rateLimit?.maxSubmissions ?? defaultMaxSubmissions;

  return async function handleFeedbackRequest(
    request: Request,
    context?: FeedbackRequestContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), corsOrigin);

    try {
      if (request.method === "GET" && pathname === "/health") {
        return withCors(jsonResponse({ ok: true, service: "feedback", version: VERSION }), corsOrigin);
      }

      if (request.method === "POST" && pathname === "/v1/feedback") {
        const denied = authorize(request, "submit", auth);
        if (denied) return withCors(denied, corsOrigin);
        const rawInput = await request.json();
        if (isSpammy(rawInput as Record<string, unknown>)) return withCors(errorResponse(400, "Feedback failed spam validation"), corsOrigin);
        const bucketKey = clientKey(request, context?.peer, trustProxy, trustedProxies);
        const now = Date.now();
        const current = buckets.get(bucketKey);
        if (!current || current.resetAt <= now) buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
        else {
          current.count += 1;
          if (current.count > maxSubmissions) return withCors(errorResponse(429, "Feedback rate limit exceeded"), corsOrigin);
        }
        const dedupeKey = fingerprint(rawInput as Record<string, unknown>);
        const previous = recentFingerprints.get(dedupeKey);
        if (previous && now - previous < windowMs) return withCors(errorResponse(409, "Duplicate feedback suppressed"), corsOrigin);
        recentFingerprints.set(dedupeKey, now);
        for (const [key, timestamp] of recentFingerprints) {
          if (now - timestamp > windowMs) recentFingerprints.delete(key);
        }

        const input = parseFeedbackInput(rawInput);
        const item = await store.createFeedback(input, { source: "api" });
        return withCors(jsonResponse(item, { status: 201 }), corsOrigin);
      }

      if (request.method === "GET" && pathname === "/v1/feedback") {
        const denied = authorize(request, "read", auth);
        if (denied) return withCors(denied, corsOrigin);
        return withCors(jsonResponse(await store.listFeedback(listFilterFromUrl(url))), corsOrigin);
      }

      if (request.method === "GET" && pathname.startsWith("/v1/feedback/")) {
        const denied = authorize(request, "read", auth);
        if (denied) return withCors(denied, corsOrigin);
        const id = decodeURIComponent(pathname.slice("/v1/feedback/".length));
        const item = await store.getFeedback(id);
        return withCors(item ? jsonResponse(item) : errorResponse(404, "Feedback not found"), corsOrigin);
      }

      if (request.method === "PATCH" && pathname.startsWith("/v1/feedback/")) {
        const denied = authorize(request, "triage", auth);
        if (denied) return withCors(denied, corsOrigin);
        const id = decodeURIComponent(pathname.slice("/v1/feedback/".length));
        const body = (await request.json()) as { status?: FeedbackStatus; changelogRef?: string };
        const status = parseFeedbackStatus(body.status);

        // `changelogRef` carries the feedback → changelog receipt. Routing it
        // through the existing PATCH keeps the hosted path able to record what
        // shipped a report, which `updateFeedbackStatus` alone cannot.
        if (body.changelogRef !== undefined) {
          if (status !== "shipped") {
            return withCors(errorResponse(400, "changelogRef is only valid with status \"shipped\""), corsOrigin);
          }
          if (!store.markFeedbackShipped) {
            return withCors(errorResponse(501, "This store cannot record changelog linkage"), corsOrigin);
          }
          if (!body.changelogRef.trim()) {
            return withCors(errorResponse(400, "changelogRef must not be empty"), corsOrigin);
          }
          const shipped = await store.markFeedbackShipped(id, body.changelogRef);
          return withCors(shipped ? jsonResponse(shipped) : errorResponse(404, "Feedback not found"), corsOrigin);
        }

        const item = await store.updateFeedbackStatus(id, status);
        return withCors(item ? jsonResponse(item) : errorResponse(404, "Feedback not found"), corsOrigin);
      }

      if (request.method === "GET" && pathname === "/v1/stats") {
        const denied = authorize(request, "read", auth);
        if (denied) return withCors(denied, corsOrigin);
        return withCors(jsonResponse(await store.stats()), corsOrigin);
      }

      if (request.method === "GET" && pathname === "/v1/export.jsonl") {
        const denied = authorize(request, "export", auth);
        if (denied) return withCors(denied, corsOrigin);
        return withCors(textResponse(await store.exportJsonl(listFilterFromUrl(url))), corsOrigin);
      }

      return withCors(errorResponse(404, "Not found"), corsOrigin);
    } catch (error) {
      // Contention is a server-side, retryable condition — not a bad request.
      if (error instanceof FeedbackStoreBusyError) {
        const response = errorResponse(503, "Feedback store is busy, retry shortly");
        response.headers.set("retry-after", "1");
        return withCors(response, corsOrigin);
      }
      return withCors(errorResponse(400, validationErrorMessage(error)), corsOrigin);
    }
  };
}
