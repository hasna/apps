import { appendFileSync, chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, hostname } from "node:os";
import { dirname } from "node:path";
import { join } from "node:path";
import { spawn } from "node:child_process";
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
 * streak's persisted firstFailureAt and the runnerId), outbox appends are
 * idempotent per (event, episodeId), and each update runs inside a
 * short-lived lock file. Every crash window converges to one open event and
 * one recovery event per episode: a crash after the append but before the
 * state write re-derives the SAME episodeId and the deduplicated append skips;
 * a crash before the append is retried from the persisted pending state.
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
  /** Defaults to the package data dir (`LOOPS_DATA_DIR` or `~/.hasna/loops`). */
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
 * Single-writer guard around each read-modify-write cycle. The critical
 * section is µs-scale (bounded state read, bounded outbox scan, one rename),
 * so acquisition is a short bounded retry: contention means another runner
 * process is mid-update, and after the retries the update is SKIPPED — never
 * an exception, never an unbounded wait, so a poll is never meaningfully
 * delayed. A lock older than LOCK_STALE_MS is a crashed holder's residue;
 * takeover uses an atomic RENAME (exactly one contender's rename succeeds) so
 * a live holder's lock is never blindly deleted by a contender.
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

function acquireLock(lockPath: string): number | undefined {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    // Ownership of a successful fd passes to the caller (withLock closes it);
    // a failed openSync never yields an fd, so failure paths need no cleanup.
    try {
      return openSync(lockPath, "wx");
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
          return openSync(lockPath, "wx");
        } catch {
          return undefined;
        }
      }
    }
    if (attempt < LOCK_ATTEMPTS - 1) sleepSync(LOCK_RETRY_MS);
  }
  return undefined;
}

function withLock<T>(lockPath: string, fn: () => T): T | undefined {
  const fd = acquireLock(lockPath);
  if (fd === undefined) return undefined;
  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      // already closed — ignore
    }
    try {
      rmSync(lockPath, { force: true });
    } catch {
      // best effort; stale takeover recovers it
    }
  }
}

