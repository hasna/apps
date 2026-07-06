/**
 * Per-app authorization domain NAMES (BUILD-SPEC §6.3 / §10.1). This is the ONLY
 * file that differs between the 9 apps' security stacks — `authorization.ts` is
 * byte-identical everywhere and imports the names from here. It exports EXACTLY
 * four members: the ACTION union, the ROLE union (which MUST include the three
 * reserved roles "system" | "owner" | "admin"), the `allActions` array, and the
 * `rolePermissions` role→action map (system/owner/admin get every action; each
 * domain role gets its narrower set).
 */

export type AuthorizationAction = "read" | "write" | "recommend" | "export" | "admin";

export type AuthorizationRole =
  | "system"
  | "owner"
  | "admin"
  | "treasurer"
  | "analyst"
  | "auditor"
  | "integration";

export const allActions: AuthorizationAction[] = ["read", "write", "recommend", "export", "admin"];

export const rolePermissions: Record<AuthorizationRole, Set<AuthorizationAction>> = {
  system: new Set(allActions),
  owner: new Set(allActions),
  admin: new Set(allActions),
  treasurer: new Set(["read", "write", "recommend", "export"]),
  analyst: new Set(["read", "recommend"]),
  auditor: new Set(["read", "export"]),
  integration: new Set(["read", "write"]),
};
