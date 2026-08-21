/**
 * @hasna/domains SDK — typed HTTP client generated from the domains-serve
 * OpenAPI document (see `src/server/openapi.ts`, regenerate via the `sdk:gen`
 * script). Client hosted convention: `DOMAINS_API_URL` + `DOMAINS_API_KEY`
 * (a key, never a DSN).
 */

export * from "./client.js";
import { resolveCredential } from "@hasna/contracts/client";
import { DomainsClient, type DomainsClientOptions } from "./client.js";

/**
 * Build a `DomainsClient` from the environment.
 * Resolves `DOMAINS_API_URL` (or `HASNA_DOMAINS_API_URL`) and the API key
 * through the @hasna/contracts client credential chain.
 */
export function createDomainsClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<DomainsClientOptions> = {},
): DomainsClient {
  const baseUrl = overrides.baseUrl ?? env["DOMAINS_API_URL"] ?? env["HASNA_DOMAINS_API_URL"];
  if (!baseUrl) {
    throw new Error("createDomainsClientFromEnv requires DOMAINS_API_URL (the domains-serve base URL).");
  }
  const resolved = resolveCredential("domains", env, { apiKey: overrides.apiKey });
  return new DomainsClient({ baseUrl, ...(resolved?.apiKey ? { apiKey: resolved.apiKey } : {}), ...overrides });
}
