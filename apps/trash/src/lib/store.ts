/**
 * The trash store — capture, list, restore, purge, empty, status, doctor, and
 * the retention sweep.
 *
 * =========================================================================
 * THE CAPTURE TRANSACTION (§14.6 ordering, implemented rather than deferred)
 * =========================================================================
 *
 *   1. persist an INTENT holding the original path and inode identity
 *   2. move (no-replace): `rename` for a tree, `link`+`unlink` for a loose file
 *   3. establish payload durability (file fsync, parent fsync)
 *   4. publish completion — the metadata file's existence IS the claim that its
 *      payload is complete, so it is published LAST
 *   5. remove the intent
 *
 * Recovery runs at every boundary and NEVER blindly unlinks an original
 * pathname: between `lstat` and the move another process can replace the path
 * with a different inode, and a naive recovery destroys the new one. Every
 * unlink in the recovery path is guarded by an exact `st_dev`+`st_ino` match
 * against the identity recorded at capture.
 *
 * **`link()` is not a substitute for an update protocol** (its `EEXIST` is not
 * an idempotency signal) — but it IS the right primitive for capturing a loose
 * file, because the inode survives the unlink of the original name and a repeat
 * publish is detectable rather than clobbering. A directory is moved with
 * `rename`, because `link(2)` returns `EPERM` for a directory (§15 correction 1).
 *
 * =========================================================================
 * NEVER SQLITE (not even in local-only mode)
 * =========================================================================
 *
 * One `<id>.json` per entry plus a `<id>` payload, published temp-then-link.
 * The doctrine does not forbid this (§15 correction 6): `docs/fleet-local-
 * storage.md:43-55` permits documented local-only packages. The reasons are the
 * ones in entry.ts — single-writer daemon, no query workload, dependency
 * weight, and keeping `bun:sqlite` out of the hook bundle.
 */

import { closeSync, lstatSync, openSync, fsyncSync, readdirSync, readFileSync, renameSync, linkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  loadTrashConfig,
  mergeTrashConfig,
  validateTrashConfig,
  type TrashConfig,
  type TrashConfigPatch,
} from "./config.js";
import {
  createEntry,
  entryFileName,
  assertSafeEntryId,
  parseEntry,
  type TrashEntry,
  type TrashEntryKind,
  type RemoteConfirmation,
} from "./entry.js";
import { retentionExpiresAt, isExpired, ageMs } from "./expiry.js";
import {
  countDirEntries,
  ensureDir,
  errnoCode,
  freeBytesOf,
  freeBytesOrNull,
  fsyncDirectory,
  isErrno,
  lstatOrNull,
  publishNoReplace,
  PublishCollisionError,
  removeFile,
  removePathRecursive,
  writeFileAtomic,
  writeTempSync,
} from "./fsx.js";
import { firstMatchingGlob, isExcludedPath } from "./glob.js";
import { inspectSource, evaluateDeletability, type CaptureRefusalDraft } from "./inspect.js";
import { describeMode, resolveTrashMode, type TrashMode } from "./mode.js";
import { listRefusals, recordRefusal, tallyRefusals, type RefusalRecord } from "./refusals.js";
import { planRetention, type RetentionPlan, type SweepStep } from "./retention.js";
import { resolveTrashRoots, getHomeDir, type TrashRootOverrides, type TrashRoots } from "../paths.js";
import { withFileLock } from "./lock.js";

export interface RemoteVerification {
  key: string;
  versionId: string | null;
  sha256: string;
  sizeBytes: number;
}

/** Re-confirm a remote copy AT THE MOMENT OF DELETION. Absent ⇒ nothing is evictable. */
export type RemoteVerifier = (entry: TrashEntry) => Promise<RemoteVerification | null>;

/** Upload a payload. Phase 3 wires the presigned single PUT; absent ⇒ step 3 records it. */
export type RemoteUploader = (
  entry: TrashEntry,
  payloadPath: string,
  sha256: string,
) => Promise<RemoteConfirmation | null>;

/** Simulated crash points — a test seam, never set in production paths. */
export type CrashPoint = "after_intent" | "after_payload" | "after_metadata" | "after_restore_move";

export interface TrashStoreOptions {
  env?: NodeJS.ProcessEnv;
  roots?: TrashRootOverrides;
  /** A section-wise patch over the defaults (or over the config file). */
  config?: TrashConfigPatch;
  now?: () => number;
  verifyRemote?: RemoteVerifier;
  upload?: RemoteUploader;
  crashAt?: (point: CrashPoint) => void;
}

export interface PutOptions {
  force?: boolean;
  agent?: string;
  retentionDays?: number | null;
  cwd?: string;
}

export type PutStatus = "captured" | "deleted_without_capture" | "refused" | "missing";

export interface PutOutcome {
  target: string;
  absolutePath: string;
  status: PutStatus;
  entryId: string | null;
  refusals: RefusalRecord[];
  detail: string;
}

export interface RestoreResult {
  id: string;
  restoredTo: string;
  kind: TrashEntry["kind"];
  sizeBytes: number;
  sha256: string;
}

export interface PurgeResult {
  purged: string[];
  bytes: number;
  dryRun: boolean;
}

export interface SweepReport {
  ranAt: string;
  applied: boolean;
  mode: string;
  plan: RetentionPlan;
  deleted: { id: string; originalPath: string; bytes: number; basis: string }[];
  kept: { id: string; basis: string; detail: string }[];
  uploads: { id: string; confirmed: boolean; detail: string }[];
  verified: { id: string; fresh: boolean; detail: string }[];
  blocked: RetentionPlan["blocked"];
}

