import { getDb } from "./db.js";
import type {
  ProviderInstallFallback,
  ProviderProfile,
  ProviderProfileAuthType,
  ProviderProfileSource,
  ProviderProfileTokenMode,
  ProviderProfileTransport,
  ProviderSafetyMetadata,
  ProviderSourceProvenance,
  UpsertProviderProfileOptions,
} from "../types.js";

const TRANSPORTS = new Set<ProviderProfileTransport>(["stdio", "sse", "streamable-http"]);
const AUTH_TYPES = new Set<ProviderProfileAuthType>(["none", "oauth2", "api_key", "bearer_token", "custom"]);
const TOKEN_MODES = new Set<ProviderProfileTokenMode>(["none", "user", "workspace", "service"]);
const PROVENANCE_SOURCES = new Set<ProviderProfileSource>(["curated", "official-registry", "npm", "github", "manual"]);

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeId(id: string): string {
  const normalized = id.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(normalized)) {
    throw new Error("Provider profile id must be lowercase kebab-case");
  }
  return normalized;
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const scope of scopes ?? []) {
    const trimmed = scope.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function assertKnown<T extends string>(value: T, allowed: Set<T>, label: string): T {
  if (!allowed.has(value)) throw new Error(`Unknown provider profile ${label}: ${value}`);
  return value;
}

function normalizeProvenance(provenance: ProviderSourceProvenance): ProviderSourceProvenance {
  const source = assertKnown(provenance.source, PROVENANCE_SOURCES, "provenance source");
  return {
    source,
    sourceUrl: normalizeString(provenance.sourceUrl) ?? undefined,
    repositoryUrl: normalizeString(provenance.repositoryUrl) ?? undefined,
    packageName: normalizeString(provenance.packageName) ?? undefined,
    verifiedAt: normalizeString(provenance.verifiedAt) ?? undefined,
  };
}

function normalizeInstallFallback(fallback: ProviderInstallFallback | null | undefined): ProviderInstallFallback | null {
  if (!fallback) return null;
  const normalized: ProviderInstallFallback = {
    command: normalizeString(fallback.command) ?? undefined,
    args: Array.isArray(fallback.args) ? fallback.args.map((arg) => arg.trim()).filter(Boolean) : undefined,
    env: fallback.env && Object.keys(fallback.env).length > 0 ? fallback.env : undefined,
    packageName: normalizeString(fallback.packageName) ?? undefined,
    registryId: normalizeString(fallback.registryId) ?? undefined,
    url: normalizeString(fallback.url) ?? undefined,
  };
  return Object.values(normalized).some((value) => value !== undefined) ? normalized : null;
}

function parseRow(row: Record<string, unknown>): ProviderProfile {
  const installFallback = safeJsonParse<ProviderInstallFallback | null>(row.install_fallback as string, null);
  return {
    id: row.id as string,
    displayName: row.display_name as string,
    description: (row.description as string) || null,
    endpoint: (row.endpoint as string) || null,
    transport: row.transport as ProviderProfileTransport,
    authType: row.auth_type as ProviderProfileAuthType,
    scopes: safeJsonParse<string[]>(row.scopes as string, []),
    tokenMode: row.token_mode as ProviderProfileTokenMode,
    installFallback,
    docsUrl: (row.docs_url as string) || null,
    safety: safeJsonParse<ProviderSafetyMetadata>(row.safety as string, {}),
    provenance: safeJsonParse<ProviderSourceProvenance>(row.provenance as string, { source: "manual" }),
    enabled: (row.enabled as number | boolean) === 1 || row.enabled === true,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function upsertProviderProfile(opts: UpsertProviderProfileOptions): ProviderProfile {
  const db = getDb();
  const id = normalizeId(opts.id);
  const displayName = normalizeString(opts.displayName);
  if (!displayName) throw new Error("Provider profile displayName is required");

  const transport = assertKnown(opts.transport, TRANSPORTS, "transport");
  const authType = assertKnown(opts.authType, AUTH_TYPES, "auth type");
  const tokenMode = assertKnown(opts.tokenMode ?? "none", TOKEN_MODES, "token mode");
  const scopes = normalizeScopes(opts.scopes);
  const installFallback = normalizeInstallFallback(opts.installFallback);
  const provenance = normalizeProvenance(opts.provenance);
  const safety = opts.safety ?? {};
  const enabled = opts.enabled === false ? 0 : 1;

  const row = db
    .prepare(
      `INSERT INTO provider_profiles (
         id, display_name, description, endpoint, transport, auth_type, scopes,
         token_mode, install_fallback, docs_url, safety, provenance, enabled
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         description = excluded.description,
         endpoint = excluded.endpoint,
         transport = excluded.transport,
         auth_type = excluded.auth_type,
         scopes = excluded.scopes,
         token_mode = excluded.token_mode,
         install_fallback = excluded.install_fallback,
         docs_url = excluded.docs_url,
         safety = excluded.safety,
         provenance = excluded.provenance,
         enabled = excluded.enabled,
         updated_at = datetime('now')
       RETURNING *`
    )
    .get(
      id,
      displayName,
      normalizeString(opts.description),
      normalizeString(opts.endpoint),
      transport,
      authType,
      JSON.stringify(scopes),
      tokenMode,
      JSON.stringify(installFallback),
      normalizeString(opts.docsUrl),
      JSON.stringify(safety),
      JSON.stringify(provenance),
      enabled
    ) as Record<string, unknown>;

  return parseRow(row);
}

export function listProviderProfiles(options: { enabledOnly?: boolean } = {}): ProviderProfile[] {
  const db = getDb();
  const sql = options.enabledOnly
    ? "SELECT * FROM provider_profiles WHERE enabled = 1 ORDER BY display_name"
    : "SELECT * FROM provider_profiles ORDER BY display_name";
  return (db.prepare(sql).all() as Record<string, unknown>[]).map(parseRow);
}

export function getProviderProfile(id: string): ProviderProfile | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM provider_profiles WHERE id = ?").get(normalizeId(id)) as Record<string, unknown> | null;
  return row ? parseRow(row) : null;
}

export function removeProviderProfile(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM provider_profiles WHERE id = ?").run(normalizeId(id));
}

export function enableProviderProfile(id: string): ProviderProfile {
  return setProviderProfileEnabled(id, true);
}

export function disableProviderProfile(id: string): ProviderProfile {
  return setProviderProfileEnabled(id, false);
}

function setProviderProfileEnabled(id: string, enabled: boolean): ProviderProfile {
  const db = getDb();
  const row = db
    .prepare("UPDATE provider_profiles SET enabled = ?, updated_at = datetime('now') WHERE id = ? RETURNING *")
    .get(enabled ? 1 : 0, normalizeId(id)) as Record<string, unknown> | null;

  if (!row) {
    throw new Error(`Provider profile "${id}" not found`);
  }

  return parseRow(row);
}
