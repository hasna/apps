export interface ServerSecurityConfig {
  apiKey?: string;
  allowUnauthenticated: boolean;
  allowedCorsOrigins: string[];
}

export interface AuthDecision {
  ok: boolean;
  status: number;
  reason?: string;
}

type Env = Record<string, string | undefined>;

export function resolveServeHost(env: Env = process.env): string {
  return env.COMPUTER_HOST || "127.0.0.1";
}

export function resolveServePort(env: Env = process.env): number {
  const parsed = Number.parseInt(env.COMPUTER_PORT ?? "19450", 10);
  return Number.isNaN(parsed) ? 19450 : parsed;
}

export function resolveSecurityConfig(
  env: Env = process.env,
  port = resolveServePort(env),
  host = resolveServeHost(env)
): ServerSecurityConfig {
  const requestedUnauthenticated =
    env.COMPUTER_ALLOW_UNAUTHENTICATED === "1" || env.COMPUTER_AUTH === "0";
  return {
    apiKey: env.COMPUTER_API_KEY,
    allowUnauthenticated: requestedUnauthenticated && isLoopbackHost(host),
    allowedCorsOrigins: parseCorsOrigins(env.COMPUTER_CORS_ORIGINS, port),
  };
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}

export function isSensitiveRequest(method: string, pathname: string): boolean {
  if (pathname === "/health") return false;
  if (method === "OPTIONS") return false;
  if (method !== "GET" && method !== "HEAD") return true;
  if (pathname === "/mcp") return true;
  if (pathname === "/run") return true;
  if (pathname === "/emergency-stop") return true;
  if (pathname === "/screenshot") return true;
  if (pathname === "/action") return true;
  if (pathname === "/stats") return true;
  if (pathname === "/sessions" || pathname.startsWith("/sessions/")) return true;
  return false;
}

export function authorizeRequest(
  req: Request,
  config: ServerSecurityConfig,
  sensitive = isSensitiveRequest(req.method, new URL(req.url).pathname)
): AuthDecision {
  if (!sensitive || config.allowUnauthenticated) return { ok: true, status: 200 };

  if (!config.apiKey) {
    return {
      ok: false,
      status: 401,
      reason: "Authentication required. Set COMPUTER_API_KEY or explicitly opt into COMPUTER_ALLOW_UNAUTHENTICATED=1 for local development.",
    };
  }

  const bearer = req.headers.get("authorization")?.trim();
  if (bearer === `Bearer ${config.apiKey}`) return { ok: true, status: 200 };

  const headerKey = req.headers.get("x-computer-api-key")?.trim();
  if (headerKey === config.apiKey) return { ok: true, status: 200 };

  return { ok: false, status: 401, reason: "Invalid or missing computer API key" };
}

export function corsHeadersForRequest(
  req: Request,
  config: ServerSecurityConfig
): Record<string, string> {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = { Vary: "Origin" };

  if (origin && isAllowedCorsOrigin(origin, config)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

export function isAllowedCorsOrigin(
  origin: string | null,
  config: ServerSecurityConfig
): boolean {
  if (!origin) return true;
  return config.allowedCorsOrigins.includes(origin);
}

export function hasDisallowedCorsOrigin(
  req: Request,
  config: ServerSecurityConfig
): boolean {
  const origin = req.headers.get("origin");
  return Boolean(origin && !isAllowedCorsOrigin(origin, config));
}

export function corsPreflightHeaders(
  req: Request,
  config: ServerSecurityConfig
): Record<string, string> {
  return {
    ...corsHeadersForRequest(req, config),
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Computer-API-Key",
  };
}

export function withCorsHeaders(
  response: Response,
  req: Request,
  config: ServerSecurityConfig
): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeadersForRequest(req, config))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function parseCorsOrigins(value: string | undefined, port: number): string[] {
  if (!value) {
    return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  }
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin && origin !== "*");
}