export interface StoreStatus {
  roots: TrashRoots;
  mode: string;
  entries: number;
  bytes: number;
  pinned: number;
  unuploaded: number;
  remoteConfirmed: number;
  expired: number;
  restored: number;
  restoring: number;
  quota: RetentionPlan["quota"];
  refusals: ReturnType<typeof tallyRefusals>;
  pendingIntents: number;
  legacyHome: boolean;
  oldestCapturedAt: string | null;
  newestCapturedAt: string | null;
}

export interface DoctorCheck {
  id: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface RecoveryReport {
  scanned: number;
  completedPublishes: string[];
  abortedIntents: string[];
  staleIntents: string[];
  unresolvable: string[];
  restoredEntries: string[];
  pendingRestores: string[];
}

interface CaptureIntent {
  schema: "hasna.trash.capture-intent.v1";
  entry: TrashEntry;
  payloadPath: string;
}

/** The source disappeared mid-capture — another process got there first. */
export class SourceVanishedError extends Error {
  constructor(public readonly path: string) {
    super(`the source ${path} vanished during capture`);
    this.name = "SourceVanishedError";
  }
}

export class TrashStoreRefusalError extends Error {
  constructor(
    message: string,
    public readonly outcome: PutOutcome,
  ) {
    super(message);
    this.name = "TrashStoreRefusalError";
  }
}

export class TrashStore {
  readonly roots: TrashRoots;
  readonly config: TrashConfig;
  private readonly env: NodeJS.ProcessEnv;
  private readonly clock: () => number;
  private readonly verifyRemote?: RemoteVerifier;
  private readonly upload?: RemoteUploader;
  private readonly crashAt?: (point: CrashPoint) => void;
  private initialized = false;

  constructor(options: TrashStoreOptions = {}) {
    this.env = options.env ?? process.env;
    this.roots = resolveTrashRoots(this.env, options.roots ?? {});
    this.config = options.config
      ? validateTrashConfig(mergeTrashConfig(options.config))
      : loadTrashConfig(this.roots.config);
    this.clock = options.now ?? (() => Date.now());
    this.verifyRemote = options.verifyRemote;
    this.upload = options.upload;
    this.crashAt = options.crashAt;
  }

  /** The derived mode (§5) — throws on a conflicting authority + local flag. */
  mode(): TrashMode {
    return resolveTrashMode(this.env);
  }

  payloadPath(id: string): string {
    return join(this.roots.files, assertSafeEntryId(id));
  }

  infoPath(id: string): string {
    return join(this.roots.info, entryFileName(id));
  }

  intentPath(id: string): string {
    return join(this.roots.intents, `${assertSafeEntryId(id)}.json`);
  }

  /** Create the store directories (0700) and complete any interrupted capture. */
  init(): RecoveryReport {
    ensureDir(this.roots.state, 0o700);
    ensureDir(this.roots.files, 0o700);
    ensureDir(this.roots.info, 0o700);
    ensureDir(this.roots.intents, 0o700);
    fsyncDirectory(this.roots.state);
    this.initialized = true;
    return this.recover();
  }

  private ensureInit(): void {
    if (!this.initialized) this.init();
  }

  // =========================================================================
  // Capture
  // =========================================================================

  /**
   * Trash one or more paths.
   *
   * Refusal policy (§11.7, binding): if capture fails on a path that does NOT
   * match an `excludeGlobs` entry, the DELETE IS REFUSED and the path stays; if
   * it matches one, the delete proceeds and the refusal is recorded. `--force`
   * overrides a capture refusal but never a protected path.
   */
  put(targets: string | string[], options: PutOptions = {}): PutOutcome[] {
    this.ensureInit();
    const list = Array.isArray(targets) ? targets : [targets];
    const outcomes: PutOutcome[] = [];
    for (const target of list) {
      outcomes.push(this.putOne(target, options));
    }
    return outcomes;
  }

