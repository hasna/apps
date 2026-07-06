import type { AuthorizationRole } from "../services/authorization.js";

export const apiScopes = [
  "treasury:read", "treasury:write", "treasury:recommend",
  "treasury:export", "treasury:admin", "storage:admin",
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
    identity_id: string; jti: string; scopes: string[]; entity_ids?: string[];
  };
}

const allScopes = [...apiScopes];
export const AUTH_CONSTANTS: AuthConstants = {
  apiScopes,
  knownRoles: ["system", "owner", "admin", "treasurer", "analyst", "auditor", "integration"],
  roleScopes: {
    system: allScopes, owner: allScopes, admin: allScopes,
    treasurer: ["treasury:read", "treasury:write", "treasury:recommend", "treasury:export"],
    analyst: ["treasury:read", "treasury:recommend"],
    auditor: ["treasury:read", "treasury:export"],
    integration: ["treasury:read", "treasury:write"],
  },
  actionScope: {
    read: "treasury:read", write: "treasury:write", recommend: "treasury:recommend",
    export: "treasury:export", admin: "treasury:admin",
  },
  defaultAction: "treasury:admin",
  env: {
    apiKey: ["HASNA_TREASURY_API_KEY", "TREASURY_API_KEY"],
    credentials: ["HASNA_TREASURY_API_CREDENTIALS", "TREASURY_API_CREDENTIALS"],
  },
};
