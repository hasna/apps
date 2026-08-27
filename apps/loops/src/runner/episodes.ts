import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { dataDir } from "../lib/paths.js";
import { LoopsApiError, RunnerRefusalError } from "./errors.js";

/**
 * Runner failure episodes.
 *
 * Measured 2026-08-20/21: the control plane was broken for 16 hours and the
 * runner knew — 822 consecutive claim failures — but all it could do was
 * write one opaque journal line per poll, and a oneshot timer lost even the
 * in-memory streak at every process exit. Nobody saw anything until a human
 * looked. This module gives the runner ONE persisted failure episode per
 * outage: state on disk (surviving process exits), ONE structured event when
 * the episode opens, silent count updates while it stays open, and ONE
 * recovery event when the plane comes back.
 *
 * OPACITY (binding): episode state and events carry NO error text — only a
 * normalized failure class derived from safe signals (instanceof against this
 * package's own error types, numeric HTTP status), and a sanitized runnerId.
 * Foreign error messages are exactly where credentials have been observed to
 * live, so they are never interpolated, logged, or persisted here.
 *
 * DELIVERY BOUNDARY (binding): this package owns detection plus a generic
 * outbox/notifier hook. There is NO hardcoded destination (no #incidents, no
 * conversations dependency): fleet deployment binds
 * `LOOPS_RUNNER_NOTIFIER_CMD` and reads the outbox file. The runner never
 * blocks on escalation: notifier and state I/O failures are swallowed and
 * retried on the next poll, and lock contention SKIPS an update rather than
 * waiting — a poll is never delayed by episode tracking.
 *
 * EXACTLY-ONCE EVENTS: the episodeId is deterministic (derived from the
 * streak's persisted firstFailureAt and the runnerId), and each update runs
 * inside a short-lived lock file. Every crash window converges to one open
 * event and one recovery event per episode.
 *
 * DELIVERY-CONFIRMATION STATE (findings F3/F4 of the PR #778 successor):
 * dedup lives in the STATE FILE, never in a scan of the outbox history. Each
 * append attempt records, in the same state write that marks the event
 * pending, the outbox byte offset at which the attempt begins
 * (`streak.pendingAppend.fromOffset`). A retry then scans EXACTLY the bytes
 * appended since that offset — by construction the only region that can hold
 * the attempted line (appends are O_APPEND single writes, and the offset is
 * taken before the append). The scan is bounded by the inter-attempt delta
 * (normally zero), never by the outbox's size or history, and it cannot miss:
 * if the earlier append landed, its line is inside the window. A fresh emit
 * (no pending record) appends directly without any scan. The notifier fires
 * ONLY when the append is freshly made — a retry that finds the event already
 * present (lost confirm-write) deduplicates and does not re-notify.
 *
 * CONTENTION-PERSISTED SUCCESSES (finding F2): a success observed while the
 * lock is contended used to be dropped — the recovery transition was lost if
 * those were the final two successes before the runner exited. Contended
 * successes now append one line to `<statePath>.success-intent.jsonl`
 * (no lock needed — single atomic O_APPEND writes), and the next lock holder
 * drains them under the lock BEFORE applying its own observation, so the
 * recovery transition is never lost, only deferred by the contention window.
 *
 * OWNERSHIP-CHECKED LOCK RELEASE (finding F5): each lock file carries a
 * per-acquisition token. A holder deletes the lock ONLY if it still owns it
 * (the file content is still its token). A displaced live holder — whose lock
 * was taken over after a 10s-stale takeover — therefore can never delete the
 * successor's lock, so a critical section cannot open a concurrent entry.
 *
 * The critical section is µs-scale (bounded state read, bounded append
 * window, one rename), so acquisition is a short bounded retry: contention
 * means another runner process is mid-update, and after the retries the
 * update is SKIPPED (or, for successes, persisted as an intent) — never an
 * exception, never an unbounded wait.
 */

/** Episode opens after this many consecutive claim/poll failures… */
export const EPISODE_OPEN_CONSECUTIVE_FAILURES = 3;
/** …whose streak spans at least this long (a 3-flicker blip is not an outage). */
export const EPISODE_OPEN_SPAN_MS = 120_000;
/** Episode closes after this many consecutive successful polls. */
export const EPISODE_CLOSE_SUCCESSES = 2;

