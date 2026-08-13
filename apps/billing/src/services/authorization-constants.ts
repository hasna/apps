/**
 * Per-app domain NAMES for @hasna/billing (BUILD-SPEC §6.3 / scope-constants
 * convention). This is the ONLY per-app authorization module — `authorization.ts`
 * is byte-identical across all 9 apps and imports the four members below. This
 * file exports NOTHING else. The reserved roles "system" | "owner" | "admin" MUST
 * be present (SYSTEM_AUTHORIZATION_CONTEXT hardcodes roles: ["system"], and
 * roleAllows/scopesForRoles index rolePermissions by role).
 */

export type AuthorizationAction = "read" | "write" | "run" | "admin" | "export";

export type AuthorizationRole =
  | "system"
  | "owner"
  | "admin"
  | "billing_manager"
  | "dunning_operator"
  | "integration"
  | "auditor"
  | "readonly";

export const allActions: AuthorizationAction[] = ["read", "write", "run", "admin", "export"];

export const rolePermissions: Record<AuthorizationRole, Set<AuthorizationAction>> = {
  system: new Set(allActions),
  owner: new Set(allActions),
  admin: new Set(allActions),
  billing_manager: new Set(["read", "write", "run", "export"]),
  dunning_operator: new Set(["read", "run"]),
  integration: new Set(["read", "write"]),
  auditor: new Set(["read", "export"]),
  readonly: new Set(["read"]),
};