  private putOne(target: string, options: PutOptions): PutOutcome {
    const cwd = options.cwd ?? process.cwd();
    const home = getHomeDir(this.env);
    const now = this.clock();

    const inspection = inspectSource(target, {
      cwd,
      home,
      maxBytes: this.config.capture.maxEntryBytes,
      extraProtectedRoots: [this.roots.files, this.roots.info, this.roots.state, dirname(this.roots.config)],
    });

    if (inspection.missing) {
      return {
        target,
        absolutePath: inspection.absolutePath,
        status: "missing",
        entryId: null,
        refusals: [],
        detail: "no such path (rm -f semantics: not an error)",
      };
    }

    const protectedRefusal = inspection.refusals.find((r) => r.reason === "protected_path");
    if (protectedRefusal) {
      const record = this.recordRefusal(target, inspection.absolutePath, protectedRefusal, false, null, false, false, options.agent ?? null);
      return {
        target,
        absolutePath: inspection.absolutePath,
        status: "refused",
        entryId: null,
        refusals: [record],
        detail: `${protectedRefusal.detail} — protected paths are refused even with --force`,
      };
    }

    const draft: CaptureRefusalDraft[] = [...inspection.refusals];
    if (inspection.source) {
      draft.push(
        ...evaluateDeletability(inspection.absolutePath, {
          spoolDevice: lstatSync(this.roots.files).dev,
          spoolFreeBytes: freeBytesOf(this.roots.files),
          minFreeBytes: this.config.capture.minFreeBytes,
          maxEntryBytes: this.config.capture.maxEntryBytes,
          sizeBytes: inspection.source.sizeBytes,
        }),
      );
    }

    const quota = this.captureQuotaRefusal(inspection.source?.sizeBytes ?? 0);
    if (quota) draft.push(quota);

    // Race guard: another process may have removed the path between `lstat` and
    // here. Nothing was deleted by us and there is nothing left to delete, so
    // the honest answer is `missing` — never a refusal record blaming us for a
    // path someone else removed.
    if (lstatOrNull(inspection.absolutePath) === null) {
      return {
        target,
        absolutePath: inspection.absolutePath,
        status: "missing",
        entryId: null,
        refusals: [],
        detail: "the path vanished during inspection (raced by another process)",
      };
    }

    const excludeGlob = firstMatchingGlob(inspection.absolutePath, this.config.capture.excludeGlobs);
    const exempt = excludeGlob !== null || options.force === true;

    if (draft.length > 0 || inspection.source === null) {
      const reason: CaptureRefusalDraft = draft[0] ?? {
        reason: "io_error",
        detail: `capture of ${inspection.absolutePath} produced no payload`,
      };
      const deleted = exempt;
      const record = this.recordRefusal(
        target,
        inspection.absolutePath,
        reason,
        excludeGlob !== null,
        excludeGlob,
        options.force === true,
        deleted,
        options.agent ?? null,
      );
      if (!deleted) {
        return {
          target,
          absolutePath: inspection.absolutePath,
          status: "refused",
          entryId: null,
          refusals: [record],
          detail:
            `${reason.detail} — capture refused, so the delete is refused too (§11.7). ` +
            "Pass --force to delete anyway, or add the path to capture.excludeGlobs.",
        };
      }
      // The exempt class: the delete proceeds without a capture, and the refusal
      // is recorded so the uncovered surface is measurable rather than invisible.
      removePathRecursive(inspection.absolutePath);
      fsyncDirectory(dirname(inspection.absolutePath));
      return {
        target,
        absolutePath: inspection.absolutePath,
        status: "deleted_without_capture",
        entryId: null,
        refusals: [record],
        detail: `${reason.detail} — path matched ${excludeGlob ?? "--force"}; deleted without a capture (recorded)`,
      };
    }

    const source = inspection.source!;
    const capturedAt = new Date(now).toISOString();
    const retentionDays = options.retentionDays === undefined ? this.config.retention.retentionDays : options.retentionDays;
    const entry = createEntry({
      originalPath: source.absolutePath,
      givenPath: target,
      capturedAt,
      kind: source.kind,
      sizeBytes: source.sizeBytes,
      sha256: source.sha256,
      device: source.device,
      inode: source.inode,
      nlink: source.nlink,
      mode: source.mode,
      retentionDays,
      expiresAt: retentionExpiresAt(capturedAt, retentionDays),
      agent: options.agent ?? null,
    });

    try {
      this.publishCapture(entry, source.absolutePath, source.kind);
    } catch (error) {
      if (error instanceof PublishCollisionError) {
        const record = this.recordRefusal(
          target,
          source.absolutePath,
          { reason: "io_error", detail: `entry id ${entry.id} already exists — refusing to clobber an identity` },
          excludeGlob !== null,
          excludeGlob,
          options.force === true,
          false,
          options.agent ?? null,
        );
        return {
          target,
          absolutePath: source.absolutePath,
          status: "refused",
          entryId: null,
          refusals: [record],
          detail: "entry id collision — the payload and its metadata are untouched",
        };
      }
      if (error instanceof SourceVanishedError) {
        // The source disappeared between `lstat` and the move — another process
        // got there first. Drop our intent and report it as gone; we deleted
        // nothing and the other process owns what happened.
        removeFile(this.intentPath(entry.id));
        return {
          target,
          absolutePath: source.absolutePath,
          status: "missing",
          entryId: null,
          refusals: [],
          detail: "the path was removed by another process during capture",
        };
      }
      if (isErrno(error, "EXDEV")) {
        const record = this.recordRefusal(
          target,
          source.absolutePath,
          { reason: "cross_device", detail: "the move crossed a filesystem boundary (EXDEV) — never copied" },
          excludeGlob !== null,
          excludeGlob,
          options.force === true,
          exempt,
          options.agent ?? null,
        );
        removeFile(this.intentPath(entry.id));
        if (exempt) {
          removePathRecursive(source.absolutePath);
          return {
            target,
            absolutePath: source.absolutePath,
            status: "deleted_without_capture",
            entryId: null,
            refusals: [record],
            detail: "cross-device capture refused; path was exempt, so the delete proceeded (recorded)",
          };
        }
        return {
          target,
          absolutePath: source.absolutePath,
          status: "refused",
          entryId: null,
          refusals: [record],
          detail: "cross-device capture refused and the delete refused with it — the path is untouched",
        };
      }
      throw error;
    }

    return {
      target,
      absolutePath: source.absolutePath,
      status: "captured",
      entryId: entry.id,
      refusals: [],
      detail: `captured ${entry.kind} (${entry.sizeBytes} bytes) as ${entry.id}`,
    };
  }