export function createRunnerEpisodeRecorder(opts: RunnerEpisodeRecorderOptions = {}): RunnerEpisodeRecorder {
  // A construction failure here must degrade to a no-op recorder, not break the run.
  try {
    const dataDirValue = opts.dataDir ?? defaultDataDir();
    const statePath = opts.statePath ?? runnerEpisodesStatePath(dataDirValue);
    const outboxPath = opts.outboxPath ?? runnerEventsOutboxPath(dataDirValue);
    const lockPath = `${statePath}.lock`;
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

    /** Dedup window for appendEventOnce: the newest lines. An episode's open
     *  and recovery events are adjacent in the outbox modulo a handful of other
     *  runners' episodes, so a bounded tail scan is sufficient — and it keeps
     *  the lock-held critical section µs-scale even as the outbox grows. */
    const OUTBOX_DEDUP_TAIL = 256;

    /**
     * Idempotent outbox append: an event already present for this episodeId is
     * treated as delivered, which is what keeps exactly-once semantics across
     * a crash between append and state write. Returns true when the event is
     * in the outbox (freshly appended or already there).
     */
    function appendEventOnce(event: RunnerEpisodeEvent): boolean {
      mkdirSync(dirname(outboxPath), { recursive: true, mode: 0o700 });
      let tail: string[] = [];
      try {
        tail = readFileSync(outboxPath, "utf8").split("\n").filter((line) => line.trim()).slice(-OUTBOX_DEDUP_TAIL);
      } catch {
        // fresh outbox
      }
      for (const prior of tail) {
        try {
          const parsed = JSON.parse(prior) as Record<string, unknown>;
          if (parsed.evt === event.evt && parsed.episodeId === event.episodeId) return true;
        } catch {
          // tolerate a torn historical line
        }
      }
      appendFileSync(outboxPath, `${JSON.stringify(event)}\n`);
      return true;
    }

    /** Journal + outbox + notifier. Returns true once the event is in the outbox. */
    function emitEvent(event: RunnerEpisodeEvent): boolean {
      const line = JSON.stringify(event);
      try {
        journal(line);
      } catch {
        // a broken journal sink must not stop delivery
      }
      let delivered = false;
      try {
        delivered = appendEventOnce(event);
      } catch {
        // outbox unwritable (read-only fs, full disk): stay pending, retry next poll
      }
      if (notifierCommand) {
        try {
          spawnNotifier(notifierCommand, line);
        } catch {
          // notifier contract: best-effort, never blocking
        }
      }
      return delivered;
    }

    function emitOpen(streak: RunnerEpisodeStreak, lastSuccessAt: string | undefined, nowIso: string): boolean {
      return emitEvent({
        evt: "loops_runner_control_plane_unreachable",
        episodeId: streak.episodeId ?? "",
        runnerId,
        firstFailureAt: streak.firstFailureAt,
        lastFailureAt: streak.lastFailureAt,
        openedAt: nowIso,
        consecutiveCount: streak.consecutiveCount,
        failureClass: streak.failureClass,
        lastSuccessAt: lastSuccessAt ?? null,
      });
    }

    function emitRecovery(streak: RunnerEpisodeStreak, nowIso: string): boolean {
      const first = Date.parse(streak.firstFailureAt);
      return emitEvent({
        evt: "loops_runner_control_plane_recovered",
        episodeId: streak.episodeId ?? "",
        runnerId,
        firstFailureAt: streak.firstFailureAt,
        openedAt: streak.openedAt ?? streak.firstFailureAt,
        recoveredAt: nowIso,
        consecutiveCount: streak.consecutiveCount,
        failureClass: streak.failureClass,
        outageMs: Number.isFinite(first) ? Math.max(0, Date.parse(nowIso) - first) : 0,
      });
    }

    function recordFailure(error: unknown): void {
      try {
        withLock(lockPath, () => {
          const nowIso = now().toISOString();
          const state = readState();
          let streak = state.streak;
          // If the plane flapped back down before a pending recovery event
          // could be delivered, finish that delivery first — the episode
          // genuinely recovered (2 successes landed) before this new failure.
          // STATE-FIRST: recovery_pending is already durable in the state
          // file, so this retry survives crashes; emitRecovery dedupes.
          if (streak?.episodeId && streak.deliveryState === "recovery_pending") {
            if (emitRecovery(streak, nowIso)) streak = undefined;
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
              // STATE-FIRST: persist the pending episode BEFORE any append, so
              // the outbox can never hold an open event the state file does not
              // know about. A crash between this write and the append leaves
              // open_pending — retried below on the next poll; a crash between
              // the append and the confirm-write is healed by the dedup.
              streak.deliveryState = "open_pending";
              writeState({ version: 1, runnerId, streak, lastSuccessAt: state.lastSuccessAt });
              if (emitOpen(streak, state.lastSuccessAt, nowIso)) {
                streak.deliveryState = "open";
              }
            }
          } else if (streak.deliveryState === "open_pending") {
            // Retry the undelivered open event (counts updated silently since).
            if (emitOpen(streak, state.lastSuccessAt, nowIso)) streak.deliveryState = "open";
          }
          writeState({ version: 1, runnerId, streak, lastSuccessAt: state.lastSuccessAt });
        });
      } catch {
        // Episode tracking must never fail the run.
      }
    }

    function recordSuccess(): void {
      try {
        withLock(lockPath, () => {
          const nowIso = now().toISOString();
          const state = readState();
          const streak = state.streak;
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
            if (emitRecovery(streak, nowIso)) {
              writeState(next); // episode closed
            }
            return;
          }
          // Deliver the open event BEFORE any recovery can be observed: a
          // recovery line without its open is a permanently skipped event.
          // Recovery counting waits until the open has actually landed.
          if (streak.deliveryState === "open_pending") {
            if (emitOpen(streak, state.lastSuccessAt, nowIso)) streak.deliveryState = "open";
            else {
              writeState({ ...next, streak });
              return;
            }
          }
          streak.consecutiveSuccesses = (streak.consecutiveSuccesses ?? 0) + 1;
          if (streak.consecutiveSuccesses >= EPISODE_CLOSE_SUCCESSES) {
            // STATE-FIRST: persist recovery_pending BEFORE the append, so a
            // crash between them leaves a retryable state rather than a lost
            // recovery event.
            streak.deliveryState = "recovery_pending";
            writeState({ ...next, streak });
            if (emitRecovery(streak, nowIso)) {
              writeState(next); // episode closed
              return;
            }
          }
          writeState({ ...next, streak });
        });
      } catch {
        // Episode tracking must never fail the run.
      }
    }

    return { recordFailure, recordSuccess };
  } catch {
    return { recordFailure: () => {}, recordSuccess: () => {} };
  }
}

function defaultDataDir(): string {
  // Mirrors src/lib/paths.ts dataDir() resolution: honor a runtime HOME
  // override (os.homedir() snapshots HOME at process start under Bun).
  const env = process.env;
  if (env.LOOPS_DATA_DIR?.trim()) return env.LOOPS_DATA_DIR.trim();
  const home = env.HOME?.trim();
  const base = home ? home : homedir();
  return join(base, ".hasna", "loops");
}
