/**
 * Typed open-files SDK — generated from the serve OpenAPI (`src/server/openapi.ts`)
 * via @hasna/contracts. Import from "@hasna/files/sdk".
 *
 * Self-hosted usage:
 *   import { FilesClient } from "@hasna/files/sdk";
 *   const files = new FilesClient({ baseUrl: process.env.FILES_API_URL!, apiKey: process.env.FILES_API_KEY });
 *   await files.listSources();
 */
export * from "./client.js";
export { openApiDocument, OPENAPI_VERSION } from "../server/openapi.js";
