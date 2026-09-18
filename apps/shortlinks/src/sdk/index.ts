/**
 * @hasna/shortlinks/sdk — typed client for the shortlinks REST API.
 *
 * The generated client (`ShortlinksApiClient`) is produced from the serve
 * OpenAPI document (src/serve/openapi.ts) by `bun run sdk:generate`. It is the
 * canonical client for the versioned `/v1` API with API-key auth.
 *
 * The client resolves its authority and credential through the ONE
 * @hasna/contracts client chain (Keychain, ~/.hasna/shortlinks/config/credentials,
 * HASNA_SHORTLINKS_API_KEY, default fleet gateway URL) — never a DSN, and never
 * a hand-rolled env read.
 */

export * from "./generated.js";
export {
  createShortlinksApiClient,
  resolveShortlinksSdkTransport,
} from "./resolve.js";
export type {
  ResolveShortlinksSdkTransportOptions,
  ShortlinksSdkTransport,
} from "./resolve.js";
export { buildOpenApiDocument } from "../serve/openapi.js";
