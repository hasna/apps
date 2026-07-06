// Per-app scope/role NAMES for fleet (the ONLY per-app difference in the security
// stack — see authorization.ts). Exports exactly four members: the action union,
// the role union (which MUST include the reserved "system" | "owner" | "admin"),
// the allActions list, and the role -> action permission map. authorization.ts
// re-exports these so all downstream code imports from "./authorization.js".

export type AuthorizationAction = "read" | "write" | "export" | "admin" | "storage_admin";

export type AuthorizationRole =
  | "system"
  | "owner"
  | "admin"
  | "editor"
  | "viewer"
  | "integration"
  | "auditor";

export const allActions: AuthorizationAction[] = ["read", "write", "export", "admin", "storage_admin"];

export const rolePermissions: Record<AuthorizationRole, Set<AuthorizationAction>> = {
  system: new Set(allActions),
  owner: new Set(allActions),
  admin: new Set(allActions),
  editor: new Set(["read", "write", "export"]),
  viewer: new Set(["read"]),
  integration: new Set(["read"]),
  auditor: new Set(["read", "export"]),
};
