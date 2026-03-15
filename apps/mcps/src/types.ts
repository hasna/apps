export interface McpServerEntry {
  id: string;
  name: string;
  description: string | null;
  command: string;
  args: string[];
  env: Record<string, string>;
  transport: "stdio" | "sse" | "streamable-http";
  url: string | null;
  source: "local" | "registry";
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_connected_at?: string | null;
  last_error?: string | null;
}

export interface AddServerOptions {
  name?: string;
  description?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: "stdio" | "sse" | "streamable-http";
  url?: string;
  source?: "local" | "registry";
}

export interface McpTool {
  server_id: string;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface RegistryPackage {
  registryType: string;
  identifier: string;
  transport?: { type: string };
}

export interface RegistryServerInner {
  name: string;
  description: string;
  repository: { url: string; source?: string };
  version?: string;
  packages?: RegistryPackage[];
}

export interface RegistryServerEntry {
  server: RegistryServerInner;
  _meta?: Record<string, unknown>;
}

export interface RegistryServer {
  id: string;
  name: string;
  description: string;
  repository: { url: string };
  packages: RegistryPackage[];
}

export interface ConnectedServer {
  entry: McpServerEntry;
  tools: McpTool[];
  disconnect: () => Promise<void>;
}

export type TuiView = "servers" | "detail" | "search" | "call" | "find";

export interface FinderResult {
  name: string;
  description: string;
  /** Where this result came from */
  source: "registry" | "npm" | "awesome" | "github";
  /** DB id of the source that returned this result */
  sourceId?: string;
  /** Homepage / repository URL */
  url?: string;
  /** GitHub repo URL if known */
  githubRepo?: string;
  /** npm package name if known */
  npmPackage?: string;
  /** Ready-to-run install command, e.g. `npx -y @package/name` */
  installCmd?: string;
  /** GitHub star count if available */
  stars?: number;
}

export interface McpSource {
  id: string;
  name: string;
  /** mcp-registry | awesome-list | npm-search | github-topic */
  type: "mcp-registry" | "awesome-list" | "npm-search" | "github-topic";
  /** The URL endpoint for this source */
  url: string;
  description: string | null;
  enabled: boolean;
  created_at: string;
}

export interface AddSourceOptions {
  name: string;
  type: "mcp-registry" | "awesome-list" | "npm-search" | "github-topic";
  url: string;
  description?: string;
}
