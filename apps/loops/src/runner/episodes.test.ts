import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { BUN_DEFAULT_TIMEOUT_MS } from "../test-timeout-policy.js";
import {
  acquireStateLock,
  classifyRunnerFailure,
  createRunnerEpisodeRecorder,
  EPISODE_CLOSE_SUCCESSES,
  EPISODE_OPEN_CONSECUTIVE_FAILURES,
  EPISODE_OPEN_SPAN_MS,
  releaseStateLock,
  runnerEpisodesStatePath,
  runnerEventsOutboxPath,
  type RunnerEpisodeRecorder,
} from "./episodes.js";
import { LoopsApiError, RunnerRefusalError } from "./errors.js";
import { runRunnerLoop } from "./index.js";

/** A foreign error whose every field carries a credential-shaped marker. */
const FOREIGN_SECRET = "postgres://user:secret@db.internal/loops";
function foreignError(): Error {
  return Object.assign(new Error(FOREIGN_SECRET), {
    name: `name-${FOREIGN_SECRET}`,
    code: `code-${FOREIGN_SECRET}`,
  });
}

/**
 * F1 budgets for the notifier-delivery test. The finding: the degraded wait
 * (shell-capability probe 20x25ms + delivery poll 100x50ms = ~5.5s worst
 * case) exceeded bun's 5000ms default per-test timeout in no-spawn sandboxes,
 * so the degraded branch never ran. The budgets are bounded so the full
 * degraded path always executes inside the default, and the test declares a
 * per-test timeout above its own budget so even a bare
 * `bun test src/runner/episodes.test.ts` run cannot kill it mid-degrade.
 */
const SHELL_PROBE_ATTEMPTS = 8;
const SHELL_PROBE_INTERVAL_MS = 10;
const DELIVERY_POLL_ATTEMPTS = 40;
const DELIVERY_POLL_INTERVAL_MS = 25;
const NOTIFIER_TEST_TIMEOUT_MS = 10_000;

