/** Agent SDK. Hosted operations await verified remote capture before removing a source. */

import { HostedTrash, type HostedOptions } from "./hosted.js";
import { TrashStore, type TrashStoreOptions } from "./lib/store.js";
import { loadTrashConfig, DEFAULT_TRASH_CONFIG, type TrashConfig } from "./lib/config.js";
import { resolveTrashRoots, type TrashRootOverrides } from "./paths.js";

export interface LocalTrashOptions {
  env?: NodeJS.ProcessEnv;
  roots?: TrashRootOverrides;
  config?: TrashConfig;
  /** Live re-confirmation of a remote copy, run immediately before an eviction. */
  verifyRemote?: TrashStoreOptions["verifyRemote"];
  /** Upload retry for un-uploaded entries — never a reason to delete one. */
  upload?: TrashStoreOptions["upload"];
  now?: () => number;
}

export type CreateTrashOptions = HostedOptions;
export function createTrash(options: CreateTrashOptions = {}): HostedTrash {
  return new HostedTrash(options);
}

/** Explicit legacy offline store. It has no hosted index or fleet visibility. */
export function createLocalTrash(options: LocalTrashOptions = {}): TrashStore {
  return new TrashStore({ ...options, env: { ...(options.env ?? process.env), HASNA_TRASH_LOCAL: "1" } });
}

/** The resolved config without constructing a store — for `--spool`-aware callers. */
export function resolveConfig(options: LocalTrashOptions = {}): TrashConfig {
  if (options.config) return options.config;
  const roots = resolveTrashRoots(options.env ?? process.env, options.roots ?? {});
  return loadTrashConfig(roots.config);
}

export { TrashStore, DEFAULT_TRASH_CONFIG };
export type { TrashStoreOptions };

// The guard's decision layer, for callers that hold a command STRING rather
// than the shell's argv — a Bash hook is the intended one (§3: the rewrite is
// a span edit, so `planGuardCommand` returns the command to run, and the same
// call answers "may this even be routed"). `runGuard` is deliberately NOT
// re-exported: it owns process-level concerns (stdin, the exit status, the
// store handle) and belongs to the CLI, not to a library consumer.
export { planGuardCommand, guardPlanDocument, guardPrefix } from "./guard/plan.js";
export { scanDeleteVerbs, applySpanEdits, quoteForShell, REWRITE_VERBS } from "./guard/scan.js";
export { EXIT_OK, EXIT_ERROR, EXIT_REFUSED } from "./guard/run.js";
export type { GuardDecision, GuardDecisionKind, GuardPlanDocument, PlanOptions } from "./guard/plan.js";
export type { ScannedWord, SourceSpan, Disposition, DeleteVerbHit, ScanResult, SpanEdit } from "./guard/scan.js";

export { resolveTrashRoots } from "./paths.js";
export { resolveTrashMode, describeMode } from "./lib/mode.js";
export { planRetention } from "./lib/retention.js";
export { isExcludedPath, firstMatchingGlob } from "./lib/glob.js";
export { parseExpiry, retentionExpiresAt, isExpired } from "./lib/expiry.js";
export type { TrashEntry } from "./lib/entry.js";
export type { RefusalRecord } from "./lib/refusals.js";
export type { RetentionPlan } from "./lib/retention.js";
export type { SweepReport, PutOutcome, StoreStatus, DoctorCheck } from "./lib/store.js";

export { HostedTrash, HostedOperationError } from "./hosted.js";
export type { HostedOptions, RestoreOutcome } from "./hosted.js";
export { TrashApi, TrashApiError } from "./client.js";
export type { TrashApiOptions, RemoteEntry, CompactEntry, EntryPage, ApiStatus } from "./client.js";
export { detectAgent, detectStation } from "./identity.js";
export { compactEntry } from "./api/domain.js";
export type { CaptureInput, Station, StationInput, ListQuery } from "./api/domain.js";

export { processBackupJob, BackupJobError } from "./backup-worker.js";
export type { BackupWorkerApi, BackupSink, BackupReceipt } from "./backup-worker.js";
export { inspectCapsule, restoreCapsule, snapshotIdentity } from "./capsule.js";
export type { CapsuleReceipt } from "./capsule.js";

export { VERSION } from "./version.js";