  /**
   * Steps 1–5 of the capture transaction. Ordering is the contract: payload
   * staged first, metadata published last (a metadata file is the claim that
   * its payload is complete).
   */
  private publishCapture(entry: TrashEntry, sourcePath: string, kind: TrashEntryKind): void {
    const payloadPath = this.payloadPath(entry.id);
    const intent: CaptureIntent = { schema: "hasna.trash.capture-intent.v1", entry, payloadPath };
    const tmpIntent = writeTempSync(this.roots.intents, ".tmp-", `${JSON.stringify(intent, null, 2)}\n`);
    publishNoReplace(tmpIntent, this.intentPath(entry.id));
    this.crashAt?.("after_intent");

    if (lstatOrNull(sourcePath) === null) throw new SourceVanishedError(sourcePath);

    try {
      if (kind === "dir") {
        // rename(2): atomic, O(1), and link(2) cannot do it at all (§15 correction 1).
        renameSync(sourcePath, payloadPath);
      } else if (this.config.capture.linkWhenSameDevice) {
        // link(2) + unlink(2): the inode survives, and EEXIST is a detectable
        // identity collision rather than a clobber. For a symlink this links
        // the LINK, never its target.
        linkSync(sourcePath, payloadPath);
        this.unlinkOriginalIfSameIdentity(sourcePath, entry);
      } else {
        renameSync(sourcePath, payloadPath);
      }
    } catch (error) {
      // Only the MOVE is interpreted here: an ENOENT raised by a later step
      // (opening a payload that is itself a dangling symlink, say) is a real
      // error and must not be mistaken for a lost race.
      if (isErrno(error, "ENOENT")) throw new SourceVanishedError(sourcePath);
      if (isErrno(error, "EEXIST") || isErrno(error, "ENOTEMPTY")) {
        throw new PublishCollisionError(payloadPath);
      }
      throw error;
    }
    this.syncPayload(payloadPath, kind);
    this.crashAt?.("after_payload");

    const tmpMeta = writeTempSync(this.roots.info, ".tmp-", `${JSON.stringify(entry, null, 2)}\n`);
    publishNoReplace(tmpMeta, this.infoPath(entry.id));
    this.crashAt?.("after_metadata");

    removeFile(this.intentPath(entry.id));
    fsyncDirectory(this.roots.intents);
  }

  /**
   * Delete the original name ONLY when it is still the inode we captured.
   * A path that another process replaced in the meantime is left alone.
   */
  private unlinkOriginalIfSameIdentity(path: string, entry: Pick<TrashEntry, "device" | "inode">): boolean {
    const info = lstatOrNull(path);
    if (!info) return false;
    if (info.dev !== entry.device || info.ino !== entry.inode) return false;
    unlinkSync(path);
    return true;
  }

  /**
   * Make the payload durable.
   *
   * A symlink payload must NOT be opened: `open(payload, "r")` FOLLOWS the
   * link, and for a dangling link (a legitimate capture — the object is the
   * target string) that raises `ENOENT` on a capture that is perfectly fine.
   * A symlink has no bytes of its own; what needs to be durable is the
   * DIRECTORY ENTRY, and that is the directory fsync.
   */
  private syncPayload(payloadPath: string, kind: TrashEntryKind): void {
    if (kind === "dir" || kind === "symlink") {
      if (kind === "dir") fsyncDirectory(payloadPath);
      fsyncDirectory(this.roots.files);
      return;
    }
    let fd: number | undefined;
    try {
      fd = openSync(payloadPath, "r");
      fsyncSync(fd);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    fsyncDirectory(this.roots.files);
  }

  private captureQuotaRefusal(incomingBytes: number): CaptureRefusalDraft | null {
    const usage = this.usage();
    const maxBytes = Math.min(this.config.retention.maxTotalBytes, this.config.storage.maxSizeBytes);
    if (usage.bytes + incomingBytes <= maxBytes && usage.entries + 1 <= this.config.retention.maxEntries) {
      return null;
    }
    return {
      reason: "quota_exceeded",
      detail:
        `store holds ${usage.bytes}/${maxBytes} bytes across ${usage.entries}/${this.config.retention.maxEntries} entries ` +
        "— run `trash sweep`/`trash purge` or let the uploads catch up",
    };
  }

  private recordRefusal(
    target: string,
    absoluteTarget: string,
    draft: CaptureRefusalDraft,
    excluded: boolean,
    excludeGlob: string | null,
    forced: boolean,
    deleted: boolean,
    agent: string | null,
  ): RefusalRecord {
    return recordRefusal(this.roots.refusals, {
      at: new Date(this.clock()).toISOString(),
      target,
      absoluteTarget,
      reason: draft.reason,
      detail: draft.detail,
      excluded,
      excludeGlob,
      forced,
      deleted,
      entryId: null,
      agent,
    });
  }

  // =========================================================================
  // Reads
  // =========================================================================

  list(options: { includeRestored?: boolean } = {}): TrashEntry[] {
    this.ensureInit();
    const entries: TrashEntry[] = [];
    let names: string[];
    try {
      names = readdirSync(this.roots.info);
    } catch {
      return entries;
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const entry = parseEntry(readFileSync(join(this.roots.info, name), "utf8"), name);
        if (!options.includeRestored && entry.status === "restored") continue;
        entries.push(entry);
      } catch {
        // A metadata file that does not parse is not silently deleted; it is
        // reported by `doctor` and left for the operator.
      }
    }
    return entries.sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  }

  info(id: string): TrashEntry | null {
    this.ensureInit();
    const path = this.infoPath(id);
    if (lstatOrNull(path) === null) return null;
    return parseEntry(readFileSync(path, "utf8"), path);
  }

  usage(): { bytes: number; entries: number } {
    let bytes = 0;
    let entries = 0;
    for (const entry of this.list({ includeRestored: false })) {
      if (entry.status === "restored") continue;
      entries += 1;
      bytes += entry.sizeBytes;
    }
    return { bytes, entries };
  }

  // =========================================================================
  // Metadata updates (§14.7: atomic replace + a revision field)
  // =========================================================================

  updateEntry(id: string, mutate: (entry: TrashEntry) => TrashEntry, attempts = 5): TrashEntry {
    this.ensureInit();
    assertSafeEntryId(id);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const current = this.info(id);
      if (!current) throw new Error(`no such entry: ${id}`);
      const next = mutate({ ...current });
      next.revision = current.revision + 1;
      next.updatedAt = new Date(this.clock()).toISOString();
      // Read-modify-write with a revision guard: a concurrent update that won
      // the race is detected (its revision differs) and this attempt re-reads.
      const reread = this.info(id);
      if (!reread || reread.revision !== current.revision) continue;
      writeFileAtomic(this.infoPath(id), `${JSON.stringify(next, null, 2)}\n`);
      return next;
    }
    throw new Error(`entry ${id} is being updated concurrently; retry`);
  }

