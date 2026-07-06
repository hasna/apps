import type { AuthorizationRole } from "../services/authorization.js";

export const apiScopes = [
  "billing:read",
  "billing:write",
  "billing:export",
  "dunning:run",
  "billing:admin",
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
  knownRoles: [
    "system",
    "owner",
    "admin",
    "billing_manager",
    "dunning_operator",
    "integration",
    "auditor",
    "readonly",
  ],
  roleScopes: {
    system: allScopes,
    owner: allScopes,
    admin: allScopes,
    billing_manager: ["billing:read", "billing:write", "billing:export", "dunning:run"],
    dunning_operator: ["billing:read", "dunning:run"],
    integration: ["billing:read", "billing:write"],
    auditor: ["billing:read", "billing:export"],
    readonly: ["billing:read"],
  },
  actionScope: {
    read: "billing:read",
    write: "billing:write",
    run: "dunning:run",
    admin: "billing:admin",
    export: "billing:export",
  },
  defaultAction: "billing:admin",
  env: {
    apiKey: ["HASNA_BILLING_API_KEY", "BILLING_API_KEY"],
    credentials: ["HASNA_BILLING_API_CREDENTIALS", "BILLING_API_CREDENTIALS"],
  },
};
