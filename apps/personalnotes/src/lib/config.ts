/**
 * Runtime configuration for the PersonalNotes multi-tenancy backend.
 *
 * Env prefix follows hasna-storage-standard: canonical `HASNA_PERSONALNOTES_`,
 * with the legacy `PERSONALNOTES_` alias accepted (the platform-personalnotes
 * control plane already reads the aliased form).
 */

export const ENV_PREFIX = "HASNA_PERSONALNOTES_";
export const ALIAS_ENV_PREFIX = "PERSONALNOTES_";

/** The single global super administrator. Ruled fixed default: andrei@hasna.com. */
export const DEFAULT_SUPER_ADMIN_EMAIL = "andrei@hasna.com";

export const DEPLOYMENT_MODES = ["local", "self_hosted", "cloud"] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

const env = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;

/** Read `HASNA_PERSONALNOTES_<suffix>`, falling back to the `PERSONALNOTES_<suffix>` alias. */
export function readEnv(suffix: string, fallback?: string): string | undefined {
  const primary = env[`${ENV_PREFIX}${suffix}`];
  if (primary !== undefined && primary !== "") return primary;
  const alias = env[`${ALIAS_ENV_PREFIX}${suffix}`];
  if (alias !== undefined && alias !== "") return alias;
  return fallback;
}

function homeDir(): string {
  return env.HOME || env.USERPROFILE || ".";
}

/** Default SQLite path per hasna-storage-standard: `~/.hasna/<name>/<name>.db`. */
export function defaultSqlitePath(): string {
  return `${homeDir()}/.hasna/personalnotes/personalnotes.db`;
}

export interface BackendConfig {
  mode: DeploymentMode;
  /** PostgreSQL DSN, server-side only. Present => postgres engine. */
  databaseUrl?: string;
  /** SQLite file path (local/self_hosted without a DSN). */
  sqlitePath: string;
  /** Signing/pepper secret for token hashing. Optional; tokens are random+hashed regardless. */
  sessionSecret?: string;
  /** Super-admin email; anyone registering/seeding with it becomes the global super admin. */
  superAdminEmail: string;
  /** Session lifetime in seconds (default 30 days). */
  sessionTtlSeconds: number;
}

function resolveMode(hasDatabaseUrl: boolean): DeploymentMode {
  const explicit = readEnv("STORAGE_MODE") || readEnv("DEPLOYMENT_MODE");
  if (explicit && (DEPLOYMENT_MODES as readonly string[]).includes(explicit)) {
    return explicit as DeploymentMode;
  }
  if (readEnv("API_URL")) return "self_hosted";
  if (hasDatabaseUrl) return "self_hosted";
  return "local";
}

/** Resolve backend config from the environment. Never throws; returns sane local defaults. */
export function resolveConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  const databaseUrl = overrides.databaseUrl ?? readEnv("DATABASE_URL");
  const mode = overrides.mode ?? resolveMode(Boolean(databaseUrl));
  const ttlRaw = readEnv("SESSION_TTL_SECONDS");
  const ttl = ttlRaw ? Number.parseInt(ttlRaw, 10) : NaN;
  return {
    mode,
    databaseUrl,
    sqlitePath: overrides.sqlitePath ?? readEnv("SQLITE_PATH") ?? defaultSqlitePath(),
    sessionSecret: overrides.sessionSecret ?? readEnv("SESSION_SECRET"),
    superAdminEmail: (overrides.superAdminEmail ?? readEnv("SUPER_ADMIN_EMAIL") ?? DEFAULT_SUPER_ADMIN_EMAIL)
      .trim()
      .toLowerCase(),
    sessionTtlSeconds: overrides.sessionTtlSeconds ?? (Number.isFinite(ttl) && ttl > 0 ? ttl : 60 * 60 * 24 * 30),
  };
}
