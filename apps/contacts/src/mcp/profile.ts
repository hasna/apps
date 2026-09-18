export type ContactsMcpProfile = "core" | "full";

export const CONTACTS_MCP_PROFILE_ENV = "HASNA_CONTACTS_MCP_PROFILE";
/** Full profile = 189 application tools plus contacts_connection_status. Pinned by profile.test.ts. */
export const CONTACTS_FULL_TOOL_COUNT = 190;

export const CONTACTS_CORE_TOOL_NAMES = [
  "create_contact",
  "get_contact",
  "update_contact",
  "delete_contact",
  "list_contacts",
  "search_contacts",
  "find_or_create_contact",
  "upsert_contact",
  "get_contact_by_email",
  "add_email_to_contact",
  "add_phone_to_contact",
  "create_company",
  "get_company",
  "update_company",
  "delete_company",
  "list_companies",
  "search_companies",
  "create_tag",
  "list_tags",
  "add_tag_to_contact",
  "remove_tag_from_contact",
  "add_relationship",
  "list_relationships",
  "delete_relationship",
  "get_contact_brief",
  "get_contact_timeline",
  "get_recent_contact_events",
  "send_feedback",
  "contacts_connection_status",
  "search_tools",
  "describe_tools",
] as const;

const CORE_TOOLS = new Set<string>(CONTACTS_CORE_TOOL_NAMES);

export function resolveContactsMcpProfile(
  argv: readonly string[] = [],
  env: Record<string, string | undefined> = process.env,
  defaultProfile: ContactsMcpProfile = "core",
): ContactsMcpProfile {
  let cliValue: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--mcp-profile") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error("--mcp-profile requires core or full");
      if (cliValue !== undefined) throw new Error("--mcp-profile may be provided only once");
      cliValue = value;
      index += 1;
    } else if (arg.startsWith("--mcp-profile=")) {
      if (cliValue !== undefined) throw new Error("--mcp-profile may be provided only once");
      cliValue = arg.slice("--mcp-profile=".length);
    }
  }
  const value = (cliValue ?? env[CONTACTS_MCP_PROFILE_ENV] ?? defaultProfile).trim().toLowerCase();
  if (value === "core" || value === "full") return value;
  throw new Error(`Invalid ${CONTACTS_MCP_PROFILE_ENV} value ${JSON.stringify(value)}: expected core or full`);
}

export function shouldRegisterContactsTool(name: string, profile: ContactsMcpProfile): boolean {
  return profile === "full" || CORE_TOOLS.has(name);
}
