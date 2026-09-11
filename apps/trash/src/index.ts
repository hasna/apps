/**
 * `@hasna/trash` — reversible deletion.
 *
 * The store plane: a per-entry capture spool with crash-safe publishing, an
 * lstat-only source inspection that never follows or canonicalizes a user
 * path, and a retention sweep whose invariant is asserted in code
 * (`lib/retention.ts`) and pinned by tests.
 *
 * What is NOT here, and is phase 2/3 by design: the shell guard
 * (`hook-trash-guard`, `@hasna/hooks`), the always-on daemon that runs the
 * sweeper on an independent timer, and the remote transport. `trash doctor`
 * reports those absences rather than implying coverage.
 */

export { TrashStore, TrashStoreRefusalError } from "./lib/store.js";
export type {
  CrashPoint,
  DoctorCheck,
  PutOptions,
  PutOutcome,
  PutStatus,
  PurgeResult,
  RecoveryReport,
  RemoteUploader,
  RemoteVerification,
  RemoteVerifier,
  RestoreResult,
  StoreStatus,
  SweepReport,
  TrashStoreOptions,
} from "./lib/store.js";

export { resolveTrashRoots, getHomeDir, configDir, dataDir, stateDir, cacheDir } from "./paths.js";
export type { TrashRoots, TrashRootOverrides, PathKind, PathsResolverOptions } from "./paths.js";

export {
  DEFAULT_TRASH_CONFIG,
  CONFIG_KEYS,
  loadTrashConfig,
  saveTrashConfig,
  validateTrashConfig,
  setConfigValue,
  unsetConfigValue,
  mergeTrashConfig,
} from "./lib/config.js";
export type { TrashConfig, TrashStorageConfig, TrashRetentionConfig, TrashCaptureConfig, TrashCloudConfig } from "./lib/config.js";

export {
  ENTRY_SCHEMA,
  createEntry,
  parseEntry,
  newEntryId,
  assertSafeEntryId,
  isSafeEntryId,
  entryFileName,
} from "./lib/entry.js";
export type { TrashEntry, TrashEntryKind, TrashEntryStatus, RemoteConfirmation } from "./lib/entry.js";

export { resolveTrashMode, describeMode, TrashModeConflictError } from "./lib/mode.js";
export type { TrashMode, TrashLocalMode, TrashHostedMode } from "./lib/mode.js";

export { planRetention } from "./lib/retention.js";
export type {
  RetentionPlan,
  RetentionPlanInput,
  SweepActionKind,
  SweepBasis,
  SweepQuota,
  SweepStep,
} from "./lib/retention.js";

export { inspectSource, evaluateDeletability, checkProtectedPath, stripTrailingSlashes, SYSTEM_PROTECTED_ROOTS } from "./lib/inspect.js";
export type { InspectResult, InspectedSource, InspectOptions, CaptureRefusalDraft } from "./lib/inspect.js";

export { hashPath, payloadMatches, sha256Text, EntryTooLargeError } from "./lib/hash.js";
export type { HashedKind, HashResult } from "./lib/hash.js";

export { globToRegExp, isExcludedPath, firstMatchingGlob, compileGlobs, normalizeForMatch } from "./lib/glob.js";
export type { CompiledGlob } from "./lib/glob.js";

export { parseExpiry, parseExpiryStrict, retentionExpiresAt, isExpired, ageMs } from "./lib/expiry.js";

export { listRefusals, recordRefusal, tallyRefusals, refusalFileName } from "./lib/refusals.js";
export type { RefusalRecord, CaptureRefusalReason, RefusalQuery, RefusalTally } from "./lib/refusals.js";

export { PublishCollisionError, errnoCode, isErrno, freeBytesOf, freeBytesOrNull, lstatOrNull } from "./lib/fsx.js";

export { withFileLock, LockTimeoutError, lockIsHeld } from "./lib/lock.js";
