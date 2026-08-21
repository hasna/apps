import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import {
  classifyRunnerFailure,
  createRunnerEpisodeRecorder,
  EPISODE_CLOSE_SUCCESSES,
  EPISODE_OPEN_CONSECUTIVE_FAILURES,
  EPISODE_OPEN_SPAN_MS,
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
    // state at open_pending with an empty outbox.
    const h = harness({ notifierCommand: undefined });
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    const original = outboxLines(h.dir)[0];
    // Roll back to the mid-transaction durable state: episode known, delivery
    // still pending, outbox line already appended (append landed, confirm
    // write lost) — the dedup must skip a duplicate.
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
      },
    }, null, 2)}\n`, { mode: 0o600 });
    h.nowMs();
    h.recorder.recordFailure(foreignError());
    let events = outboxLines(h.dir);
    expect(events).toHaveLength(1); // deduped: same episodeId
    let state = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(state.streak?.deliveryState).toBe("open");
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
    // state already records the episode (open_pending), so the next successes
    // complete the open (dedup) and then close with exactly one recovery.
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

  test("lock contention skips without throwing and later transitions are not lost", async () => {
    const h = harness();
    for (let i = 0; i < 3; i++) {
      h.nowMs();
      h.recorder.recordFailure(foreignError());
    }
    // Simulate a live lock held by another runner process.
    writeFileSync(`${runnerEpisodesStatePath(h.dir)}.lock`, "held", { mode: 0o600 });
    expect(() => h.recorder.recordSuccess()).not.toThrow(); // skipped after bounded retries
    const midState = readStateFile(h.dir) as { streak?: Record<string, unknown> };
    expect(midState.streak?.deliveryState).toBe("open");
    rmSync(`${runnerEpisodesStatePath(h.dir)}.lock`);
    // Contention clears: the skipped success did not corrupt anything, and the
    // episode still closes on the next two successes — the transition was
    // delayed, not lost.
    h.recorder.recordSuccess();
    h.recorder.recordSuccess();
    const events = outboxLines(h.dir);
    expect(events).toHaveLength(2);
    expect(events[1].evt).toBe("loops_runner_control_plane_recovered");
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

  test("the default notifier spawn delivers the event JSON on stdin to an env-pointed command", async () => {
    // Capability probe: this test asserts REAL delivery, which requires an
    // environment that can spawn `sh -c`. Sandboxed runtimes without a shell
    // (some review/isolation environments) cannot deliver via spawn at all —
    // there the binding contract's durable surface is the outbox, already
    // asserted by every other test, so this gate degrades with a reason
    // instead of false-red on a platform property.
    const probe = mkdtempSync(join(tmpdir(), "loops-ep-probe-"));
    const probeSink = join(probe, "probe");
    const probeChild = spawn("sh", ["-c", `printf ok > ${JSON.stringify(probeSink)}`], { stdio: "ignore", detached: true });
    probeChild.on("error", () => {});
    let shellCapable = false;
    for (let attempt = 0; attempt < 20 && !shellCapable; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
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
    for (let attempt = 0; attempt < 100 && sinkLines().length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
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
  });
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
