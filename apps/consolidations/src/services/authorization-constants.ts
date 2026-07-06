// Per-app domain NAMES only (BUILD-SPEC §6.3 / §10.1). This is the ONLY file that
// differs between apps; the authorization.ts MECHANISM that imports it is
// byte-identical across all 9 apps. Exports exactly four members and nothing else.

export type AuthorizationAction = "read" | "write" | "run" | "finalize" | "export" | "admin";

export type AuthorizationRole =
  | "system"
  | "owner"
  | "admin"
  | "controller"
  | "analyst"
  | "auditor"
  | "integration"
  | "viewer";

export const allActions: AuthorizationAction[] = ["read", "write", "run", "finalize", "export", "admin"];

export const rolePermissions: Record<AuthorizationRole, Set<AuthorizationAction>> = {
  system: new Set(allActions),
  owner: new Set(allActions),
  admin: new Set(allActions),
  controller: new Set(["read", "write", "run", "finalize", "export"]),
  analyst: new Set(["read", "write", "run", "export"]),
  auditor: new Set(["read", "export"]),
  integration: new Set(["read", "write"]),
  viewer: new Set(["read"]),
};
