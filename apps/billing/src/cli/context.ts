import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { makeContext, type ServiceContext } from "../services/context.js";
import { SYSTEM_AUTHORIZATION_CONTEXT, type AuthorizationContext } from "../services/authorization.js";

/**
 * Build the CLI run context. The CLI is a local operator tool running as the
 * machine user; in local mode it uses the SYSTEM (bypass) context. A caller may
 * override the principal (used by the interface-parity harness to drive the CLI
 * surface with scoped credentials).
 */
export function buildRunContext(opts: { db?: Database; principal?: AuthorizationContext } = {}): ServiceContext {
  const db = opts.db ?? getDatabase();
  const principal = opts.principal ?? SYSTEM_AUTHORIZATION_CONTEXT;
  return makeContext(db, principal);
}
