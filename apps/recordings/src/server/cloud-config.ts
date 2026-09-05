// Server-side data-backend configuration for `recordings-serve`.
//
// The server has exactly TWO internal storage backends: `sqlite` (an on-box
// file) and `postgresql` (the shared dataset). Which one is used is decided
// by the environment alone: the presence of a PostgreSQL DSN
// (`HASNA_RECORDINGS_DATABASE_URL`) selects `postgresql`; any other
// environment serves from SQLite. Where the server runs and who operates it
// never select a backend.

/** The server's internal storage engine. Two arms, no third. */
export type DataBackend = "sqlite" | "postgresql";

/** Resolve the PostgreSQL DSN from the supported env vars (priority order). */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    env.HASNA_RECORDINGS_DATABASE_URL ||
    env.RECORDINGS_DATABASE_URL ||
    env.DATABASE_URL ||
    undefined
  );
}

/**
 * Resolve the PostgreSQL DSN used by the one-shot `migrate` operator verb.
 *
 * In the two-role deploy model the MIGRATION role owns the schema (it runs
 * DDL) while the RUNTIME role (`resolveDatabaseUrl`, used by `/v1` and
 * `/ready`) is DML-only, so the strict `assertCloudSchemaReady` posture
 * contract can pass. A dedicated migration DSN is configured via
 * `HASNA_RECORDINGS_MIGRATE_DATABASE_URL` (or `RECORDINGS_MIGRATE_DATABASE_URL`);
 * when none is set the migrate falls back to the runtime DSN for
 * single-role setups.
 */
export function resolveMigrationDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    env.HASNA_RECORDINGS_MIGRATE_DATABASE_URL ||
    env.RECORDINGS_MIGRATE_DATABASE_URL ||
    resolveDatabaseUrl(env)
  );
}

/**
 * The backend this process will use: `postgresql` when a DSN is present,
 * `sqlite` otherwise.
 */
export function resolveDataBackend(env: NodeJS.ProcessEnv = process.env): DataBackend {
  return resolveDatabaseUrl(env) ? "postgresql" : "sqlite";
}

/** True when this process serves `/v1` out of PostgreSQL. */
export function isPostgresBackendEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveDataBackend(env) === "postgresql";
}

/** Resolve the HMAC signing secret used to verify API keys. */
export function resolveSigningSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    env.HASNA_RECORDINGS_API_SIGNING_KEY?.trim() ||
    env.HASNA_API_SIGNING_KEY?.trim() ||
    env.API_KEY_SIGNING_SECRET?.trim() ||
    undefined
  );
}

/** Validate auth configuration without opening a database connection or exposing the secret. */
export function requireSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const signingSecret = resolveSigningSecret(env);
  if (!signingSecret) {
    throw new Error(
      "The /v1 API requires a signing secret (HASNA_RECORDINGS_API_SIGNING_KEY / HASNA_API_SIGNING_KEY / API_KEY_SIGNING_SECRET).",
    );
  }
  if (Buffer.byteLength(signingSecret, "utf8") < 16) {
    throw new Error("The /v1 API signing secret must be at least 16 bytes.");
  }
  return signingSecret;
}
