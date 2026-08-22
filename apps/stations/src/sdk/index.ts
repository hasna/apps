// Typed SDK for the stations control-plane API.
//
// The client class + request/response types are generated from the serve
// OpenAPI document (`generated-client.ts`, regenerate with `bun run sdk:generate`).
// This module re-exports them and adds an env-based factory for the
// API-client mode: STATIONS_API_URL + STATIONS_API_KEY (never a DSN).

export * from "./generated-client.js";
import { StationsClient, type StationsClientOptions } from "./generated-client.js";

export const STATIONS_API_URL_ENV = "STATIONS_API_URL";
export const STATIONS_API_KEY_ENV = "STATIONS_API_KEY";

/**
 * Build a StationsClient from the environment (API-client mode).
 * Requires STATIONS_API_URL; STATIONS_API_KEY is required for any /v1 call.
 */
export function stationsClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<StationsClientOptions> = {},
): StationsClient {
  const baseUrl = overrides.baseUrl ?? env[STATIONS_API_URL_ENV];
  if (!baseUrl) {
    throw new Error(`stationsClientFromEnv requires ${STATIONS_API_URL_ENV} (or an explicit baseUrl override).`);
  }
  const apiKey = overrides.apiKey ?? env[STATIONS_API_KEY_ENV];
  return new StationsClient({
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
    ...(overrides.headers ? { headers: overrides.headers } : {}),
  });
}
