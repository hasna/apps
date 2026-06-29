import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  addServer,
  removeServer,
  listServers,
  getServer,
  enableServer,
  disableServer,
  updateServer,
  getCachedTools,
} from "../lib/registry.js";
import { searchRegistry, installFromRegistry } from "../lib/remote.js";
import { listAwesomeServers } from "../lib/finder.js";
import {
  listSources,
  getSource,
  addSource,
  removeSource,
  enableSource as enableSourceFn,
  disableSource as disableSourceFn,
  findServers,
} from "../lib/sources.js";
import { installToAgents } from "../lib/install.js";
import type { AgentTarget } from "../lib/install.js";
import {
  connectAllEnabled,
  connectToServer,
  listAllTools,
  callTool,
  disconnectAll,
} from "../lib/proxy.js";
import { diagnoseServer } from "../lib/doctor.js";
import { TOOL_PREFIX_SEPARATOR } from "../lib/config.js";
import { getAdapter } from "../lib/db.js";
import {
  assertLocalCommandConsent,
  type LocalCommandConsent,
} from "../lib/local-command-consent.js";
import { normalizeCredentialRefs } from "../lib/credentials.js";
import type { CredentialReferenceMap } from "../types.js";
import {
  addMachine,
  getMachine as getRegisteredMachine,
  listMachines,
  removeMachine as removeRegisteredMachine,
  seedDefaultMachines,
} from "../lib/machines.js";
import { listHasnaMcpCatalog, runFleetHealthCheck, runFleetInstall } from "../lib/fleet.js";
import { readPackageVersion } from "../lib/version.js";
import {
  getProviderProfile,
  installProviderProfile,
  listProviderProfiles,
  searchProviderProfiles,
} from "../lib/provider-profiles.js";
import {
  STORAGE_SYNC_TABLES,
  collectStorageSyncErrors,
  getStorageSyncStatus,
  storagePull,
  storagePush,
  storageSync,
} from "../lib/storage-sync.js";

const VERSION = readPackageVersion(import.meta.url);
const storageTableSchema = z.enum(STORAGE_SYNC_TABLES);

export interface McpsMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  paramsSchema?: Record<string, z.ZodTypeAny>;
  run: (input: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>;
}

type InternalMcpToolDefinition = Omit<McpsMcpToolDefinition, "inputSchema"> & {
  paramsSchema: Record<string, z.ZodTypeAny>;
};

interface McpsAgent {
  id: string;
  name: string;
  session_id?: string;
  last_seen_at: string;
  project_id?: string;
}

const mcpsAgents = new Map<string, McpsAgent>();

function redactServerEnv<T extends { env: Record<string, string> }>(server: T): T {
  return { ...server, env: {} };
}

