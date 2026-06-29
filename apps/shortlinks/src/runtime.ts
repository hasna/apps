export type ShortlinksStoreMode = "local" | "postgres";

export type ShortlinksRuntimeEnv = Record<string, string | undefined>;

export interface ShortlinksPostgresConfig {
  provider: "postgres";
  url: string;
  ssl: boolean;
}

export interface ShortlinksRuntimeConfig {
  service: "shortlinks";
  mode: ShortlinksStoreMode;
  database?: ShortlinksPostgresConfig;
}

export const SHORTLINKS_RUNTIME_ENV = {
  store: "HASNA_SHORTLINKS_STORE",
  databaseUrl: "HASNA_SHORTLINKS_DATABASE_URL",
  databaseSsl: "HASNA_SHORTLINKS_DATABASE_SSL",
} as const;

export const SHORTLINKS_RUNTIME_FALLBACK_ENV = {
  store: "SHORTLINKS_STORE",
  databaseUrl: "SHORTLINKS_DATABASE_URL",
  databaseSsl: "SHORTLINKS_DATABASE_SSL",
} as const;

export const CANONICAL_SHORTLINKS_POSTGRES_CLUSTER = "hasna-xyz-infra-apps-prod-postgres";
export const CANONICAL_SHORTLINKS_POSTGRES_DATABASE = "shortlinks";
export const CANONICAL_SHORTLINKS_RUNTIME_SECRET_PATH = "hasna/xyz/opensource/shortlinks/prod/postgres";

export interface CanonicalShortlinksPostgresConfig {
  cluster: typeof CANONICAL_SHORTLINKS_POSTGRES_CLUSTER;
  database: typeof CANONICAL_SHORTLINKS_POSTGRES_DATABASE;
  runtimeSecretPath: typeof CANONICAL_SHORTLINKS_RUNTIME_SECRET_PATH;
  primaryEnv: typeof SHORTLINKS_RUNTIME_ENV.databaseUrl;
  fallbackEnv: typeof SHORTLINKS_RUNTIME_FALLBACK_ENV.databaseUrl;
}

export interface RuntimeEnvStatus {
  name: string;
  active_name: string;
  configured: boolean;
}

export interface ShortlinksRuntimeStatus {
  ok: boolean;
  service: "shortlinks";
  mode: ShortlinksStoreMode;
  local_default: boolean;
  postgres_enabled: boolean;
  database: {
    configured: boolean;
    provider: "postgres" | null;
    redacted_url: string | null;
    ssl: boolean | null;
  };
  env: Record<keyof typeof SHORTLINKS_RUNTIME_ENV, RuntimeEnvStatus>;
  canonical: CanonicalShortlinksPostgresConfig;
  issues: string[];
  warnings: string[];
  no_network: true;
}

export function getCanonicalShortlinksPostgresConfig(): CanonicalShortlinksPostgresConfig {
  return {
    cluster: CANONICAL_SHORTLINKS_POSTGRES_CLUSTER,
    database: CANONICAL_SHORTLINKS_POSTGRES_DATABASE,
    runtimeSecretPath: CANONICAL_SHORTLINKS_RUNTIME_SECRET_PATH,
    primaryEnv: SHORTLINKS_RUNTIME_ENV.databaseUrl,
    fallbackEnv: SHORTLINKS_RUNTIME_FALLBACK_ENV.databaseUrl,
  };
}

export function parseShortlinksStoreMode(value: string | undefined): ShortlinksStoreMode {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return "local";
  if (normalized === "local" || normalized === "postgres") return normalized;
  if (normalized === "pg") return "postgres";
  throw new Error(`${SHORTLINKS_RUNTIME_ENV.store} must be local or postgres`);
}

export function getShortlinksStoreMode(env: ShortlinksRuntimeEnv = process.env): ShortlinksStoreMode {
  return parseShortlinksStoreMode(readRuntimeEnv(env, "store").value);
}

export function getShortlinksDatabaseUrl(env: ShortlinksRuntimeEnv = process.env): string | undefined {
  return readRuntimeEnv(env, "databaseUrl").value;
}

export function getShortlinksDatabaseSsl(env: ShortlinksRuntimeEnv = process.env): boolean {
  return parseBoolean(readRuntimeEnv(env, "databaseSsl").value, true);
}

