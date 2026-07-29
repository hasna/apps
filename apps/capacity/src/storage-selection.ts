import { AccountsError } from "./errors";

/**
 * Storage selection replaces the retired three-way deployment mode
 * (`local | self_hosted | cloud`, plus the `remote` / `hybrid` aliases).
 *
 * Two axes, deliberately separate:
 *
 * - **Client store** — how the OSS client reaches capacity data. SQLite in
 *   process, or HTTP to a server. The client never opens PostgreSQL directly,
 *   so `postgresql` is intentionally absent from {@link CLIENT_STORES}.
 * - **Server data backend** — a server's own internal storage. SQLite for a
 *   single-operator install, PostgreSQL for a service deployment.
 *
 * A retired value is always rejected and never normalized to a default. Silent
 * normalization of unknown values to `local` was the actual defect the retired
 * vocabulary carried; the words were only its symptom.
 */

/** How the OSS client reaches capacity data. Never PostgreSQL. */
export const CLIENT_STORES = Object.freeze(["sqlite", "http"] as const);
export type ClientStore = (typeof CLIENT_STORES)[number];

/** A server's own internal storage. */
export const SERVER_DATA_BACKENDS = Object.freeze(["sqlite", "postgresql"] as const);
export type ServerDataBackend = (typeof SERVER_DATA_BACKENDS)[number];

/**
 * Every retired deployment-mode spelling. Both spellings of the hyphen/underscore
 * split are listed on purpose: manifests spelled it `self-hosted` while code
 * enums spelled it `self_hosted`, and a single pattern misses one.
 */
export const RETIRED_DEPLOYMENT_MODE_VALUES = Object.freeze([
  "local",
  "self_hosted",
  "self-hosted",
  "cloud",
  "remote",
  "hybrid", // RETIREMENT-EXEMPT: this module is the rejection list; it must name what it rejects.
] as const);
export type RetiredDeploymentModeValue = (typeof RETIRED_DEPLOYMENT_MODE_VALUES)[number];

/** The retired configuration keys that must no longer select behaviour. */
// RETIREMENT-EXEMPT: names the retired keys in order to reject them.
export const RETIRED_DEPLOYMENT_MODE_KEYS = Object.freeze(["mode", "deploymentMode"] as const);

/** The retired environment variable, and the variable that replaces it. */
// RETIREMENT-EXEMPT: names the retired variable in order to reject it.
export const RETIRED_DEPLOYMENT_ENV = "HASNA_ACCOUNTS_DEPLOYMENT" as const;
export const CLIENT_STORE_ENV = "HASNA_ACCOUNTS_STORE" as const;

export function isClientStore(value: unknown): value is ClientStore {
  return typeof value === "string" && (CLIENT_STORES as readonly string[]).includes(value);
}

export function isServerDataBackend(value: unknown): value is ServerDataBackend {
  return typeof value === "string" && (SERVER_DATA_BACKENDS as readonly string[]).includes(value);
}

export function isRetiredDeploymentModeValue(
  value: unknown,
): value is RetiredDeploymentModeValue {
  return (
    typeof value === "string" &&
    (RETIRED_DEPLOYMENT_MODE_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Builds the rejection for a retired deployment-mode value.
 *
 * `AccountsError` deliberately discards its message argument in favour of a
 * fixed public message, so the only channel that reaches a caller is
 * `details.field`. The human-readable replacement therefore travels through
 * {@link deploymentModeRetirementHint}, which callers surface directly.
 */
export function retiredDeploymentModeError(
  field: string,
  value: unknown,
  replacement: string,
): AccountsError {
  return new AccountsError(
    "VALIDATION_FAILED",
    `Deployment modes are removed. ${field}=${String(value)} is retired; use ${replacement}.`,
    { details: { field } },
  );
}

/**
 * Operator-facing remediation text for a retired configuration surface. Returns
 * `undefined` for anything unrelated so callers can print it unconditionally.
 *
 * This carries no state or credential material — only the old name, the new
 * name, and the accepted values.
 */
export function deploymentModeRetirementHint(field: string): string | undefined {
  const accepted =
    `Set ${CLIENT_STORE_ENV}=sqlite for the local SQLite store, or ` +
    `${CLIENT_STORE_ENV}=http to reach a server over HTTP.`;
  const rejected =
    `Retired values (${RETIRED_DEPLOYMENT_MODE_VALUES.join(", ")}) are rejected, not defaulted.`;
  if (field === RETIRED_DEPLOYMENT_ENV) {
    return [
      `Deployment modes are removed and ${RETIRED_DEPLOYMENT_ENV} is no longer read.`,
      accepted,
      rejected,
    ].join(" ");
  }
  if (field === CLIENT_STORE_ENV) {
    return [`Deployment modes are removed.`, accepted, rejected].join(" ");
  }
  if ((RETIRED_DEPLOYMENT_MODE_KEYS as readonly string[]).includes(field)) {
    return [
      `Deployment modes are removed. The "${field}" option is no longer read.`,
      `Use store: "sqlite" for the in-process SQLite store, or store: "http" to reach a server.`,
      `Retired values (${RETIRED_DEPLOYMENT_MODE_VALUES.join(", ")}) are rejected, not defaulted.`,
    ].join(" ");
  }
  if (field === "dataBackend") {
    return [
      `Deployment modes are removed. A server declares its own storage instead:`,
      `dataBackend: "postgresql" for a service deployment.`,
    ].join(" ");
  }
  return undefined;
}
