import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const RUNTIME_OUTPUTS = [
  "dist/app-event.js",
  "dist/catalog.js",
  "dist/cli/index.js",
  "dist/commander.js",
  "dist/durable-spool.js",
  "dist/durable-worker.js",
  "dist/durable.js",
  "dist/filter.js",
  "dist/index.js",
  "dist/intake/client.js",
  "dist/mcp/intake.js",
  "dist/server/intake-admin.js",
  "dist/server/serve-entry.js",
  "dist/signing.js",
  "dist/ssrf.js",
  "dist/storage.js",
  "dist/transports.js",
  "dist/types.js",
] as const;

export const TYPE_OUTPUTS = [
  "types/app-event.d.ts",
  "types/app-home.d.ts",
  "types/catalog.d.ts",
  "types/cli-webhook-policy.d.ts",
  "types/cli/index.d.ts",
  "types/cli/list-cursor.d.ts",
  "types/commander.d.ts",
  "types/durable-spool.d.ts",
  "types/durable-worker.d.ts",
  "types/durable.d.ts",
  "types/filter-options.d.ts",
  "types/filter.d.ts",
  "types/index.d.ts",
  "types/intake/cli.d.ts",
  "types/intake/client.d.ts",
  "types/intake/generated.d.ts",
  "types/intake/protocol.d.ts",
  "types/mcp/intake.d.ts",
  "types/redaction.d.ts",
  "types/server/intake-admin.d.ts",
  "types/server/intake-api.d.ts",
  "types/server/intake-migrations.d.ts",
  "types/server/intake-postgres.d.ts",
  "types/server/serve-entry.d.ts",
  "types/signing.d.ts",
  "types/ssrf.d.ts",
  "types/storage.d.ts",
  "types/transports.d.ts",
  "types/types.d.ts",
] as const;

export const GENERATED_OUTPUTS = [...RUNTIME_OUTPUTS, ...TYPE_OUTPUTS] as const;

function listFiles(root: string, directory: string): string[] {
  const files: string[] = [];
  const visit = (relativeDirectory: string): void => {
    for (const entry of readdirSync(join(root, relativeDirectory), { withFileTypes: true })) {
      const relativePath = join(relativeDirectory, entry.name).replaceAll("\\", "/");
      if (entry.isDirectory()) visit(relativePath);
      else if (entry.isFile()) files.push(relativePath);
    }
  };
  visit(directory);
  return files;
}

export function generatedOutputDiff(packageRoot: string): { missing: string[]; unexpected: string[] } {
  const expected = new Set<string>(GENERATED_OUTPUTS);
  const actual = [...listFiles(packageRoot, "dist"), ...listFiles(packageRoot, "types")];
  return {
    missing: GENERATED_OUTPUTS.filter((file) => !actual.includes(file)),
    unexpected: actual.filter((file) => !expected.has(file)).sort(),
  };
}

export function assertExactGeneratedOutputInventory(packageRoot: string): void {
  const { missing, unexpected } = generatedOutputDiff(packageRoot);
  const failures = [
    missing.length > 0 ? `missing generated outputs: ${missing.join(", ")}` : "",
    unexpected.length > 0 ? `unexpected generated outputs: ${unexpected.join(", ")}` : "",
  ].filter(Boolean);
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

function collectStringLeaves(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringLeaves(item, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStringLeaves(item, output);
  }
}

export function generatedPackageEntrypoints(packageRoot: string): string[] {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    main?: unknown;
    types?: unknown;
    bin?: unknown;
    exports?: unknown;
  };
  const leaves: string[] = [];
  collectStringLeaves(manifest.main, leaves);
  collectStringLeaves(manifest.types, leaves);
  collectStringLeaves(manifest.bin, leaves);
  collectStringLeaves(manifest.exports, leaves);
  return [...new Set(leaves
    .map((file) => file.replace(/^\.\//, ""))
    .filter((file) => file.startsWith("dist/") || file.startsWith("types/")))]
    .sort();
}

export function assertGeneratedEntrypointsCovered(packageRoot: string): void {
  const expected = new Set<string>(GENERATED_OUTPUTS);
  const uncovered = generatedPackageEntrypoints(packageRoot).filter((file) => !expected.has(file));
  if (uncovered.length > 0) {
    throw new Error(`package.json generated entrypoints missing from expected output manifest: ${uncovered.join(", ")}`);
  }
}
