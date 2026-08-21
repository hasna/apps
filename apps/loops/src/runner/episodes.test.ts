import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
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
