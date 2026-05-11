import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { MCPS_DIR } from "./config.js";
import type { CredentialReference, CredentialReferenceMap, McpServerEntry } from "../types.js";

export class CredentialReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialReferenceError";
  }
}

const SECRET_KEY_PATTERN = /(?:^|[_-])(api[_-]?key|token|secret|password|passwd|credential|auth|private[_-]?key)(?:$|[_-])/i;
const SECRET_VALUE_PATTERN =
  /^(sk_(?:live|test)_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+|AIza[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

export const REDACTED_CREDENTIAL_VALUE = "<redacted>";

function normalizeKey(key: string): string {
  return key.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSecretLikeEnvKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function isSecretLikeValue(value: string): boolean {
  return SECRET_VALUE_PATTERN.test(value.trim());
}

export function normalizeCredentialRef(ref: CredentialReference): CredentialReference {
  const source = ref.source;
  if (source !== "env" && source !== "local-vault" && source !== "hosted") {
    throw new CredentialReferenceError(`Unsupported credential reference source: ${String(source)}`);
  }
  const name = ref.name?.trim();
  if (!name) {
    throw new CredentialReferenceError("Credential reference name is required");
  }
  return {
    source,
    name,
    required: ref.required !== false,
    ...(ref.description ? { description: ref.description } : {}),
  };
}

export function normalizeCredentialRefs(refs: CredentialReferenceMap | undefined): CredentialReferenceMap {
  const normalized: CredentialReferenceMap = {};
  for (const [rawKey, ref] of Object.entries(refs ?? {})) {
    const key = normalizeKey(rawKey);
    if (!key) throw new CredentialReferenceError("Credential reference env key is required");
    normalized[key] = normalizeCredentialRef(ref);
  }
  return normalized;
}

export function parseCredentialRefs(value: unknown): CredentialReferenceMap {
  if (!isRecord(value)) return {};
  const refs: CredentialReferenceMap = {};
  for (const [key, ref] of Object.entries(value)) {
    if (!isRecord(ref)) continue;
    const source = ref.source;
    const name = ref.name;
    if (
      (source === "env" || source === "local-vault" || source === "hosted") &&
      typeof name === "string" &&
      name.trim()
    ) {
      refs[key] = normalizeCredentialRef({
        source,
        name,
        required: typeof ref.required === "boolean" ? ref.required : true,
        description: typeof ref.description === "string" ? ref.description : undefined,
      });
    }
  }
  return refs;
}

export function normalizeLiteralEnv(env: Record<string, string> | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(env ?? {})) {
    const key = normalizeKey(rawKey);
    if (!key) continue;
    const value = String(rawValue);
    if (isSecretLikeEnvKey(key) || isSecretLikeValue(value)) {
      throw new CredentialReferenceError(
        `Refusing to store raw secret-like env value for "${key}". Use a credential reference instead.`,
      );
    }
    normalized[key] = value;
  }
  return normalized;
}

export function redactEnv(env: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    redacted[key] = isSecretLikeEnvKey(key) || isSecretLikeValue(value) ? REDACTED_CREDENTIAL_VALUE : value;
  }
  return redacted;
}

export function redactServerCredentials<T extends { env: Record<string, string>; credentialRefs?: CredentialReferenceMap }>(
  server: T,
): T {
  return {
    ...server,
    env: redactEnv(server.env),
    credentialRefs: normalizeCredentialRefs(server.credentialRefs),
  };
}

function readLocalVault(): Record<string, string> {
  const path = process.env.HASNA_MCPS_CREDENTIAL_VAULT_PATH ?? join(MCPS_DIR, "credentials.local.json");
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  if (!isRecord(parsed)) return {};
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

function resolveCredentialRef(envKey: string, ref: CredentialReference): string | undefined {
  if (ref.source === "env") {
    const value = process.env[ref.name];
    if (value === undefined && ref.required !== false) {
      throw new CredentialReferenceError(`Missing required environment credential "${ref.name}" for "${envKey}"`);
    }
    return value;
  }

  if (ref.source === "local-vault") {
    const value = readLocalVault()[ref.name];
    if (value === undefined && ref.required !== false) {
      throw new CredentialReferenceError(`Missing required local vault credential "${ref.name}" for "${envKey}"`);
    }
    return value;
  }

  if (ref.required !== false) {
    throw new CredentialReferenceError(
      `Hosted credential "${ref.name}" for "${envKey}" cannot be resolved by the local runtime`,
    );
  }
  return undefined;
}

export function resolveServerEnv(server: McpServerEntry): Record<string, string> {
  const resolved: Record<string, string> = { ...server.env };
  const refs = normalizeCredentialRefs(server.credentialRefs);
  for (const [envKey, ref] of Object.entries(refs)) {
    const value = resolveCredentialRef(envKey, ref);
    if (value !== undefined) resolved[envKey] = value;
  }
  return resolved;
}

export function credentialRefPlaceholders(refs: CredentialReferenceMap | undefined): Record<string, string> {
  const placeholders: Record<string, string> = {};
  for (const key of Object.keys(refs ?? {})) {
    placeholders[key] = REDACTED_CREDENTIAL_VALUE;
  }
  return placeholders;
}
