export interface BrowserServerSecurityConfig {
  apiKey?: string | null;
  allowUnauthenticated: boolean;
  allowedOrigin?: string | null;
}

export const BROWSER_ALLOW_UNAUTHENTICATED_ENV = "BROWSER_ALLOW_UNAUTHENTICATED";

export function resolveSecurityConfig(env: Record<string, string | undefined> = process.env): BrowserServerSecurityConfig {
  return {
    apiKey: env["BROWSER_API_KEY"] ?? null,
    allowUnauthenticated: env[BROWSER_ALLOW_UNAUTHENTICATED_ENV] === "1" || env["BROWSER_AUTH"] === "0",
    allowedOrigin: env["BROWSER_ALLOWED_ORIGIN"] ?? null,
  };
}

export function corsHeaders(
  origin: string | null,
  config: BrowserServerSecurityConfig
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
  if (!origin) return headers;

  if (isAllowedOrigin(origin, config)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function isAllowedOrigin(origin: string, config: BrowserServerSecurityConfig): boolean {
  if (config.allowedOrigin) return origin === config.allowedOrigin;
  return origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1");
}

export function authenticate(req: Request, config: BrowserServerSecurityConfig): Response | null {
  if (config.allowUnauthenticated) return null;

  if (!config.apiKey) {
    return new Response(JSON.stringify({
      error: `Unauthorized. Set BROWSER_API_KEY or explicitly set ${BROWSER_ALLOW_UNAUTHENTICATED_ENV}=1 for local development.`,
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== config.apiKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
