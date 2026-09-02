import { createPgPool } from "../generated/storage-kit/pool";
import { createQueryClient } from "../generated/storage-kit/query";

/** Server-only PostgreSQL configuration; never used by a client. */
export function resolveServerDatabase(env: NodeJS.ProcessEnv): string {
  for (const name of ["HASNA_ATTACHMENTS_STORAGE_MODE", "ATTACHMENTS_STORAGE_MODE", "HASNA_ATTACHMENTS_MODE"]) {
    if (env[name] !== undefined) throw new Error(`${name} is retired; the service requires PostgreSQL.`);
  }
  const values = [env.HASNA_ATTACHMENTS_DATABASE_URL, env.ATTACHMENTS_DATABASE_URL].filter((v): v is string => v !== undefined);
  if (!values.length || values.some(v => !v.trim() || v !== v.trim()) || new Set(values).size !== 1) {
    throw new Error("Missing, blank, or conflicting server PostgreSQL configuration.");
  }
  let parsed: URL;
  try { parsed = new URL(values[0]!); } catch { throw new Error("Invalid server PostgreSQL configuration."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2 || parsed.hash) {
    throw new Error("The service requires a PostgreSQL URL with host and database.");
  }
  return values[0]!;
}

export function createServerPool(env: NodeJS.ProcessEnv = process.env) {
  const connectionString = resolveServerDatabase(env);
  return createQueryClient(createPgPool({ connectionString, env, applicationName: "attachments-serve" }));
}
