import { openDatabase } from "../db/database.js";
import { contextFromPrincipal, localOwnerContext, type RunContext } from "../services/context.js";
import { authenticateToken } from "../server/auth.js";

/**
 * Build a CLI run context. When TREASURY_API_TOKEN (or a --token) is supplied,
 * the CLI acts as that SCOPED principal so interface-parity/authz can be tested
 * with real credentials — not just a SYSTEM bypass. Otherwise (local dev) it is
 * a full-scope local owner.
 */
export async function buildCliContext(token?: string): Promise<RunContext> {
  const db = await openDatabase();
  const bearer = token || process.env["TREASURY_API_TOKEN"];
  if (bearer) {
    const principal = authenticateToken(bearer);
    if (!principal) throw new Error("Invalid TREASURY_API_TOKEN.");
    return contextFromPrincipal(db, principal);
  }
  return localOwnerContext(db);
}
