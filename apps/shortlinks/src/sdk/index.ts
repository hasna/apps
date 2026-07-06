/**
 * @hasna/shortlinks/sdk — typed client for the shortlinks REST API.
 *
 * The generated client (`ShortlinksApiClient`) is produced from the serve
 * OpenAPI document (src/serve/openapi.ts) by `bun run sdk:generate`. It is the
 * canonical client for the versioned `/v1` API with API-key auth.
 *
 * Client self_hosted mode reads `SHORTLINKS_API_URL` + `SHORTLINKS_API_KEY`
 * (never a DSN).
 */

export * from "./generated.js";
export { buildOpenApiDocument } from "../serve/openapi.js";