/** Environment variable holding the optional notifier command (fleet binding surface). */
export const LOOPS_RUNNER_NOTIFIER_CMD_ENV = "LOOPS_RUNNER_NOTIFIER_CMD";

/** A notifier that has not exited by this point is killed; escalation must not accumulate orphans. */
export const NOTIFIER_KILL_MS = 30_000;

export type RunnerFailureClass = "connectivity" | "http_5xx" | "auth" | "contract" | "refusal";

export function classifyRunnerFailure(error: unknown): RunnerFailureClass {
  if (error instanceof RunnerRefusalError) return "refusal";
  if (error instanceof LoopsApiError) {
    if (error.status === 401 || error.status === 403) return "auth";
    if (error.status >= 500) return "http_5xx";
    return "contract";
  }
  // Foreign errors (fetch rejections, DNS failures, sockets) classify by
  // category only — their text is never read.
  return "connectivity";
}

export type RunnerEpisodeDeliveryState = "counting" | "open" | "open_pending" | "recovery_pending";

export interface RunnerEpisodeStreak {
  firstFailureAt: string;
  lastFailureAt: string;
  consecutiveCount: number;
  failureClass: RunnerFailureClass;
  /** Present once the streak has become an episode. */
  episodeId?: string;
  openedAt?: string;
  /** Consecutive successful polls since the episode opened (close at 2). */
  consecutiveSuccesses?: number;
  deliveryState: RunnerEpisodeDeliveryState;
  /**
   * Delivery-confirmation state (findings F3/F4): present while the event
   * this episode is currently trying to deliver (the open event while
   * `deliveryState === "open_pending"`, the recovery event while
   * `"recovery_pending"`) has had an append attempt whose confirm-write is
   * not yet durable. `fromOffset` is the outbox byte size when the attempt
   * began; a retry scans exactly `[fromOffset..EOF]` — the only region that
   * can hold the attempted line. Absent means no append has been attempted
   * (fresh emits append directly, no scan).
   */
  pendingAppend?: { fromOffset: number; attemptedAt: string };
}

/** Shape of `<dataDir>/runner-episodes.json`. `streak` doubles as the pre-open failure counter. */
export interface RunnerEpisodesFile {
  version: 1;
  runnerId?: string;
  streak?: RunnerEpisodeStreak;
  lastSuccessAt?: string;
}

export type RunnerEpisodeEvent =
  | {
      evt: "loops_runner_control_plane_unreachable";
      episodeId: string;
      runnerId: string;
      firstFailureAt: string;
      lastFailureAt: string;
      openedAt: string;
      consecutiveCount: number;
      failureClass: RunnerFailureClass;
      lastSuccessAt: string | null;
    }
  | {
      evt: "loops_runner_control_plane_recovered";
      episodeId: string;
      runnerId: string;
      firstFailureAt: string;
      openedAt: string;
      recoveredAt: string;
      consecutiveCount: number;
      failureClass: RunnerFailureClass;
      outageMs: number;
    };

export interface RunnerEpisodeRecorder {
  /** Record one failed claim/poll. Never throws. */
  recordFailure(error: unknown): void;
  /** Record one successful poll. Never throws. */
  recordSuccess(): void;
}

export interface RunnerEpisodeRecorderOptions {
  /** Defaults to the package data dir (resolved through @hasna/paths, `LOOPS_DATA_DIR` or `~/.hasna/loops` until the XDG home is adopted). */
  dataDir?: string;
  statePath?: string;
  outboxPath?: string;
  /** Defaults to `$LOOPS_RUNNER_NOTIFIER_CMD` when unset here. */
  notifierCommand?: string;
  runnerId?: string;
  now?: () => Date;
  /** Structured journal sink; defaults to `console.error`. */
  journal?: (line: string) => void;
  /** Notifier launcher; defaults to a detached `spawn` whose failures are swallowed. */
  spawnNotifier?: (command: string, payload: string) => void;
}

export function runnerEpisodesStatePath(dataDirValue: string): string {
  return join(dataDirValue, "runner-episodes.json");
}

export function runnerEventsOutboxPath(dataDirValue: string): string {
  return join(dataDirValue, "runner-events.outbox.jsonl");
}

/**
 * Runner ids reach state files, journal lines, and escalation events, so a
 * caller-controlled `--runner-id` is validated BEFORE it is ever persisted or
 * emitted: an id matching the conservative identifier shape passes unchanged,
 * and anything else (URLs, connection strings, free text) is replaced with
 * `unknown` in full — partial masking would leave attacker-chosen readable
 * text embedded in durable surfaces.
 */
