/**
 * Bearer-token gate for the local `connectors-serve` API.
 *
 * WHY THIS EXISTS. `connectors-serve` is the on-box management plane for a
 * vendor-credential store: `GET /api/export` returns every configured
 * connector profile (API keys and all), `POST /api/import` writes them,
 * `/api/agents`, `/api/jobs`, `/api/workflows` and `/mcp` drive the runner.
 * Until this module the server bound every interface with no
 * authentication at all, so anyone who could reach the port could read the
 * station's vendor secrets (fleet alignment T1 §3.5, `serve.ts` `/api/export`).
 *
 * THE CONTRACT.
 *   - Every `/api/*` route and the `/mcp` mount require
 *     `Authorization: Bearer <token>` (or `X-Connectors-Token: <token>`).
 *   - `/health` is public (liveness probe, no data), and the two OAuth
 *     browser routes `/oauth/:name/start` and `/oauth/:name/callback` stay
 *     public because a vendor's browser redirect cannot carry our header —
 *     they return no credential; the callback only persists a token the
 *     vendor issued for this exact redirect.
 *   - `OPTIONS` preflights pass (a preflight carries no credentials by
 *     definition); the real request is gated.
 *
 * WHERE THE TOKEN LIVES. `HASNA_CONNECTORS_SERVE_TOKEN` in the environment
 * wins; otherwise `<connectors home>/serve-token` (mode 0600, owner-only),
 * generated on first start with 32 random bytes. The CLI, the MCP server and
 * the `./sdk` `LocalConnectorsClient` read the same two sources, so a
 * same-user process on the box authenticates without any configuration and a
 * remote or other-user process cannot. The token is never printed; startup
 * output names only its SOURCE.
 *
 * There is no `allowAnonymous` switch and no "trusted network" mode: an
 * unauthenticated server that serves vendor credentials is the defect, not a
 * deployment option.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomBytes, timingSafeEqual } from "crypto";
import { dirname, join } from "path";
import { connectorsHome } from "../lib/paths.js";

/** Environment variable that supplies the serve token (wins over the file). */
export const SERVE_TOKEN_ENV = "HASNA_CONNECTORS_SERVE_TOKEN";

/** File name of the generated token under the connectors home. */
export const SERVE_TOKEN_FILE = "serve-token";

/** Stable refusal code, first token of every 401 body. */
export const SERVE_UNAUTHORIZED_CODE = "CONNECTORS_SERVE_UNAUTHORIZED";

/** The address the server binds by default: loopback only. */
export const SERVE_DEFAULT_HOSTNAME = "127.0.0.1";

const PRIVATE_FILE_MODE = 0o600;

export type ServeTokenSource = "env" | "file" | "generated" | "explicit";

export interface ResolvedServeToken {
  token: string;
  source: ServeTokenSource;
  /** Absolute path of the token file when the file tier was used or written. */
  path: string | null;
}

/** Absolute path of the token file for the given (or effective) connectors home. */
export function serveTokenPath(home: string = connectorsHome()): string {
  return join(home, SERVE_TOKEN_FILE);
}

function readTokenFile(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const value = readFileSync(path, "utf-8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeTokenFile(path: string, token: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${token}\n`, { mode: PRIVATE_FILE_MODE });
  try {
    chmodSync(path, PRIVATE_FILE_MODE);
  } catch {
    // Non-POSIX filesystems: the mode passed to writeFileSync is best effort.
  }
}

/**
 * Read the token a CLIENT should present, without ever creating one:
 * the environment first, then the token file. `null` when neither exists.
 */
export function readServeToken(
  env: Record<string, string | undefined> = process.env,
  home?: string,
): ResolvedServeToken | null {
  const fromEnv = env[SERVE_TOKEN_ENV]?.trim();
  if (fromEnv) return { token: fromEnv, source: "env", path: null };
  const path = serveTokenPath(home);
  const fromFile = readTokenFile(path);
  if (fromFile) return { token: fromFile, source: "file", path };
  return null;
}

/**
 * Resolve the token the SERVER enforces. An explicit token wins, then the
 * environment, then the token file; when none exists a fresh 256-bit token
 * is generated and written owner-only so same-user clients can find it.
 */
export function resolveServeToken(
  options: { token?: string; env?: Record<string, string | undefined>; home?: string } = {},
): ResolvedServeToken {
  const explicit = options.token?.trim();
  if (explicit) return { token: explicit, source: "explicit", path: null };
  const existing = readServeToken(options.env ?? process.env, options.home);
  if (existing) return existing;
  const path = serveTokenPath(options.home);
  const token = randomBytes(32).toString("hex");
  writeTokenFile(path, token);
  return { token, source: "generated", path };
}

/** Extract the presented token from a request, or `null`. */
export function presentedToken(req: Request): string | null {
  const authorization = req.headers.get("authorization");
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match) return match[1]!.trim();
  }
  const header = req.headers.get("x-connectors-token");
  if (header && header.trim().length > 0) return header.trim();
  return null;
}

/** Constant-time comparison of a presented token with the enforced one. */
export function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Does this route require the bearer token?
 *
 * Public: `/health` (liveness), the OAuth browser routes (vendor redirects
 * cannot carry our header; they return no credential) and CORS preflights.
 * Everything else the server answers — every `/api/*` route and `/mcp` — is
 * gated.
 */
export function requiresServeAuth(pathname: string, method: string): boolean {
  if (method === "OPTIONS") return false;
  if (pathname === "/health") return false;
  if (/^\/oauth\/[^/]+\/(start|callback)$/.test(pathname)) return false;
  return true;
}

/** True when the request may proceed. */
export function isServeAuthorized(req: Request, token: string): boolean {
  const url = new URL(req.url);
  if (!requiresServeAuth(url.pathname, req.method)) return true;
  return tokenMatches(presentedToken(req), token);
}

/** The 401 body every gated route returns. Names the sources, never a value. */
export function unauthorizedPayload(): { error: string; hint: string } {
  return {
    error:
      `${SERVE_UNAUTHORIZED_CODE}: this connectors-serve route requires ` +
      "`Authorization: Bearer <token>` (or `X-Connectors-Token`).",
    hint:
      `The token is ${SERVE_TOKEN_ENV} when set, otherwise the owner-only file ` +
      `<connectors home>/${SERVE_TOKEN_FILE} (default ~/.hasna/connectors/${SERVE_TOKEN_FILE}) ` +
      "the server generates on first start. Same-user CLI, MCP and `@hasna/connectors/sdk` clients read it automatically.",
  };
}

/** Human line for startup output. Never includes the token. */
export function describeServeTokenSource(resolved: ResolvedServeToken): string {
  switch (resolved.source) {
    case "env":
      return `bearer token from ${SERVE_TOKEN_ENV}`;
    case "explicit":
      return "bearer token supplied by the caller";
    case "file":
      return `bearer token from ${resolved.path}`;
    case "generated":
      return `bearer token generated and written owner-only to ${resolved.path}`;
  }
}
