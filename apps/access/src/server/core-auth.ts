import { timingSafeEqual } from "node:crypto";
import { AUTH_CONSTANTS } from "./core-auth-constants.js";
import type { AuthorizationContext } from "../services/authorization-scopes.js";
import type { AuthorizationRole } from "../services/authorization.js";
import { verifyToken } from "./core-domain/tokens.js";

function aliases(env: Record<string, string | undefined>, names: string[]): string | undefined {
  const present = names.filter(name => env[name] !== undefined).map(name => env[name]!);
  if (present.some(value => !value || value !== value.trim()) || new Set(present).size > 1) throw new Error(`Invalid or conflicting server credential configuration: ${names.join(", ")}.`);
  return present[0];
}

function strings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) throw new Error("Invalid server credential scope or entity list.");
  return [...value];
}

export function createCoreAuthenticator(env: Record<string, string | undefined> = process.env) {
  const single = aliases(env, ["HASNA_ACCESS_API_KEY", "ACCESS_API_KEY"]);
  const json = aliases(env, ["HASNA_ACCESS_API_CREDENTIALS", "ACCESS_API_CREDENTIALS"]);
  const entries: Array<{ token: string; context: AuthorizationContext }> = [];
  if (single) {
    if (/[\s\x00-\x1f\x7f]/.test(single)) throw new Error("Invalid server API credential.");
    entries.push({ token: single, context: { actor_id: "legacy-api-key", roles: ["owner"], scopes: [...AUTH_CONSTANTS.apiScopes], entity_ids: [] } });
  }
  if (json) {
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { throw new Error("Invalid server API credential JSON."); }
    const credentials = Array.isArray(parsed) ? parsed : [parsed];
    for (const raw of credentials) {
      if (!raw || typeof raw !== "object") throw new Error("Invalid server API credential record.");
      const value = raw as Record<string, unknown>;
      const token = value.token ?? value.key;
      if (typeof token !== "string" || !token || /[\s\x00-\x1f\x7f]/.test(token) || (value.token !== undefined && value.key !== undefined && value.token !== value.key) || typeof value.id !== "string" || !value.id) throw new Error("Invalid server API credential record.");
      const roles = value.roles === undefined ? ["integration"] : strings(value.roles);
      if (roles.some(role => !AUTH_CONSTANTS.knownRoles.includes(role as AuthorizationRole))) throw new Error("Invalid server credential role.");
      const scopes = value.scopes === undefined ? [...new Set(roles.flatMap(role => AUTH_CONSTANTS.roleScopes[role as AuthorizationRole]))] : strings(value.scopes);
      if (scopes.some(scope => !AUTH_CONSTANTS.apiScopes.includes(scope as never))) throw new Error("Invalid server credential scope.");
      if (value.revoked === true) continue;
      if (value.expires_at !== undefined && (typeof value.expires_at !== "string" || !Number.isFinite(Date.parse(value.expires_at)))) throw new Error("Invalid credential expiry.");
      const entityIds = [...strings(value.entity_ids), ...strings(value.org_ids)];
      for (const key of ["entity_id", "org_id"]) if (value[key] !== undefined) {
        if (typeof value[key] !== "string" || !value[key]) throw new Error("Invalid credential entity.");
        entityIds.push(value[key] as string);
      }
      entries.push({ token, context: { actor_id: typeof value.actor_id === "string" ? value.actor_id : `api_key:${value.id}`, roles: roles as AuthorizationRole[], scopes, entity_ids: entityIds }, ...(value.expires_at ? { expiresAt: Date.parse(value.expires_at as string) } : {}) });
    }
  }
  if (!entries.length) throw new Error("Access server requires configured API credentials.");
  if (new Set(entries.map(entry => entry.token)).size !== entries.length) throw new Error("Server credential declarations must not assign conflicting identities to one bearer token.");
  return async (request: Request): Promise<AuthorizationContext | null> => {
    const auth = request.headers.get("Authorization") ?? "";
    if (!/^Bearer [^\s]+$/.test(auth)) return null;
    const token = auth.slice(7);
    const bytes = Buffer.from(token);
    for (const entry of entries) {
      const expiresAt = (entry as { expiresAt?: number }).expiresAt;
      if (expiresAt !== undefined && expiresAt <= Date.now()) continue;
      const expected = Buffer.from(entry.token);
      if (bytes.length === expected.length && timingSafeEqual(bytes, expected)) return structuredClone(entry.context);
    }
    if (token.split(".").length !== 3) return null;
    try {
      const verified = await verifyToken(token);
      return { actor_id: verified.identity_id, roles: [], scopes: verified.scopes, entity_ids: verified.entity_ids };
    } catch { return null; }
  };
}
