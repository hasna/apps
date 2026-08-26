import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { resolve, sep } from "path";

/**
 * Server security posture for shield-serve.
 *
 * The dashboard API is a command surface (it triggers scans, LLM fixes and
 * policy changes), so it is NOT defensible with CORS alone — every `/api`
 * route is behind a bearer/`x-api-key` gate whenever a key is configured.
 *
 * Posture, resolved once at startup:
 *  - `SECURITY_API_KEY` set   -> EVERY `/api` request must present the key
 *    (`Authorization: Bearer <key>` or `x-api-key: <key>`), timing-safe.
 *  - `SECURITY_API_KEY` unset -> the API is served WITHOUT a key, but only on
 *    loopback: a non-loopback bind (`--host`) without a key is a startup
 *    REFUSAL (`assertBindPosture`), never a wide-open server.
 *    This matches the contract manifest (`authMode: "local-only"`): an
 *    anonymous loopback caller already sits at the same trust level as the
 *    local CLI.
 *
 * The scan-source boundary is separate from auth: `POST /api/scans` accepts
 * an arbitrary filesystem path from the network, so it additionally enforces
 * `SECURITY_SCAN_ROOTS` (comma-separated absolute roots, default `$HOME`).
 * Host-wide IOC checks (`include_system`) cross the requested tree boundary
 * and require the explicit server-side gate `SECURITY_ALLOW_SYSTEM_SCANS=1`.
 */

export function resolveApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = env.SECURITY_API_KEY?.trim();
  return key || undefined;
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * Fail closed at startup: a bind beyond loopback without a configured key is
 * a misconfiguration, not a judgment call. Throws; the callers (bin entry and
 * `shield serve`) convert that into a non-zero exit.
 */
export function assertBindPosture(host: string, apiKey: string | undefined): void {
  if (!isLoopbackHost(host) && !apiKey) {
    throw new Error(
      "Refusing to bind beyond loopback without a key: set SECURITY_API_KEY before running shield serve --host <host>",
    );
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function extractApiKey(req: Request): string | null {
  const headerKey = req.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey.trim().length > 0) return headerKey;
  const authorization = req.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }
  return null;
}

/** Express middleware: denies every `/api` request unless the key matches. */
export function apiKeyMiddleware(apiKey: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!apiKey) {
      // Only reachable when `assertBindPosture` accepted a loopback bind.
      next();
      return;
    }
    const token = extractApiKey(req);
    if (!token || !timingSafeEqualStr(token, apiKey)) {
      res.status(401).json({ error: "Unauthorized: present the SECURITY_API_KEY via x-api-key or Authorization: Bearer" });
      return;
    }
    next();
  };
}

export function resolveScanRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.SECURITY_SCAN_ROOTS;
  if (raw && raw.trim().length > 0) {
    return raw
      .split(",")
      .map((part) => resolve(part.trim()))
      .filter((part) => part.length > 1);
  }
  return [resolve(env.HOME || env.USERPROFILE || process.cwd())];
}

export function isPathAllowed(resolvedPath: string, roots: string[]): boolean {
  return roots.some((root) => resolvedPath === root || resolvedPath.startsWith(root + sep));
}

export function isSystemScansEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SECURITY_ALLOW_SYSTEM_SCANS === "1";
}
