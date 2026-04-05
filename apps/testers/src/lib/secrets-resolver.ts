/**
 * Lightweight credential resolver for open-testers.
 *
 * Supports three value formats in persona/auth-preset credential fields:
 *   @secrets:<key>   — look up from the @hasna/secrets vault (~/.hasna/secrets/vault.db)
 *   $ENV_VAR_NAME    — resolve from the current process environment
 *   <plain text>     — used as-is
 *
 * No dependency on @hasna/secrets package — reads the vault SQLite directly,
 * matching the same pattern used by todos-connector.ts for the todos DB.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function getVaultPath(): string {
  const envPath = process.env["HASNA_SECRETS_DB_PATH"] ?? process.env["OPEN_SECRETS_DB"];
  if (envPath) return envPath;
  return join(homedir(), ".hasna", "secrets", "vault.db");
}

/**
 * Look up a key in the hasna secrets vault.
 * Returns the value or null if the vault doesn't exist or the key is not found.
 */
function lookupFromVault(key: string): string | null {
  const vaultPath = getVaultPath();
  if (!existsSync(vaultPath)) return null;

  try {
    const db = new Database(vaultPath, { readonly: true });
    const row = db.query("SELECT value FROM secrets WHERE key = ?").get(key) as
      | { value: string }
      | null;
    db.close();
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve a credential value, supporting these patterns:
 *
 * - `@secrets:hasnastudio/alumia/platform/test/member/password`
 *   → looks up the key in the hasna secrets vault
 *
 * - `$ANTHROPIC_API_KEY`
 *   → resolves from process.env
 *
 * - `myplaintextpassword`
 *   → returned unchanged
 *
 * Returns `null` if a reference is declared but can't be resolved
 * (vault missing, key not found, or env var not set).
 */
export function resolveCredential(value: string | null | undefined): string | null {
  if (!value) return null;

  // @secrets: reference
  if (value.startsWith("@secrets:")) {
    const key = value.slice("@secrets:".length).trim();
    if (!key) return null;
    return lookupFromVault(key);
  }

  // $ENV_VAR reference
  if (value.startsWith("$")) {
    const varName = value.slice(1).trim();
    if (!varName) return null;
    return process.env[varName] ?? null;
  }

  // Plain text
  return value;
}

/**
 * Whether a credential value is a secrets reference (vault or env).
 * Useful for display purposes (avoid logging the value if it's a reference).
 */
export function isCredentialReference(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith("@secrets:") || value.startsWith("$");
}
