import { AccountsError } from "../errors";
import {
  RETIRED_DEPLOYMENT_MODE_KEYS,
  isRetiredDeploymentModeValue,
  retiredDeploymentModeError,
} from "../storage-selection";
import { createLocalAccountsCapacity } from "./local";
import { createHttpAccountsCapacity } from "./remote";
import type { AccountsCapacity, AccountsDeployment } from "./types";

export type {
  AccountLanesApi,
  AccountsAuthProvider,
  AccountsCapacity,
  AccountsDeployment,
  AuthCapsulesApi,
  BootstrapIntentInput,
  CallOptions,
  CapacityQueryApi,
  CreateAccountLaneInput,
  CreateEntitlementInput,
  CreateProviderAccountInput,
  EntitlementsApi,
  ListOptions,
  LocalRecoveryConfiguration,
  MutationOptions,
  Page,
  ProviderAccountsApi,
  ProviderAccountView,
  ReadonlyCapacityPoolsApi,
  ReadonlyCredentialBindingsApi,
  RevisionMutationOptions,
} from "./types";
export { createLocalAccountsCapacityFromCatalog } from "./local";

/**
 * Store choice is explicit and immutable. An HTTP error is returned to the
 * caller and never falls back to SQLite.
 *
 * Retired deployment-mode configuration is rejected rather than normalized: an
 * unknown value must not quietly become the SQLite store.
 */
export function createAccountsCapacity(config: AccountsDeployment): AccountsCapacity {
  const record = config as AccountsDeployment & Record<string, unknown>;
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw invalidConfig("config");
  }
  rejectRetiredDeploymentMode(record);
  if (record.store === "sqlite") {
    exactConfigurationKeys(record, ["store", "actorRef"], ["sqlitePath", "recovery"]);
    if (record.recovery !== undefined) {
      if (
        record.recovery === null ||
        typeof record.recovery !== "object" ||
        Array.isArray(record.recovery)
      ) {
        throw invalidConfig("recovery");
      }
      exactConfigurationKeys(
        record.recovery as unknown as Record<string, unknown>,
        ["ledgerPath", "catalogIncarnation", "signingKey"],
      );
      if (!(record.recovery.signingKey instanceof Uint8Array)) {
        throw invalidConfig("recovery.signingKey");
      }
    }
    return createLocalAccountsCapacity(record.actorRef, record.sqlitePath, record.recovery);
  }
  if (record.store === "http") {
    exactConfigurationKeys(record, ["store", "baseUrl", "authProvider"]);
    if (
      record.authProvider === null ||
      typeof record.authProvider !== "object" ||
      typeof record.authProvider.authorize !== "function"
    ) {
      throw invalidConfig("authProvider");
    }
    return createHttpAccountsCapacity(record.baseUrl, record.authProvider);
  }
  throw invalidConfig("store");
}

/**
 * Rejects the retired deployment-mode switch. A retired key is refused even when
 * it carries a live store value, so `mode` cannot survive as an alias for
 * `store`; and a retired value under the live key is refused rather than mapped.
 */
function rejectRetiredDeploymentMode(record: Record<string, unknown>): void {
  for (const key of RETIRED_DEPLOYMENT_MODE_KEYS) {
    if (Object.hasOwn(record, key)) {
      throw retiredDeploymentModeError(key, record[key], 'store: "sqlite" | "http"');
    }
  }
  if (isRetiredDeploymentModeValue(record.store)) {
    throw retiredDeploymentModeError("store", record.store, 'store: "sqlite" | "http"');
  }
}

function exactConfigurationKeys(
  config: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(config)) {
    if (!allowed.has(key)) throw invalidConfig(key);
  }
  for (const key of required) {
    if (!Object.hasOwn(config, key)) throw invalidConfig(key);
  }
}

function invalidConfig(field: string): AccountsError {
  return new AccountsError("VALIDATION_FAILED", "Accounts deployment configuration is invalid", {
    details: { field: field.replace(/[^A-Za-z0-9_.]/g, "_").slice(0, 64) },
  });
}
