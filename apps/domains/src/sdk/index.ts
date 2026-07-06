/**
 * @hasna/domains SDK — typed HTTP client generated from the domains-serve
 * OpenAPI document (see `src/server/openapi.ts`, regenerate via the `sdk:gen`
 * script). Client self_hosted convention: `DOMAINS_API_URL` + `DOMAINS_API_KEY`
 * (a key, never a DSN).
 */

export * from "./client.js";
import { DomainsClient, type DomainsClientOptions } from "./client.js";

/**
 * Build a `DomainsClient` from the environment.
 * Reads `DOMAINS_API_URL` and `DOMAINS_API_KEY`.
 */
export function createDomainsClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<DomainsClientOptions> = {},
): DomainsClient {
  const baseUrl = overrides.baseUrl ?? env["DOMAINS_API_URL"];
  if (!baseUrl) {
    throw new Error("createDomainsClientFromEnv requires DOMAINS_API_URL (the domains-serve base URL).");
  }
  const apiKey = overrides.apiKey ?? env["DOMAINS_API_KEY"];
  return new DomainsClient({ baseUrl, ...(apiKey ? { apiKey } : {}), ...overrides });
}
