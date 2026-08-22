/**
 * executeRun's terminal-transition invariant (todos cac959de).
 *
 * The failure this guards: executeRun's catch delegates to failRun, whose FIRST
 * statement is another appendLog. When the original failure was itself thrown by
 * appendLog - SQLITE_BUSY past the finite busy_timeout, or a Postgres log-sequence
 * conflict past LOG_SEQUENCE_ATTEMPTS - the second appendLog rejects inside the
 * catch and propagates out of executeRun before fencedTransition ever runs, so no
 * terminal 'failed' transition is written. The run stays 'running' with locked_by
 * set, and claimNextRun never reclaims it (it selects only queued/retrying).
 *
 * The invariant under test: a log write is best-effort; the run's terminal state
 * is not. No appendLog failure - the starting log, the error log in failRun, or
 * the refused-transition warning in fencedTransition - may abort the terminal
 * transition or escape executeRun as a rejection.
 */
import { describe, expect, test } from "bun:test";
import { executeRun } from "./handlers.js";
import type { ServerArtifact, ServerRunRecord, SkillsProductStore } from "./types.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const LOG_WRITE_FAILURE = new Error("SQLITE_BUSY: database is locked (simulated log-write failure)");

function runRecord(overrides: Partial<ServerRunRecord> = {}): ServerRunRecord {
  return {
    id: "run_regression",
    orgId: "org_a",
    userId: "user_a",
    skill: "audio-transcript-pack",
    requestedSlug: "audio-transcript-pack",
    status: "running",
    input: { transcript: "hello world" },
    args: [],
    correlationId: "corr_regression",
    costCents: 0,
    leaseGeneration: 1,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Minimal store stub covering only the surface executeRun touches; the rest of
 * the wide SkillsProductStore seam is unreachable from these tests.
 *
 * `failLogFromCall` lets a test break log writes after the first N succeed, so
 * the fencedTransition late-write warning can be the failing call while the
 * run's own logs succeed.
 */
function stubStore(options: { appendLogRejects: boolean; failLogFromCall?: number; transitionRefused?: boolean }): {
  store: SkillsProductStore;
  /** Every transitionRun patch, in call order. */
  transitions: unknown[];
} {
  const transitions: unknown[] = [];
  let logWrites = 0;
  const store = {
    async appendLog() {
      logWrites += 1;
      if (options.appendLogRejects || (options.failLogFromCall !== undefined && logWrites >= options.failLogFromCall)) {
        throw LOG_WRITE_FAILURE;
      }
      return { runId: "run_regression", sequence: logWrites, level: "info" as const, message: "", createdAt: new Date().toISOString() };
    },
    async addArtifact(artifact: Omit<ServerArtifact, "createdAt">) {
      return { ...artifact, createdAt: new Date().toISOString() };
    },
    async transitionRun(runId: string, patch: Record<string, unknown>) {
      transitions.push(patch);
      if (options.transitionRefused) return null;
      return { ...runRecord(), ...patch, id: runId };
    },
  } as unknown as SkillsProductStore;
  return { store, transitions };
}

describe("executeRun terminal transitions", () => {
  test("a run whose log writes always fail still reaches a terminal 'failed' transition", async () => {
    const { store, transitions } = stubStore({ appendLogRejects: true });
    const base = runRecord();

    const outcome = await executeRun(store, base);

    expect(outcome.status).toBe("failed");
    expect(outcome.errorCode).toBe("WORKER_ERROR");
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ status: "failed", errorCode: "WORKER_ERROR" });
  });

  test("a refused fenced transition whose late-write warning fails still resolves", async () => {
    // The first two log writes succeed (starting + run progress); the third -
    // fencedTransition's "late write rejected" warning - fails. The refusal must
    // still surface as a resolved stale record, never as a rejection.
    const { store } = stubStore({ appendLogRejects: false, failLogFromCall: 3, transitionRefused: true });
    const base = runRecord();

    const outcome = await executeRun(store, base);

    expect(outcome).toBe(base);
    expect(outcome.status).toBe("running");
  });

  test("the happy path is unchanged: a successful run reaches 'succeeded'", async () => {
    const { store, transitions } = stubStore({ appendLogRejects: false });
    const base = runRecord();

    const outcome = await executeRun(store, base);

    expect(outcome.status).toBe("succeeded");
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ status: "succeeded" });
  });
});
