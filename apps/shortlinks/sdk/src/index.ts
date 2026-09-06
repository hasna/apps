/**
 * @hasna/shortlinks-sdk
 * Zero-dependency TypeScript client for the @hasna/shortlinks REST API.
 * Works in Node.js, Bun, Deno, and browser environments.
 *
 * The client below is generated from the serve OpenAPI document
 * (apps/shortlinks/src/serve/openapi.ts). Regenerate with `bun run sdk:generate`
 * in the repo root.
 *
 * This standalone package stays zero-dependency: it takes an explicit
 * `baseUrl` + `apiKey` and never resolves credentials itself. For the
 * resolver-backed client (Keychain, ~/.hasna/shortlinks/config/credentials,
 * HASNA_SHORTLINKS_API_KEY, default fleet gateway URL, refreshed per request),
 * use the in-package `@hasna/shortlinks/sdk` surface instead:
 *
 *   import { createShortlinksApiClient } from "@hasna/shortlinks/sdk";
 *   const client = createShortlinksApiClient(); // resolves via @hasna/contracts
 *
 * Usage (standalone, explicit options):
 *   import { ShortlinksApiClient } from "@hasna/shortlinks-sdk";
 *   const client = new ShortlinksApiClient({
 *     baseUrl: "https://api.hasna.com/shortlinks",
 *     apiKey: "hsk_...",
 *   });
 */

export * from "./generated.js";
