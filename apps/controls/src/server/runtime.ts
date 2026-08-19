import { serverBackend } from "../config.js";

export function getPort(): number {
  const raw = process.env["HASNA_CONTROLS_PORT"] || process.env["CONTROLS_PORT"];
  // Whole numbers only: a fractional or trailing-garbage value ("8080.5",
  // "8080abc") must fall back to the default, never silently truncate to a
  // different port than the operator intended.
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 3482;
}

export function getBindHost(): string {
  return process.env["HASNA_CONTROLS_BIND_HOST"] || process.env["CONTROLS_BIND_HOST"] || "127.0.0.1";
}

export function isLoopbackBind(host = getBindHost()): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function corsOrigins(): string[] {
  const raw = process.env["HASNA_CONTROLS_CORS_ORIGINS"] || process.env["CONTROLS_CORS_ORIGINS"] || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function rateLimitMax(): number {
  const raw = process.env["HASNA_CONTROLS_RATE_LIMIT"] || process.env["CONTROLS_RATE_LIMIT"];
  // Whole numbers only (see getPort): a fractional value falls back to the
  // default rather than silently truncating the configured limit.
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 120;
}

/**
 * Auth is decoupled from the storage backend. Unauthenticated /v1 is permitted
 * ONLY when bound strictly to loopback AND on the SQLite backend. Any
 * non-loopback bind or PostgreSQL backend requires auth (fail-closed).
 */
export function authRequired(): boolean {
  if (!isLoopbackBind()) return true;
  return serverBackend() === "postgresql";
}

/** Fail-closed startup guard: non-loopback / PostgreSQL with no credentials configured. */
export function assertServeSafe(authConfigured: boolean): void {
  if (authRequired() && !authConfigured) {
    throw new Error(
      "Refusing to start: serve is bound to a non-loopback interface or the PostgreSQL backend without API credentials. " +
        "Set HASNA_CONTROLS_API_CREDENTIALS (or HASNA_CONTROLS_API_KEY) before serving /v1.",
    );
  }
}
