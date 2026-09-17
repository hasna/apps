export type FilesMcpProfile = "minimal" | "standard" | "full";

export const FILES_MCP_PROFILE_ENV = "HASNA_FILES_MCP_PROFILE";
export const FILES_MCP_PROFILE_ALIAS_ENV = "OPEN_FILES_MCP_PROFILE";

const MINIMAL_TOOLS = new Set([
  "list_sources",
  "list_files",
  "search_files",
  "get_file",
  "get_file_by_path",
  "recent_files",
  "find_duplicates",
  "get_stats",
  "list_tags",
  "list_collections",
  "get_collection",
  "list_projects",
  "get_project",
  "list_machines",
]);

const STANDARD_TOOLS = new Set([
  ...MINIMAL_TOOLS,
  "build_context_pack",
  "search_context_pack",
  "download_file",
  "get_file_url",
  "get_file_content",
  "extract_file_text",
  "extract_file_snapshot",
  "describe_file",
  "list_evidence_assets",
  "audit_evidence_asset",
  "list_agents",
  "get_file_history",
  "get_agent_activity",
  "get_session_activity",
]);

const LOCAL_ONLY_REDUCED_TOOLS = new Set([
  "build_context_pack",
  "search_context_pack",
]);

export function resolveFilesMcpProfile(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = [],
): FilesMcpProfile {
  const cliValues: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--profile") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("--profile requires minimal, standard, or full");
      }
      cliValues.push(value);
      index++;
    } else if (arg.startsWith("--profile=")) {
      cliValues.push(arg.slice("--profile=".length));
    }
  }
  if (cliValues.length > 1) throw new Error("--profile may be provided only once");
  const raw = cliValues[0]
    ?? env[FILES_MCP_PROFILE_ENV]
    ?? env[FILES_MCP_PROFILE_ALIAS_ENV]
    ?? "standard";
  if (raw === "minimal" || raw === "standard" || raw === "full") return raw;
  throw new Error(
    `Invalid ${FILES_MCP_PROFILE_ENV} value "${raw}": expected minimal, standard, or full`,
  );
}

/**
 * Reduced profiles advertise only tools selected by that profile and callable
 * under the current capability flags. The full profile preserves the legacy
 * inventory and its call-time denials for compatibility and diagnostics.
 */
export function shouldRegisterFilesMcpTool(options: {
  name: string;
  profile: FilesMcpProfile;
  capabilityAvailable: boolean;
  transport: "api" | "local";
}): boolean {
  if (options.profile === "full") return true;
  if (!options.capabilityAvailable) return false;
  if (options.transport === "api" && LOCAL_ONLY_REDUCED_TOOLS.has(options.name)) return false;
  return (options.profile === "minimal" ? MINIMAL_TOOLS : STANDARD_TOOLS).has(options.name);
}
