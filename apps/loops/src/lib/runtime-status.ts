/**
 * Runtime status reporting for @hasna/loops.
 *
 * Replaces the pre-mode-removal deployment-status contract. The mode and
 * authority report fields are removed; see runtime-config. A report names the
 * storage backend (`sqlite | postgresql`) and the client connection
 * (`file | api`) and nothing else about placement.
 */

import { packageVersion } from "./version.js";
import {
  ROUTE_ADMISSION_GATES,
  displayControlPlaneUrl,
  envValue,
} from "./runtime-config.js";
import { resolveCloudStorage, type CloudStorageResolution } from "./cloud/resolve.js";
import type { Env, LoopRouteAdmissionGate, RuntimeConfig, RuntimeConnection, RuntimeStorage } from "./runtime-config.js";

export type LoopRemoteSchedulerBackend = "none" | "control_plane_http" | "postgres_contract";

export type LoopRemoteArtifactStore = "none" | "object_store_contract";

export type LoopRouteAdmissionStateStore = "local_sqlite" | "control_plane_contract";

export interface LoopSchedulerStateStatus {
  localStore: {
    backend: "sqlite";
    role: "authoritative" | "spool";
    runArtifacts: "local_files";
    routeAdmissionState: "workflow_work_items";
  };
  remoteStore: {
    backend: LoopRemoteSchedulerBackend;
    configured: boolean;
    applySupported: false;
    objectArtifacts: LoopRemoteArtifactStore;
    mutatesAws: false;
  };
  routeAdmission: {
    stateStore: LoopRouteAdmissionStateStore;
    activeStatuses: readonly ["admitted", "running"];
    gates: readonly LoopRouteAdmissionGate[];
    dryRunEvaluatesLiveCounts: false;
  };
}

export interface StorageConnectionReport {
  packageVersion: string;
  storage: RuntimeStorage;
  connection: RuntimeConnection;
  /** Scrubbed API URL (origin + path, no credentials); undefined when no API connection. */
  apiUrl?: string;
  apiKeyPresent: boolean;
  databaseUrlPresent: boolean;
  configured: boolean;
  warnings: string[];
}

/**
 * The runtime config a RESOLVED client connection implies.
 *
 * The connection fields come from the shared credential resolver, not from
 * env presence: a Keychain or credential-file identity reports `api` even when
 * no HASNA_LOOPS_* env variable is set. This is what the CLI `status` command
 * reports; server surfaces keep the env-presence `resolveRuntimeConfig`.
 *
 * Throws when nothing is configured — the same fail-closed refusal the data
 * path gives — so an unconfigured `status` never reports a file connection
 * that no data command would use.
 */
export function resolvedClientRuntimeConfig(env: Env = process.env): RuntimeConfig {
  const resolution: CloudStorageResolution = resolveCloudStorage("loops", env);
  const databaseUrlPresent = Boolean(envValue(env, ["HASNA_LOOPS_DATABASE_URL"]));
  return {
    storage: databaseUrlPresent ? "postgresql" : "sqlite",
    connection: resolution.transport,
    apiUrl: resolution.transport === "api" ? authorityWithoutV1(resolution.baseUrl) : undefined,
    apiUrlPresent: resolution.transport === "api",
    apiKeyPresent: resolution.transport === "api",
    databaseUrlPresent,
  };
}

/** The resolver's `<origin>/v1` base without the transport suffix, for display. */
function authorityWithoutV1(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "");
}

/**
 * Build the storage/connection report for a resolved runtime config. The
 * report never carries credential values: the API key is a presence flag and
 * the API URL is scrubbed.
 */
export function buildStorageConnectionReport(config: RuntimeConfig): StorageConnectionReport {
  const warnings: string[] = [];
  if (config.connection === "file" && config.databaseUrlPresent) {
    warnings.push(
      "HASNA_LOOPS_DATABASE_URL is server-only: this client keeps its local sqlite file and never opens " +
        "postgres directly; the variable applies to loops-serve",
    );
  }
  return {
    packageVersion: packageVersion(),
    storage: config.storage,
    connection: config.connection,
    apiUrl: displayControlPlaneUrl(config.apiUrl),
    apiKeyPresent: config.apiKeyPresent,
    databaseUrlPresent: config.databaseUrlPresent,
    configured: config.connection === "api" ? config.apiUrlPresent && config.apiKeyPresent : true,
    warnings,
  };
}

/**
 * Scheduler-state fields derived from the connection and the server storage
 * presence only. Neutral backend names: `control_plane_http` for an API
 * connection, `postgres_contract` when the server storage is postgres,
 * `none` for a plain local sqlite file.
 */
export function schedulerStateForConnection(config: RuntimeConfig): LoopSchedulerStateStatus {
  const remote: LoopRemoteSchedulerBackend =
    config.connection === "api" ? "control_plane_http" : config.databaseUrlPresent ? "postgres_contract" : "none";
  const remoteConfigured = remote !== "none";
  return {
    localStore: {
      backend: "sqlite",
      role: remoteConfigured ? "spool" : "authoritative",
      runArtifacts: "local_files",
      routeAdmissionState: "workflow_work_items",
    },
    remoteStore: {
      backend: remote,
      configured: remoteConfigured,
      applySupported: false,
      objectArtifacts: remoteConfigured ? "object_store_contract" : "none",
      mutatesAws: false,
    },
    routeAdmission: {
      stateStore: remoteConfigured ? "control_plane_contract" : "local_sqlite",
      activeStatuses: ["admitted", "running"],
      gates: ROUTE_ADMISSION_GATES,
      dryRunEvaluatesLiveCounts: false,
    },
  };
}

/**
 * One-line human-readable summary of the storage/connection report:
 * `storage=<backend> connection=<transport> [api=<scrubbed-url>] [warnings=[...]]`.
 */
export function storageConnectionReportLine(report: StorageConnectionReport): string {
  const parts = [`storage=${report.storage}`, `connection=${report.connection}`];
  if (report.apiUrl) parts.push(`api=${report.apiUrl}`);
  if (report.warnings.length > 0) parts.push(`warnings=[${report.warnings.join("; ")}]`);
  return parts.join(" ");
}
