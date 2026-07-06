/**
 * Environment bridge between the hasna-app ECS container contract and the
 * @hasna/contracts storage kit + auth conventions.
 *
 * The hasna-app Terraform module injects a fixed set of container env/secrets:
 *   PORT, HASNA_APP_NAME, HASNA_APP_MODE, AWS_REGION            (env)
 *   DATABASE_URL, API_KEY_SIGNING_SECRET                        (secrets)
 *
 * The storage kit resolves DSN/mode from HASNA_SECRETS_DATABASE_URL /
 * HASNA_SECRETS_STORAGE_MODE, and the auth middleware wants the signing secret.
 * This module maps the injected names onto the canonical ones exactly once.
 */

export const APP_NAME = "secrets";
export const DEFAULT_PORT = 8080;

/** Normalize the ECS-injected env onto the canonical Hasna kit/auth env keys. */
export function bootstrapCloudEnv(env: NodeJS.ProcessEnv = process.env): void {
  // DSN: DATABASE_URL -> HASNA_SECRETS_DATABASE_URL
  if (!env.HASNA_SECRETS_DATABASE_URL && !env.SECRETS_DATABASE_URL && env.DATABASE_URL) {
    env.HASNA_SECRETS_DATABASE_URL = env.DATABASE_URL;
  }
  // The deployed serve is always cloud (PURE REMOTE, Amendment A1).
  if (!env.HASNA_SECRETS_STORAGE_MODE && !env.SECRETS_STORAGE_MODE) {
    env.HASNA_SECRETS_STORAGE_MODE = "cloud";
  }
  // Signing secret: API_KEY_SIGNING_SECRET -> HASNA_SECRETS_API_SIGNING_KEY
  if (!env.HASNA_SECRETS_API_SIGNING_KEY && env.API_KEY_SIGNING_SECRET) {
    env.HASNA_SECRETS_API_SIGNING_KEY = env.API_KEY_SIGNING_SECRET;
  }
}

export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PORT ?? env.HASNA_SECRETS_SERVE_PORT;
  const port = raw ? Number(raw) : DEFAULT_PORT;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}

/** Resolve the HMAC signing secret for API-key verification (fail-closed). */
export function resolveSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret =
    env.HASNA_SECRETS_API_SIGNING_KEY?.trim() ||
    env.API_KEY_SIGNING_SECRET?.trim() ||
    env.HASNA_API_SIGNING_KEY?.trim();
  if (!secret) {
    throw new Error(
      "secrets-serve requires an API-key signing secret. Set HASNA_SECRETS_API_SIGNING_KEY (or API_KEY_SIGNING_SECRET).",
    );
  }
  return secret;
}
