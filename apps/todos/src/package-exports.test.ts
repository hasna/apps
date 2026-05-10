import { describe, expect, test } from "bun:test";
import packageJson from "../package.json";
import {
  TODOS_CONTRACTS,
  TODOS_ERROR_CODES,
  createContractsManifest,
} from "./contracts.js";
import {
  TODOS_MCP_MANIFEST,
  createMcpManifest,
  getMcpToolNames,
} from "./mcp.js";
import {
  TODOS_PACKAGE_EXPORTS,
  TODOS_REGISTRY,
  createTodosRegistry,
} from "./registry.js";

const expectedExports = {
  ".": {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  },
  "./sdk": {
    types: "./dist/sdk/index.d.ts",
    import: "./dist/sdk/index.js",
  },
  "./mcp": {
    types: "./dist/mcp.d.ts",
    import: "./dist/mcp.js",
  },
  "./registry": {
    types: "./dist/registry.d.ts",
    import: "./dist/registry.js",
  },
  "./contracts": {
    types: "./dist/contracts.d.ts",
    import: "./dist/contracts.js",
  },
};

describe("package subpath exports", () => {
  test("declares stable root, SDK, MCP, registry, and contracts exports", () => {
    expect(packageJson.exports).toEqual(expectedExports);
    expect(TODOS_PACKAGE_EXPORTS.map((entry) => entry.subpath)).toEqual(Object.keys(expectedExports));

    for (const exported of TODOS_PACKAGE_EXPORTS) {
      expect(packageJson.exports[exported.subpath]).toEqual({
        types: exported.types,
        import: exported.import,
      });
      expect(exported.stability).toBe("stable");
      expect(exported.description.length).toBeGreaterThan(20);
    }
  });

  test("provides side-effect-free MCP metadata and profile filtering", () => {
    const manifest = createMcpManifest({
      version: "1.2.3",
      generatedAt: "2026-01-02T03:04:05.000Z",
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-01-02T03:04:05.000Z",
      package: {
        packageName: "@hasna/todos",
        repository: "hasna/todos",
        version: "1.2.3",
      },
      server: {
        name: "todos",
        binary: "todos-mcp",
        transport: "stdio",
      },
    });
    expect(manifest.tools.length).toBeGreaterThan(100);
    expect(manifest.tools.find((tool) => tool.name === "create_task")).toMatchObject({
      groups: ["core"],
      profiles: expect.arrayContaining(["minimal", "standard"]),
      core: true,
      stability: "stable",
    });
    expect(getMcpToolNames({ profile: "minimal" })).toContain("create_task");
    expect(getMcpToolNames({ profile: "minimal" })).not.toContain("bulk_update_tasks");
    expect(getMcpToolNames({ profile: "full" })).toContain("bulk_update_tasks");
    expect(TODOS_MCP_MANIFEST.generatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  test("provides API contracts, enum values, and generic error codes", () => {
    const manifest = createContractsManifest({
      version: "1.2.3",
      generatedAt: "2026-01-02T03:04:05.000Z",
    });

    expect(manifest.values.taskStatuses).toEqual(["pending", "in_progress", "completed", "failed", "cancelled"]);
    expect(manifest.values.taskPriorities).toEqual(["low", "medium", "high", "critical"]);
    expect(manifest.apiRoutes.map((route) => `${route.method} ${route.path}`)).toEqual(
      expect.arrayContaining([
        "GET /api/health",
        "GET /api/tasks",
        "POST /api/tasks",
        "GET /api/tasks/:id",
        "PATCH /api/tasks/:id",
        "POST /api/tasks/:id/complete",
        "POST /api/tasks/claim",
      ]),
    );
    expect(manifest.errorCodes.map((error) => error.code)).toEqual(
      expect.arrayContaining(["TASK_NOT_FOUND", "VERSION_CONFLICT", "COMPLETION_BLOCKED"]),
    );
    expect(manifest.jsonOutputs.contracts.map((contract) => contract.id)).toEqual(
      expect.arrayContaining(["task", "project", "agent", "template", "task_list", "comment", "checkpoint", "dispatch", "audit_history", "status_summary", "structured_error", "api_error"]),
    );
    expect(manifest.jsonOutputs.generatedAt).toBe(manifest.generatedAt);
    expect(TODOS_ERROR_CODES).toHaveLength(manifest.errorCodes.length);
    expect(TODOS_CONTRACTS.generatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  test("combines exports, capabilities, contracts, and MCP metadata in the registry", () => {
    const registry = createTodosRegistry({
      version: "1.2.3",
      generatedAt: "2026-01-02T03:04:05.000Z",
    });

    expect(registry).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-01-02T03:04:05.000Z",
      package: {
        packageName: "@hasna/todos",
        repository: "hasna/todos",
        version: "1.2.3",
      },
    });
    expect(registry.exports).toEqual(TODOS_PACKAGE_EXPORTS);
    expect(registry.jsonContractDocsPath).toBe("docs/json-contracts.md");
    expect(registry.capabilities.package.version).toBe("1.2.3");
    expect(registry.contracts.package.version).toBe("1.2.3");
    expect(registry.mcp.package.version).toBe("1.2.3");
    expect(TODOS_REGISTRY.generatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  test("keeps exported integration contracts SaaS-neutral", () => {
    const serialized = JSON.stringify({
      mcp: TODOS_MCP_MANIFEST,
      contracts: TODOS_CONTRACTS,
      registry: TODOS_REGISTRY,
    }).toLowerCase();

    for (const forbidden of ["stripe", "billing", "tenant", "aws", "s3", "platform-todos", "saas"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });
});
