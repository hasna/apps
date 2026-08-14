import { ENV_TOKEN } from "../config.js";
import { authenticateToken, type ApiPrincipal } from "../server/auth.js";
import { SYSTEM_PRINCIPAL } from "../services/execute.js";
import { UnauthorizedError } from "../types/index.js";

// Build the CLI run principal. Local single-user CLI defaults to SYSTEM; a token
// (HASNA_CONSOLIDATIONS_CLI_TOKEN / --token) opts into scoped credentials so the
// same authorization applies as MCP/HTTP.
export function buildCliPrincipal(token?: string): ApiPrincipal {
  const raw = token ?? process.env[`HASNA_${ENV_TOKEN}_CLI_TOKEN`] ?? process.env[`${ENV_TOKEN}_CLI_TOKEN`];
  if (!raw) return SYSTEM_PRINCIPAL;
  const principal = authenticateToken(raw.trim());
  if (!principal) throw new UnauthorizedError("Invalid --token / CLI token.");
  return principal;
}

/** camelCase (commander option attr) -> snake_case (op input key). */
export function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}
