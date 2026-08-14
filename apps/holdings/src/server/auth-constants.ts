// Per-app domain NAMES for the IP portfolio app — the ONLY per-app module in the
// canonical transport-credential stack. `auth.ts` is byte-identical across all 9
// apps and imports from this file; downstream code never touches these names
// directly (it imports the resolved values from "./auth.js").
import type { AuthorizationRole } from "../services/authorization.js";

export const apiScopes = [
  "holdings:read",
  "holdings:write",
  "holdings:register",
  "holdings:renew",
  "holdings:export",
  "holdings:admin",
  "storage:admin",
] as const;
export type ApiScope = (typeof apiScopes)[number];

export interface AuthConstants {
  apiScopes: readonly ApiScope[];
  knownRoles: AuthorizationRole[];
  roleScopes: Record<AuthorizationRole, ApiScope[]>;
  actionScope: Record<string, ApiScope>;
  defaultAction: ApiScope;
  env: { apiKey: string[]; credentials: string[] };
  verifyToken?: (token: string) => {
    identity_id: string;
    jti: string;
    scopes: string[];
    entity_ids?: string[];
  };
}

const allScopes = [...apiScopes];
export const AUTH_CONSTANTS: AuthConstants = {
  apiScopes,
  knownRoles: ["system", "owner", "admin", "holdings_manager", "paralegal", "viewer", "auditor", "integration"],
  roleScopes: {
    system: allScopes,
    owner: allScopes,
    admin: allScopes,
    holdings_manager: ["holdings:read", "holdings:write", "holdings:register", "holdings:renew", "holdings:export"],
    paralegal: ["holdings:read", "holdings:write", "holdings:register", "holdings:renew"],
    viewer: ["holdings:read"],
    auditor: ["holdings:read", "holdings:export"],
    integration: ["holdings:read", "holdings:write", "holdings:export"],
  },
  actionScope: {
    read: "holdings:read",
    write: "holdings:write",
    register: "holdings:register",
    renew: "holdings:renew",
    export: "holdings:export",
    admin: "holdings:admin",
  },
  defaultAction: "holdings:admin",
  env: {
    apiKey: ["HASNA_HOLDINGS_API_KEY", "HOLDINGS_API_KEY"],
    credentials: ["HASNA_HOLDINGS_API_CREDENTIALS", "HOLDINGS_API_CREDENTIALS"],
  },
};
