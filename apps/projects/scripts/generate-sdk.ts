#!/usr/bin/env bun
// Generate the typed projects SDK from the serve OpenAPI document, using
// @hasna/contracts/sdk generateSdkFromOpenApi. Output: src/sdk/client.ts.
// Run: bun run scripts/generate-sdk.ts

import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSdkFromOpenApi } from "@hasna/contracts/sdk";
import { buildOpenApiSpec } from "../src/serve/openapi.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const version = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")).version || "0.0.0";

const spec = buildOpenApiSpec(version);
const { code, operations, warnings } = generateSdkFromOpenApi(spec as never, {
  className: "ProjectsClient",
  apiKeyHeader: "x-api-key",
});

// The shared generator currently makes every query object optional even when
// every query parameter in OpenAPI is required. Keep complete bounded reads
// impossible to call without their bounds until the generator owns this
// distinction directly.
const requiredBoundedReadMethods = [
  "guardedReadProject",
  "lookupGuardedProjectMutationReceipt",
  "readProjectResourceLinks",
  "readProjectResourceLinkMigration",
] as const;
let generatedCode = code;
for (const method of requiredBoundedReadMethods) {
  const signature = new RegExp(`(async ${method}\\([^)]*?), query\\?:`);
  if (!signature.test(generatedCode)) {
    throw new Error(`generated SDK is missing the expected bounded-read signature for ${method}`);
  }
  generatedCode = generatedCode.replace(signature, "$1, query:");
}

// New list filters are additive to the existing /v1/projects route, but an
// older projects-serve ignores unknown query parameters. Make the generated
// SDK fail closed whenever a caller opts into those filters, using the same
// producer attestation as the CLI/MCP Store seam. Legacy listProjects calls
// keep accepting the historical response shape.
const listProjectsStart = generatedCode.indexOf("    async listProjects(");
const listProjectsEnd = generatedCode.indexOf("\n    /** Create a project", listProjectsStart);
if (listProjectsStart < 0 || listProjectsEnd < 0) {
  throw new Error("generated SDK is missing the expected listProjects method");
}
const listProjectsBlock = generatedCode.slice(listProjectsStart, listProjectsEnd);
const legacyListReturn = `      return this.request("GET", \`/v1/projects\`, {
        body: undefined,
        query,
        init,
      });`;
if (!listProjectsBlock.includes(legacyListReturn)) {
  throw new Error("generated SDK listProjects body changed; update the v2 attestation patch");
}
const attestedListReturn = `      const response = await this.request<WorkspaceList>("GET", \`/v1/projects\`, {
        body: undefined,
        query,
        init,
      });
      const usesV2Filters = query?.query_scope !== undefined
        || query?.tags !== undefined
        || query?.exclude_evals !== undefined
        || query?.include_fixtures !== undefined;
      if (usesV2Filters) {
        const expectedTags = [...new Set([...(query?.tag ? [query.tag] : []), ...(query?.tags ?? [])])];
        const applied = response.applied_filters;
        if (
          response.filter_contract !== "projects.list.v2"
          || !applied
          || applied.query_scope !== (query?.query_scope ?? "legacy")
          || JSON.stringify(applied.tags) !== JSON.stringify(expectedTags)
          || applied.exclude_evals !== (query?.exclude_evals === true)
          || applied.exclude_registry_fixtures !== (query?.include_fixtures !== true)
        ) {
          throw new Error("Projects list requires the projects.list.v2 filter contract; deploy the matching projects-serve before using additive filters.");
        }
      }
      return response;`;
generatedCode = generatedCode.slice(0, listProjectsStart)
  + listProjectsBlock.replace(legacyListReturn, attestedListReturn)
  + generatedCode.slice(listProjectsEnd);

const banner = `// @generated from the projects-serve OpenAPI document by scripts/generate-sdk.ts.
// DO NOT EDIT BY HAND. Regenerate: bun run sdk:generate
`;
const outPath = join(repoRoot, "src", "sdk", "client.ts");
writeFileSync(outPath, banner + generatedCode);

console.error(`Generated ${operations.length} operations -> src/sdk/client.ts`);
if (warnings.length) console.error("Warnings:\n" + warnings.map((w) => `  - ${w}`).join("\n"));
