import type { Database } from "bun:sqlite";
import { openDatabase } from "../db/database.js";
import { systemContext, type ServiceContext } from "../services/runtime.js";
import { authenticateBearer } from "../server/auth.js";
import { principalToAuthContext } from "../server/principal.js";

// The CLI is a local operator tool: with NO token it runs a system (bypass)
// context so a human operator on the box can manage the full local portfolio.
// When a scoped credential IS threaded in (HASNA_HOLDINGS_API_TOKEN / HOLDINGS_API_TOKEN),
// the CLI adopts that caller principal — the SAME scoped, non-bypass credential
// model as the serve + MCP surfaces — so a deny-by-default regression surfaces
// identically on all three surfaces (interface-parity, §7). An invalid token
// resolves to an unscoped, role-less context (deny-by-default), never bypass.

export interface CliContext {
  db: Database;
  service: ServiceContext;
  json: boolean;
}

function cliApiToken(): string | undefined {
  return process.env["HASNA_HOLDINGS_API_TOKEN"]?.trim() || process.env["HOLDINGS_API_TOKEN"]?.trim() || undefined;
}

function resolveCliService(db: Database): ServiceContext {
  const token = cliApiToken();
  if (!token) return systemContext(db);
  const principal = authenticateBearer(token);
  if (!principal) {
    // Token supplied but invalid: refuse to silently fall back to bypass.
    return { db, auth: { actor_id: "cli-token", roles: [] } };
  }
  return { db, auth: principalToAuthContext(principal) };
}

export function buildCliContext(json: boolean): CliContext {
  const db = openDatabase();
  return { db, service: resolveCliService(db), json };
}
