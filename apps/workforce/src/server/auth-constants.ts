import type { AuthorizationRole } from "../services/authorization.js";

export const apiScopes = [
  "workforce:read", "workforce:write", "workforce:lifecycle",
  "workforce:export", "workforce:admin", "storage:admin",
] as const;
export type ApiScope = (typeof apiScopes)[number];

export interface AuthConstants {
  apiScopes: readonly ApiScope[];
  knownRoles: AuthorizationRole[];
  roleScopes: Record<AuthorizationRole, ApiScope[]>;   // role -> API scopes (union grant)
  actionScope: Record<string, ApiScope>;               // authz action -> required scope
  defaultAction: ApiScope;                             // deny-safe fallback (e.g. <app>:admin)
  env: { apiKey: string[]; credentials: string[] };    // legacy key + credentials env names
  verifyToken?: (token: string) => {                   // ONLY the token-issuer app (access) sets this
    identity_id: string; jti: string; scopes: string[]; entity_ids?: string[];
  };
}

const allScopes = [...apiScopes];
export const AUTH_CONSTANTS: AuthConstants = {
  apiScopes,
  knownRoles: ["system","owner","admin","hr_manager","recruiter","manager","member","auditor","integration"],
  roleScopes: {
    system: allScopes, owner: allScopes, admin: allScopes,
    hr_manager: ["workforce:read","workforce:write","workforce:lifecycle","workforce:export"],
    recruiter:  ["workforce:read","workforce:write"],
    manager:    ["workforce:read","workforce:write"],
    member:     ["workforce:read"],
    auditor:    ["workforce:read","workforce:export"],
    integration:["workforce:read","workforce:write","workforce:export"],
  },
  actionScope: { read:"workforce:read", write:"workforce:write", lifecycle:"workforce:lifecycle",
                 export:"workforce:export", admin:"workforce:admin" },
  defaultAction: "workforce:admin",
  env: { apiKey: ["HASNA_WORKFORCE_API_KEY","WORKFORCE_API_KEY"],
         credentials: ["HASNA_WORKFORCE_API_CREDENTIALS","WORKFORCE_API_CREDENTIALS"] },
};