function textContent(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function jsonContent(value: unknown) {
  return textContent(JSON.stringify(value, null, 2));
}

function errorContent(text: string) {
  return { ...textContent(text), isError: true };
}

function storageResultContent(value: Awaited<ReturnType<typeof storagePush>> | Awaited<ReturnType<typeof storageSync>>) {
  const errors = collectStorageSyncErrors(value);
  return errors.length > 0 ? { ...jsonContent(value), isError: true } : jsonContent(value);
}

function localConsent(input: Record<string, unknown>): LocalCommandConsent {
  return {
    approved: input.allow_local_stdio === true,
    allowRisky: input.allow_risky_command === true,
    source: "mcp",
  };
}

function readCredentialRefs(input: Record<string, unknown>): CredentialReferenceMap {
  return normalizeCredentialRefs(
    (input.credential_refs ?? input.credentialRefs) as CredentialReferenceMap | undefined,
  );
}

export function buildMcpTools(): McpsMcpToolDefinition[] {
  const definitions: InternalMcpToolDefinition[] = [
    {
      name: "list_servers",
      description: "List all registered MCP servers",
      paramsSchema: {},
      run: () => jsonContent(listServers().map(redactServerEnv)),
    },
    {
      name: "search_registry",
      description: "Search the official MCP registry for servers",
      paramsSchema: { query: z.string().describe("Search query") },
      run: async ({ query }) => jsonContent(await searchRegistry(String(query))),
    },
    {
      name: "add_server",
      description: "Register a new MCP server",
      paramsSchema: {
        command: z.string().describe("Command to run the server (e.g., npx, bunx, node)"),
        args: z.array(z.string()).optional().describe("Arguments for the command"),
        name: z.string().optional().describe("Display name"),
        description: z.string().optional().describe("Description"),
        transport: z.enum(["stdio", "sse", "streamable-http"]).optional().describe("Transport type"),
        url: z.string().optional().describe("URL for remote transports"),
        env: z.record(z.string()).optional().describe("Environment variables"),
        credential_refs: z.record(z.object({
          source: z.enum(["env", "local-vault", "hosted"]),
          name: z.string(),
          required: z.boolean().optional(),
          description: z.string().optional(),
        })).optional().describe("Credential references by server env key"),
        allow_local_stdio: z.boolean().optional().describe("Approve registering this local stdio command"),
        allow_risky_command: z.boolean().optional().describe("Approve registering risky local command patterns"),
      },
      run: (input) => {
        const command = String(input.command);
        const args = Array.isArray(input.args) ? input.args.map(String) : [];
        const env = isRecordOfStrings(input.env) ? input.env : {};
        const credentialRefs = readCredentialRefs(input);
        const transport = input.transport as Parameters<typeof addServer>[0]["transport"];
        try {
          assertLocalCommandConsent(
            {
              command,
              args,
              env: { ...env, ...Object.fromEntries(Object.keys(credentialRefs).map((key) => [key, "<credential-ref>"])) },
              transport,
              operation: "register",
            },
            localConsent(input),
          );
          return jsonContent(addServer({
            command,
            args,
            name: typeof input.name === "string" ? input.name : undefined,
            description: typeof input.description === "string" ? input.description : undefined,
            transport,
            url: typeof input.url === "string" ? input.url : undefined,
            env,
            credentialRefs,
          }));
        } catch (err) {
          return errorContent((err as Error).message);
        }
      },
    },
    {
      name: "install_from_registry",
      description: "Install an MCP server from the official registry",
      paramsSchema: {
        id: z.string().describe("Registry server ID"),
        allow_local_stdio: z.boolean().optional().describe("Approve registering registry stdio commands"),
        allow_risky_command: z.boolean().optional().describe("Approve registering risky local command patterns"),
      },
      run: async (input) => {
        try {
          return jsonContent(await installFromRegistry(String(input.id), { localCommandConsent: localConsent(input) }));
        } catch (err) {
          return errorContent((err as Error).message);
        }
      },
    },
    {
      name: "remove_server",
      description: "Remove a registered MCP server",
      paramsSchema: { id: z.string().describe("Server ID to remove") },
      run: ({ id }) => {
        const existing = getServer(String(id));
        if (!existing) return errorContent(`Server "${String(id)}" not found.`);
        removeServer(String(id));
        return textContent(`Removed server: ${existing.name} [${String(id)}]`);
      },
    },
    {
      name: "enable_server",
      description: "Enable a registered MCP server",
      paramsSchema: { id: z.string().describe("Server ID to enable") },
      run: ({ id }) => {
        const existing = getServer(String(id));
        if (!existing) return errorContent(`Server "${String(id)}" not found.`);
        return jsonContent(enableServer(String(id)));
      },
    },
    {
      name: "disable_server",
      description: "Disable a registered MCP server",
      paramsSchema: { id: z.string().describe("Server ID to disable") },
      run: ({ id }) => {
        const existing = getServer(String(id));
        if (!existing) return errorContent(`Server "${String(id)}" not found.`);
        return jsonContent(disableServer(String(id)));
      },
    },
    {
      name: "update_server",
      description: "Update fields of a registered MCP server",
      paramsSchema: {
        id: z.string().describe("Server ID to update"),
        name: z.string().optional().describe("New display name"),
        description: z.string().optional().describe("New description"),
        command: z.string().optional().describe("New command"),
        args: z.array(z.string()).optional().describe("New args list"),
        transport: z.enum(["stdio", "sse", "streamable-http"]).optional().describe("New transport type"),
        url: z.string().optional().describe("New URL for remote transports"),
        credential_refs: z.record(z.object({
          source: z.enum(["env", "local-vault", "hosted"]),
          name: z.string(),
          required: z.boolean().optional(),
          description: z.string().optional(),
        })).optional().describe("Credential references by server env key"),
        allow_local_stdio: z.boolean().optional().describe("Approve updating this local stdio command"),
        allow_risky_command: z.boolean().optional().describe("Approve risky local command patterns"),
      },
      run: (input) => {
        const serverId = String(input.id);
        const existing = getServer(serverId);
        if (!existing) return errorContent(`Server "${serverId}" not found.`);
        const fields: Parameters<typeof updateServer>[1] = {};
        if (typeof input.name === "string") fields.name = input.name;
        if (typeof input.description === "string") fields.description = input.description;
        if (typeof input.command === "string") fields.command = input.command;
        if (Array.isArray(input.args)) fields.args = input.args.map(String);
        if (input.credential_refs !== undefined || input.credentialRefs !== undefined) fields.credentialRefs = readCredentialRefs(input);
        if (input.transport === "stdio" || input.transport === "sse" || input.transport === "streamable-http") fields.transport = input.transport;
        if (typeof input.url === "string") fields.url = input.url;
        if (fields.command !== undefined || fields.args !== undefined || fields.transport !== undefined) {
          try {
            assertLocalCommandConsent(
              {
                command: fields.command ?? existing.command,
                args: fields.args ?? existing.args,
                env: {
                  ...existing.env,
                  ...Object.fromEntries(Object.keys(fields.credentialRefs ?? existing.credentialRefs ?? {}).map((key) => [key, "<credential-ref>"])),
                },
                transport: fields.transport ?? existing.transport,
                operation: "register",
              },
              localConsent(input),
            );
          } catch (err) {
            return errorContent((err as Error).message);
          }
        }
        return jsonContent(redactServerEnv(updateServer(serverId, fields)));
      },
    },
    {
      name: "list_tools",
      description: "List all cached tools across registered servers without connecting. Optionally filter by server_id.",
      paramsSchema: { server_id: z.string().optional().describe("Server ID to filter by (optional)") },
      run: ({ server_id }) => {
        if (typeof server_id === "string" && server_id) {
          const toolsForServer = getCachedTools(server_id);
          return jsonContent(toolsForServer.map((tool) => ({ ...tool, server_id })));
        }
        const allTools: Array<{
          server_id: string;
          name: string;
          description: string;
          input_schema: Record<string, unknown>;
        }> = [];
        for (const server of listServers()) {
          for (const tool of getCachedTools(server.id)) {
            allTools.push({ server_id: server.id, ...tool });
          }
        }
        return jsonContent(allTools);
      },
    },
    {
      name: "get_server_info",
      description: "Get detailed information about a registered MCP server",
      paramsSchema: { id: z.string().describe("Server ID") },
      run: ({ id }) => {
        const entry = getServer(String(id));
        if (!entry) return errorContent(`Server "${String(id)}" not found.`);
        return jsonContent(redactServerEnv(entry));
      },
    },
    {
      name: "storage_status",
      description: "Show app-owned MCP registry storage configuration and sync metadata.",
      paramsSchema: {},
      run: () => jsonContent(getStorageSyncStatus()),
    },
    {
      name: "storage_push",
      description: "Push local open-mcps registry tables to the configured Postgres database.",
      paramsSchema: {
        tables: z.array(storageTableSchema).optional().describe("Tables to push"),
      },
      run: async ({ tables }) => storageResultContent(await storagePush({
        tables: Array.isArray(tables) ? tables.map(String) : undefined,
      })),
    },
    {
      name: "storage_pull",
      description: "Pull open-mcps registry tables from the configured Postgres database.",
      paramsSchema: {
        tables: z.array(storageTableSchema).optional().describe("Tables to pull"),
      },
      run: async ({ tables }) => storageResultContent(await storagePull({
        tables: Array.isArray(tables) ? tables.map(String) : undefined,
      })),
    },
    {
      name: "storage_sync",
      description: "Push then pull open-mcps registry tables with the configured Postgres database.",
      paramsSchema: {
        tables: z.array(storageTableSchema).optional().describe("Tables to sync"),
      },
      run: async ({ tables }) => storageResultContent(await storageSync({
        tables: Array.isArray(tables) ? tables.map(String) : undefined,
      })),
    },
    {
      name: "find_mcp_servers",
      description: "Search for MCP servers across configured sources (official registry, npm, GitHub topics, awesome lists). Use list_sources to see available source IDs.",
      paramsSchema: {
        query: z.string().describe("Search query (e.g., 'filesystem', 'postgres', 'browser')"),
        sources: z.array(z.string()).optional().describe("Source IDs to search (default: all enabled). Use list_sources to get IDs."),
        limit: z.number().optional().describe("Max results per source (default: 20)"),
      },
      run: async ({ query, sources, limit }) => jsonContent(await findServers(String(query), {
        sources: Array.isArray(sources) ? sources.map(String) : undefined,
        limit: typeof limit === "number" ? limit : undefined,
      })),
    },
    {
      name: "list_provider_profiles",
      description: "List curated provider profiles for hosted/common MCP integrations such as GitHub, Slack, Google Workspace, Stripe, Cloudflare, Postgres, filesystem, and browser automation.",
      paramsSchema: {
        enabled_only: z.boolean().optional().describe("Only include enabled provider profiles"),
      },
      run: ({ enabled_only }) => jsonContent(listProviderProfiles({ enabledOnly: enabled_only === true })),
    },
    {
      name: "search_provider_profiles",
      description: "Search curated provider profiles separately from raw MCP registry/source search.",
      paramsSchema: {
        query: z.string().describe("Search query such as 'github', 'slack', 'postgres', or an endpoint URL"),
        enabled_only: z.boolean().optional().describe("Only include enabled provider profiles"),
      },
      run: ({ query, enabled_only }) => jsonContent(searchProviderProfiles(String(query), { enabledOnly: enabled_only === true })),
    },
    {
      name: "get_provider_profile",
      description: "Get one curated provider profile by ID.",
      paramsSchema: {
        id: z.string().describe("Provider profile ID"),
      },
      run: ({ id }) => {
        const profile = getProviderProfile(String(id));
        if (!profile) return errorContent(`Provider profile "${String(id)}" not found.`);
        return jsonContent(profile);
      },
    },
    {
      name: "install_provider_profile",
      description: "Register a curated provider profile as an MCP server.",
      paramsSchema: {
        id: z.string().describe("Provider profile ID"),
        name: z.string().optional().describe("Override registered server name"),
        use_fallback: z.boolean().optional().describe("Install the stdio fallback command instead of the direct remote transport"),
        allow_local_stdio: z.boolean().optional().describe("Approve registering provider stdio fallback commands"),
        allow_risky_command: z.boolean().optional().describe("Approve risky local command patterns"),
      },
      run: (input) => {
        try {
          return jsonContent(redactServerEnv(installProviderProfile(String(input.id), {
            name: typeof input.name === "string" ? input.name : undefined,
            useFallback: input.use_fallback === true,
            localCommandConsent: localConsent(input),
          })));
        } catch (err) {
          return errorContent((err as Error).message);
        }
      },
    },
    {
      name: "list_sources",
      description: "List all configured search sources for finding MCP servers",
      paramsSchema: {},
      run: () => jsonContent(listSources()),
    },
    {
      name: "add_source",
      description: "Add a new search source for finding MCP servers",
      paramsSchema: {
        name: z.string().describe("Source name"),
        type: z.enum(["mcp-registry", "awesome-list", "npm-search", "github-topic"]).describe("Source type"),
        url: z.string().describe("Source URL endpoint"),
        description: z.string().optional().describe("Description"),
      },
      run: ({ name, type, url, description }) => jsonContent(addSource({
        name: String(name),
        type: type as Parameters<typeof addSource>[0]["type"],
        url: String(url),
        description: typeof description === "string" ? description : undefined,
      })),
    },
    {
      name: "remove_source",
      description: "Remove a search source by ID",
      paramsSchema: { id: z.string().describe("Source ID to remove") },
      run: ({ id }) => {
        const sourceId = String(id);
        const existing = getSource(sourceId);
        if (!existing) return errorContent(`Source "${sourceId}" not found.`);
        removeSource(sourceId);
        return textContent(`Removed source: ${existing.name} [${sourceId}]`);
      },
    },
    {
      name: "enable_source_finder",
      description: "Enable a search source",
      paramsSchema: { id: z.string().describe("Source ID to enable") },
      run: ({ id }) => {
        const sourceId = String(id);
        const existing = getSource(sourceId);
        if (!existing) return errorContent(`Source "${sourceId}" not found.`);
        enableSourceFn(sourceId);
        return textContent(`Enabled source: ${existing.name}`);
      },
    },
    {
      name: "disable_source_finder",
      description: "Disable a search source",
      paramsSchema: { id: z.string().describe("Source ID to disable") },
      run: ({ id }) => {
        const sourceId = String(id);
        const existing = getSource(sourceId);
        if (!existing) return errorContent(`Source "${sourceId}" not found.`);
        disableSourceFn(sourceId);
        return textContent(`Disabled source: ${existing.name}`);
      },
    },
    {
      name: "install_to_agents",
      description: "Install a registered MCP server into Claude Code, Codex, and/or Gemini",
      paramsSchema: {
        id: z.string().describe("Server ID to install (from list_servers)"),
        targets: z.array(z.enum(["claude", "codex", "gemini"])).optional().describe("Target agents to install into (default: all)"),
        allow_local_stdio: z.boolean().optional().describe("Approve installing local stdio commands into local agent configs"),
        allow_risky_command: z.boolean().optional().describe("Approve installing risky local command patterns"),
      },
      run: (input) => {
        const serverId = String(input.id);
        const entry = getServer(serverId);
        if (!entry) return errorContent(`Server "${serverId}" not found.`);
        const agentTargets = (Array.isArray(input.targets) ? input.targets : undefined) as AgentTarget[] | undefined;
        return jsonContent(installToAgents(entry, agentTargets ?? ["claude", "codex", "gemini"], {
          localCommandConsent: localConsent(input),
        }));
      },
    },
    {
      name: "list_awesome_servers",
      description: "List all MCP servers from the curated punkpeye/awesome-mcp-servers GitHub list",
      paramsSchema: {},
      run: async () => jsonContent(await listAwesomeServers()),
    },
    {
      name: "connect_and_list_tools",
      description: "Connect to all enabled MCP servers and list their available tools",
      paramsSchema: {
        allow_local_stdio: z.boolean().optional().describe("Approve launching enabled local stdio commands"),
        allow_risky_command: z.boolean().optional().describe("Approve launching risky local command patterns"),
      },
      run: async (input) => {
        let liveTools = [];
        try {
          await connectAllEnabled({ localCommandConsent: localConsent(input) });
          liveTools = listAllTools();
        } finally {
          await disconnectAll().catch(() => undefined);
        }
        return jsonContent(liveTools);
      },
    },
    {
      name: "call_upstream_tool",
      description: `Call a tool on a connected upstream MCP server. Tool name format: server_id${TOOL_PREFIX_SEPARATOR}tool_name`,
      paramsSchema: {
        tool_name: z.string().describe(`Prefixed tool name (server_id${TOOL_PREFIX_SEPARATOR}tool_name)`),
        arguments: z.record(z.unknown()).optional().describe("Tool arguments as key-value pairs"),
        allow_local_stdio: z.boolean().optional().describe("Approve launching this local stdio command"),
        allow_risky_command: z.boolean().optional().describe("Approve launching risky local command patterns"),
      },
      run: async (input) => {
        try {
          const toolName = String(input.tool_name);
          const sepIdx = toolName.indexOf(TOOL_PREFIX_SEPARATOR);
          if (sepIdx === -1) return errorContent(`Error: Invalid tool name "${toolName}"`);
          const serverId = toolName.slice(0, sepIdx);
          const entry = getServer(serverId);
          if (!entry) return errorContent(`Error: Server "${serverId}" not found.`);
          if (!entry.enabled) return errorContent(`Error: Server "${serverId}" is disabled.`);
          await connectToServer(entry, { localCommandConsent: localConsent(input) });
          const result = await callTool(toolName, readRecord(input.arguments));
          return { content: result.content as any };
        } catch (error) {
          return errorContent(`Error: ${(error as Error).message}`);
        }
      },
    },
    {
      name: "diagnose_server",
      description: "Run health checks on a registered MCP server",
      paramsSchema: {
        id: z.string().describe("Server ID"),
        allow_local_stdio: z.boolean().optional().describe("Approve launching local stdio diagnostics"),
        allow_risky_command: z.boolean().optional().describe("Approve diagnosing risky local command patterns"),
      },
      run: async (input) => {
        const serverId = String(input.id);
        const entry = getServer(serverId);
        if (!entry) return errorContent(`Server "${serverId}" not found.`);
        return jsonContent(await diagnoseServer(entry, { localCommandConsent: localConsent(input) }));
      },
    },
    {
      name: "list_machines",
      description: "List registered fleet machines",
      paramsSchema: {
        enabled_only: z.boolean().optional().describe("When true, only return enabled machines"),
      },
      run: ({ enabled_only }) => jsonContent(listMachines().filter((machine) => (enabled_only === true ? machine.enabled : true))),
    },
    {
      name: "add_machine",
      description: "Register a machine for fleet health checks and installs",
      paramsSchema: {
        host: z.string().describe("Hostname or SSH target"),
        id: z.string().optional().describe("Stable machine ID"),
        name: z.string().optional().describe("Display name"),
        username: z.string().optional().describe("SSH username"),
        port: z.number().int().min(1).max(65535).optional().describe("SSH port"),
        platform: z.enum(["linux", "darwin", "unknown"]).optional().describe("Machine platform"),
        arch: z.enum(["arm64", "x64", "unknown"]).optional().describe("Machine architecture"),
        bun_path: z.string().optional().describe("Explicit path to bun on the remote machine"),
        npm_path: z.string().optional().describe("Explicit path to npm on the remote machine"),
        installer: z.enum(["auto", "bun", "npm"]).optional().describe("Preferred installer"),
        ssh_key_path: z.string().optional().describe("SSH private key path"),
        enabled: z.boolean().optional().describe("Whether the machine should be enabled"),
      },
      run: ({ host, id, name, username, port, platform, arch, bun_path, npm_path, installer, ssh_key_path, enabled }) => jsonContent(addMachine({
        host: String(host),
        id: typeof id === "string" ? id : undefined,
        name: typeof name === "string" ? name : undefined,
        username: typeof username === "string" ? username : undefined,
        port: typeof port === "number" ? port : undefined,
        platform: platform as Parameters<typeof addMachine>[0]["platform"],
        arch: arch as Parameters<typeof addMachine>[0]["arch"],
        bun_path: typeof bun_path === "string" ? bun_path : undefined,
        npm_path: typeof npm_path === "string" ? npm_path : undefined,
        installer: installer as Parameters<typeof addMachine>[0]["installer"],
        ssh_key_path: typeof ssh_key_path === "string" ? ssh_key_path : undefined,
        enabled: typeof enabled === "boolean" ? enabled : undefined,
      })),
    },
    {
      name: "remove_machine",
      description: "Remove a registered machine",
      paramsSchema: { id: z.string().describe("Machine ID to remove") },
      run: ({ id }) => {
        const machineId = String(id);
        const machine = getRegisteredMachine(machineId);
        if (!machine) return errorContent(`Machine "${machineId}" not found.`);
        removeRegisteredMachine(machineId);
        return jsonContent({ removed: true, machine });
      },
    },
    {
      name: "seed_default_machines",
      description: "Seed the standard spark/apple machine inventory",
      paramsSchema: {},
      run: () => jsonContent(seedDefaultMachines()),
    },
    {
      name: "list_hasna_mcp_catalog",
      description: "List the discovered @hasna MCP package catalog",
      paramsSchema: {
        packages: z.array(z.string()).optional().describe("Optional package-name filter"),
        refresh: z.boolean().optional().describe("Refresh npm metadata instead of using cache"),
      },
      run: async ({ packages, refresh }) => {
        const catalog = await listHasnaMcpCatalog({ refresh: refresh === true });
        const filtered = Array.isArray(packages) && packages.length > 0
          ? catalog.filter((entry) => packages.map(String).includes(entry.name))
          : catalog;
        return jsonContent(filtered);
      },
    },
    {
      name: "fleet_health",
      description: "Run fleet-wide MCP health checks across registered machines",
      paramsSchema: {
        machine_ids: z.array(z.string()).optional().describe("Optional machine IDs to check"),
        packages: z.array(z.string()).optional().describe("Optional @hasna package-name filter"),
        refresh_catalog: z.boolean().optional().describe("Refresh npm metadata before checking"),
        timeout_ms: z.number().int().min(1000).optional().describe("Remote timeout in milliseconds"),
      },
      run: async ({ machine_ids, packages, refresh_catalog, timeout_ms }) => jsonContent(await runFleetHealthCheck({
        machineIds: Array.isArray(machine_ids) ? machine_ids.map(String) : undefined,
        packages: Array.isArray(packages) ? packages.map(String) : undefined,
        refreshCatalog: refresh_catalog === true,
        timeoutMs: typeof timeout_ms === "number" ? timeout_ms : undefined,
      })),
    },
    {
      name: "fleet_install",
      description: "Batch-install missing or outdated @hasna MCP packages across machines",
      paramsSchema: {
        machine_ids: z.array(z.string()).optional().describe("Optional machine IDs to target"),
        packages: z.array(z.string()).optional().describe("Optional @hasna package-name filter"),
        mode: z.enum(["missing", "missing-or-outdated", "all"]).optional().describe("Install selection mode"),
        installer: z.enum(["auto", "bun", "npm"]).optional().describe("Override installer"),
        refresh_catalog: z.boolean().optional().describe("Refresh npm metadata before installing"),
        timeout_ms: z.number().int().min(1000).optional().describe("Remote timeout in milliseconds"),
      },
      run: async ({ machine_ids, packages, mode, installer, refresh_catalog, timeout_ms }) => jsonContent(await runFleetInstall({
        machineIds: Array.isArray(machine_ids) ? machine_ids.map(String) : undefined,
        packages: Array.isArray(packages) ? packages.map(String) : undefined,
        mode: mode === "missing" || mode === "missing-or-outdated" || mode === "all" ? mode : undefined,
        installer: installer === "auto" || installer === "bun" || installer === "npm" ? installer : undefined,
        refreshCatalog: refresh_catalog === true,
        timeoutMs: typeof timeout_ms === "number" ? timeout_ms : undefined,
      })),
    },
    {
      name: "send_feedback",
      description: "Send feedback about this service",
      paramsSchema: {
        message: z.string().describe("Feedback message"),
        email: z.string().optional().describe("Contact email (optional)"),
        category: z.enum(["bug", "feature", "general"]).optional().describe("Feedback category"),
      },
      run: ({ message, email, category }) => {
        const adapter = getAdapter();
        adapter.run(
          "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
          String(message),
          typeof email === "string" ? email : null,
          typeof category === "string" ? category : "general",
          VERSION,
        );
        return textContent("Feedback saved. Thank you!");
      },
    },
    {
      name: "register_agent",
      description: "Register an agent session. Returns agent_id. Auto-triggers a heartbeat.",
      paramsSchema: {
        name: z.string(),
        session_id: z.string().optional(),
      },
      run: ({ name, session_id }) => {
        const agentName = String(name);
        const existing = [...mcpsAgents.values()].find((agent) => agent.name === agentName);
        if (existing) {
          existing.last_seen_at = new Date().toISOString();
          if (typeof session_id === "string") existing.session_id = session_id;
          return jsonContent(existing);
        }
        const id = Math.random().toString(36).slice(2, 10);
        const agent: McpsAgent = {
          id,
          name: agentName,
          session_id: typeof session_id === "string" ? session_id : undefined,
          last_seen_at: new Date().toISOString(),
        };
        mcpsAgents.set(id, agent);
        return jsonContent(agent);
      },
    },
    {
      name: "heartbeat",
      description: "Update last_seen_at to signal agent is active.",
      paramsSchema: { agent_id: z.string() },
      run: ({ agent_id }) => {
        const agentId = String(agent_id);
        const agent = mcpsAgents.get(agentId);
        if (!agent) return errorContent(`Agent not found: ${agentId}`);
        agent.last_seen_at = new Date().toISOString();
        return jsonContent({ agent_id: agent.id, last_seen_at: agent.last_seen_at });
      },
    },
    {
      name: "set_focus",
      description: "Set active project context for this agent session.",
      paramsSchema: {
        agent_id: z.string(),
        project_id: z.string().optional(),
      },
      run: ({ agent_id, project_id }) => {
        const agentId = String(agent_id);
        const agent = mcpsAgents.get(agentId);
        if (!agent) return errorContent(`Agent not found: ${agentId}`);
        agent.project_id = typeof project_id === "string" ? project_id : undefined;
        return jsonContent({ agent_id: agent.id, project_id: agent.project_id ?? null });
      },
    },
    {
      name: "list_agents",
      description: "List all registered agents.",
      paramsSchema: {},
      run: () => jsonContent([...mcpsAgents.values()]),
    },
  ];

  return definitions.map((definition) => ({
    ...definition,
    inputSchema: zodRawShapeToJsonSchema(definition.paramsSchema),
  }));
}

export const tools = buildMcpTools();

export async function listTools(): Promise<McpsMcpToolDefinition[]> {
  return buildMcpTools();
}

export function registerMcpTools(
  server: McpServer,
  toolDefinitions: McpsMcpToolDefinition[] = buildMcpTools(),
): McpsMcpToolDefinition[] {
  for (const tool of toolDefinitions) {
    server.tool(tool.name, tool.description, tool.paramsSchema ?? {}, async (input) => tool.run(readRecord(input)));
  }
  return toolDefinitions;
}

function zodRawShapeToJsonSchema(shape: Record<string, z.ZodTypeAny>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, schema] of Object.entries(shape)) {
    properties[key] = zodSchemaToJsonSchema(schema);
    if (!isOptionalSchema(schema)) required.push(key);
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

function zodSchemaToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> | boolean {
  const def = (schema as any)._def;
  const typeName = String(def?.typeName ?? "");
  const description = schema.description ? { description: schema.description } : {};

  if (typeName === z.ZodFirstPartyTypeKind.ZodOptional || typeName === z.ZodFirstPartyTypeKind.ZodDefault) {
    return { ...asJsonSchemaObject(zodSchemaToJsonSchema(def.innerType)), ...description };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodNullable) {
    return { ...asJsonSchemaObject(zodSchemaToJsonSchema(def.innerType)), nullable: true, ...description };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodString) {
    return { type: "string", ...description };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodBoolean) {
    return { type: "boolean", ...description };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodUnknown || typeName === z.ZodFirstPartyTypeKind.ZodAny) {
    return Object.keys(description).length > 0 ? description : true;
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodNumber) {
    const checks = Array.isArray(def.checks) ? def.checks : [];
    const schemaJson: Record<string, unknown> = {
      type: checks.some((check: any) => check.kind === "int") ? "integer" : "number",
      ...description,
    };
    for (const check of checks) {
      if (check.kind === "min") schemaJson.minimum = check.value;
      if (check.kind === "max") schemaJson.maximum = check.value;
    }
    return schemaJson;
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodEnum) {
    return { type: "string", enum: def.values, ...description };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodArray) {
    return { type: "array", items: zodSchemaToJsonSchema(def.type), ...description };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodRecord) {
    const valueType = def.valueType ? zodSchemaToJsonSchema(def.valueType) : true;
    return { type: "object", additionalProperties: valueType, ...description };
  }

  if (typeName === z.ZodFirstPartyTypeKind.ZodObject) {
    const objectShape = typeof def.shape === "function" ? def.shape() : def.shape;
    return { ...zodRawShapeToJsonSchema(objectShape ?? {}), ...description };
  }

  return Object.keys(description).length > 0 ? description : {};
}

function asJsonSchemaObject(schema: Record<string, unknown> | boolean): Record<string, unknown> {
  return typeof schema === "boolean" ? {} : schema;
}

function isOptionalSchema(schema: z.ZodTypeAny): boolean {
  const def = (schema as any)._def;
  const typeName = String(def?.typeName ?? "");
  return typeName === z.ZodFirstPartyTypeKind.ZodOptional || typeName === z.ZodFirstPartyTypeKind.ZodDefault;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}
