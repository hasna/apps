import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getStore } from "./store/index.js";
import type { SecretType } from "./types.js";

const PACKAGE_NAME = "@hasna/secrets";
const FALLBACK_PACKAGE_VERSION = "0.1.31";

export interface SecretReferenceStatus {
  service: "secrets";
  schemaVersion: "2.0";
  package: {
    name: typeof PACKAGE_NAME;
    version: string;
  };
  /** `local` (on-box sqlite) or `api` (cloud HTTP API). */
  mode: "local" | "api";
  /** Vault file path (local) or API origin (api). Never contains a key. */
  location: string;
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
  };
  safety: {
    includesSecretValues: false;
    includesSecretKeys: false;
    includesProviderInventory: false;
    includesRawEnvValues: false;
    includesPrivateKeyMaterial: false;
    statusOutputIsMetadataOnly: true;
  };
}

/**
 * Metadata-only status of the active vault (local sqlite or the cloud API).
 * Routes through the Store; never touches sqlite or the network directly and
 * never emits secret values or key names.
 */
export async function getSecretReferenceStatus(): Promise<SecretReferenceStatus> {
  const store = getStore();
  const descriptor = store.describe();
  const counts = await store.status();

  return {
    service: "secrets",
    schemaVersion: "2.0",
    package: { name: PACKAGE_NAME, version: packageVersion() },
    mode: descriptor.mode,
    location: redactLocation(descriptor),
    counts,
    references: { opaqueStoreRef: opaqueRef(descriptor.location || "default") },
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

function redactLocation(descriptor: { mode: "local" | "api"; location: string }): string {
  if (descriptor.mode === "api") return descriptor.location;
  return redactLocalPath(descriptor.location);
}

function redactLocalPath(path: string): string {
  const home = homedir();
  if (!path) return "";
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return "<custom-database-path>";
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
