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

export type TuiView = "servers" | "detail" | "search" | "call";
