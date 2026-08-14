import { resolveStorageMode } from "../config.js";
import { getDatabase } from "../db/database.js";
import { SYSTEM_AUTHORIZATION_CONTEXT, type AuthorizationContext } from "../services/authorization.js";
import { authenticateApiRequest, toAuthorizationContext } from "../server/auth.js";
import { UnauthorizedError } from "../types/index.js";

// Run context for the CLI. By default the local operator runs with a system
// context (bypass) against the authoritative local SQLite store. When an API
// token is supplied (HASNA_WORKFORCE_API_TOKEN / WORKFORCE_API_TOKEN) the CLI
// resolves it against the SAME configured credential model as the serve/MCP
// tiers and runs under that scoped, NON-bypass principal — so scope enforcement
// is identical across all three surfaces (BUILD-SPEC §7 parity harness).

export interface CliContext {
  json: boolean;
  mode: string;
  authCtx: AuthorizationContext;
}

/**
 * Resolve the CLI's authorization context. No token → SYSTEM bypass (trusted local
 * operator). A token → the scoped principal that token maps to; an unknown token is
 * rejected rather than silently downgraded to bypass.
 */
export function resolveCliAuthContext(): AuthorizationContext {
  const token = process.env["HASNA_WORKFORCE_API_TOKEN"] || process.env["WORKFORCE_API_TOKEN"];
  if (!token) return SYSTEM_AUTHORIZATION_CONTEXT;
  const principal = authenticateApiRequest(
    new Request("http://cli.local/", { headers: { Authorization: `Bearer ${token}` } }),
  );
  if (!principal) throw new UnauthorizedError("Invalid API token.");
  return toAuthorizationContext(principal);
}

export function buildCliContext(json: boolean): CliContext {
  // Touch the DB so schema/migrations are applied before the first command.
  getDatabase();
  let mode = "local";
  try {
    mode = resolveStorageMode();
  } catch {
    mode = "local";
  }
  return { json, mode, authCtx: resolveCliAuthContext() };
}

/** Print a result as canonical JSON (parity mode) or a compact human summary. */
export function emit(result: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  if (Array.isArray(result)) {
    if (result.length === 0) {
      console.log("(none)");
      return;
    }
    for (const row of result) console.log(summarize(row));
    return;
  }
  console.log(summarize(result));
}

function summarize(row: unknown): string {
  if (row && typeof row === "object") {
    const r = row as Record<string, unknown>;
    if (r["id"] && r["name"]) return `${String(r["id"]).slice(0, 8)}  ${r["kind"] ?? ""}  ${r["name"]}  ${r["status"] ?? ""}`.trim();
    return JSON.stringify(row);
  }
  return String(row);
}
