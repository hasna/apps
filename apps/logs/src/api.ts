/**
 * Typed client SDK for the @hasna/logs hosted API (`/v1`).
 *
 * Generated from the serve OpenAPI document — see `scripts/generate-sdk-api.ts`.
 * Usage:
 *
 *   import { LogsClient } from "@hasna/logs/api";
 *   const logs = new LogsClient({
 *     baseUrl: "https://logs.example.com",
 *     apiKey: "my-key",
 *   });
 *   await logs.ingestLog({ level: "info", message: "hello" });
 *
 * Or resolve the credential through the shared @hasna/contracts client chain
 * (hasna/apps#1720) — the same five tiers the CLI and the MCP server use,
 * resolved FRESH per request so a key rotation heals a long-lived process:
 *
 *   import { createLogsApiClientFromEnv } from "@hasna/logs/api";
 *   const logs = createLogsApiClientFromEnv();
 *   await logs.ingestLog({ level: "info", message: "hello" });
 *
 * The chain reads `HASNA_LOGS_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
 * `HASNA_LOGS_API_KEY_REF`, then the macOS Keychain item
 * `hasna.credentials.logs.api-key`, then `~/.hasna/logs/config/credentials`
 * (0400/0600), then `HASNA_LOGS_API_KEY`; the authority follows
 * `HASNA_LOGS_API_URL`, the Keychain `api-url` item, the credentials file, and
 * defaults to the fleet gateway `https://api.hasna.com/logs`. The legacy
 * unprefixed `LOGS_API_URL` / `LOGS_API_KEY` names are read ONLY as the shared
 * resolver's silent alias fallback and never outrank the canonical pair.
 * `createLogsApiClientFromEnv` THROWS when no credential resolves — an
 * unauthenticated client is never built.
 *
 * An explicit `baseUrl` pins the authority: the ambient chain is never
 * consulted again, so the constructor's `apiKey` (or nothing) is the only
 * credential that ever travels to that URL (hasna/apps#1794, #1781 review
 * NO_GO). An explicit `apiKey` is tier 1 and is likewise never re-resolved.
 */

export * from "./sdk-api/client.ts";
export { createLogsApiClientFromEnv } from "./sdk-api/from-env.ts";