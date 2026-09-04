// ============================================================================
// CORS headers
// ============================================================================

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": process.env["MEMENTOS_CORS_ORIGIN"] ?? "http://localhost:19428",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

// ============================================================================
// Host/Origin allowlist for state-changing requests
// ============================================================================

const STATE_CHANGING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** True for methods that mutate state — the CSRF-relevant request surface. */
export function isStateChangingMethod(method: string): boolean {
  return STATE_CHANGING_METHODS.has(method);
}

/**
 * The configured allowlist of origins permitted to mutate state.
 *
 * `MEMENTOS_CORS_ORIGIN` accepts a comma-separated list; each entry may be a
 * full origin (`http://localhost:19428`) or a bare `host[:port]`. The default
 * is the mementos server's own origin. An empty value yields an empty
 * allowlist, which fails closed (no origin or host is allowed to mutate
 * state).
 */
export function getAllowedOrigins(): string[] {
  const raw = process.env["MEMENTOS_CORS_ORIGIN"] ?? "http://localhost:19428";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** The `host[:port]` portion of an allowlist entry (bare hosts pass through). */
function hostOf(entry: string): string {
  try {
    return new URL(entry).host;
  } catch {
    return entry;
  }
}

/**
 * Reject state-changing requests whose Origin (when present) or Host (when no
 * Origin is present) is not on the configured allowlist. Read-only methods
 * pass through untouched. Returns an error `Response` to reject, or `null`.
 *
 * This is the non-OPTIONS sibling of the preflight gate: a hostile page can
 * forge a POST/PATCH/DELETE with any Origin it likes, so those methods must
 * be allowlisted on every request, not only at preflight time.
 *
 * `authenticated` marks a request whose API key was already verified (see
 * auth.ts `checkApiKey`): such a request is not CSRF, so the ambient-credential
 * gate is skipped for it when it carries no Origin header (the CLI/MCP/SDK
 * client shape). See `checkWriteOriginOrHost`.
 */
export function checkOriginOrHost(req: Request, method: string, authenticated = false): Response | null {
  if (!isStateChangingMethod(method)) return null;
  return checkWriteOriginOrHost(req, authenticated);
}

/**
 * The allowlist check itself: reject a request whose Origin (when present) or
 * Host (when no Origin is present) is not on the configured allowlist.
 *
 * GET requests are CORS "simple requests" — a hostile cross-origin page can
 * trigger one with no preflight — so a GET route whose handler writes state
 * (a touch/recency update, a cache write, an LLM call) must be gated exactly
 * like a state-changing method, even though its HTTP method is not one.
 *
 * `authenticated` exempts requests that carry a VERIFIED explicit API key and
 * no Origin header. The allowlist is an ambient-credential (CSRF) defense: a
 * hostile page cannot attach the Authorization header without CORS preflight
 * (which is separately allowlisted) and cannot read the key, so a keyed
 * request with no Origin is not CSRF and must be served regardless of
 * MEMENTOS_CORS_ORIGIN — a deployment that omits the env var (or a client
 * reaching the server through a Host the allowlist does not name) must not
 * take down every CLI/MCP/SDK client with 403 'Host is not allowed'.
 * Browser-context requests — any request WITH an Origin header — keep the
 * full Origin allowlist even when keyed, as defense in depth.
 */
export function checkWriteOriginOrHost(req: Request, authenticated = false): Response | null {
  if (authenticated && req.headers.get("origin") === null) return null;
  const allowlist = getAllowedOrigins();
  const allowedHosts = allowlist.map(hostOf);

  const origin = req.headers.get("origin");
  if (origin !== null) {
    if (allowlist.includes(origin)) return null;
    return json({ error: "Forbidden. Origin is not allowed." }, 403);
  }

  const host = req.headers.get("host");
  if (host !== null) {
    if (allowedHosts.includes(host)) return null;
    return json({ error: "Forbidden. Host is not allowed." }, 403);
  }

  // Neither Origin nor Host (a malformed request) — fail closed.
  return json({ error: "Forbidden. Missing Origin or Host header." }, 403);
}

// ============================================================================
// Response helpers
// ============================================================================

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export function errorResponse(
  message: string,
  status: number,
  details?: unknown
): Response {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body["details"] = details;
  return json(body, status);
}

/**
 * Classify a thrown error as a database constraint violation — i.e. the caller
 * sent a value the schema refuses (bad enum, missing FK, duplicate unique key).
 * Returns an actionable message for a 400, or `null` when the error is a
 * genuine server fault that must stay a 500.
 *
 * Defence in depth behind the per-route validators: a column whose CHECK is not
 * yet mirrored by a validator still gets reported as a client error rather than
 * as an opaque outage.
 */
export function describeConstraintViolation(e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  const code = String((e as { code?: unknown }).code ?? "");
  const message = String((e as { message?: unknown }).message ?? "");
  const isConstraint =
    code.startsWith("SQLITE_CONSTRAINT") ||
    // node-postgres integrity-violation class
    /^23\d{3}$/.test(code) ||
    /constraint failed/i.test(message);
  if (!isConstraint) return null;
  return `Request rejected by a database constraint: ${message || code}. Check that enum fields (category, scope, source, status) and referenced ids are valid.`;
}

// Maximum POST body size: 1 MB
const MAX_BODY_BYTES = 1 * 1024 * 1024;

export async function readJson(req: Request): Promise<unknown> {
  try {
    const contentLength = req.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Payload too large"), { status: 413 });
    }
    return await req.json();
  } catch {
    return null;
  }
}

// ============================================================================
// Authentication
// ============================================================================

export function getCorsHeaders(req?: Request): Record<string, string> {
  const allowlist = getAllowedOrigins();
  const origin = req?.headers.get("origin");
  // If origin is allowlisted, echo it; otherwise use the configured default
  const finalOrigin = typeof origin === "string" && allowlist.includes(origin) ? origin : (allowlist[0] ?? "http://localhost:19428");
  return {
    "Access-Control-Allow-Origin": finalOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function authenticateRequest(req: Request): Response | null {
  const requiredKey = process.env["MEMENTOS_API_KEY"];
  if (!requiredKey) return null; // no key configured, allow all

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized. Provide a Bearer token in the Authorization header." }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...getCorsHeaders(req) },
    });
  }

  const provided = authHeader.slice("Bearer ".length);
  if (provided !== requiredKey) {
    return new Response(JSON.stringify({ error: "Forbidden. Invalid API key." }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...getCorsHeaders(req) },
    });
  }

  return null; // authenticated
}

export function getSearchParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  return params;
}
