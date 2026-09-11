/**
 * Store construction for tests.
 *
 * Two things every test store must have, and gets from here:
 *
 *  - a `--spool` root INSIDE the sandbox, so `~/.hasna/trash` is unreachable
 *    even by accident, and
 *  - a `capture.minFreeBytes` small enough to be about the code rather than
 *    about how much disk the CI machine has (the 2 GiB production default
 *    would refuse every capture on a full runner — which is the correct
 *    production behaviour and a useless test fixture).
 */

import { TrashStore, type TrashStoreOptions } from "../lib/store.js";
import { mergeTrashConfig, type TrashConfigPatch } from "../lib/config.js";
import { createEntry, type TrashEntry } from "../lib/entry.js";
import { retentionExpiresAt } from "../lib/expiry.js";
import type { Sandbox } from "./sandbox.js";
import { testEnv } from "./sandbox.js";

export interface TestStoreOptions {
  /** Spool directory; defaults to `<sandbox>/spool`. */
  spool?: string;
  /** Section-wise config overrides merged over the defaults. */
  config?: TrashConfigPatch;
  verifyRemote?: TrashStoreOptions["verifyRemote"];
  upload?: TrashStoreOptions["upload"];
  crashAt?: TrashStoreOptions["crashAt"];
  now?: () => number;
  env?: NodeJS.ProcessEnv;
}

export const TEST_CAPTURE_DEFAULTS = {
  minFreeBytes: 1_048_576,
} as const;

export function makeTestStore(sandbox: Sandbox, options: TestStoreOptions = {}): TrashStore {
  const env = options.env ?? testEnv(sandbox);
  const spool = options.spool ?? sandbox.path("spool");
  return new TrashStore({
    env,
    roots: { root: spool },
    config: mergeTrashConfig({
      ...options.config,
      capture: { ...TEST_CAPTURE_DEFAULTS, ...(options.config?.capture ?? {}) },
    }),
    verifyRemote: options.verifyRemote,
    upload: options.upload,
    crashAt: options.crashAt,
    now: options.now,
  });
}

/** A config that makes an un-flagged sweep act (the unattended-daemon posture). */
export function applyingConfig(): TrashConfigPatch {
  return { retention: { requireExplicitApply: false, dryRun: false } };
}

/**
 * A deterministic UUID for a readable test label.
 *
 * Entry ids are UUIDs by contract (`assertSafeEntryId` — an id becomes a file
 * name), so a test cannot just call an entry `"e1"`. This keeps the tests
 * readable without weakening the check.
 */
export function fixtureId(label: string): string {
  const hex = Array.from(label)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .padEnd(12, "0")
    .slice(0, 12);
  return `00000000-0000-4000-8000-${hex}`;
}

export interface MakeEntryOptions {
  id?: string;
  capturedAt?: string;
  retentionDays?: number | null;
  sizeBytes?: number;
  remote?: TrashEntry["remote"];
  pinned?: boolean;
  status?: TrashEntry["status"];
  originalPath?: string;
}

/** Build an entry document for the pure-retention tests. */
export function makeEntry(options: MakeEntryOptions = {}): TrashEntry {
  const capturedAt = options.capturedAt ?? new Date().toISOString();
  const retentionDays = options.retentionDays === undefined ? 30 : options.retentionDays;
  return createEntry({
    id: options.id,
    originalPath: options.originalPath ?? `/fixture/${options.id ?? "entry"}`,
    givenPath: options.originalPath ?? "fixture",
    capturedAt,
    kind: "file",
    sizeBytes: options.sizeBytes ?? 100,
    sha256: "a".repeat(64),
    device: 1,
    inode: 1,
    nlink: 1,
    mode: 0o644,
    retentionDays,
    expiresAt: retentionExpiresAt(capturedAt, retentionDays),
    pinned: options.pinned,
  });
}

/** An entry with the given fields applied (status/remote are set post-create). */
export function makeEntryWith(remote: TrashEntry["remote"], status: TrashEntry["status"], options: MakeEntryOptions = {}): TrashEntry {
  const entry = makeEntry(options);
  return { ...entry, remote, status };
}

/** A sentinel used by the crash tests to abort a capture at a chosen boundary. */
export class CrashSentinel extends Error {
  constructor(public readonly point: string) {
    super(`simulated crash at ${point}`);
    this.name = "CrashSentinel";
  }
}

export function crashingAt(...points: string[]): TrashStoreOptions["crashAt"] {
  return (point) => {
    if (points.includes(point)) throw new CrashSentinel(point);
  };
}
