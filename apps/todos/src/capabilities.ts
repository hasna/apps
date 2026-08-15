import { getPackageVersion } from "./lib/package-version.js";

export type TodosCapabilityKind = "cli" | "sdk" | "mcp" | "server";
export type TodosCapabilityStability = "stable" | "experimental";

export interface TodosCapabilitySource {
  packageName: "@hasna/todos";
  repository: "hasna/todos";
  version: string;
}

export interface TodosCapability {
  id: string;
  kind: TodosCapabilityKind;
  name: string;
  description: string;
  tags: string[];
  docsPath: string;
  stability: TodosCapabilityStability;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  source: TodosCapabilitySource;
}

export interface TodosCapabilityManifest {
  schemaVersion: 1;
  generatedAt: string;
  package: TodosCapabilitySource;
  capabilities: TodosCapability[];
}

export interface CreateCapabilityManifestOptions {
  version?: string;
  generatedAt?: string;
}

const packageName = "@hasna/todos" as const;
const repository = "hasna/todos" as const;

const objectSchema = {
  type: "object",
  additionalProperties: true,
} as const;

const taskSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    status: { type: "string" },
    priority: { type: "string" },
  },
  required: ["id", "title", "status", "priority"],
  additionalProperties: true,
} as const;

function source(version: string): TodosCapabilitySource {
  return { packageName, repository, version };
}

function capability(
  version: string,
  input: Omit<TodosCapability, "source">,
): TodosCapability {
  return {
    ...input,
    source: source(version),
  };
}

function buildCapabilities(version: string): TodosCapability[] {
  return [
    capability(version, {
      id: "cli.add-task",
      kind: "cli",
      name: "todos add",
      description: "Create a local task from the command line.",
      tags: ["tasks", "cli", "local"],
      docsPath: "README.md#cli",
      stability: "stable",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["title"],
        additionalProperties: false,
      },
      outputSchema: taskSchema,
    }),
    capability(version, {
      id: "cli.list-tasks",
      kind: "cli",
      name: "todos list",
      description: "List local tasks with filters for status, priority, assignment, tags, and task lists.",
      tags: ["tasks", "cli", "query"],
      docsPath: "README.md#cli",
      stability: "stable",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string" },
          priority: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "array",
        items: taskSchema,
      },
    }),
    capability(version, {
      id: "cli.show-task",
      kind: "cli",
      name: "todos show",
      description: "Show full local task details by id or partial id.",
      tags: ["tasks", "cli", "query"],
      docsPath: "README.md#cli",
      stability: "stable",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
        additionalProperties: false,
      },
      outputSchema: taskSchema,
    }),
    capability(version, {
      id: "sdk.client",
      kind: "sdk",
      name: "createClient",
      description: "Create a REST SDK client for cross-process and cross-machine task operations.",
      tags: ["sdk", "api", "client"],
      docsPath: "sdk/README.md",
      stability: "stable",
      inputSchema: {
        type: "object",
        properties: {
          baseUrl: { type: "string" },
          apiKey: { type: "string" },
        },
        required: ["baseUrl"],
        additionalProperties: true,
      },
      outputSchema: objectSchema,
    }),
    capability(version, {
      id: "mcp.create-task",
      kind: "mcp",
      name: "create_task",
      description: "Create a task through the MCP server.",
      tags: ["mcp", "tasks", "create"],
      docsPath: "README.md#mcp",
      stability: "stable",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
          project_id: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["title"],
        additionalProperties: false,
      },
      outputSchema: taskSchema,
    }),
    capability(version, {
      id: "mcp.claim-next-task",
      kind: "mcp",
      name: "claim_next_task",
      description: "Atomically claim and start the best available pending task for an agent.",
      tags: ["mcp", "tasks", "agents", "workflow"],
      docsPath: "README.md#mcp",
      stability: "stable",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          project_id: { type: "string" },
          task_list_id: { type: "string" },
          plan_id: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["agent_id"],
        additionalProperties: false,
      },
      outputSchema: taskSchema,
    }),
    capability(version, {
      id: "mcp.get-status",
      kind: "mcp",
      name: "get_status",
      description: "Read queue status or task-specific status through the MCP server.",
      tags: ["mcp", "tasks", "status"],
      docsPath: "README.md#mcp",
      stability: "stable",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          project_id: { type: "string" },
          task_list_id: { type: "string" },
          agent_id: { type: "string" },
        },
        additionalProperties: false,
      },
      outputSchema: objectSchema,
    }),
    capability(version, {
      id: "server.local-api",
      kind: "server",
      name: "todos-serve",
      description: "Start the local HTTP server for task APIs and dashboard support.",
      tags: ["server", "api", "local"],
      docsPath: "README.md#server",
      stability: "experimental",
      inputSchema: {
        type: "object",
        properties: {
          port: { type: "number" },
          host: { type: "string" },
        },
        additionalProperties: true,
      },
      outputSchema: objectSchema,
    }),
  ];
}

export function createCapabilityManifest(
  options: CreateCapabilityManifestOptions = {},
): TodosCapabilityManifest {
  const version = options.version ?? getPackageVersion(import.meta.url);
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    package: source(version),
    capabilities: buildCapabilities(version),
  };
}

export const TODOS_CAPABILITIES = createCapabilityManifest({
  generatedAt: "1970-01-01T00:00:00.000Z",
}).capabilities;
