import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type KnowledgeMcpProfile = 'core' | 'full';
export const KNOWLEDGE_MCP_PROFILE_ENV = 'HASNA_KNOWLEDGE_MCP_PROFILE';

/**
 * Routine agent reads/writes only. The full operational/admin inventory remains
 * discoverable through search_tools/describe_tools and callable after an
 * explicit full-profile restart.
 */
export const KNOWLEDGE_CORE_TOOL_NAMES = [
  'search_tools',
  'describe_tools',
  'ok_paths',
  'ok_storage_status',
  'ok_add',
  'ok_list',
  'ok_get',
  'ok_update',
  'ok_stats',
  'ok_search',
  'knowledge_search',
  'knowledge_context_pack',
  'knowledge_ask',
  'knowledge_get',
  'knowledge_ingest',
  'knowledge_build',
  'knowledge_run_status',
  'knowledge_storage',
] as const;

const CORE_TOOLS = new Set<string>(KNOWLEDGE_CORE_TOOL_NAMES);

export interface KnowledgeToolCatalogEntry {
  name: string;
  description: string;
  parameters: string[];
  active_in_core: boolean;
}

export class KnowledgeToolCatalog {
  private readonly entries = new Map<string, KnowledgeToolCatalogEntry>();

  record(name: string, description: string, inputSchema: unknown): void {
    const parameters = inputSchema && typeof inputSchema === 'object' && !Array.isArray(inputSchema)
      ? Object.keys(inputSchema as Record<string, unknown>)
      : [];
    this.entries.set(name, {
      name,
      description,
      parameters,
      active_in_core: CORE_TOOLS.has(name),
    });
  }

  all(): KnowledgeToolCatalogEntry[] {
    return [...this.entries.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  search(query = ''): KnowledgeToolCatalogEntry[] {
    const normalized = query.trim().toLowerCase();
    return this.all().filter((entry) => !normalized
      || entry.name.toLowerCase().includes(normalized)
      || entry.description.toLowerCase().includes(normalized));
  }

  describe(names: readonly string[]): { items: KnowledgeToolCatalogEntry[]; missing: string[] } {
    const items: KnowledgeToolCatalogEntry[] = [];
    const missing: string[] = [];
    for (const name of names) {
      const entry = this.entries.get(name);
      if (entry) items.push(entry);
      else missing.push(name);
    }
    return { items, missing };
  }
}

export function resolveKnowledgeMcpProfile(
  argv: readonly string[] = process.argv,
  env: Record<string, string | undefined> = process.env,
  defaultProfile: KnowledgeMcpProfile = 'core',
): KnowledgeMcpProfile {
  let cliValue: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--mcp-profile') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--mcp-profile requires core or full');
      if (cliValue !== undefined) throw new Error('--mcp-profile may be provided only once');
      cliValue = value;
      index += 1;
    } else if (arg.startsWith('--mcp-profile=')) {
      if (cliValue !== undefined) throw new Error('--mcp-profile may be provided only once');
      cliValue = arg.slice('--mcp-profile='.length);
    }
  }
  const value = (cliValue ?? env[KNOWLEDGE_MCP_PROFILE_ENV] ?? defaultProfile).trim().toLowerCase();
  if (value === 'core' || value === 'full') return value;
  throw new Error(`Invalid ${KNOWLEDGE_MCP_PROFILE_ENV} value ${JSON.stringify(value)}: expected core or full`);
}

export function shouldRegisterKnowledgeTool(name: string, profile: KnowledgeMcpProfile): boolean {
  return profile === 'full' || CORE_TOOLS.has(name);
}

function registrationMetadata(property: string | symbol, args: unknown[]) {
  if (property === 'registerTool') {
    const config = args[1] && typeof args[1] === 'object' ? args[1] as Record<string, unknown> : {};
    return {
      description: typeof config.description === 'string' ? config.description : '',
      inputSchema: config.inputSchema,
    };
  }
  const description = typeof args[1] === 'string' ? args[1] : '';
  const inputSchema = args.find((value, index) => index >= 2 && value && typeof value === 'object' && !Array.isArray(value));
  return { description, inputSchema };
}

export function createProfiledKnowledgeServer(
  server: McpServer,
  profile: KnowledgeMcpProfile,
  catalog: KnowledgeToolCatalog,
): McpServer {
  return new Proxy(server, {
    get(target, property, receiver) {
      if (property !== 'tool' && property !== 'registerTool') return Reflect.get(target, property, receiver);
      return (...args: unknown[]) => {
        const name = String(args[0] ?? '');
        const metadata = registrationMetadata(property, args);
        catalog.record(name, metadata.description, metadata.inputSchema);
        if (!shouldRegisterKnowledgeTool(name, profile)) return undefined;
        const method = target[property] as (...toolArgs: unknown[]) => unknown;
        return method.apply(target, args);
      };
    },
  }) as McpServer;
}
