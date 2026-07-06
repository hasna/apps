/**
 * Per-app domain NAMES for the copy-verbatim security stack (BUILD-SPEC §6.3 /
 * §10.1). This is the ONLY file that differs between apps: `authorization.ts` is
 * byte-identical everywhere and imports the four members below. The reserved roles
 * "system" | "owner" | "admin" MUST be present (SYSTEM_AUTHORIZATION_CONTEXT
 * hardcodes roles: ["system"], and roleAllows/scopesForRoles index rolePermissions
 * by role); each of those three grants the full action set.
 */

export type AuthorizationAction = "read" | "write" | "lifecycle" | "export" | "admin";

export type AuthorizationRole =
  | "system"
  | "owner"
  | "admin"
  | "hr_manager"
  | "recruiter"
  | "manager"
  | "member"
  | "auditor"
  | "integration";

export const allActions: AuthorizationAction[] = ["read", "write", "lifecycle", "export", "admin"];

export const rolePermissions: Record<AuthorizationRole, Set<AuthorizationAction>> = {
  system: new Set(allActions),
  owner: new Set(allActions),
  admin: new Set(allActions),
  hr_manager: new Set(["read", "write", "lifecycle", "export"]),
  recruiter: new Set(["read", "write"]),
  manager: new Set(["read", "write"]),
  member: new Set(["read"]),
  auditor: new Set(["read", "export"]),
  integration: new Set(["read", "write", "export"]),
};