function sanitizeRunnerId(value: string | undefined): string {
  const candidate = (value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(candidate) ? candidate : "unknown";
}

function defaultRunnerId(env: NodeJS.ProcessEnv = process.env): string {
  return env.LOOPS_RUNNER_ID?.trim() || env.LOOPS_RUNNER_MACHINE_ID?.trim() || env.HASNA_MACHINE_ID?.trim() || hostname();
}

/**
 * Deterministic per-episode identity: derived from the streak's persisted
 * firstFailureAt plus a hash of the runnerId. Two outages never collide (they
 * start at different instants); a crash-and-restart during the SAME outage
 * re-derives the SAME id, which is what makes outbox appends idempotent and
 * the exactly-one-event-per-episode property hold across lost state writes.
 */
function episodeIdFor(firstFailureAt: string, runnerId: string): string {
  const stamp = firstFailureAt.replace(/[^0-9A-Za-z]/g, "");
  const digest = createHash("sha256").update(runnerId).digest("hex").slice(0, 8);
  return `ep_${stamp}_${digest}`;
}

function defaultSpawnNotifier(command: string, payload: string, killMs: number = NOTIFIER_KILL_MS): void {
  // Escalation is best-effort by contract: a dead notifier command must never
  // fail, block, or zombie the run. Every error path is swallowed, and a
  // notifier that never exits is killed so events cannot accumulate orphans.
  const launch = (shell: boolean): ReturnType<typeof spawn> =>
    spawn(command, { shell, stdio: ["pipe", "ignore", "ignore"], detached: true });
  let child: ReturnType<typeof spawn>;
  try {
    child = launch(true);
  } catch {
    return;
  }
  child.on("error", () => {
    // `sh -c` itself unavailable (minimal/sandboxed environments): one retry
    // with a plain argv split, still fully detached and still best-effort.
    try {
      const direct = launch(false);
      wireNotifier(direct, payload, killMs);
    } catch {
      // no notifier lane at all — the outbox remains the durable surface
    }
  });
  wireNotifier(child, payload, killMs);
}

function wireNotifier(child: ReturnType<typeof spawn>, payload: string, killMs: number): void {
  child.on("error", () => {});
  child.stdin?.on("error", () => {});
  const killer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }, killMs);
  killer.unref?.();
  child.once("exit", () => clearTimeout(killer));
  try {
    child.stdin?.end(`${payload}\n`);
  } catch {
    // already closed — ignore
  }
  child.unref();
}

/**
 * Single-writer guard around each read-modify-write cycle. A lock older than
 * LOCK_STALE_MS is a crashed holder's residue; takeover uses an atomic RENAME
 * (exactly one contender's rename succeeds). Finding F5: a displaced STILL
 * LIVE holder (its section exceeded the staleness window) must never delete
 * the successor's lock — every lock file carries the acquirer's token, and
 * release deletes the file only if its content is still that token.
 */
const LOCK_STALE_MS = 10_000;
const LOCK_ATTEMPTS = 8;
const LOCK_SPIN_ATTEMPTS = 4;
const LOCK_RETRY_MS = 15;

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // no sync sleep available: spin without it
  }
}

/** Atomic stale takeover: rename the stale lock aside (one winner), then create ours. */
function takeOverStaleLock(lockPath: string): boolean {
  const mine = `${lockPath}.${process.pid}.${Date.now()}.takeover`;
  try {
    renameSync(lockPath, mine);
  } catch {
    return false; // another contender won the rename, or it already vanished
  }
  try {
    rmSync(mine, { force: true });
  } catch {
    // residue from a crashed takeover attempt; harmless, the next takeover clears it
  }
  return true;
}

export interface StateLock {
  /** The open writable fd; ownership of it passes to the caller (releaseStateLock closes it). */
  fd: number;
  /** Unique per-acquisition identity, written into the lock file. */
  token: string;
}

/**
 * Create the state lock with O_EXCL and stamp it with our token. Returns
 * undefined on contention (bounded retries) or an unexpected failure. The
 * token is what makes release ownership-checked (finding F5): only the holder
 * whose token still sits in the file may delete it.
 */
