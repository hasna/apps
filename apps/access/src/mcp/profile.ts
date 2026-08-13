/** MCP tool profiles (minimal | standard | full) filtered via ACCESS_PROFILE. */

export type Profile = "minimal" | "standard" | "full";

const MINIMAL = [
  // core reads + the primary create
  "list_identities",
  "get_identity",
  "list_credentials",
  "list_scopes",
  "list_elevations",
  "list_reviews",
  "list_requests",
  "list_tokens",
  "verify_token",
  "create_identity",
];

const STANDARD = [
  ...MINIMAL,
  "get_credential",
  "get_scope",
  "get_elevation",
  "get_review",
  "get_request",
  "get_token",
  "effective_scopes",
  "list_revocations",
  "list_audit",
  "register_credential",
  "grant_scope",
  "request_elevation",
  "approve_elevation",
  "schedule_review",
  "create_request",
  "approve_request",
  "start_review",
  "complete_review",
  "issue_token",
];

const FULL = [
  ...STANDARD,
  "update_identity",
  "suspend_identity",
  "retire_identity",
  "revoke_credential",
  "revoke_scope",
  "revoke_elevation",
  "expire_elevations",
  "cancel_review",
  "provision_request",
  "fail_request",
  "cancel_request",
  "execute_revocation",
  "revoke_token",
  "verify_audit",
];

export const PROFILE_TOOL_MAP: Record<Profile, Set<string>> = {
  minimal: new Set(MINIMAL),
  standard: new Set(STANDARD),
  full: new Set(FULL),
};

export function getProfile(): Profile {
  const env = (process.env["ACCESS_PROFILE"] || process.env["HASNA_ACCESS_PROFILE"] || "").toLowerCase();
  if (env === "minimal" || env === "standard" || env === "full") return env;
  return "full";
}

export function shouldRegisterTool(toolName: string): boolean {
  return PROFILE_TOOL_MAP[getProfile()].has(toolName);
}
