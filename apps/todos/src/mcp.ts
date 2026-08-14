import { getPackageVersion } from "./lib/package-version.js";
import {
  CORE_MCP_TOOLS,
  MCP_PROFILE_GROUPS,
  MCP_TOOL_GROUPS,
  shouldRegisterToolForProfile,
} from "./mcp/token-utils.js";

export type TodosMcpStability = "stable" | "experimental";

export interface CreateMcpManifestOptions {
  version?: string;
  generatedAt?: string;
}

export interface GetMcpToolNamesOptions {
  profile?: string;
  groups?: string;
}

export interface TodosMcpPackageSource {
  packageName: "@hasna/todos";
  repository: "hasna/todos";
  version: string;
}

export interface TodosMcpToolContract {
  name: string;
  groups: string[];
  profiles: string[];
  core: boolean;
  stability: TodosMcpStability;
}

export interface TodosMcpManifest {
  schemaVersion: 1;
  generatedAt: string;
  package: TodosMcpPackageSource;
  server: {
    name: "todos";
    binary: "todos-mcp";
    transport: "stdio";
    profileEnvironmentVariable: "TODOS_PROFILE";
    groupEnvironmentVariable: "TODOS_TOOL_GROUPS";
  };
  groups: Record<string, readonly string[]>;
  profiles: Record<string, readonly string[]>;
  tools: TodosMcpToolContract[];
}

export {
  CORE_MCP_TOOLS,
  MCP_PROFILE_GROUPS,
  MCP_TOOL_GROUPS,
  shouldRegisterToolForProfile,
};

function source(version: string): TodosMcpPackageSource {
  return {
    packageName: "@hasna/todos",
    repository: "hasna/todos",
    version,
  };
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function getAllMcpToolNames(): string[] {
  return uniqueSorted(Object.values(MCP_TOOL_GROUPS).flatMap((tools) => [...tools]));
}

function groupsForTool(toolName: string): string[] {
  return Object.entries(MCP_TOOL_GROUPS)
    .filter(([, tools]) => tools.includes(toolName))
    .map(([group]) => group)
    .sort((left, right) => left.localeCompare(right));
}

function profilesForTool(toolName: string): string[] {
  return Object.entries(MCP_PROFILE_GROUPS)
    .filter(([, groups]) => groups.some((group) => MCP_TOOL_GROUPS[group]?.includes(toolName)))
    .map(([profile]) => profile)
    .sort((left, right) => left.localeCompare(right));
}

export function getMcpToolNames(options: GetMcpToolNamesOptions = {}): string[] {
  const profile = options.profile ?? "minimal";
  const groups = options.groups ?? "";
  return getAllMcpToolNames().filter((toolName) => (
    shouldRegisterToolForProfile(toolName, profile, groups)
  ));
}

export function createMcpManifest(options: CreateMcpManifestOptions = {}): TodosMcpManifest {
  const version = options.version ?? getPackageVersion(import.meta.url);
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    package: source(version),
    server: {
      name: "todos",
      binary: "todos-mcp",
      transport: "stdio",
      profileEnvironmentVariable: "TODOS_PROFILE",
      groupEnvironmentVariable: "TODOS_TOOL_GROUPS",
    },
    groups: MCP_TOOL_GROUPS,
    profiles: MCP_PROFILE_GROUPS,
    tools: getAllMcpToolNames().map((toolName) => ({
      name: toolName,
      groups: groupsForTool(toolName),
      profiles: profilesForTool(toolName),
      core: CORE_MCP_TOOLS.has(toolName),
      stability: CORE_MCP_TOOLS.has(toolName) ? "stable" : "experimental",
    })),
  };
}

export const TODOS_MCP_MANIFEST = createMcpManifest({
  generatedAt: "1970-01-01T00:00:00.000Z",
});