export function acquireStateLock(lockPath: string): StateLock | undefined {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      const fd = openSync(lockPath, "wx");
      const token = `${process.pid}.${randomBytes(8).toString("hex")}`;
      try {
        writeSync(fd, token);
      } catch {
        // The lock could not be stamped: abandon it. It is seconds-fresh, so
        // no takeover can have displaced it yet — removing it is safe.
        try {
          closeSync(fd);
        } catch {
          // ignore
        }
        try {
          rmSync(lockPath, { force: true });
        } catch {
          // ignore
        }
        return undefined;
      }
      return { fd, token };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") return undefined; // unexpected failure: skip silently
    }
    if (attempt >= LOCK_SPIN_ATTEMPTS) {
      let stale = false;
      try {
        stale = Date.now() - statSync(lockPath).mtimeMs >= LOCK_STALE_MS;
      } catch {
        // lock vanished between open and stat: plain retry
      }
      if (stale && takeOverStaleLock(lockPath)) {
        try {
          const fd = openSync(lockPath, "wx");
          const token = `${process.pid}.${randomBytes(8).toString("hex")}`;
          try {
            writeSync(fd, token);
          } catch {
            // The lock could not be stamped: abandon it (fresh, no takeover
            // can have displaced it yet).
            try {
              closeSync(fd);
            } catch {
              // ignore
            }
            try {
              rmSync(lockPath, { force: true });
            } catch {
              // ignore
            }
            return undefined;
          }
          return { fd, token };
        } catch {
          return undefined;
        }
      }
    }
    if (attempt < LOCK_ATTEMPTS - 1) sleepSync(LOCK_RETRY_MS);
  }
  return undefined;
}

/**
 * Release the state lock (finding F5): delete the lock file only if it still
 * holds OUR token. A lock file holding a different token was created by a
 * successor after a stale takeover — deleting it would open a concurrent
 * entry while that successor is mid-critical-section. A missing file (the
 * takeover already renamed ours aside) is nothing to do.
 */
export function releaseStateLock(lockPath: string, fd: number, token: string): void {
  try {
    closeSync(fd);
  } catch {
    // already closed — ignore
  }
  try {
    const current = readFileSync(lockPath, "utf8");
    if (current === token) rmSync(lockPath, { force: true });
    // token mismatch: a successor owns the path now — never delete it.
  } catch {
    // lock already gone (takeover renamed/removed it, or another release) — nothing to do
  }
}

/**
 * Run `fn` under the state lock. Returns `{ value: fn() }` on success and
 * `undefined` when the lock could not be acquired within the bounded retry —
 * the caller decides whether to skip or to persist the observation (finding
 * F2: successes are persisted as intents so no transition is lost).
 */
function withLock<T>(lockPath: string, fn: () => T): { value: T } | undefined {
  const lock = acquireStateLock(lockPath);
  if (lock === undefined) return undefined;
  try {
    return { value: fn() };
  } finally {
    releaseStateLock(lockPath, lock.fd, lock.token);
  }
}