  setPinned(id: string, pinned: boolean): TrashEntry {
    return this.updateEntry(id, (entry) => ({ ...entry, pinned }));
  }

  recordRemote(id: string, confirmation: RemoteConfirmation): TrashEntry {
    return this.updateEntry(id, (entry) => ({ ...entry, remote: confirmation }));
  }

  // =========================================================================
  // Restore (§14.8: no-clobber, and the entry survives until the bytes do)
  // =========================================================================

  restore(id: string, options: { to?: string; overwrite?: boolean } = {}): RestoreResult {
    this.ensureInit();
    const entry = this.info(id);
    if (!entry) throw new Error(`no such entry: ${id}`);
    if (entry.status !== "staged") {
      throw new Error(`entry ${id} is ${entry.status} — restoring it would race another operation`);
    }
    const payload = this.payloadPath(entry.id);
    if (lstatOrNull(payload) === null) {
      throw new Error(`entry ${id} has no payload at ${payload}`);
    }

    const destination = options.to ? resolve(options.to) : entry.originalPath;
    if (lstatOrNull(destination) !== null && options.overwrite !== true) {
      throw new Error(
        `refusing to restore over ${destination} — the path is occupied (restore is no-clobber; ` +
          "pass --to <path> for an explicit destination)",
      );
    }
    if (destination.startsWith(this.roots.files + "/") || destination === this.roots.files) {
      throw new Error(`refusing to restore into the store's own payload directory (${this.roots.files})`);
    }
    ensureDir(dirname(destination));

    // Persist the in-flight state BEFORE the move: the entry survives until the
    // restored bytes are durable, and recovery can tell a half-done restore
    // apart from a complete one (§14.8).
    this.updateEntry(id, (current) => ({ ...current, status: "restoring", restoredTo: destination }));

    try {
      if (entry.kind === "dir") {
        if (lstatOrNull(destination) !== null && options.overwrite !== true) {
          throw new Error(`refusing to restore over the occupied path ${destination}`);
        }
        renameSync(payload, destination);
      } else {
        // link(2) gives an atomic no-replace move for loose files.
        linkSync(payload, destination);
        unlinkSync(payload);
      }
      fsyncDirectory(dirname(destination));
      fsyncDirectory(this.roots.files);
    } catch (error) {
      // Roll the status back so the entry stays restorable; nothing was moved.
      this.updateEntry(id, (current) => ({ ...current, status: "staged", restoredTo: null }));
      throw error;
    }

    this.crashAt?.("after_restore_move");
    removeFile(this.infoPath(entry.id));
    fsyncDirectory(this.roots.info);
    return {
      id: entry.id,
      restoredTo: destination,
      kind: entry.kind,
      sizeBytes: entry.sizeBytes,
      sha256: entry.sha256,
    };
  }

  // =========================================================================
  // Purge / empty — the explicit irreversible actions
  // =========================================================================

  purge(ids: string[], options: { apply?: boolean } = {}): PurgeResult {
    this.ensureInit();
    // Purging is permanent and operator-initiated: it is a dry run until the
    // caller passes `apply: true` (`trash purge <id> --apply`).
    const dryRun = options.apply !== true;
    const result: PurgeResult = { purged: [], bytes: 0, dryRun };
    for (const id of ids) {
      assertSafeEntryId(id);
      const entry = this.info(id);
      if (!entry) continue;
      if (dryRun) continue;
      this.removeEntryPayload(entry);
      removeFile(this.infoPath(id));
      result.purged.push(id);
      result.bytes += entry.sizeBytes;
    }
    fsyncDirectory(this.roots.info);
    return result;
  }

  empty(options: { apply?: boolean } = {}): PurgeResult {
    this.ensureInit();
    const ids = this.list({ includeRestored: true }).map((entry) => entry.id);
    return this.purge(ids, options);
  }

  private removeEntryPayload(entry: TrashEntry): void {
    const payload = this.payloadPath(entry.id);
    if (lstatOrNull(payload) !== null) removePathRecursive(payload);
    fsyncDirectory(this.roots.files);
  }

  // =========================================================================
  // Retention sweep — an independent operation, never on the write path (§6)
  // =========================================================================

