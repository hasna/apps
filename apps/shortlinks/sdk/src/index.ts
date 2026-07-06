/**
 * @hasna/shortlinks-sdk
 * Zero-dependency TypeScript client for the @hasna/shortlinks REST API.
 * Works in Node.js, Bun, Deno, and browser environments.
 *
 * The client below is generated from the serve OpenAPI document
 * (open-shortlinks/src/serve/openapi.ts). Regenerate with `bun run sdk:generate`
 * in the repo root.
 *
 * Usage:
 *   import { ShortlinksApiClient } from "@hasna/shortlinks-sdk";
 *   const client = new ShortlinksApiClient({
 *     baseUrl: process.env.SHORTLINKS_API_URL!,
 *     apiKey: process.env.SHORTLINKS_API_KEY!,
 *   });
 */

export * from "./generated.js";
