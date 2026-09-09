// Retired SQLite configuration is rejected before resolving credentials or
// opening storage. This leaf module is shared by all client entrypoints.
import {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
} from "@hasna/contracts/client";

/** Legacy variables that must no longer select a client database. */
export const LOCAL_PATH_VARS = [
  "HASNA_DOMAINS_DB_PATH",
  "DOMAINS_DB_PATH",
  "HASNA_DOMAINS_DIR",
  "DOMAINS_DIR",
] as const;

export type LocalOptInEnv = Record<string, string | undefined>;

/** The first local-path var this env sets, or undefined when none is set. */
export function explicitLocalPathVar(env: LocalOptInEnv = process.env): string | undefined {
  return LOCAL_PATH_VARS.find((key) => (env[key] ?? "").trim() !== "");
}

/** Every env name that can configure a domains authority or credential, resolver-derived. */
export function domainsAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys("domains");
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey("domains"),
    credentialPointerEnvKey("domains"),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/** Refuse obsolete local database configuration without exposing its value. */
export function assertDomainsClientStorage(env: LocalOptInEnv = process.env): void {
  const pathVar = explicitLocalPathVar(env);
  if (pathVar) throw new Error(
    `domains: ${pathVar} is no longer supported by clients. Unset local database path variables and configure the shared API with HASNA_DOMAINS_API_KEY or saved credentials. Preserve any existing database until its records have been migrated and verified.`,
  );
}
