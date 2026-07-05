import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCloudRuntimeReferenceStatus, type CloudRuntimeReferenceStatus } from "./cloud-runtime.js";
import { getDb } from "./db.js";
import type { SecretType } from "./types.js";

const PACKAGE_NAME = "@hasna/secrets";
const FALLBACK_PACKAGE_VERSION = "0.1.31";
const SECRET_TYPES: SecretType[] = ["api_key", "password", "token", "credential", "other"];
const USER_TYPES = ["human", "agent"] as const;

export interface SecretReferenceStatus {
  service: "secrets";
  schemaVersion: "1.0";
  package: {
    name: typeof PACKAGE_NAME;
    version: string;
  };
  dataDir: string;
  database: {
    path: string;
    exists: boolean;
    records: number;
  };
  env: {
    databasePath: {
      primary: "HASNA_SECRETS_DB_PATH";
      fallback: "OPEN_SECRETS_DB";
      active: "HASNA_SECRETS_DB_PATH" | "OPEN_SECRETS_DB" | null;
      configured: boolean;
      includesRawValue: false;
    };
  };
  counts: {
    secrets: number;
    byType: Record<SecretType, number>;
    withLabels: number;
    expired: number;
    expiringSoon: number;
    users: number;
    usersByType: Record<"human" | "agent", number>;
    auditEntries: number;
  };
  references: {
    opaqueStoreRef: string;
    secretKeyNamesIncluded: false;
    providerInventoryIncluded: false;
  };
  cloudRuntime: CloudRuntimeReferenceStatus;
  safety: {
    includesSecretValues: false;
    includesSecretKeys: false;
    includesProviderInventory: false;
    includesRawEnvValues: false;
    includesPrivateKeyMaterial: false;
    statusOutputIsMetadataOnly: true;
  };
}

interface SecretMetadataRow {
  type: string;
  label: string | null;
  expires_at: string | null;
}

interface UserMetadataRow {
  type: "human" | "agent";
}

export function getSecretReferenceStatus(options: { expiringSoonDays?: number } = {}): SecretReferenceStatus {
  const db = getDb();
  const databasePath = String((db as { filename?: string }).filename ?? "");
  const secretRows = db.prepare("SELECT type, label, expires_at FROM secrets").all() as SecretMetadataRow[];
  const userRows = db.prepare("SELECT type FROM users").all() as UserMetadataRow[];
  const auditEntries = Number((db.prepare("SELECT COUNT(*) as count FROM audit_log").get() as { count: number }).count);
  const now = Date.now();
  const expiringSoonMs = Math.max(1, options.expiringSoonDays ?? 14) * 86_400_000;

  const byType = Object.fromEntries(SECRET_TYPES.map((type) => [type, 0])) as Record<SecretType, number>;
  let withLabels = 0;
  let expired = 0;
  let expiringSoon = 0;

  for (const row of secretRows) {
    const type = SECRET_TYPES.includes(row.type as SecretType) ? row.type as SecretType : "other";
    byType[type] += 1;
    if (row.label) withLabels += 1;
    if (!row.expires_at) continue;
    const expiresAt = Date.parse(row.expires_at);
    if (Number.isNaN(expiresAt)) continue;
    if (expiresAt < now) expired += 1;
    else if (expiresAt - now <= expiringSoonMs) expiringSoon += 1;
  }

  const usersByType = Object.fromEntries(USER_TYPES.map((type) => [type, 0])) as Record<"human" | "agent", number>;
  for (const row of userRows) {
    if (row.type === "human" || row.type === "agent") usersByType[row.type] += 1;
  }

  return {
    service: "secrets",
    schemaVersion: "1.0",
    package: {
      name: PACKAGE_NAME,
      version: packageVersion(),
    },
    dataDir: redactConfiguredPath(dirname(databasePath), "~/.hasna/secrets", "<custom-data-dir>"),
    database: {
      path: redactConfiguredPath(databasePath, "~/.hasna/secrets/vault.db", "<custom-database-path>"),
      exists: existsSync(databasePath),
      records: secretRows.length,
    },
    env: {
      databasePath: {
        primary: "HASNA_SECRETS_DB_PATH",
        fallback: "OPEN_SECRETS_DB",
        active: activeDatabasePathEnv(),
        configured: Boolean(activeDatabasePathEnv()),
        includesRawValue: false,
      },
    },
    counts: {
      secrets: secretRows.length,
      byType,
      withLabels,
      expired,
      expiringSoon,
      users: userRows.length,
      usersByType,
      auditEntries,
    },
    references: {
      opaqueStoreRef: opaqueRef(databasePath || "default"),
      secretKeyNamesIncluded: false,
      providerInventoryIncluded: false,
    },
    cloudRuntime: getCloudRuntimeReferenceStatus(),
    safety: {
      includesSecretValues: false,
      includesSecretKeys: false,
      includesProviderInventory: false,
      includesRawEnvValues: false,
      includesPrivateKeyMaterial: false,
      statusOutputIsMetadataOnly: true,
    },
  };
}

export const getSecretsStatus = getSecretReferenceStatus;

function activeDatabasePathEnv(): "HASNA_SECRETS_DB_PATH" | "OPEN_SECRETS_DB" | null {
  if (process.env["HASNA_SECRETS_DB_PATH"]) return "HASNA_SECRETS_DB_PATH";
  if (process.env["OPEN_SECRETS_DB"]) return "OPEN_SECRETS_DB";
  return null;
}

function redactConfiguredPath(path: string, defaultDisplay: string, customDisplay: string): string {
  if (activeDatabasePathEnv()) return customDisplay;
  const defaultPath = join(homedir(), ".hasna", "secrets", "vault.db");
  const expected = defaultDisplay.endsWith("vault.db") ? defaultPath : dirname(defaultPath);
  if (path === expected) return defaultDisplay;
  return redactLocalPath(path, customDisplay);
}

function redactLocalPath(path: string, customDisplay: string): string {
  const home = homedir();
  if (!path) return "";
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return customDisplay;
}

function opaqueRef(value: string): string {
  return `secrets_${createHash("sha256").update(`open-secrets:${value}`).digest("hex").slice(0, 16)}`;
}

function packageVersion(): string {
  try {
    const path = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { version?: string };
    return parsed.version ?? FALLBACK_PACKAGE_VERSION;
  } catch {
    return FALLBACK_PACKAGE_VERSION;
  }
}
