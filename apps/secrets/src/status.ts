import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getStoreWithResolution } from "./store/index.js";
import type { CredentialTier, SecretsClientResolutionOptions } from "./store/client-types.js";
import type { SecretType } from "./types.js";
import { VERSION } from "./version.js";

const PACKAGE_NAME = "@hasna/secrets";
const FALLBACK_PACKAGE_VERSION = VERSION;

/**
 * WHERE the hosted transport was resolved from — names only, never values.
 * `null` for a local-vault run. Sources are an env key NAME, a Keychain item
 * reference (`keychain:<service>@<account>`), a file PATH with the home
 * prefix folded to `~`, or `"default"` (the fleet gateway).
 */
export interface SecretTransportStatus {
  api_url_source: string | null;
  api_key_source: string | null;
  api_key_tier: CredentialTier;
}

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
  /** Resolver provenance for a hosted run (hasna/apps#1720); null when local. */
  transport: SecretTransportStatus | null;
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
export async function getSecretReferenceStatus(
  env: NodeJS.ProcessEnv = process.env,
  options: SecretsClientResolutionOptions = {},
): Promise<SecretReferenceStatus> {
  const { store, resolution } = getStoreWithResolution(env, options);
  const descriptor = store.describe();
  const counts = await store.status();

  return {
    service: "secrets",
    schemaVersion: "2.0",
    package: { name: PACKAGE_NAME, version: packageVersion() },
    mode: descriptor.mode,
    location: redactLocation(descriptor),
    transport: resolution
      ? {
          api_url_source: redactHomePrefix(resolution.apiUrlSource),
          api_key_source: redactHomePrefix(resolution.apiKeySource),
          api_key_tier: resolution.apiKeyTier,
        }
      : null,
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

/**
 * A resolver SOURCE is a name (env key, Keychain reference, `"default"`) or an
 * absolute credentials-file path. Only the path form carries the home prefix;
 * fold it to `~` so a status line never spells the operator's home directory.
 */
function redactHomePrefix(source: string | null): string | null {
  if (source === null) return null;
  const home = homedir();
  if (source.startsWith(`${home}/`)) return `~/${source.slice(home.length + 1)}`;
  return source;
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
