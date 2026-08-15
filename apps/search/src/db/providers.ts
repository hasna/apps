import type { Database } from "bun:sqlite";
import { getDb } from "./database.js";
import { hasReadyRoot } from "../lib/local/indexer.js";
import { type ProviderConfig, type SearchProviderName, LOCAL_PROVIDER_NAMES } from "../types/index.js";

export type ProviderConfigurationSource = "env" | "local-index" | "none";

export interface ProviderConfigurationStatus {
  configured: boolean;
  source: ProviderConfigurationSource;
  env?: string;
  reason: string;
}

interface ProviderRow {
  name: string;
  enabled: number;
  api_key_env: string;
  rate_limit: number;
  last_used_at: string | null;
  metadata: string;
}

function rowToProvider(row: ProviderRow): ProviderConfig {
  return {
    name: row.name as SearchProviderName,
    enabled: row.enabled === 1,
    apiKeyEnv: row.api_key_env,
    rateLimit: row.rate_limit,
    lastUsedAt: row.last_used_at,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  };
}

export function getProvider(name: string, db?: Database): ProviderConfig | null {
  const d = db ?? getDb();
  const row = d.prepare("SELECT * FROM providers WHERE name = ?").get(name) as ProviderRow | null;
  return row ? rowToProvider(row) : null;
}

export function listProviders(db?: Database): ProviderConfig[] {
  const d = db ?? getDb();
  const rows = d.prepare("SELECT * FROM providers ORDER BY name").all() as ProviderRow[];
  return rows.map(rowToProvider);
}

export function enableProvider(name: string, db?: Database): boolean {
  const d = db ?? getDb();
  const result = d.prepare("UPDATE providers SET enabled = 1 WHERE name = ?").run(name);
  return result.changes > 0;
}

export function disableProvider(name: string, db?: Database): boolean {
  const d = db ?? getDb();
  const result = d.prepare("UPDATE providers SET enabled = 0 WHERE name = ?").run(name);
  return result.changes > 0;
}

export function updateProvider(
  name: string,
  updates: { apiKeyEnv?: string; rateLimit?: number; metadata?: Record<string, unknown> },
  db?: Database,
): boolean {
  const d = db ?? getDb();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.apiKeyEnv !== undefined) {
    sets.push("api_key_env = ?");
    params.push(updates.apiKeyEnv);
  }
  if (updates.rateLimit !== undefined) {
    if (!Number.isInteger(updates.rateLimit) || updates.rateLimit < 0) {
      throw new Error("rateLimit must be an integer >= 0");
    }
    sets.push("rate_limit = ?");
    params.push(updates.rateLimit);
  }
  if (updates.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(updates.metadata));
  }

  if (sets.length === 0) return false;

  params.push(name);
  const result = d
    .prepare(`UPDATE providers SET ${sets.join(", ")} WHERE name = ?`)
    .run(...(params as [string, ...string[]]));
  return result.changes > 0;
}

export function updateProviderLastUsed(name: string, db?: Database): void {
  const d = db ?? getDb();
  const now = new Date().toISOString();
  d.prepare("UPDATE providers SET last_used_at = ? WHERE name = ?").run(now, name);
}

export function getProviderConfigurationStatus(provider: ProviderConfig): ProviderConfigurationStatus {
  if (LOCAL_PROVIDER_NAMES.has(provider.name)) {
    const configured = hasReadyRoot();
    return {
      configured,
      source: "local-index",
      reason: configured ? "local index has at least one ready root" : "no index roots ready",
    };
  }

  if (!provider.apiKeyEnv) {
    return {
      configured: true,
      source: "none",
      reason: "no API key required",
    };
  }

  const configured = Boolean(Bun.env[provider.apiKeyEnv]?.trim());
  return {
    configured,
    source: "env",
    env: provider.apiKeyEnv,
    reason: configured ? `configured via ${provider.apiKeyEnv}` : `missing ${provider.apiKeyEnv}`,
  };
}

export function isProviderConfigured(provider: ProviderConfig): boolean {
  return getProviderConfigurationStatus(provider).configured;
}
