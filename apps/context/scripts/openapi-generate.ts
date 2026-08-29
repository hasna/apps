/**
 * Regenerate src/sdk/generated-client.ts from the context-serve OpenAPI
 * document. Run after any change to the route table in
 * src/server/openapi.ts:
 *
 *   bun run openapi:generate
 *
 * src/sdk/generated-client.test.ts fails when the committed generated
 * client is stale, so CI enforces this step.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildOpenApiDocument } from "../src/server/openapi.js";
import { generateClientSource } from "../src/sdk/generate-client.js";

const outPath = join(import.meta.dir, "..", "src", "sdk", "generated-client.ts");
const source = generateClientSource(buildOpenApiDocument() as never);
writeFileSync(outPath, source);
console.log(`openapi:generate — wrote ${outPath} (${source.split("\n").length} lines)`);
