/**
 * @hasna/secrets/sdk — typed client for the secrets serve API.
 *
 * The method surface mirrors the serve OpenAPI document (src/server/openapi.ts)
 * and routes through the one shared Hasna HTTP transport (no raw fetch). It speaks
 * the Hasna self_hosted convention: `SECRETS_API_URL` + `SECRETS_API_KEY` (the
 * client never sees a DSN).
 */

export * from "./sdk/client.js";
import { SecretsClient, type SecretsClientOptions } from "./sdk/client.js";

/**
 * Build a client from the environment. Requires `SECRETS_API_URL` and
 * `SECRETS_API_KEY` (self_hosted mode — a DSN is never used here).
 */
export function createSecretsClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<SecretsClientOptions> = {},
): SecretsClient {
  const baseUrl = overrides.baseUrl ?? env.SECRETS_API_URL ?? env.HASNA_SECRETS_API_URL;
  const apiKey = overrides.apiKey ?? env.SECRETS_API_KEY ?? env.HASNA_SECRETS_API_KEY;
  if (!baseUrl) {
    throw new Error("createSecretsClientFromEnv requires SECRETS_API_URL.");
  }
  return new SecretsClient({ baseUrl, ...(apiKey ? { apiKey } : {}), ...overrides });
}
