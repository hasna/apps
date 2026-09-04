import { getDatabase } from "../db/database.js";
import { logActivity } from "../db/activity.js";
import type { ContactWithDetails } from "../types/index.js";

export const CONTACTS_AUTH_ENV = [
  "HASNA_CONTACTS_API_TOKENS",
  "OPEN_CONTACTS_API_TOKENS",
  "CONTACTS_API_TOKENS",
  "HASNA_CONTACTS_API_TOKEN",
  "OPEN_CONTACTS_API_TOKEN",
  "CONTACTS_API_TOKEN",
] as const;

export type ContactsScope =
  | "contacts:read"
  | "contacts:write"
  | "companies:read"
  | "companies:write"
  | "tags:read"
  | "tags:write"
  | "contacts:import"
  | "contacts:export"
  | "contacts:export:full"
  | "documents:read"
  | "images:read"
  | "images:write"
  | "mcp:access"
  | "stats:read";

export interface ContactsPrincipal {
  id: string;
  scopes: Set<string>;
  localDevelopment: boolean;
}

export interface ContactsAuthResult {
  ok: boolean;
  principal?: ContactsPrincipal;
  status?: number;
  message?: string;
}

export interface ContactsAuthContext {
  allowUnauthenticatedLoopback: boolean;
}

interface TokenRecord {
  token: string;
  scopes: Set<string>;
}

function parseTokenRecords(): TokenRecord[] {
  const records: TokenRecord[] = [];
  for (const name of CONTACTS_AUTH_ENV) {
    const raw = process.env[name];
    if (!raw) continue;
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const separator = trimmed.includes("=") ? "=" : trimmed.includes(":") ? ":" : null;
      if (!separator) {
        records.push({ token: trimmed, scopes: new Set(["*"]) });
        continue;
      }
      const separatorIndex = trimmed.indexOf(separator);
      const token = trimmed.slice(0, separatorIndex);
      const scopeText = trimmed.slice(separatorIndex + 1);
      if (!token?.trim()) continue;
      const scopes = (scopeText ?? "")
        .split(/[| ]/)
        .map((scope) => scope.trim())
        .filter(Boolean);
      records.push({ token: token.trim(), scopes: new Set(scopes.length > 0 ? scopes : ["*"]) });
    }
  }
  return records;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function allowUnauthenticatedLoopbackEnv(): boolean {
  return process.env["CONTACTS_ALLOW_UNAUTHENTICATED_LOOPBACK"] === "1";
}

export function isLoopbackBindHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(normalized);
}

export function hasScope(principal: ContactsPrincipal, required: ContactsScope): boolean {
  const prefix = required.split(":")[0];
  return principal.scopes.has("*") || principal.scopes.has(required) || principal.scopes.has(`${prefix}:*`);
}

export function authenticateContactsRequest(
  req: Request,
  required: ContactsScope,
  context: ContactsAuthContext = { allowUnauthenticatedLoopback: false },
): ContactsAuthResult {
  const configured = parseTokenRecords();
  const token = bearerToken(req) ?? req.headers.get("x-contacts-token");
  if (token) {
    const matched = configured.find((record) => record.token === token);
    if (!matched) return { ok: false, status: 401, message: "Invalid contacts token" };
    const principal: ContactsPrincipal = { id: "api-token", scopes: matched.scopes, localDevelopment: false };
    if (!hasScope(principal, required)) return { ok: false, status: 403, message: `Missing scope: ${required}` };
    return { ok: true, principal };
  }

  if (configured.length === 0 && context.allowUnauthenticatedLoopback) {
    return {
      ok: true,
      principal: { id: "local-loopback", scopes: new Set(["*"]), localDevelopment: true },
    };
  }

  return { ok: false, status: 401, message: "Contacts API token required" };
}

export function auditServerAccess(
  action: string,
  details: Record<string, unknown>,
  principal?: ContactsPrincipal,
): void {
  try {
    logActivity(getDatabase(), {
      action,
      details: JSON.stringify({
        principal: principal?.id ?? "unknown",
        local_development: Boolean(principal?.localDevelopment),
        ...details,
      }),
    });
  } catch {
    // Audit should not turn an otherwise valid request into a data outage.
  }
}

function redactValue(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return [];
  if (typeof value === "object") return {};
  return "[redacted]";
}

export function redactContactForExport(contact: ContactWithDetails): ContactWithDetails {
  return {
    ...contact,
    birthday: null,
    notes: contact.notes ? "[redacted]" : contact.notes,
    emails: [],
    phones: [],
    addresses: [],
    social_profiles: [],
    custom_fields: redactValue(contact.custom_fields) as Record<string, unknown>,
    company: contact.company
      ? {
          ...contact.company,
          notes: contact.company.notes ? "[redacted]" : contact.company.notes,
          custom_fields: redactValue(contact.company.custom_fields) as Record<string, unknown>,
        }
      : null,
  };
}
