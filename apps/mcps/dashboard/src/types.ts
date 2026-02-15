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
}