function outboxLines(dir: string): Record<string, unknown>[] {
  try {
    return readFileSync(runnerEventsOutboxPath(dir), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function readStateFile(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(runnerEpisodesStatePath(dir), "utf8")) as Record<string, unknown>;
}

interface Harness {
  dir: string;
  recorder: RunnerEpisodeRecorder;
  journal: string[];
  notifierPayloads: string[];
  nowMs: () => number;
}

/** Recorder wired to a temp dir, injectable clock (60s steps by default), captured journal and notifier. */
function harness(overrides: Partial<Parameters<typeof createRunnerEpisodeRecorder>[0]> = {}, stepMs = 60_000): Harness {
  const dir = mkdtempSync(join(tmpdir(), "loops-episodes-"));
  let clock = Date.parse("2026-08-20T21:07:26.000Z");
  const nowMs = () => clock;
  const journal: string[] = [];
  const notifierPayloads: string[] = [];
  const recorder = createRunnerEpisodeRecorder({
    dataDir: dir,
    runnerId: "station02-test",
    notifierCommand: "test-notifier",
    now: () => new Date(clock),
    journal: (line) => journal.push(line),
    spawnNotifier: (_command, payload) => notifierPayloads.push(payload),
    ...overrides,
  });
  return {
    dir,
    recorder,
    journal,
    notifierPayloads,
    nowMs: () => {
      clock += stepMs;
      return clock;
    },
  };
}

describe("classifyRunnerFailure", () => {
  test("refusal: this package's own static refusals", () => {
    expect(classifyRunnerFailure(new RunnerRefusalError("static by construction"))).toBe("refusal");
  });
  test("auth: 401/403 from the control plane", () => {
    expect(classifyRunnerFailure(new LoopsApiError("denied", 401))).toBe("auth");
    expect(classifyRunnerFailure(new LoopsApiError("forbidden", 403))).toBe("auth");
  });
  test("http_5xx: 5xx statuses", () => {
    expect(classifyRunnerFailure(new LoopsApiError("boom", 500))).toBe("http_5xx");
    expect(classifyRunnerFailure(new LoopsApiError("boom", 503))).toBe("http_5xx");
  });
  test("contract: other 4xx statuses", () => {
    expect(classifyRunnerFailure(new LoopsApiError("bad", 400))).toBe("contract");
    expect(classifyRunnerFailure(new LoopsApiError("missing", 404))).toBe("contract");
  });
  test("connectivity: every foreign error, by category only", () => {
    expect(classifyRunnerFailure(foreignError())).toBe("connectivity");
    expect(classifyRunnerFailure(new TypeError("fetch failed"))).toBe("connectivity");
    expect(classifyRunnerFailure("not even an error")).toBe("connectivity");
    expect(classifyRunnerFailure(undefined)).toBe("connectivity");
  });
});

describe("runner failure episodes", () => {
  test(`${EPISODE_OPEN_CONSECUTIVE_FAILURES} consecutive failures spanning >=${EPISODE_OPEN_SPAN_MS}ms open exactly one episode`, () => {
    const h = harness();
    // One failure per minute, mirroring the measured outage cadence.
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    const events = outboxLines(h.dir);
    expect(events).toHaveLength(1);
    expect(events[0].evt).toBe("loops_runner_control_plane_unreachable");
    expect(events[0].failureClass).toBe("connectivity");
    expect(events[0].consecutiveCount).toBe(3);
    expect(events[0].runnerId).toBe("station02-test");
    expect(typeof events[0].episodeId).toBe("string");
    expect(events[0].firstFailureAt).toBe("2026-08-20T21:08:26.000Z");
    expect(events[0].lastFailureAt).toBe("2026-08-20T21:10:26.000Z");
    const state = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(state.streak?.deliveryState).toBe("open");
    expect(state.streak?.consecutiveCount).toBe(3);
    expect(h.journal).toHaveLength(1);
    expect(h.notifierPayloads).toHaveLength(1);
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("3 failures spanning less than the window stay a counting streak", () => {
    const h = harness({}, 1_000);
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    expect(outboxLines(h.dir)).toHaveLength(0);
    const state = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(state.streak?.deliveryState).toBe("counting");
    expect(state.streak?.consecutiveCount).toBe(3);
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("100 more failures after the episode opens emit no duplicates", () => {
    const h = harness();
    for (let i = 0; i < 103; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    const events = outboxLines(h.dir);
    expect(events).toHaveLength(1);
    const state = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(state.streak?.consecutiveCount).toBe(103);
    expect(state.streak?.deliveryState).toBe("open");
    expect(h.journal).toHaveLength(1);
    expect(h.notifierPayloads).toHaveLength(1);
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("a success before the episode opens resets the streak", () => {
    const h = harness();
    h.nowMs();
    h.recorder.recordFailure(foreignError());
    h.nowMs();
    h.recorder.recordFailure(foreignError());
    h.nowMs();
    h.recorder.recordSuccess();
    h.nowMs();
    h.recorder.recordFailure(foreignError());
    expect(outboxLines(h.dir)).toHaveLength(0);
    const state = readStateFile(h.dir) as { streak?: Record<string, unknown>; lastSuccessAt?: string };
    expect(state.streak?.consecutiveCount).toBe(1);
    expect(typeof state.lastSuccessAt).toBe("string");
    rmSync(h.dir, { recursive: true, force: true });
  });

  test(`${EPISODE_CLOSE_SUCCESSES} successes after the episode open emit exactly one recovery event and close it`, () => {
    const h = harness();
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    h.recorder.recordSuccess();
    expect(outboxLines(h.dir)).toHaveLength(1); // one success is not recovery
    h.recorder.recordSuccess();
    const events = outboxLines(h.dir);
    expect(events).toHaveLength(2);
    expect(events[1].evt).toBe("loops_runner_control_plane_recovered");
    expect(events[1].episodeId).toBe(events[0].episodeId);
    expect(events[1].consecutiveCount).toBe(3);
    expect(typeof events[1].outageMs).toBe("number");
    const state = readStateFile(h.dir) as { streak?: unknown; lastSuccessAt?: string };
    expect(state.streak).toBeUndefined();
    expect(typeof state.lastSuccessAt).toBe("string");
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("a failure between the two recovery successes resets the recovery count", () => {
    const h = harness();
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    h.recorder.recordSuccess();
    h.nowMs();
    h.recorder.recordFailure(foreignError()); // plane flapped: recovery needs 2 consecutive
    h.recorder.recordSuccess();
    h.recorder.recordSuccess();
    const events = outboxLines(h.dir);
    expect(events).toHaveLength(2);
    expect(events[1].evt).toBe("loops_runner_control_plane_recovered");
    expect(events[1].consecutiveCount).toBe(4);
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("state survives a simulated process restart (new recorder instance, same files)", () => {
    const dir = mkdtempSync(join(tmpdir(), "loops-episodes-"));
    let clock = Date.parse("2026-08-20T21:07:26.000Z");
    const shared = {
      dataDir: dir,
      runnerId: "station02-test",
      now: () => new Date(clock),
      journal: () => {},
      spawnNotifier: () => {},
    };
    // Process A: three failures open the episode, then A exits.
    const a = createRunnerEpisodeRecorder(shared);
    for (let i = 0; i < 3; i++) {
      clock += 60_000;
      a.recordFailure(foreignError());
    }
    // Process B: a fresh instance must see the persisted streak, not restart it.
    const b = createRunnerEpisodeRecorder(shared);
    clock += 60_000;
    b.recordFailure(foreignError());
    const eventsAfterB = outboxLines(dir);
    expect(eventsAfterB).toHaveLength(1); // no duplicate open
    const midState = JSON.parse(readFileSync(runnerEpisodesStatePath(dir), "utf8")) as { streak?: Record<string, unknown> };
    expect(midState.streak?.consecutiveCount).toBe(4);
    // Process C: recovery also across a restart boundary.
    const c = createRunnerEpisodeRecorder(shared);
    clock += 60_000;
    c.recordSuccess();
    c.recordSuccess();
    const events = outboxLines(dir);
    expect(events).toHaveLength(2);
    expect(events[1].evt).toBe("loops_runner_control_plane_recovered");
    expect(events[1].episodeId).toBe(events[0].episodeId);
    rmSync(dir, { recursive: true, force: true });
  });

  test("a notifier that throws never fails the run or drops the outbox event", () => {
    const h = harness({
      notifierCommand: "definitely-not-a-real-command",
      spawnNotifier: () => {
        throw new Error("notifier exploded");
      },
    });
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      expect(() => h.recorder.recordFailure(foreignError())).not.toThrow();
    }
    expect(outboxLines(h.dir)).toHaveLength(1);
    h.recorder.recordSuccess();
    expect(() => h.recorder.recordSuccess()).not.toThrow();
    expect(outboxLines(h.dir)).toHaveLength(2);
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("an unwritable outbox keeps the episode pending and retries delivery exactly once", () => {
    const h = harness({ notifierCommand: undefined });
    const outboxPath = runnerEventsOutboxPath(h.dir);
    // A directory squatting on the outbox path makes every append fail.
    mkdirSync(outboxPath, { recursive: true });
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    let state = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(state.streak?.deliveryState).toBe("open_pending");
    expect(state.streak?.episodeId).toBeDefined();
    // The obstruction clears; the next silent increment retries the emission.
    rmSync(outboxPath, { recursive: true, force: true });
    h.nowMs();
    h.recorder.recordFailure(foreignError());
    const events = outboxLines(h.dir);
    expect(events).toHaveLength(1);
    expect(events[0].evt).toBe("loops_runner_control_plane_unreachable");
    state = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(state.streak?.deliveryState).toBe("open");
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("episode state and events never contain foreign error text or credentials", () => {
    const h = harness();
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    const outboxRaw = readFileSync(runnerEventsOutboxPath(h.dir), "utf8");
    const stateRaw = readFileSync(runnerEpisodesStatePath(h.dir), "utf8");
    for (const surface of [outboxRaw, stateRaw, ...h.journal]) {
      expect(surface).not.toContain("postgres://");
      expect(surface).not.toContain("secret");
      expect(surface).not.toContain("db.internal");
    }
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("classification reaches the event: http_5xx and auth episodes", () => {
    const h = harness();
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(new LoopsApiError("server-provided detail", 503));
    }
    expect(outboxLines(h.dir)[0].failureClass).toBe("http_5xx");
    const h2 = harness();
    for (let i = 0; i < 3; i++) {
      h2.nowMs();
      h2.recorder.recordFailure(new LoopsApiError("unauthorized", 401));
    }
    expect(outboxLines(h2.dir)[0].failureClass).toBe("auth");
    rmSync(h.dir, { recursive: true, force: true });
    rmSync(h2.dir, { recursive: true, force: true });
  });

  test("corrupt state degrades to a fresh streak instead of crashing the runner", () => {
    const h = harness();
    writeFileSync(runnerEpisodesStatePath(h.dir), "not json at all{{{", { mode: 0o600 });
    expect(() => h.recorder.recordFailure(foreignError())).not.toThrow();
    const state = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(state.streak?.consecutiveCount).toBe(1);
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("crash between the open state-write and the append retries delivery exactly once", () => {
    // STATE-FIRST ordering: simulate the crash window by leaving the durable
    // state at open_pending with the append window recorded (`pendingAppend`),
    // and the outbox in either state — line already appended (append landed,
    // confirm write lost) or empty (state landed, append lost). The windowed
    // dedup must converge to exactly one event in both directions.
    const h = harness({ notifierCommand: undefined });
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    const original = outboxLines(h.dir)[0];
    // Roll back to the mid-transaction durable state: episode known, delivery
    // still pending, outbox line already appended — the dedup must skip a
    // duplicate. `fromOffset: 0` is the outbox size when the attempt began
    // (the line sits at offset 0 of a fresh outbox).
    writeFileSync(runnerEpisodesStatePath(h.dir), `${JSON.stringify({
      version: 1,
      runnerId: "station02-test",
      streak: {
        firstFailureAt: "2026-08-20T21:08:26.000Z",
        lastFailureAt: "2026-08-20T21:10:26.000Z",
        consecutiveCount: 3,
        failureClass: "connectivity",
        episodeId: original.episodeId,
        openedAt: "2026-08-20T21:10:26.000Z",
        deliveryState: "open_pending",
        pendingAppend: { fromOffset: 0, attemptedAt: "2026-08-20T21:10:26.000Z" },
      },
    }, null, 2)}\n`, { mode: 0o600 });
    h.nowMs();
    h.recorder.recordFailure(foreignError());
    let events = outboxLines(h.dir);
    expect(events).toHaveLength(1); // deduped: same episodeId
    let state = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(state.streak?.deliveryState).toBe("open");
    expect(state.streak?.pendingAppend).toBeUndefined(); // confirm-write cleared the window
    expect(state.streak?.consecutiveCount).toBe(4);
    // And the same crash shape with an EMPTY outbox (state landed, append
    // lost): the next failure emits the open exactly once.
    writeFileSync(runnerEpisodesStatePath(h.dir), `${JSON.stringify({
      version: 1,
      runnerId: "station02-test",
      streak: {
        firstFailureAt: "2026-08-20T21:08:26.000Z",
        lastFailureAt: "2026-08-20T21:10:26.000Z",
        consecutiveCount: 3,
        failureClass: "connectivity",
        episodeId: original.episodeId,
        openedAt: "2026-08-20T21:10:26.000Z",
        deliveryState: "open_pending",
        pendingAppend: { fromOffset: 0, attemptedAt: "2026-08-20T21:10:26.000Z" },
      },
    }, null, 2)}\n`, { mode: 0o600 });
    rmSync(runnerEventsOutboxPath(h.dir));
    h.nowMs();
    h.recorder.recordFailure(foreignError());
    events = outboxLines(h.dir);
    expect(events).toHaveLength(1);
    expect(events[0].episodeId).toBe(original.episodeId);
    state = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(state.streak?.deliveryState).toBe("open");
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("crash after the open append followed by successes still emits the recovery (reviewer repro)", () => {
    // The exact cycle-2 finding-1 repro: open event reached the outbox, the
    // confirm state-write was lost. Under state-first ordering the durable
    // state already records the episode (open_pending + the append window),
    // so the next successes complete the open (windowed dedup) and then close
    // with exactly one recovery.
    const h = harness({ notifierCommand: undefined });
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    const original = outboxLines(h.dir)[0];
    writeFileSync(runnerEpisodesStatePath(h.dir), `${JSON.stringify({
      version: 1,
      runnerId: "station02-test",
      streak: {
        firstFailureAt: "2026-08-20T21:08:26.000Z",
        lastFailureAt: "2026-08-20T21:10:26.000Z",
        consecutiveCount: 3,
        failureClass: "connectivity",
        episodeId: original.episodeId,
        openedAt: "2026-08-20T21:10:26.000Z",
        deliveryState: "open_pending",
        pendingAppend: { fromOffset: 0, attemptedAt: "2026-08-20T21:10:26.000Z" },
      },
    }, null, 2)}\n`, { mode: 0o600 });
    h.recorder.recordSuccess();
    h.recorder.recordSuccess();
    const events = outboxLines(h.dir);
    expect(events).toHaveLength(2);
    expect(events[0].evt).toBe("loops_runner_control_plane_unreachable");
    expect(events[1].evt).toBe("loops_runner_control_plane_recovered");
    expect(events[1].episodeId).toBe(original.episodeId);
    const state = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(state.streak).toBeUndefined();
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("a recovery pending in state with an empty outbox is retried by the next success", () => {
    // STATE-FIRST for recovery: durable recovery_pending, append lost.
    const h = harness({ notifierCommand: undefined });
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    const original = outboxLines(h.dir)[0];
    h.recorder.recordSuccess();
    // Simulate the crash between the recovery_pending state write and the
    // append by rewinding the outbox.
    rmSync(runnerEventsOutboxPath(h.dir));
    writeFileSync(runnerEventsOutboxPath(h.dir), `${JSON.stringify(original)}\n`, { mode: 0o600 });
    h.recorder.recordSuccess(); // closes (recovery_pending write) + append
    h.recorder.recordSuccess(); // retries nothing needed, but must not duplicate
    const events = outboxLines(h.dir);
    expect(events).toHaveLength(2);
    expect(events[1].evt).toBe("loops_runner_control_plane_recovered");
    const state = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(state.streak).toBeUndefined();
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("F2: a success observed under lock contention is persisted, not dropped — the recovery transition survives", () => {
    // Finding F2 repro: the final two successes land while a live lock is
    // contended, then the plane flaps. The contended success must be durable:
    // the next update drains it, emits the recovery, and only then starts the
    // new failure streak. Red-before (terminated head): the contended success
    // was skipped entirely, so the recovery never emitted.
    const h = harness();
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    h.recorder.recordSuccess(); // success 1
    const intentPath = `${runnerEpisodesStatePath(h.dir)}.success-intent.jsonl`;
    // Simulate a live lock held by another runner process.
    writeFileSync(`${runnerEpisodesStatePath(h.dir)}.lock`, "held", { mode: 0o600 });
    expect(() => h.recorder.recordSuccess()).not.toThrow(); // contended: skipped but persisted
    const intent = readFileSync(intentPath, "utf8");
    expect(intent.trim().split("\n").filter(Boolean)).toHaveLength(1);
    let midState = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(midState.streak?.deliveryState).toBe("open");
    rmSync(`${runnerEpisodesStatePath(h.dir)}.lock`);
    // The contended success was the final success before the plane flapped:
    // the next failure drains the intent, emits the recovery, and starts a
    // fresh counting streak — the recovery is NOT lost.
    h.nowMs();
    h.recorder.recordFailure(foreignError());
    const events = outboxLines(h.dir);
    expect(events).toHaveLength(2);
    expect(events[1].evt).toBe("loops_runner_control_plane_recovered");
    expect(events[1].episodeId).toBe(events[0].episodeId);
    const state = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(state.streak?.consecutiveCount).toBe(1);
    expect(state.streak?.episodeId).toBeUndefined();
    expect(state.streak?.deliveryState).toBe("counting");
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("F2b: contended successes drain into the recovery count — the episode closes on the next success", () => {
    const h = harness();
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    h.recorder.recordSuccess(); // 1
    writeFileSync(`${runnerEpisodesStatePath(h.dir)}.lock`, "held", { mode: 0o600 });
    h.recorder.recordSuccess(); // contended -> persisted intent
    rmSync(`${runnerEpisodesStatePath(h.dir)}.lock`);
    h.recorder.recordSuccess(); // drains 1 + this 1 = 2 -> close + recovery
    const events = outboxLines(h.dir);
    expect(events).toHaveLength(2);
    expect(events[1].evt).toBe("loops_runner_control_plane_recovered");
    const state = readStateFile(h.dir) as { streak?: unknown };
    expect(state.streak).toBeUndefined();
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("repeated recording does not leak file descriptors (lock fd closed on every path)", async () => {
    const fdDir = "/proc/self/fd";
    let before = 0;
    try {
      before = readdirSync(fdDir).length;
    } catch {
      return; // not Linux: nothing to assert
    }
    const h = harness();
    for (let i = 0; i < 300; i++) h.recorder.recordSuccess();
    for (let i = 0; i < 300; i++) h.recorder.recordFailure(foreignError());
    const after = readdirSync(fdDir).length;
    expect(after - before).toBeLessThan(50);
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("a recovery never lands before its still-pending open event", () => {
    const h = harness({ notifierCommand: undefined });
    const outboxPath = runnerEventsOutboxPath(h.dir);
    mkdirSync(outboxPath, { recursive: true }); // obstruct the open append
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    let state = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(state.streak?.deliveryState).toBe("open_pending");
    rmSync(outboxPath, { recursive: true, force: true }); // obstruction clears
    h.recorder.recordSuccess(); // retries the open delivery
    h.recorder.recordSuccess(); // closes the episode
    const events = outboxLines(h.dir);
    expect(events).toHaveLength(2);
    expect(events[0].evt).toBe("loops_runner_control_plane_unreachable");
    expect(events[1].evt).toBe("loops_runner_control_plane_recovered");
    const closedState = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(closedState.streak).toBeUndefined();
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("a caller-controlled runnerId is sanitized before any state, event, or journal write", () => {
    const h = harness({ runnerId: "postgres://user:secret@db.internal/loops\nx" });
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    const outboxRaw = readFileSync(runnerEventsOutboxPath(h.dir), "utf8");
    const stateRaw = readFileSync(runnerEpisodesStatePath(h.dir), "utf8");
    for (const surface of [outboxRaw, stateRaw, ...h.journal]) {
      expect(surface).not.toContain("postgres://");
      expect(surface).not.toContain("secret");
      expect(surface).not.toContain("db.internal");
    }
    const event = outboxLines(h.dir)[0];
    expect(event.runnerId).toBe("unknown");
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("F3: a re-emit after a lost confirm-write does not double-fire the notifier", () => {
    // Finding F3 repro: appendEventOnce used to report "delivered" both when
    // freshly appended AND when already present, and spawnNotifier fired
    // unconditionally — so a re-emit after a lost confirm-write double-fired
    // the notifier. Red-before (terminated head): notifierPayloads reaches 2.
    const h = harness(); // injected spawnNotifier captures payloads
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    expect(h.notifierPayloads).toHaveLength(1);
    const original = outboxLines(h.dir)[0];
    // Simulate the crash between append and confirm-write: state says
    // open_pending with the append window recorded, outbox already holds the
    // line. The retry dedups — and must NOT re-fire the notifier.
    writeFileSync(runnerEpisodesStatePath(h.dir), `${JSON.stringify({
      version: 1,
      runnerId: "station02-test",
      streak: {
        firstFailureAt: "2026-08-20T21:08:26.000Z",
        lastFailureAt: "2026-08-20T21:10:26.000Z",
        consecutiveCount: 3,
        failureClass: "connectivity",
        episodeId: original.episodeId,
        openedAt: "2026-08-20T21:10:26.000Z",
        deliveryState: "open_pending",
        pendingAppend: { fromOffset: 0, attemptedAt: "2026-08-20T21:10:26.000Z" },
      },
    }, null, 2)}\n`, { mode: 0o600 });
    h.nowMs();
    h.recorder.recordFailure(foreignError());
    expect(outboxLines(h.dir)).toHaveLength(1); // deduped
    expect(h.notifierPayloads).toHaveLength(1); // NOT re-fired
    const state = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(state.streak?.deliveryState).toBe("open");
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("F4: dedup cannot miss beyond a fixed tail — exactly one open event however far the line sits", () => {
    // Finding F4 repro: the old dedup scanned only the newest 256 outbox
    // lines, so once the earlier append sat further back the retry appended a
    // duplicate open event. Red-before (terminated head): with 300 unrelated
    // lines after the open line, the tail scan missed it and produced TWO
    // unreachable events. The windowed state-file dedup scans exactly
    // [fromOffset..EOF] — the region that provably holds the line — so the
    // count stays one regardless of outbox growth.
    const h = harness({ notifierCommand: undefined });
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    const original = outboxLines(h.dir)[0];
    writeFileSync(runnerEpisodesStatePath(h.dir), `${JSON.stringify({
      version: 1,
      runnerId: "station02-test",
      streak: {
        firstFailureAt: "2026-08-20T21:08:26.000Z",
        lastFailureAt: "2026-08-20T21:10:26.000Z",
        consecutiveCount: 3,
        failureClass: "connectivity",
        episodeId: original.episodeId,
        openedAt: "2026-08-20T21:10:26.000Z",
        deliveryState: "open_pending",
        pendingAppend: { fromOffset: 0, attemptedAt: "2026-08-20T21:10:26.000Z" },
      },
    }, null, 2)}\n`, { mode: 0o600 });
    // Hundreds of unrelated events land between the append and the retry
    // (other runners share the outbox) — far beyond the old 256-line tail.
    for (let i = 0; i < 300; i++) {
      appendFileSync(runnerEventsOutboxPath(h.dir), `${JSON.stringify({ evt: "other_runner_event", episodeId: `ep_other_${i}`, seq: i })}\n`);
    }
    h.nowMs();
    h.recorder.recordFailure(foreignError());
    const events = outboxLines(h.dir);
    const unreachable = events.filter(
      (e) => e.evt === "loops_runner_control_plane_unreachable" && e.episodeId === original.episodeId,
    );
    expect(unreachable).toHaveLength(1); // exactly one open event, however far back the first line sits
    const state = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(state.streak?.deliveryState).toBe("open");
    expect(state.streak?.pendingAppend).toBeUndefined(); // confirm-write cleared the window
    rmSync(h.dir, { recursive: true, force: true });
  });

  test("F5: a displaced holder's release never deletes the successor's lock", () => {
    // Finding F5 repro: withLock's finally removed the lock path
    // UNCONDITIONALLY, so a displaced still-live holder (its section exceeded
    // the 10s staleness window and a contender took over) deleted the
    // SUCCESSOR's lock — concurrent entry. Locks now carry the acquirer's
    // token and release deletes the file only when the content is still that
    // token. Red-before (terminated head): the unconditional rmSync removed
    // the successor's lock and this assertion failed.
    const dir = mkdtempSync(join(tmpdir(), "loops-episodes-"));
    const lockPath = join(dir, "runner-episodes.json.lock");
    // Holder A acquires and stamps its lock.
    const a = acquireStateLock(lockPath);
    expect(a).toBeDefined();
    if (a === undefined) throw new Error("lock A not acquired");
    // A's critical section exceeds the staleness window; a contender takes it
    // over: the old lock is renamed aside and removed, and the successor
    // creates its own lock at the same path with its own token.
    rmSync(lockPath, { force: true });
    const b = acquireStateLock(lockPath);
    expect(b).toBeDefined();
    if (b === undefined) throw new Error("lock B not acquired");
    try {
      // A's release runs while B is mid-section: it must NOT delete B's lock.
      releaseStateLock(lockPath, a.fd, a.token);
      expect(readFileSync(lockPath, "utf8")).toBe(b.token); // successor's lock intact
      // B completes normally and releases its own lock.
      releaseStateLock(lockPath, b.fd, b.token);
      expect(() => statSync(lockPath)).toThrow(); // gone once its owner releases it
    } finally {
      try {
        releaseStateLock(lockPath, b.fd, b.token);
      } catch {
        // already released or already gone
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("F1: the notifier-delivery wait budget fits inside bun's default per-test timeout", () => {
    // Finding F1 repro: the degraded wait (probe 20x25ms + poll 100x50ms =
    // ~5.5s worst case) exceeded bun's 5000ms default per-test timeout in
    // no-spawn sandboxes, so the degraded assertions never ran. Red-before:
    // 5500ms >= 5000ms. The budgets are bounded so the full degraded path
    // always executes inside the default, and the delivery test itself
    // declares a per-test timeout above its own budget.
    const worstCaseDegradedMs =
      SHELL_PROBE_ATTEMPTS * SHELL_PROBE_INTERVAL_MS + DELIVERY_POLL_ATTEMPTS * DELIVERY_POLL_INTERVAL_MS;
    expect(worstCaseDegradedMs).toBeLessThan(BUN_DEFAULT_TIMEOUT_MS - 1_000);
    expect(NOTIFIER_TEST_TIMEOUT_MS).toBeGreaterThan(worstCaseDegradedMs);
    expect(NOTIFIER_TEST_TIMEOUT_MS).toBeGreaterThan(BUN_DEFAULT_TIMEOUT_MS);
  });

  test("the default notifier spawn delivers the event JSON on stdin to an env-pointed command", async () => {
    // Capability probe: this test asserts REAL delivery, which requires an
    // environment that can spawn `sh -c`. Sandboxed runtimes without a shell
    // (some review/isolation environments) cannot deliver via spawn at all —
    // there the binding contract's durable surface is the outbox, already
    // asserted by every other test, so this gate degrades with a reason
    // instead of false-red on a platform property. Finding F1: the degraded
    // waits are bounded (worst case ~1.1s, far under the 5s default) and the
    // test declares its own timeout above the budget, so the degraded branch
    // always executes even when this file runs bare.
    const probe = mkdtempSync(join(tmpdir(), "loops-ep-probe-"));
    const probeSink = join(probe, "probe");
    const probeChild = spawn("sh", ["-c", `printf ok > ${JSON.stringify(probeSink)}`], { stdio: "ignore", detached: true });
    probeChild.on("error", () => {});
    let shellCapable = false;
    for (let attempt = 0; attempt < SHELL_PROBE_ATTEMPTS && !shellCapable; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, SHELL_PROBE_INTERVAL_MS));
      try {
        shellCapable = readFileSync(probeSink, "utf8") === "ok";
      } catch {
        // not yet
      }
    }
    rmSync(probe, { recursive: true, force: true });
    if (!shellCapable) {
      console.log("SKIP-REASON: this environment cannot spawn `sh -c`; notifier delivery gate degraded to the no-throw contract");
    }

    const dir = mkdtempSync(join(tmpdir(), "loops-episodes-"));
    const sink = join(dir, "notified.jsonl");
    let clock = Date.parse("2026-08-20T21:07:26.000Z");
    // Real defaultSpawnNotifier path: shell command, stdin payload, detached.
    const recorder = createRunnerEpisodeRecorder({
      dataDir: dir,
      runnerId: "station02-test",
      notifierCommand: `cat >> ${JSON.stringify(sink)}`,
      now: () => new Date(clock),
      journal: () => {},
    });
    for (let i = 0; i < 3; i++) {
      clock += 60_000;
      recorder.recordFailure(foreignError());
    }
    // The detached child needs a moment; poll until the sink actually holds a
    // line (the shell append-opens the file before cat writes, so existence
    // alone races).
    const sinkLines = (): string[] => {
      try {
        return readFileSync(sink, "utf8").trim().split("\n").filter(Boolean);
      } catch {
        return [];
      }
    };
    for (let attempt = 0; attempt < DELIVERY_POLL_ATTEMPTS && sinkLines().length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, DELIVERY_POLL_INTERVAL_MS));
    }
    const delivered = sinkLines();
    if (shellCapable) {
      expect(delivered).toHaveLength(1);
      const parsed = JSON.parse(delivered[0]) as Record<string, unknown>;
      expect(parsed.evt).toBe("loops_runner_control_plane_unreachable");
      expect(parsed.failureClass).toBe("connectivity");
    } else {
      // Contract floor everywhere: notifier failure never throws, the outbox
      // still holds exactly one event.
      expect(delivered).toHaveLength(0);
      expect(outboxLines(dir)).toHaveLength(1);
    }
    rmSync(dir, { recursive: true, force: true });
  }, { timeout: NOTIFIER_TEST_TIMEOUT_MS });
});

describe("runRunnerLoop episode wiring", () => {
  test("failing polls open one episode through the injected recorder; the loop itself never throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loops-episodes-"));
    let clock = Date.parse("2026-08-20T21:07:26.000Z");
    const recorder = createRunnerEpisodeRecorder({
      dataDir: dir,
      runnerId: "station02-test",
      now: () => new Date(clock),
      journal: () => {},
      spawnNotifier: () => {},
    });
    const fetchImpl = (async () => {
      clock += 60_000; // each failing poll lands a minute apart, like the real outage
      throw new TypeError("fetch failed: connection refused");
    }) as unknown as typeof fetch;
    const result = await runRunnerLoop({
      apiUrl: "https://loops.invalid/",
      apiKey: "test-token",
      env: {},
      runnerId: "station02",
      machineId: "station02",
      fetchImpl,
      maxIterations: 5,
      pollIntervalMs: 1,
      sleep: async () => {},
      nowMs: () => clock,
      onError: () => {},
      episodeRecorder: recorder,
    });
    expect(result.errors).toBe(5);
    const events = outboxLines(dir);
    expect(events).toHaveLength(1);
    expect(events[0].evt).toBe("loops_runner_control_plane_unreachable");
    expect(events[0].failureClass).toBe("connectivity");
    const state = readStateFile(dir) as { streak?: Record<string, unknown> };
    expect(state.streak?.consecutiveCount).toBe(5);
    expect(state.streak?.deliveryState).toBe("open");
    rmSync(dir, { recursive: true, force: true });
  });
});