  /**
   * Plan (and, when explicitly applied, execute) the retention sweep.
   *
   * The sweeper is deliberately NOT invoked from `put`: KDE fired cleanup only
   * when a new item was trashed (bug 205854, open since 2009) and produced a
   * 444 GB trash that filled the home partition (bug 414519). The reaper runs
   * on an independent timer (the daemon, phase 3) and re-checks eligibility at
   * COMMIT, not at selection.
   */
  async sweep(options: { apply?: boolean } = {}): Promise<SweepReport> {
    this.ensureInit();
    const mode = this.mode();
    const now = this.clock();
    const entries = this.list();
    const plan = planRetention({
      entries,
      config: this.config,
      mode: mode.kind,
      now,
      hasVerifier: this.verifyRemote !== undefined,
    });

    // `requireExplicitApply` (default true) means a sweep acts only when the
    // caller says so; `dryRun` (default true) means an un-flagged sweep is a
    // dry run. Both together are the default posture. Only an instance that
    // turns BOTH off — which the operator must do deliberately — lets an
    // unattended timer apply a sweep on its own.
    const unattended = !this.config.retention.requireExplicitApply && !this.config.retention.dryRun;
    const applied = options.apply === true || unattended;

    const report: SweepReport = {
      ranAt: new Date(now).toISOString(),
      applied,
      mode: describeMode(mode),
      plan,
      deleted: [],
      kept: [],
      uploads: [],
      verified: [],
      blocked: plan.blocked,
    };

    for (const step of plan.steps) {
      if (step.kind === "keep" || step.kind === "skip") {
        report.kept.push({ id: step.entry.id, basis: step.basis, detail: step.detail });
      }
    }

    if (!applied) return report;

    // A mutating sweep runs under the store lock (§4) so two sweepers cannot
    // both act on a stale accounting.
    await withFileLock(`trash-sweep:${this.roots.state}`, this.roots.lock, async () => {
      for (const step of plan.steps) {
        if (step.kind === "delete_payload") {
          const outcome = await this.applyDelete(step);
          if (outcome.deleted) {
            report.deleted.push({
              id: step.entry.id,
              originalPath: step.entry.originalPath,
              bytes: step.entry.sizeBytes,
              basis: step.basis,
            });
          } else {
            report.kept.push({ id: step.entry.id, basis: outcome.basis, detail: outcome.detail });
          }
          if (outcome.verification) report.verified.push(outcome.verification);
        } else if (step.kind === "retry_upload") {
          report.uploads.push(await this.retryUpload(step.entry));
        }
      }
    });

    return report;
  }

  /**
   * The commit-time path for one planned deletion.
   *
   * Re-reads the entry, re-checks pin/status, and for a remote-confirmed entry
   * performs the live verification IMMEDIATELY before the payload is removed —
   * a stored `remoteConfirmed` boolean is a historical fact and is never
   * sufficient (§6 correction, §12 risk row).
   */
  private async applyDelete(
    step: SweepStep,
  ): Promise<{ deleted: boolean; basis: string; detail: string; verification?: { id: string; fresh: boolean; detail: string } }> {
    const fresh = this.info(step.entry.id);
    if (!fresh) return { deleted: false, basis: "gone", detail: "entry disappeared before commit" };
    if (fresh.pinned) return { deleted: false, basis: "pinned", detail: "pinned between selection and commit" };
    if (fresh.status !== "staged") {
      return { deleted: false, basis: "restore_in_flight", detail: `status is ${fresh.status} at commit` };
    }

    if (fresh.remote !== null) {
      const missing = await this.verifyRemoteEntry(fresh);
      if (!missing.ok) {
        return { deleted: false, basis: missing.basis, detail: missing.detail, verification: { id: fresh.id, fresh: false, detail: missing.detail } };
      }
      // Refresh the confirmation with the verification that just authorized THIS delete.
      this.updateEntry(fresh.id, (entry) => ({
        ...entry,
        remote: {
          key: missing.verification.key,
          versionId: missing.verification.versionId,
          sha256: missing.verification.sha256,
          sizeBytes: missing.verification.sizeBytes,
          confirmedAt: new Date(this.clock()).toISOString(),
        },
      }));
      const stored = fresh.remote;
      const freshEnough = this.clock() - Date.parse(stored.confirmedAt) <= this.config.retention.remoteVerificationHorizonMs;
      this.removeEntryPayload(fresh);
      removeFile(this.infoPath(fresh.id));
      fsyncDirectory(this.roots.info);
      return {
        deleted: true,
        basis: step.basis,
        detail: `${step.basis} — remote copy re-verified at ${new Date(this.clock()).toISOString()}`,
        verification: {
          id: fresh.id,
          fresh: freshEnough,
          detail: freshEnough
            ? "stored confirmation within the verification horizon and re-verified live"
            : "stored confirmation was older than the verification horizon — deleted only on the live re-verification",
        },
      };
    }

    // The local-only arm: no remote copy exists and none is expected (§15.11.1).
    const mode = this.mode();
    if (mode.kind !== "local") {
      return {
        deleted: false,
        basis: "hosted_mode",
        detail: "an un-uploaded entry in a hosted instance is never deleted to make room",
      };
    }
    this.removeEntryPayload(fresh);
    removeFile(this.infoPath(fresh.id));
    fsyncDirectory(this.roots.info);
    return {
      deleted: true,
      basis: step.basis,
      detail: "local-only instance, past retentionDays, explicit apply — the only arm that may expire un-uploaded bytes",
    };
  }

  private async verifyRemoteEntry(
    entry: TrashEntry,
  ): Promise<{ ok: true; verification: RemoteVerification } | { ok: false; basis: string; detail: string }> {
    if (!this.verifyRemote) {
      return { ok: false, basis: "no_verifier", detail: "no remote verifier is configured — nothing is evictable" };
    }
    let verification: RemoteVerification | null = null;
    try {
      verification = await this.verifyRemote(entry);
    } catch (error) {
      return { ok: false, basis: "verify_failed", detail: `remote verification failed: ${(error as Error).message}` };
    }
    if (!verification) {
      return { ok: false, basis: "unverified", detail: "the remote copy could not be confirmed — the local payload stays" };
    }
    if (verification.sha256 !== entry.sha256 || verification.sizeBytes !== entry.sizeBytes) {
      return {
        ok: false,
        basis: "verify_mismatch",
        detail:
          `remote sha256/size (${verification.sha256}/${verification.sizeBytes}) does not match the captured ` +
          `payload (${entry.sha256}/${entry.sizeBytes}) — the local payload is the only verified copy left`,
      };
    }
    if (entry.remote?.versionId && verification.versionId && entry.remote.versionId !== verification.versionId) {
      return {
        ok: false,
        basis: "verify_identity_changed",
        detail: `remote object identity changed (${entry.remote.versionId} → ${verification.versionId})`,
      };
    }
    return { ok: true, verification };
  }

