/**
 * Server-only PostgreSQL configuration; the service ignores client-side
 * `*_MODE` / `*_STORAGE_MODE` variables (they are inert since the adoption
 * stripped the ratchet that used to turn them into errors).
 */
export function resolveServerDatabase(env: NodeJS.ProcessEnv): string {
  const values = [env.HASNA_ATTACHMENTS_DATABASE_URL, env.ATTACHMENTS_DATABASE_URL].filter((v): v is string => v !== undefined);
  if (!values.length || values.some(v => !v.trim() || v !== v.trim() || /[\x00-\x1f\x7f]/.test(v)) || new Set(values).size !== 1) {
    throw new Error("Missing, blank, or conflicting server PostgreSQL configuration.");
  }
  let parsed: URL;
  try { parsed = new URL(values[0]!); } catch { throw new Error("Invalid server PostgreSQL configuration."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2 || parsed.hash) {
    throw new Error("The service requires a PostgreSQL URL with host and database.");
  }
  return values[0]!;
}
