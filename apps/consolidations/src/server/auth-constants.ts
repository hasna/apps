import type { AuthorizationRole } from "../services/authorization.js";

// PER-APP domain NAMES only. This is the ONLY file that differs between the 9
// apps; `./auth.js` (the MECHANISM) is byte-identical everywhere and imports
// from here. Carries the domain scope/role names, the env-var names, and an
// optional token-verify hook (consolidations is NOT a token issuer, so it is
// omitted).

export const apiScopes = [
  "consolidations:read",
  "consolidations:write",
  "consolidations:run",
  "consolidations:finalize",
  "consolidations:export",
  "storage:admin",
  "org:admin",
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
  knownRoles: ["system", "owner", "admin", "controller", "analyst", "auditor", "integration", "viewer"],
  roleScopes: {
    system: allScopes,
    owner: allScopes,
    admin: allScopes,
    controller: [
      "consolidations:read",
      "consolidations:write",
      "consolidations:run",
      "consolidations:finalize",
      "consolidations:export",
    ],
    analyst: ["consolidations:read", "consolidations:write", "consolidations:run", "consolidations:export"],
    auditor: ["consolidations:read", "consolidations:export"],
    integration: ["consolidations:read", "consolidations:write"],
    viewer: ["consolidations:read"],
  },
  actionScope: {
    read: "consolidations:read",
    write: "consolidations:write",
    run: "consolidations:run",
    finalize: "consolidations:finalize",
    export: "consolidations:export",
    admin: "storage:admin",
  },
  defaultAction: "org:admin",
  env: {
    apiKey: ["HASNA_CONSOLIDATIONS_API_KEY", "CONSOLIDATIONS_API_KEY"],
    credentials: ["HASNA_CONSOLIDATIONS_API_CREDENTIALS", "CONSOLIDATIONS_API_CREDENTIALS"],
  },
};
