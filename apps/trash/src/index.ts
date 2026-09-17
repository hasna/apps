/** Hosted reversible deletion. Legacy TrashStore is available only for explicit offline use. */
export { createTrash, createLocalTrash } from "./sdk.js";
export { HostedTrash, HostedOperationError } from "./hosted.js";
export { TrashApi, TrashApiError } from "./client.js";
export type { HostedOptions, RestoreOutcome } from "./hosted.js";
export type { TrashApiOptions, RemoteEntry, CompactEntry, EntryPage, ApiStatus } from "./client.js";
export { detectStation, detectAgent } from "./identity.js";
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
