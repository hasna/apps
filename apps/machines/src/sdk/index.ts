// Typed SDK for the machines control-plane API.
//
// The client class + request/response types are generated from the serve
// OpenAPI document (`generated-client.ts`, regenerate with `bun run sdk:generate`).
// This module re-exports them and adds an env-based factory for the client
// self_hosted mode: MACHINES_API_URL + MACHINES_API_KEY (never a DSN).

export * from "./generated-client.js";
import { MachinesClient, type MachinesClientOptions } from "./generated-client.js";

export const MACHINES_API_URL_ENV = "MACHINES_API_URL";
export const MACHINES_API_KEY_ENV = "MACHINES_API_KEY";

/**
 * Build a MachinesClient from the environment (client self_hosted mode).
 * Requires MACHINES_API_URL; MACHINES_API_KEY is required for any /v1 call.
 */
export function machinesClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<MachinesClientOptions> = {},
): MachinesClient {
  const baseUrl = overrides.baseUrl ?? env[MACHINES_API_URL_ENV];
  if (!baseUrl) {
    throw new Error(`machinesClientFromEnv requires ${MACHINES_API_URL_ENV} (or an explicit baseUrl override).`);
  }
  const apiKey = overrides.apiKey ?? env[MACHINES_API_KEY_ENV];
  return new MachinesClient({
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
    ...(overrides.headers ? { headers: overrides.headers } : {}),
  });
}
