export interface McpSource {
  id: string;
  name: string;
  type: "mcp-registry" | "awesome-list" | "npm-search" | "github-topic";
  url: string;
  description: string | null;
  enabled: boolean;
  created_at: string;
}

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
  toolCount: number;
  created_at: string;
  updated_at: string;
  last_connected_at?: string | null;
  last_error?: string | null;
}
