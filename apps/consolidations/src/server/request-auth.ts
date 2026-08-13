import { ENV_TOKEN, resolveStorageMode } from "../config.js";
import { SYSTEM_PRINCIPAL } from "../services/execute.js";
import { UnauthorizedError } from "../types/index.js";
import { authenticateRequest, isApiAuthConfigured, type ApiPrincipal } from "./auth.js";

// Serve-tier request context: bind config, deny-by-default CORS, rate limiting,
// and principal resolution. Auth is decoupled from storage mode — required
// whenever the server binds a non-loopback interface OR credentials are
// configured; unauthenticated /v1 is permitted only on loopback + local.

function firstEnv(keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return fallback;
}

export function getPort(): number {
  return Number.parseInt(firstEnv([`HASNA_${ENV_TOKEN}_PORT`, `${ENV_TOKEN}_PORT`], "3488"), 10);
}

export function getBindHost(): string {
  return firstEnv([`HASNA_${ENV_TOKEN}_BIND_HOST`, `${ENV_TOKEN}_BIND_HOST`], "127.0.0.1");
}

export function isLoopbackBind(): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(getBindHost());
}

export function corsOrigins(): string[] {
  const raw = firstEnv([`HASNA_${ENV_TOKEN}_CORS_ORIGINS`, `${ENV_TOKEN}_CORS_ORIGINS`], "");
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Whether /v1 requires authentication for this bind + mode. */
export function authApplies(): boolean {
  const loopbackLocal = isLoopbackBind() && resolveStorageMode() === "local";
  return !loopbackLocal || isApiAuthConfigured();
}

/** Resolve the request principal, or throw UnauthorizedError. */
export function resolvePrincipal(req: Request): ApiPrincipal {
  if (!authApplies()) return SYSTEM_PRINCIPAL;
  const principal = authenticateRequest(req);
  if (!principal) throw new UnauthorizedError("Invalid or missing bearer token.");
  return principal;
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000;

function rateLimitMax(): number {
  return Number.parseInt(firstEnv([`HASNA_${ENV_TOKEN}_RATE_LIMIT`, `${ENV_TOKEN}_RATE_LIMIT`], "240"), 10);
}

export function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const max = rateLimitMax();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: max - 1 };
  }
  entry.count += 1;
  const remaining = max - entry.count;
  return remaining < 0 ? { allowed: false, remaining: 0 } : { allowed: true, remaining };
}