export function getShortlinksRuntimeEnvName(
  env: ShortlinksRuntimeEnv,
  key: keyof typeof SHORTLINKS_RUNTIME_ENV,
): string {
  const primary = SHORTLINKS_RUNTIME_ENV[key];
  if (clean(env[primary])) return primary;
  return SHORTLINKS_RUNTIME_FALLBACK_ENV[key];
}

export function loadShortlinksRuntimeConfig(env: ShortlinksRuntimeEnv = process.env): ShortlinksRuntimeConfig {
  const mode = getShortlinksStoreMode(env);
  const databaseUrl = getShortlinksDatabaseUrl(env);
  return {
    service: "shortlinks",
    mode,
    ...(databaseUrl
      ? {
          database: {
            provider: "postgres" as const,
            url: databaseUrl,
            ssl: getShortlinksDatabaseSsl(env),
          },
        }
      : {}),
  };
}

export function assertShortlinksPostgresConfig(config: ShortlinksRuntimeConfig): void {
  if (config.mode !== "postgres") return;
  if (!config.database?.url) {
    throw new Error(`${SHORTLINKS_RUNTIME_ENV.databaseUrl} is required when ${SHORTLINKS_RUNTIME_ENV.store}=postgres`);
  }
}

export function getShortlinksRuntimeStatus(env: ShortlinksRuntimeEnv = process.env): ShortlinksRuntimeStatus {
  const issues: string[] = [];
  const warnings: string[] = [];
  let config: ShortlinksRuntimeConfig;

  try {
    config = loadShortlinksRuntimeConfig(env);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
    config = { service: "shortlinks", mode: "local" };
  }

  try {
    assertShortlinksPostgresConfig(config);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  if (config.mode === "local" && config.database?.url) {
    warnings.push(`${SHORTLINKS_RUNTIME_ENV.store}=local ignores configured Postgres database settings`);
  }

  return {
    ok: issues.length === 0,
    service: "shortlinks",
    mode: config.mode,
    local_default: config.mode === "local",
    postgres_enabled: config.mode === "postgres",
    database: {
      configured: Boolean(config.database?.url),
      provider: config.database?.provider ?? null,
      redacted_url: redactDatabaseUrl(config.database?.url),
      ssl: config.database?.ssl ?? null,
    },
    env: runtimeEnvStatus(env),
    canonical: getCanonicalShortlinksPostgresConfig(),
    issues,
    warnings,
    no_network: true,
  };
}

export function redactDatabaseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveQueryKey(key)) url.searchParams.set(key, "***");
    }
    return url.toString();
  } catch {
    return "(redacted)";
  }
}

function runtimeEnvStatus(env: ShortlinksRuntimeEnv): Record<keyof typeof SHORTLINKS_RUNTIME_ENV, RuntimeEnvStatus> {
  return Object.fromEntries(
    Object.entries(SHORTLINKS_RUNTIME_ENV).map(([key, name]) => {
      const activeName = getShortlinksRuntimeEnvName(env, key as keyof typeof SHORTLINKS_RUNTIME_ENV);
      return [
        key,
        {
          name,
          active_name: activeName,
          configured: Boolean(clean(env[activeName])),
        },
      ];
    }),
  ) as Record<keyof typeof SHORTLINKS_RUNTIME_ENV, RuntimeEnvStatus>;
}

function readRuntimeEnv(env: ShortlinksRuntimeEnv, key: keyof typeof SHORTLINKS_RUNTIME_ENV): { name: string; value?: string } {
  const primary = SHORTLINKS_RUNTIME_ENV[key];
  const primaryValue = clean(env[primary]);
  if (primaryValue) return { name: primary, value: primaryValue };

  const fallback = SHORTLINKS_RUNTIME_FALLBACK_ENV[key];
  return { name: fallback, value: clean(env[fallback]) };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${SHORTLINKS_RUNTIME_ENV.databaseSsl} must be true or false`);
}

function isSensitiveQueryKey(key: string): boolean {
  return /(?:^|[_-])(pass(?:word)?|pwd|secret|token|credential|auth|api[_-]?key|access[_-]?key)(?:$|[_-])/i.test(key);
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