  private async retryUpload(entry: TrashEntry): Promise<{ id: string; confirmed: boolean; detail: string }> {
    const fresh = this.info(entry.id);
    if (!fresh) return { id: entry.id, confirmed: false, detail: "entry disappeared before the upload retry" };
    if (!this.upload) {
      return { id: entry.id, confirmed: false, detail: "no uploader configured — un-uploaded entries are retried, never deleted" };
    }
    const payload = this.payloadPath(fresh.id);
    if (lstatOrNull(payload) === null) {
      return { id: entry.id, confirmed: false, detail: "payload missing — left in place for the operator" };
    }
    try {
      const confirmation = await this.upload(fresh, payload, fresh.sha256);
      if (!confirmation) return { id: entry.id, confirmed: false, detail: "uploader returned no confirmation" };
      this.recordRemote(entry.id, confirmation);
      return { id: entry.id, confirmed: true, detail: `uploaded and confirmed (${confirmation.key})` };
    } catch (error) {
      return { id: entry.id, confirmed: false, detail: `upload failed: ${(error as Error).message}` };
    }
  }

  // =========================================================================
  // Crash recovery
  // =========================================================================

  /**
   * Complete or abandon every interrupted capture and every half-done restore.
   *
   * The rule that makes this safe: an original pathname is unlinked ONLY when
   * its `st_dev`/`st_ino` still match what was captured, and an entry's
   * metadata is written ONLY through the no-replace publish.
   */
  recover(): RecoveryReport {
    const report: RecoveryReport = {
      scanned: 0,
      completedPublishes: [],
      abortedIntents: [],
      staleIntents: [],
      unresolvable: [],
      restoredEntries: [],
      pendingRestores: [],
    };

    let names: string[] = [];
    try {
      names = readdirSync(this.roots.intents).filter((name) => name.endsWith(".json") && !name.startsWith(".tmp-"));
    } catch {
      names = [];
    }

    for (const name of names) {
      report.scanned += 1;
      const path = join(this.roots.intents, name);
      let intent: CaptureIntent;
      try {
        intent = JSON.parse(readFileSync(path, "utf8")) as CaptureIntent;
        if (intent.schema !== "hasna.trash.capture-intent.v1" || !intent.entry) throw new Error("bad intent");
      } catch {
        report.unresolvable.push(`${name} (unreadable intent — left in place, never deleted)`);
        continue;
      }

      const id = intent.entry.id;
      const metaPath = this.infoPath(id);
      const payloadPath = this.payloadPath(id);

      if (lstatOrNull(metaPath) !== null) {
        // The capture completed; the intent is the last thing to clean up.
        removeFile(path);
        report.staleIntents.push(id);
        continue;
      }

      if (lstatOrNull(payloadPath) !== null) {
        const tmp = writeTempSync(this.roots.info, ".tmp-", `${JSON.stringify(intent.entry, null, 2)}\n`);
        try {
          publishNoReplace(tmp, metaPath);
          report.completedPublishes.push(id);
        } catch (error) {
          if (!(error instanceof PublishCollisionError)) throw error;
        }
        // A loose-file capture whose unlink had not happened yet: finish it, but
        // only if the path is still the very same inode.
        this.unlinkOriginalIfSameIdentity(intent.entry.originalPath, intent.entry);
        removeFile(path);
        continue;
      }

      const original = lstatOrNull(intent.entry.originalPath);
      if (original && original.dev === intent.entry.device && original.ino === intent.entry.inode) {
        // Never moved: the intent is abandoned and the source is intact.
        removeFile(path);
        report.abortedIntents.push(id);
        continue;
      }
      report.unresolvable.push(`${id} (intent with neither a payload nor a matching original — left in place)`);
    }

    for (const entry of this.list({ includeRestored: true })) {
      if (entry.status !== "restoring") continue;
      const payloadPath = this.payloadPath(entry.id);
      const destination = entry.restoredTo ?? entry.originalPath;
      if (lstatOrNull(payloadPath) === null && lstatOrNull(destination) !== null) {
        removeFile(this.infoPath(entry.id));
        report.restoredEntries.push(entry.id);
        continue;
      }
      if (lstatOrNull(payloadPath) !== null) {
        this.updateEntry(entry.id, (current) => ({ ...current, status: "staged", restoredTo: null }));
        report.pendingRestores.push(entry.id);
      }
    }

    fsyncDirectory(this.roots.info);
    return report;
  }

  // =========================================================================
  // Status and doctor
  // =========================================================================

  status(): StoreStatus {
    this.ensureInit();
    const entries = this.list({ includeRestored: true });
    const now = this.clock();
    let bytes = 0;
    let pinned = 0;
    let unuploaded = 0;
    let remoteConfirmed = 0;
    let expired = 0;
    let restored = 0;
    let restoring = 0;
    for (const entry of entries) {
      if (entry.status === "restored") {
        restored += 1;
        continue;
      }
      if (entry.status === "restoring") restoring += 1;
      bytes += entry.sizeBytes;
      if (entry.pinned) pinned += 1;
      if (entry.remote === null) unuploaded += 1;
      else remoteConfirmed += 1;
      if (isExpired(entry.expiresAt, now)) expired += 1;
    }
    const maxTotalBytes = Math.min(this.config.retention.maxTotalBytes, this.config.storage.maxSizeBytes);
    const count = entries.length - restored;
    return {
      roots: this.roots,
      mode: describeMode(this.mode()),
      entries: count,
      bytes,
      pinned,
      unuploaded,
      remoteConfirmed,
      expired,
      restored,
      restoring,
      quota: {
        maxTotalBytes,
        maxEntries: this.config.retention.maxEntries,
        totalBytes: bytes,
        entries: count,
        overBytes: bytes > maxTotalBytes,
        overEntries: count > this.config.retention.maxEntries,
        overQuota: bytes > maxTotalBytes || count > this.config.retention.maxEntries,
        excessBytes: Math.max(0, bytes - maxTotalBytes),
        excessEntries: Math.max(0, count - this.config.retention.maxEntries),
      },
      refusals: tallyRefusals(this.roots.refusals),
      pendingIntents: countDirEntries(this.roots.intents),
      legacyHome: this.roots.legacy,
      oldestCapturedAt: entries.length > 0 ? entries[entries.length - 1]!.capturedAt : null,
      newestCapturedAt: entries.length > 0 ? entries[0]!.capturedAt : null,
    };
  }

