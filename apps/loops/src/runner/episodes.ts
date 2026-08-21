import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
 * package's own error types, numeric HTTP status). Foreign error messages are
 * exactly where credentials have been observed to live, so they are never
 * interpolated, logged, or persisted here.
 *
 * DELIVERY BOUNDARY (binding): this package owns detection plus a generic
 * outbox/notifier hook. There is NO hardcoded destination (no #incidents, no
 * conversations dependency): fleet deployment binds
 * `LOOPS_RUNNER_NOTIFIER_CMD` and reads the outbox file. The runner never
 * blocks on escalation: notifier and state I/O failures are swallowed and
 * retried on the next poll.
 */

/** Episode opens after this many consecutive claim/poll failures… */
export const EPISODE_OPEN_CONSECUTIVE_FAILURES = 3;
/** …whose streak spans at least this long (a 3-flicker blip is not an outage). */
export const EPISODE_OPEN_SPAN_MS = 120_000;
/** Episode closes after this many consecutive successful polls. */
export const EPISODE_CLOSE_SUCCESSES = 2;

/** Environment variable holding the optional notifier command (fleet binding surface). */
export const LOOPS_RUNNER_NOTIFIER_CMD_ENV = "LOOPS_RUNNER_NOTIFIER_CMD";

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

function defaultRunnerId(env: NodeJS.ProcessEnv = process.env): string {
  return env.LOOPS_RUNNER_ID?.trim() || env.LOOPS_RUNNER_MACHINE_ID?.trim() || env.HASNA_MACHINE_ID?.trim() || hostname();
}

function defaultSpawnNotifier(command: string, payload: string): void {
  const child = spawn(command, { shell: true, stdio: ["pipe", "ignore", "ignore"], detached: true });
  // Escalation is best-effort by contract: a dead notifier command must never
  // fail, block, or zombie the run. Every error path is swallowed.
  child.on("error", () => {});
  child.stdin?.on("error", () => {});
  try {
    child.stdin?.end(`${payload}\n`);
  } catch {
    // already closed — ignore
  }
  child.unref();
}

export function createRunnerEpisodeRecorder(opts: RunnerEpisodeRecorderOptions = {}): RunnerEpisodeRecorder {
  // resolve() per call so tests (and LOOPS_DATA_DIR redeployment) are honored;
  // a construction failure here must degrade to a no-op recorder, not break the run.
  try {
    const dataDirValue = opts.dataDir ?? defaultDataDir();
    const statePath = opts.statePath ?? runnerEpisodesStatePath(dataDirValue);
    const outboxPath = opts.outboxPath ?? runnerEventsOutboxPath(dataDirValue);
    const notifierCommand = opts.notifierCommand ?? (process.env[LOOPS_RUNNER_NOTIFIER_CMD_ENV]?.trim() || undefined);
    const runnerId = opts.runnerId ?? defaultRunnerId();
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
        mkdirSync(dirname(outboxPath), { recursive: true, mode: 0o700 });
        appendFileSync(outboxPath, `${line}\n`);
        delivered = true;
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
        const nowIso = now().toISOString();
        const state = readState();
        let streak = state.streak;
        // If the plane flapped back down before a pending recovery event could
        // be delivered, finish that delivery first — the episode genuinely
        // recovered (2 successes landed) before this new failure.
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
            streak.episodeId = `ep_${randomUUID()}`;
            streak.openedAt = nowIso;
            streak.deliveryState = emitOpen(streak, state.lastSuccessAt, nowIso) ? "open" : "open_pending";
          }
        } else if (streak.deliveryState === "open_pending") {
          // Retry the undelivered open event (counts updated silently since).
          streak.deliveryState = emitOpen(streak, state.lastSuccessAt, nowIso) ? "open" : "open_pending";
        }
        writeState({ version: 1, runnerId, streak, lastSuccessAt: state.lastSuccessAt });
      } catch {
        // Episode tracking must never fail the run.
      }
    }

    function recordSuccess(): void {
      try {
        const nowIso = now().toISOString();
        const state = readState();
        const next: RunnerEpisodesFile = { version: 1, runnerId, lastSuccessAt: nowIso };
        const streak = state.streak;
        if (!streak) {
          writeState(next);
          return;
        }
        if (!streak.episodeId) {
          // Failures never became an episode; the streak is broken.
          writeState(next);
          return;
        }
        streak.consecutiveSuccesses = (streak.consecutiveSuccesses ?? 0) + 1;
        if (streak.consecutiveSuccesses >= EPISODE_CLOSE_SUCCESSES) {
          if (emitRecovery(streak, nowIso)) {
            writeState(next); // episode closed
            return;
          }
          streak.deliveryState = "recovery_pending"; // retried on the next poll
        }
        writeState({ ...next, streak });
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
