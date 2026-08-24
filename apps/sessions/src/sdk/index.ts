// Typed SDK for @hasna/sessions, generated from the sessions-serve OpenAPI
// document by @hasna/contracts. Self_hosted clients need only SESSIONS_API_URL
// + SESSIONS_API_KEY. Regenerate with `bun run sdk:generate`.

export * from "./client.js";
export { SessionsApi as SessionsClient } from "./client.js";

import { resolveClientTransport, resolveCredential } from "@hasna/contracts/client";
import { SessionsApi, type SessionsApiOptions } from "./client.js";

/**
 * Build a SessionsApi client from the environment (SESSIONS_API_URL +
 * SESSIONS_API_KEY), the Hasna self_hosted client convention. Overrides win.
 *
 * The API URL and key resolve through @hasna/contracts/client at call time —
 * argument, deliberate override/profile, disk, then the deprecated legacy env
 * tier — so a long-lived process picks up a key rotation instead of serving a
 * process-start snapshot.
 */
export function createSessionsClientFromEnv(
  overrides: Partial<SessionsApiOptions> = {},
  env: NodeJS.ProcessEnv = process.env,
): SessionsApi {
  const { baseUrl: resolvedBaseUrl, apiKeyPresent } = resolveClientTransport("sessions", env);
  const baseUrl = overrides.baseUrl ?? resolvedBaseUrl;
  if (!baseUrl) {
    throw new Error("SESSIONS_API_URL is required to build the sessions client.");
  }
  const apiKey =
    overrides.apiKey ?? (apiKeyPresent ? resolveCredential("sessions", env)?.apiKey : undefined);
  return new SessionsApi({ baseUrl, ...(apiKey ? { apiKey } : {}), ...overrides });
}
