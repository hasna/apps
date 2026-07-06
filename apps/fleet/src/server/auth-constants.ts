// src/server/auth-constants.ts  (PER-APP — the ONLY file that differs across the
// 9 Hasna internal apps). Carries fleet's domain scope/role NAMES, env-var names,
// and (omitted here — fleet is not a token issuer) the optional verifyToken hook.
// The canonical ./auth.js imports from here and is byte-identical across apps.
import type { AuthorizationRole } from "../services/authorization.js";

export const apiScopes = [
  "fleet:read",
  "fleet:write",
  "fleet:export",
  "fleet:admin",
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
  knownRoles: ["system", "owner", "admin", "editor", "viewer", "integration", "auditor"],
  roleScopes: {
    system: allScopes,
    owner: allScopes,
    admin: allScopes,
    editor: ["fleet:read", "fleet:write", "fleet:export"],
    viewer: ["fleet:read"],
    integration: ["fleet:read"],
    auditor: ["fleet:read", "fleet:export"],
  },
  actionScope: {
    read: "fleet:read",
    write: "fleet:write",
    export: "fleet:export",
    admin: "fleet:admin",
    storage_admin: "storage:admin",
  },
  defaultAction: "fleet:admin",
  env: {
    apiKey: ["HASNA_FLEET_API_KEY", "FLEET_API_KEY"],
    credentials: ["HASNA_FLEET_API_CREDENTIALS", "FLEET_API_CREDENTIALS", "HASNA_FLEET_API_KEYS"],
  },
};