export function createRunnerEpisodeRecorder(opts: RunnerEpisodeRecorderOptions = {}): RunnerEpisodeRecorder {
  // A construction failure here must degrade to a no-op recorder, not break the run.
  try {
    const dataDirValue = opts.dataDir ?? dataDir();
    const statePath = opts.statePath ?? runnerEpisodesStatePath(dataDirValue);
    const outboxPath = opts.outboxPath ?? runnerEventsOutboxPath(dataDirValue);
    const lockPath = `${statePath}.lock`;
    /** Finding F2: contended successes are durable here until the next lock holder drains them. */
    const successIntentPath = `${statePath}.success-intent.jsonl`;
    const notifierCommand = opts.notifierCommand ?? (process.env[LOOPS_RUNNER_NOTIFIER_CMD_ENV]?.trim() || undefined);
    const runnerId = sanitizeRunnerId(opts.runnerId ?? defaultRunnerId());
    const now = opts.now ?? (() => new Date());
    const journal = opts.journal ?? ((line: string) => console.error(line));
    const spawnNotifier = opts.spawnNotifier ?? defaultSpawnNotifier;

    function readState(): RunnerEpisodesFile {
      try {
        const raw = readFileSync(statePath, "utf8");
        const parsed = JSON.parse(raw) as RunnerEpisodesFile;
        return parsed && parsed.version === 1 ? parsed : { version: 1 };
      } catch {
        return { version: 1 };
      }
    }

    /** tmp+rename so a crash mid-write never leaves a half-written state file. */
    function writeState(state: RunnerEpisodesFile): void {
      mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
      const tmpPath = `${statePath}.tmp`;
      writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      renameSync(tmpPath, statePath);
    }

    /** Byte size of the outbox at this instant (0 when absent/rotated). */
    function outboxSize(): number {
      try {
        return statSync(outboxPath).size;
      } catch {
        return 0;
      }
    }

    /**
     * Finding F4: does the outbox hold `event` among the bytes appended since
     * `fromOffset`? The caller records `fromOffset` (the outbox size) BEFORE
     * its append attempt, in the same state write that marks the event
     * pending. Any line this recorder appended for that attempt landed at or
     * after `fromOffset` (O_APPEND single write), so the window
     * `[fromOffset..EOF]` provably contains the attempted line if it exists —
     * dedup is exact, and the read is bounded by the inter-attempt delta, not
     * by the outbox history. Rotation/truncation clamps the window to the
     * current file (the old line is gone; a fresh append is correct).
     */
    function outboxHasEventSince(fromOffset: number, event: RunnerEpisodeEvent): boolean {
      let size = 0;
      try {
        size = statSync(outboxPath).size;
      } catch {
        return false; // outbox absent — nothing of ours can be there
      }
      const start = Math.min(fromOffset, size);
      if (start >= size) return false;
      const fd = openSync(outboxPath, "r");
      try {
        const buf = Buffer.alloc(size - start);
        const read = readSync(fd, buf, 0, size - start, start);
        const tail = buf.subarray(0, read).toString("utf8");
        for (const line of tail.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>;
            if (parsed.evt === event.evt && parsed.episodeId === event.episodeId) return true;
          } catch {
            // a torn historical line (concurrent append mid-write): tolerate and keep scanning
          }
        }
        return false;
      } finally {
        try {
          closeSync(fd);
        } catch {
          // ignore
        }
      }
    }

    /**
     * One outbox delivery attempt. Returns:
     *  - "delivered_fresh"   — the event was appended NOW (notifier fires);
     *  - "delivered_present" — the event was already in the outbox from an
     *    earlier attempt whose confirm-write was lost (dedup — the notifier
     *    must NOT re-fire; finding F3);
     *  - "failed"            — the outbox is unwritable; stay pending and
     *    retry on the next poll.
     */
    type EmitResult = "delivered_fresh" | "delivered_present" | "failed";
    function emitEvent(event: RunnerEpisodeEvent, pendingAppend: { fromOffset: number } | undefined): EmitResult {
      const line = JSON.stringify(event);
      try {
        journal(line);
      } catch {
        // a broken journal sink must not stop delivery
      }
      try {
        if (pendingAppend && outboxHasEventSince(pendingAppend.fromOffset, event)) {
          return "delivered_present";
        }
        mkdirSync(dirname(outboxPath), { recursive: true, mode: 0o700 });
        appendFileSync(outboxPath, `${line}\n`, { mode: 0o600 });
      } catch {
        return "failed"; // outbox unwritable (read-only fs, full disk): stay pending, retry next poll
      }
      if (notifierCommand) {
        try {
          spawnNotifier(notifierCommand, line);
        } catch {
          // notifier contract: best-effort, never blocking
        }
      }
      return "delivered_fresh";
    }

    function openEvent(streak: RunnerEpisodeStreak, lastSuccessAt: string | undefined, nowIso: string): RunnerEpisodeEvent {
      return {
        evt: "loops_runner_control_plane_unreachable",
        episodeId: streak.episodeId ?? "",
        runnerId,
        firstFailureAt: streak.firstFailureAt,
        lastFailureAt: streak.lastFailureAt,
        openedAt: nowIso,
        consecutiveCount: streak.consecutiveCount,
        failureClass: streak.failureClass,
        lastSuccessAt: lastSuccessAt ?? null,
      };
    }

    function recoveryEvent(streak: RunnerEpisodeStreak, nowIso: string): RunnerEpisodeEvent {
      const first = Date.parse(streak.firstFailureAt);
      return {
        evt: "loops_runner_control_plane_recovered",
        episodeId: streak.episodeId ?? "",
        runnerId,
        firstFailureAt: streak.firstFailureAt,
        openedAt: streak.openedAt ?? streak.firstFailureAt,
        recoveredAt: nowIso,
        consecutiveCount: streak.consecutiveCount,
        failureClass: streak.failureClass,
        outageMs: Number.isFinite(first) ? Math.max(0, Date.parse(nowIso) - first) : 0,
      };
    }

    /** STATE-FIRST for a delivery attempt: mark the event pending AND record
     *  the append window BEFORE any append, so a crash at any point leaves a
     *  state from which the retry can decide exactly-once. */
    function beginDelivery(streak: RunnerEpisodeStreak, nowIso: string): void {
      streak.pendingAppend = { fromOffset: outboxSize(), attemptedAt: nowIso };
    }

    /**
     * Finding F2: drain persisted success intents (successes observed under
     * lock contention). Returns how many were drained; the caller applies them
     * to the streak under the lock. Reading then unlinking has a tiny
     * double-count window on a crash between the two — double-counted
     * successes only close an episode one poll early (the recovery emit is
     * idempotent per episodeId), never drop a transition.
     */
    function drainContendedSuccesses(): number {
      let count = 0;
      try {
        const raw = readFileSync(successIntentPath, "utf8");
        for (const line of raw.split("\n")) if (line.trim()) count += 1;
      } catch {
        return 0; // no intents
      }
      try {
        rmSync(successIntentPath, { force: true });
      } catch {
        // leave it; a double-count of a success is benign (see above)
      }
      return count;
    }

    /** Apply N persisted contended successes to the current state, emitting
     *  the recovery when they close the episode. Runs under the lock. */
    function applyContendedSuccesses(state: RunnerEpisodesFile, count: number, nowIso: string): void {
      const streak = state.streak;
      if (!streak) return; // no episode: successes after a closed episode are no-ops
      if (!streak.episodeId) {
        // A success broke the pre-episode failure streak.
        state.streak = undefined;
        return;
      }
      streak.consecutiveSuccesses = (streak.consecutiveSuccesses ?? 0) + count;
      if (streak.consecutiveSuccesses >= EPISODE_CLOSE_SUCCESSES && streak.deliveryState === "open") {
        // STATE-FIRST for the recovery: persist recovery_pending + the append
        // window BEFORE the append; the emit dedups any earlier attempt.
        streak.deliveryState = "recovery_pending";
        beginDelivery(streak, nowIso);
        writeState({ version: 1, runnerId, streak, lastSuccessAt: state.lastSuccessAt });
        if (emitEvent(recoveryEvent(streak, nowIso), streak.pendingAppend) !== "failed") {
          state.streak = undefined; // episode closed
        }
      }
    }

    function recordFailure(error: unknown): void {
      try {
        withLock(lockPath, () => {
          const nowIso = now().toISOString();
          const state = readState();
          let streak = state.streak;
          // Finding F2: successes observed during earlier contention land
          // before this observation — if they close the episode, the recovery
          // emits before the new failure starts a fresh streak.
          const drained = drainContendedSuccesses();
          if (drained > 0) applyContendedSuccesses(state, drained, nowIso);
          streak = state.streak;
          // If the plane flapped back down before a pending recovery event
          // could be delivered, finish that delivery first — the episode
          // genuinely recovered (2 successes landed) before this new failure.
          // STATE-FIRST: recovery_pending is already durable in the state
          // file, so this retry survives crashes; the append dedups.
          if (streak?.episodeId && streak.deliveryState === "recovery_pending") {
            if (emitEvent(recoveryEvent(streak, nowIso), streak.pendingAppend) !== "failed") {
              streak = undefined;
            }
          }
          const failureClass = classifyRunnerFailure(error);
          if (!streak) {
            streak = {
              firstFailureAt: nowIso,
              lastFailureAt: nowIso,
              consecutiveCount: 0,
              failureClass,
              deliveryState: "counting",
            };
          }
          streak.consecutiveCount += 1;
          streak.lastFailureAt = nowIso;
          streak.failureClass = failureClass;
          streak.consecutiveSuccesses = 0;
          if (!streak.episodeId) {
            const spanMs = Date.parse(streak.lastFailureAt) - Date.parse(streak.firstFailureAt);
            if (streak.consecutiveCount >= EPISODE_OPEN_CONSECUTIVE_FAILURES && spanMs >= EPISODE_OPEN_SPAN_MS) {
              streak.episodeId = episodeIdFor(streak.firstFailureAt, runnerId);
              streak.openedAt = nowIso;
              // STATE-FIRST: persist the pending episode (and the append
              // window) BEFORE any append, so the outbox can never hold an
              // open event the state file does not know about. A crash
              // between this write and the append leaves open_pending —
              // retried below on the next poll; a crash between the append
              // and the confirm-write is healed by the windowed dedup.
              streak.deliveryState = "open_pending";
              beginDelivery(streak, nowIso);
              writeState({ version: 1, runnerId, streak, lastSuccessAt: state.lastSuccessAt });
              if (emitEvent(openEvent(streak, state.lastSuccessAt, nowIso), streak.pendingAppend) !== "failed") {
                streak.deliveryState = "open";
                streak.pendingAppend = undefined;
              }
            }
          } else if (streak.deliveryState === "open_pending") {
            // Retry the undelivered open event (counts updated silently since).
            if (emitEvent(openEvent(streak, state.lastSuccessAt, nowIso), streak.pendingAppend) !== "failed") {
              streak.deliveryState = "open";
              streak.pendingAppend = undefined;
            }
          }
          writeState({ version: 1, runnerId, streak, lastSuccessAt: state.lastSuccessAt });
        });
      } catch {
        // Episode tracking must never fail the run.
      }
    }

    function recordSuccess(): void {
      try {
        const outcome = withLock(lockPath, () => {
          const nowIso = now().toISOString();
          const state = readState();
          let streak = state.streak;
          // Finding F2: apply any successes persisted during earlier
          // contention BEFORE counting this observation.
          const drained = drainContendedSuccesses();
          if (drained > 0) {
            applyContendedSuccesses(state, drained, nowIso);
            streak = state.streak;
          }
          const next: RunnerEpisodesFile = { version: 1, runnerId, lastSuccessAt: nowIso };
          if (!streak) {
            writeState(next);
            return;
          }
          if (!streak.episodeId) {
            // Failures never became an episode; the streak is broken. The
            // state-first ordering guarantees an open event in the outbox
            // always has a matching open_pending/open episode in the state
            // file, so clearing here can never orphan a delivered open.
            writeState(next);
            return;
          }
          // A still-undelivered recovery (crash between the pending write and
          // the append): finish it before anything else — this success cannot
          // belong to the closed episode.
          if (streak.deliveryState === "recovery_pending") {
            if (emitEvent(recoveryEvent(streak, nowIso), streak.pendingAppend) !== "failed") {
              writeState(next); // episode closed
            }
            return;
          }
          // Deliver the open event BEFORE any recovery can be observed: a
          // recovery line without its open is a permanently skipped event.
          // Recovery counting waits until the open has actually landed.
          if (streak.deliveryState === "open_pending") {
            if (emitEvent(openEvent(streak, state.lastSuccessAt, nowIso), streak.pendingAppend) !== "failed") {
              streak.deliveryState = "open";
              streak.pendingAppend = undefined;
            } else {
              writeState({ ...next, streak });
              return;
            }
          }
          streak.consecutiveSuccesses = (streak.consecutiveSuccesses ?? 0) + 1;
          if (streak.consecutiveSuccesses >= EPISODE_CLOSE_SUCCESSES) {
            // STATE-FIRST: persist recovery_pending + the append window
            // BEFORE the append, so a crash between them leaves a retryable
            // state rather than a lost recovery event.
            streak.deliveryState = "recovery_pending";
            beginDelivery(streak, nowIso);
            writeState({ ...next, streak });
            if (emitEvent(recoveryEvent(streak, nowIso), streak.pendingAppend) !== "failed") {
              writeState(next); // episode closed
              return;
            }
          }
          writeState({ ...next, streak });
        });
        if (outcome === undefined) {
          // Finding F2: the lock was contended — the success observation must
          // not be dropped (if these were the final two successes before the
          // runner exits, the recovery transition would be lost forever).
          // Persist the success as a durable intent; the next lock holder
          // drains it under the lock and the recovery it completes is emitted.
          try {
            mkdirSync(dirname(successIntentPath), { recursive: true, mode: 0o700 });
            appendFileSync(successIntentPath, `${now().toISOString()}\n`, { mode: 0o600 });
          } catch {
            // Even the intent is unwritable: the observation is dropped, but
            // the run must never fail because of it.
          }
        }
      } catch {
        // Episode tracking must never fail the run.
      }
    }

    return { recordFailure, recordSuccess };
  } catch {
    return { recordFailure: () => {}, recordSuccess: () => {} };
  }
}

