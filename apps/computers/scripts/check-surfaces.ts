import { existsSync, readFileSync } from "node:fs";
import packageJson from "../package.json";
import { SAFE_MCP_TOOLS } from "../src/mcp";
import { REST_ROUTE_MANIFEST } from "../src/server";

interface Manifest {
  package: string;
  binaries: string[];
  exports: string[];
  mcpTools: string[];
  mcpAnnotations: Record<string, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }>;
  forbiddenMcp: string[];
  sandbox: { executableMutation: boolean; errorCode: string };
}

const manifest = JSON.parse(readFileSync("schemas/surface-parity.json", "utf8")) as Manifest;
const openapi = JSON.parse(readFileSync("schemas/openapi.json", "utf8")) as { paths: Record<string, Record<string, unknown>> };
if (manifest.package !== packageJson.name) throw new Error("Surface package name mismatch");

function equalSets(left: string[], right: string[], label: string): void {
  const a = [...left].sort(); const b = [...right].sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label} mismatch: ${JSON.stringify({ manifest: a, runtime: b })}`);
}

equalSets(manifest.binaries, Object.keys(packageJson.bin), "Binary surface");
equalSets(manifest.exports, Object.keys(packageJson.exports), "Export surface");
equalSets(manifest.mcpTools, SAFE_MCP_TOOLS.map((tool) => tool.name), "MCP tool surface");
equalSets(Object.keys(manifest.mcpAnnotations), SAFE_MCP_TOOLS.map((tool) => tool.name), "MCP annotation surface");
for (const target of Object.values(packageJson.bin)) if (!existsSync(String(target).replace("./dist", "src").replace(/\.js$/, ".ts").replace("src/computers", "src/bin/computers"))) {
  throw new Error(`Binary source is missing for ${target}`);
}
for (const route of REST_ROUTE_MANIFEST) {
  if (openapi.paths[route.path]?.[route.method.toLowerCase()] === undefined) throw new Error(`OpenAPI/runtime route mismatch: ${route.method} ${route.path}`);
}
const openapiRoutes = Object.entries(openapi.paths).flatMap(([path, item]) => Object.keys(item)
  .filter((method) => ["get", "post", "put", "patch", "delete", "options", "head", "trace"].includes(method))
  .map((method) => `${method.toUpperCase()} ${path}`));
equalSets(openapiRoutes, REST_ROUTE_MANIFEST.map((route) => `${route.method} ${route.path}`), "REST/OpenAPI route surface");
for (const tool of SAFE_MCP_TOOLS) {
  if (tool.inputSchema.additionalProperties !== false) throw new Error(`Unsafe MCP schema: ${tool.name}`);
  if (JSON.stringify(manifest.mcpAnnotations[tool.name]) !== JSON.stringify(tool.annotations)) throw new Error(`MCP annotation mismatch: ${tool.name}`);
}
const expectedAnnotations: Manifest["mcpAnnotations"] = {
  computers_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  computers_get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  computers_operations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  computers_exec_request: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  computers_install_plan: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  computers_provider_readiness: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
if (JSON.stringify(manifest.mcpAnnotations) !== JSON.stringify(expectedAnnotations)) throw new Error("MCP annotations are not the reviewed truthful contract");
for (const forbidden of ["delete", "reassign", "restore", "policy", "sandbox"]) {
  if (SAFE_MCP_TOOLS.some((tool) => tool.name.toLowerCase().includes(forbidden))) throw new Error(`Forbidden MCP tool exposed: ${forbidden}`);
}
if (manifest.sandbox.executableMutation || manifest.sandbox.errorCode !== "sandbox_disabled") throw new Error("Sandbox must remain deterministically disabled");
process.stdout.write("surface parity checks passed\n");
