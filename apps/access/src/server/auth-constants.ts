// src/server/auth-constants.ts  (PER-APP — the only file that differs)
import type { AuthorizationRole } from "../services/authorization.js";
import { verifyToken } from "../services/tokens.js";

export const apiScopes = [
  "access:read",
  "access:write",
  "identity:admin",
  "credential:admin",
  "scope:grant",
  "elevation:approve",
  "review:manage",
  "revoke:execute",
  "token:issue",
  "storage:admin",
  "org:admin",
] as const;
export type ApiScope = (typeof apiScopes)[number];

export interface AuthConstants {
  apiScopes: readonly ApiScope[];
  knownRoles: AuthorizationRole[];
  roleScopes: Record<AuthorizationRole, ApiScope[]>; // role -> API scopes (union grant)
  actionScope: Record<string, ApiScope>; // authz action -> required scope
  defaultAction: ApiScope; // deny-safe fallback
  env: { apiKey: string[]; credentials: string[] }; // legacy key + credentials env names
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
  knownRoles: ["system", "owner", "admin", "identity_admin", "approver", "issuer", "auditor", "integration"],
  roleScopes: {
    system: allScopes,
    owner: allScopes,
    admin: allScopes,
    identity_admin: [
      "access:read",
      "access:write",
      "identity:admin",
      "credential:admin",
      "scope:grant",
      "revoke:execute",
      "storage:admin",
    ],
    approver: ["access:read", "elevation:approve"],
    issuer: ["access:read", "token:issue", "revoke:execute"],
    auditor: ["access:read", "review:manage"],
    integration: ["access:read", "access:write"],
  },
  actionScope: {
    read: "access:read",
    write: "access:write",
    admin: "identity:admin",
    approve: "elevation:approve",
    issue: "token:issue",
    revoke: "revoke:execute",
    review: "review:manage",
    export: "storage:admin",
  },
  defaultAction: "org:admin",
  env: {
    apiKey: ["HASNA_ACCESS_API_KEY", "ACCESS_API_KEY"],
    credentials: ["HASNA_ACCESS_API_CREDENTIALS", "ACCESS_API_CREDENTIALS"],
  },
  // access is the cohort token issuer — wire its own signed-bearer verifier.
  verifyToken,
};
