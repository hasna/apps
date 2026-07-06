// Per-app domain NAMES for the IP portfolio app — the ONLY per-app module in the
// security stack (BUILD-SPEC §6.3 / §10.1 scope-constants convention). `authorization.ts`
// is byte-identical across all 9 apps and imports these four members; downstream
// code never touches this file directly (it imports from "./authorization.js").

export type AuthorizationAction = "read" | "write" | "register" | "renew" | "export" | "admin";

export type AuthorizationRole =
  | "system"
  | "owner"
  | "admin"
  | "holdings_manager"
  | "paralegal"
  | "viewer"
  | "auditor"
  | "integration";

export const allActions: AuthorizationAction[] = ["read", "write", "register", "renew", "export", "admin"];

export const rolePermissions: Record<AuthorizationRole, Set<AuthorizationAction>> = {
  system: new Set(allActions),
  owner: new Set(allActions),
  admin: new Set(allActions),
  holdings_manager: new Set(["read", "write", "register", "renew", "export"]),
  paralegal: new Set(["read", "write", "register", "renew"]),
  viewer: new Set(["read"]),
  auditor: new Set(["read", "export"]),
  integration: new Set(["read", "write", "export"]),
};
