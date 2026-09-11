/**
 * `@hasna/trash/sdk` — the programmatic facade.
 *
 * The four-surface law requires an `./sdk` subpath; what it carries is the
 * store with the mode and the two injected seams (verification and upload)
 * already applied, so a caller writes:
 *
 *   const trash = createTrash();
 *   trash.put("./build", { force: true });
 *
 * `put` is SYNCHRONOUS on purpose. It is the write path of an `rm`
 * replacement, and the guard that will call it (phase 2) runs inside a Bash
 * hook with a ceiling on its runtime; an `await` there is a regression, not a
 * feature. The asynchronous work — remote verification, upload retries — lives
 * in `sweep()`, which is never on the write path (§6: the sweeper is an
 * independent timer; KDE's bug 205854 was exactly this coupling).
 */

import { TrashStore, type TrashStoreOptions } from "./lib/store.js";
import { loadTrashConfig, DEFAULT_TRASH_CONFIG, type TrashConfig } from "./lib/config.js";
import { resolveTrashRoots, type TrashRootOverrides } from "./paths.js";

export interface CreateTrashOptions {
  env?: NodeJS.ProcessEnv;
  roots?: TrashRootOverrides;
  config?: TrashConfig;
  /** Live re-confirmation of a remote copy, run immediately before an eviction. */
  verifyRemote?: TrashStoreOptions["verifyRemote"];
  /** Upload retry for un-uploaded entries — never a reason to delete one. */
  upload?: TrashStoreOptions["upload"];
  now?: () => number;
}

export function createTrash(options: CreateTrashOptions = {}): TrashStore {
  return new TrashStore(options);
}

/** The resolved config without constructing a store — for `--spool`-aware callers. */
export function resolveConfig(options: CreateTrashOptions = {}): TrashConfig {
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
