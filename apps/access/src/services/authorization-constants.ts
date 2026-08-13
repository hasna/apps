/**
 * Per-app domain NAMES for the copy-verbatim security stack. This is the ONLY
 * file that differs between apps — `authorization.ts` imports these four members
 * and is otherwise byte-identical across the 9 apps (BUILD-SPEC §6.3 / §10.1).
 *
 * The role union MUST include the three reserved roles "system" | "owner" |
 * "admin" (SYSTEM_AUTHORIZATION_CONTEXT hardcodes roles: ["system"]; roleAllows/
 * scopesForRoles index rolePermissions by role). system/owner/admin each grant
 * the full action set; every domain role gets its narrower set.
 */

export type AuthorizationAction =
  | "read"
  | "write"
  | "admin"
  | "approve"
  | "issue"
  | "revoke"
  | "review"
  | "export";

export type AuthorizationRole =
  | "system"
  | "owner"
  | "admin"
  | "identity_admin"
  | "approver"
  | "issuer"
  | "auditor"
  | "integration";

export const allActions: AuthorizationAction[] = [
  "read",
  "write",
  "admin",
  "approve",
  "issue",
  "revoke",
  "review",
  "export",
];

export const rolePermissions: Record<AuthorizationRole, Set<AuthorizationAction>> = {
  system: new Set(allActions),
  owner: new Set(allActions),
  admin: new Set(allActions),
  identity_admin: new Set(["read", "write", "admin", "revoke", "export"]),
  approver: new Set(["read", "approve"]),
  issuer: new Set(["read", "issue", "revoke"]),
  auditor: new Set(["read", "review", "export"]),
  integration: new Set(["read", "write"]),
};