  /**
   * `doctor` is a first-class deliverable, not a nicety: a guard that silently
   * isn't installed is worse than no guard, because it produces false
   * confidence (§9, §12). Phase 1 has no hook or daemon to report, and says so
   * rather than implying coverage.
   */
  doctor(): DoctorCheck[] {
    const checks: DoctorCheck[] = [];
    const push = (id: string, status: DoctorCheck["status"], detail: string): void => {
      checks.push({ id, status, detail });
    };

    // `doctor` never throws and never reports a store that merely does not
    // exist yet as broken: it initializes the layout first (which is what every
    // other verb does), and reports an init failure as a CHECK — an operator
    // diagnosing a store cannot be handed a stack trace instead of a report.
    let initError: string | null = null;
    try {
      this.ensureInit();
    } catch (error) {
      initError = (error as Error).message;
    }
    push(
      "store.init",
      initError === null ? "ok" : "fail",
      initError === null ? `store layout present at ${this.roots.state}` : `could not create the store layout: ${initError}`,
    );

    push("store.files", lstatOrNull(this.roots.files)?.isDirectory() ? "ok" : "fail", this.roots.files);
    push("store.info", lstatOrNull(this.roots.info)?.isDirectory() ? "ok" : "fail", this.roots.info);
    push("store.legacy-home", this.roots.legacy ? "warn" : "ok", this.roots.legacy ? `using the legacy home ${this.roots.state}` : "resolver (XDG) roots");

    try {
      const filesDevice = lstatSync(this.roots.files).dev;
      const infoDevice = lstatSync(this.roots.info).dev;
      push(
        "store.same-device",
        filesDevice === infoDevice ? "ok" : "warn",
        filesDevice === infoDevice
          ? `payloads and index share device ${filesDevice}`
          : `payloads on device ${filesDevice}, index on ${infoDevice} — restores are still same-device per entry`,
      );
    } catch (error) {
      push("store.same-device", "fail", `cannot stat the store roots: ${errnoCode(error) ?? String(error)}`);
    }

    const free = freeBytesOrNull(this.roots.files);
    push(
      "capture.free-space",
      free === null || free < this.config.capture.minFreeBytes ? "fail" : "ok",
      free === null
        ? `${this.roots.files} does not exist yet — run \`trash status\` to create the store layout`
        : `${free} bytes free, capture.minFreeBytes is ${this.config.capture.minFreeBytes}`,
    );

    const usage = this.usage();
    const maxBytes = Math.min(this.config.retention.maxTotalBytes, this.config.storage.maxSizeBytes);
    push(
      "retention.quota",
      usage.bytes > maxBytes ? "fail" : usage.bytes > maxBytes * 0.9 ? "warn" : "ok",
      `${usage.bytes}/${maxBytes} bytes, ${usage.entries}/${this.config.retention.maxEntries} entries`,
    );

    try {
      const mode = this.mode();
      push("mode.resolution", mode.kind === "local" ? "warn" : "ok", describeMode(mode));
    } catch (error) {
      push("mode.resolution", "fail", (error as Error).message);
    }

    try {
      this.config;
      push("config.parse", "ok", `${this.roots.config}`);
    } catch (error) {
      push("config.parse", "fail", (error as Error).message);
    }

    const mode = this.mode();
    push(
      "retention.remote-verifier",
      mode.kind === "local" ? "ok" : this.verifyRemote ? "ok" : "fail",
      mode.kind === "local"
        ? "local-only: nothing is expected to be evictable on a remote confirmation"
        : this.verifyRemote
          ? "a remote verifier is configured; every eviction re-verifies at deletion time"
          : "hosted mode with no remote verifier: no payload is evictable (fail closed)",
    );

    const pendingIntents = countDirEntries(this.roots.intents);
    push(
      "store.pending-intents",
      pendingIntents === 0 ? "ok" : "warn",
      pendingIntents === 0 ? "no interrupted captures" : `${pendingIntents} intent file(s) — run recovery`,
    );

    const refusals = tallyRefusals(this.roots.refusals);
    push(
      "capture.refusals",
      refusals.refused > 0 ? "warn" : "ok",
      `${refusals.total} recorded refusal(s): ${refusals.deleted} deleted without capture, ${refusals.refused} refused`,
    );

    push("guard.hook", "warn", "not part of phase 1 — the shell guard (hook-trash-guard) is phase 2, so no delete is intercepted yet");
    push("daemon.timer", "warn", "not part of phase 1 — retention runs on an independent timer in phase 3 (`trash sweep` is manual here)");
    return checks;
  }

  refusals(query?: Parameters<typeof listRefusals>[1]): RefusalRecord[] {
    return listRefusals(this.roots.refusals, query ?? {});
  }

  /** Age of the newest entry — used by status output and the daemon heartbeat. */
  newestAgeMs(): number | null {
    const entries = this.list();
    if (entries.length === 0) return null;
    return ageMs(entries[0]!.capturedAt, this.clock());
  }
}
