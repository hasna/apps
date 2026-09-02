import { readFileSync } from "node:fs";
/** Server-only PostgreSQL validation. Never prints the supplied DSN. */
export function validateDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) || /\s/.test(value) || url.hash) throw 0;
    // Never let Bun/libpq aliases, duplicate query keys or ambient defaults
    // weaken encryption or hostname verification. No production exceptions.
    const tlsKeys = [...url.searchParams.keys()].filter(k => /^(ssl|tls)/i.test(k));
    if (tlsKeys.length !== 1 || tlsKeys[0] !== "sslmode" || url.searchParams.get("sslmode") !== "verify-full") throw 0;
    return value;
  } catch { throw new Error("Calendar requires a valid PostgreSQL URL with exactly one sslmode=verify-full and no other SSL/TLS query overrides."); }
}

/** Honor the existing Docker PGSSLROOTCERT contract, with an app-scoped alias. */
export function readPostgresCa(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const keys = ["HASNA_CALENDAR_PG_CA_FILE", "PGSSLROOTCERT"].filter(k => env[k] !== undefined);
  if (!keys.length) return undefined;
  const file = env[keys[0]!]!;
  if (!file || file !== file.trim() || keys.some(k => env[k] !== file)) throw new Error("Calendar PostgreSQL CA configuration is blank or conflicting.");
  try {
    const pem = readFileSync(file, "utf8");
    if (!pem.includes("-----BEGIN CERTIFICATE-----")) throw 0;
    return pem;
  } catch { throw new Error("Calendar PostgreSQL CA file must be a readable PEM certificate bundle."); }
}
