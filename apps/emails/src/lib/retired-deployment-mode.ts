// Fail-loud rejection of the retired deployment-mode variables.
//
// Deployment modes no longer exist (hasna/apps#1566). Emails has one deployment
// story — "you run it" — and every process chooses the store it reads and writes
// from STORAGE configuration alone: the HTTP API when an API origin plus a
// credential are configured (EMAILS_SELF_HOSTED_URL with one of
// EMAILS_SESSION_TOKEN, EMAILS_IDP_TOKEN or EMAILS_SELF_HOSTED_API_KEY, or
// delivered through the EMAILS_CLIENT_ENV_SECRET vault pointer), and the local
// SQLite database only when a database path is configured explicitly
// (HASNA_EMAILS_DB_PATH / EMAILS_DB_PATH). The decision itself lives in
// src/store-resolution.ts, which never reads a mode word.
//
// The variables that used to DECLARE the mode (EMAILS_MODE / HASNA_EMAILS_MODE,
// and the older Mailery spellings of the same contract) were REMOVED, not
// ignored: a variable an operator carries forward must be refused loudly rather
// than watched do nothing. That refusal lives HERE — the only module in src/
// that spells the removed variable names for the client half of the axis (the
// `emails-serve` process keeps its own narrower reading for the rollout window;
// see src/server/storage-backend.ts, which tolerates an agreeing retired value
// with a notice until the deployment that still pins it is migrated). Mode
// resolution and store code import these guards and never restate the keys.

/**
 * The retired deployment-mode variables, both spellings that ever selected the
 * client's data source. Named once here; every other site reads them by role or
 * not at all.
 */
export const RETIRED_MODE_VARIABLE_KEYS = Object.freeze([
  "EMAILS_MODE",
  "HASNA_EMAILS_MODE",
] as const);

// Removed hosted/legacy mode tiering. The MAILERY_ prefixed spellings belong to
// the abandoned 0.6.x line and to the separate cloud product; refusing them keeps
// a variable that configured a runtime this package does not have from silently
// doing nothing.
//
// These arrays stay module-PRIVATE on purpose: exporting them would emit the
// literal key names into a declaration surface, which the no-cloud artifact
// scan's compatibility-bridge strip does not cover.
const LEGACY_MODE_VARIABLE_KEYS = [
  "MAILERY_MODE",
  "HASNA_MAILERY_MODE",
  "MAILERY_STORAGE_MODE",
  "HASNA_MAILERY_STORAGE_MODE",
  "EMAILS_STORAGE_MODE",
  "HASNA_EMAILS_STORAGE_MODE",
] as const;

// Hosted control-plane credential/endpoint vars. This OSS package is cloud-free
// (a hosted Mailery cloud is platform-mailery's job), so these stay banned.
const LEGACY_HOSTED_RUNTIME_KEYS = [
  "MAILERY_API_URL",
  "MAILERY_API_KEY",
  "MAILERY_CLOUD_API_URL",
  "MAILERY_CLOUD_TOKEN",
  "HASNA_MAILERY_API_URL",
  "HASNA_MAILERY_API_KEY",
  "HASNA_MAILERY_ENV_FILE",
] as const;

// Config-file spellings of the same retired contract. The old client accepted an
// `emails_mode` key in ~/.hasna/emails/config.json and refused the Mailery-era
// spellings; none of them select anything any more, so all of them are retired
// together.
const RETIRED_MODE_CONFIG_KEYS = ["emails_mode", "mode", "mailery_mode", "storage_mode"] as const;

/**
 * The guidance shared by every refusal: what replaced the removed contract, in
 * the same dialect the store resolution uses (src/store-resolution.ts).
 */
const STORAGE_ROUTING_GUIDANCE =
  "Emails routes on storage configuration alone: set EMAILS_SELF_HOSTED_URL and " +
  "one of EMAILS_SESSION_TOKEN, EMAILS_IDP_TOKEN or EMAILS_SELF_HOSTED_API_KEY " +
  "for the API (or point EMAILS_CLIENT_ENV_SECRET at a vault entry that carries " +
  "them), or set HASNA_EMAILS_DB_PATH / EMAILS_DB_PATH to a database file for the " +
  "local database.";

function firstConfiguredEnvKey(env: NodeJS.ProcessEnv, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (env[key]?.trim()) return key;
  }
  return null;
}

/**
 * Throw when a retired deployment-mode variable is set in the environment.
 * Naming the retired variable and the storage settings that replaced it makes
 * the error actionable without accepting the value. Safe to call from any entry
 * that resolves the client's data source; a no-op when nothing retired is set.
 */
export function assertNoRetiredModeVariables(env: NodeJS.ProcessEnv = process.env): void {
  const retiredKey = firstConfiguredEnvKey(env, RETIRED_MODE_VARIABLE_KEYS);
  if (!retiredKey) return;
  throw new Error(
    `${retiredKey} was removed. Deployment modes no longer exist in Emails: ` +
      `${STORAGE_ROUTING_GUIDANCE} Delete ${retiredKey}.`,
  );
}

/**
 * Throw when a retired deployment-mode variable is set in the Emails config
 * file. The config file used to accept an `emails_mode` key (and refuse the
 * Mailery-era spellings); none of them select anything any more. Reads nothing —
 * the caller passes the already-parsed config object.
 */
export function assertNoRetiredModeConfigKeys(config: Readonly<Record<string, unknown>>): void {
  for (const key of RETIRED_MODE_CONFIG_KEYS) {
    const value = config[key];
    if (typeof value !== "string" || !value.trim()) continue;
    throw new Error(
      `'${key}' in the Emails config file was removed. Deployment modes no longer ` +
        `exist in Emails: ${STORAGE_ROUTING_GUIDANCE} Delete the '${key}' key.`,
    );
  }
}

/**
 * Throw when a removed Mailery/cloud runtime variable is set. These never
 * selected a store this package ships, so a value here is refused rather than
 * read. No options: the historical tolerance that blessed a hosted-runtime
 * environment under an explicit self-hosted mode died with the mode variable.
 */
export function assertNoLegacyHostedEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const legacyKey =
    firstConfiguredEnvKey(env, LEGACY_MODE_VARIABLE_KEYS)
    ?? firstConfiguredEnvKey(env, LEGACY_HOSTED_RUNTIME_KEYS);
  if (!legacyKey) return;
  throw new Error(
    `${legacyKey} belongs to the removed Mailery/cloud runtime, which this package ` +
      `does not ship. Deployment modes no longer exist in Emails: ` +
      `${STORAGE_ROUTING_GUIDANCE} Delete ${legacyKey}.`,
  );
}
