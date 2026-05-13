import { createCapabilityManifest } from "./capabilities.js";
import type { TodosCapabilityManifest } from "./capabilities.js";
import { createContractsManifest } from "./contracts.js";
import type { TodosContractsManifest } from "./contracts.js";
import { getPackageVersion } from "./lib/package-version.js";
import { createMcpManifest } from "./mcp.js";
import type { TodosMcpManifest } from "./mcp.js";

export interface CreateTodosRegistryOptions {
  version?: string;
  generatedAt?: string;
}

export interface TodosPackageSource {
  packageName: "@hasna/todos";
  repository: "hasna/todos";
  version: string;
}

export interface TodosPackageExportContract {
  subpath: "." | "./sdk" | "./mcp" | "./registry" | "./contracts" | "./storage";
  import: string;
  types: string;
  description: string;
  stability: "stable";
}

export interface TodosRegistry {
  schemaVersion: 1;
  generatedAt: string;
  package: TodosPackageSource;
  exports: TodosPackageExportContract[];
  jsonContractDocsPath: "docs/json-contracts.md";
  capabilities: TodosCapabilityManifest;
  contracts: TodosContractsManifest;
  mcp: TodosMcpManifest;
}

export const TODOS_PACKAGE_EXPORTS: TodosPackageExportContract[] = [
  {
    subpath: ".",
    import: "./dist/index.js",
    types: "./dist/index.d.ts",
    description: "Root SDK and local database exports kept for backward compatibility.",
    stability: "stable",
  },
  {
    subpath: "./sdk",
    import: "./dist/sdk/index.js",
    types: "./dist/sdk/index.d.ts",
    description: "REST SDK client and SDK response/error types.",
    stability: "stable",
  },
  {
    subpath: "./mcp",
    import: "./dist/mcp.js",
    types: "./dist/mcp.d.ts",
    description: "Side-effect-free MCP manifest, profile, and tool group contracts.",
    stability: "stable",
  },
  {
    subpath: "./registry",
    import: "./dist/registry.js",
    types: "./dist/registry.d.ts",
    description: "Package registry manifest combining exports, capabilities, contracts, and MCP metadata.",
    stability: "stable",
  },
  {
    subpath: "./contracts",
    import: "./dist/contracts.js",
    types: "./dist/contracts.d.ts",
    description: "Stable API, enum, and error contracts for integrations.",
    stability: "stable",
  },
  {
    subpath: "./storage",
    import: "./dist/storage.js",
    types: "./dist/storage.d.ts",
    description: "Storage and service adapter contracts for local SQLite implementations.",
    stability: "stable",
  },
];

function source(version: string): TodosPackageSource {
  return {
    packageName: "@hasna/todos",
    repository: "hasna/todos",
    version,
  };
}

export function createTodosRegistry(options: CreateTodosRegistryOptions = {}): TodosRegistry {
  const version = options.version ?? getPackageVersion(import.meta.url);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  return {
    schemaVersion: 1,
    generatedAt,
    package: source(version),
    exports: TODOS_PACKAGE_EXPORTS,
    jsonContractDocsPath: "docs/json-contracts.md",
    capabilities: createCapabilityManifest({ version, generatedAt }),
    contracts: createContractsManifest({ version, generatedAt }),
    mcp: createMcpManifest({ version, generatedAt }),
  };
}

export const TODOS_REGISTRY = createTodosRegistry({
  generatedAt: "1970-01-01T00:00:00.000Z",
});
