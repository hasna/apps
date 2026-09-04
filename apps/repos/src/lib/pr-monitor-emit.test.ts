import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { closeDb, getDb } from "../db/database.js";
import { emitMonitorDelta, type EmitPrInput } from "./pr-monitor-emit.js";
import type {
  MonitorCommentMeta,
  MonitorLeaseInput,
  MergeTreeProbe,
  PrMonitorClass,
  PrMonitorSubject,
} from "./pr-monitor-classify.js";
import {
  computeEventFingerprint,
  readCommentCursor,
  readLastEmittedFingerprint,
  readWatchStateByPr,
  watchStateKey,
  type PrMonitorWatchRow,
} from "./pr-monitor-state.js";
import type { ParsedVerdict } from "./verdict-parser.js";

/**
 * pr-monitor delta emitter tests.
 *
 * Covers the emitter contract from the pr-monitor design sections 2.1-2.3 and
 * acceptance criterion 4 (idempotency): baseline mode records watch state and
 * emits no per-PR NEW events; first sighting outside baseline emits a NEW
 * event with a 16-hex fingerprint id; every event is persisted through
 * markEventEmitted so an unchanged re-run emits `events: []` with unchanged
 * fingerprints; the comment cursor is seeded at the newest comment on first
 * sighting so older discussion is never replayed as NEW_COMMENT.
 *
 * The emitter is exercised against a real in-memory registry (v15 migrated by
 * getDb) exactly as the state-accessor tests do: watch rows persist between
 * runs, which is what makes the idempotency property testable at all.
 */

const OWNER = "hasna";
const REPO = "apps";
const NUMBER = 1234;
const PR_KEY = watchStateKey(OWNER, REPO, NUMBER);
const HEAD = "abc1234abc1234abc1234abc1234abc1234abc1";
const MAIN = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const NOW = "2026-08-18 10:00:00";

function subject(overrides: Partial<PrMonitorSubject> = {}): PrMonitorSubject {
  return {
    owner: OWNER,
    repo: REPO,
    number: NUMBER,
    title: "fix the thing",
    state: "open",
    url: `https://github.com/${OWNER}/${REPO}/pull/${NUMBER}`,
    headSha: HEAD,
    headBranch: "plan/pr-monitor",
    baseBranch: "main",
    baseRefOid: MAIN,
    mergeable: "MERGEABLE",
    ciState: "SUCCESS",
    ciContextsJson: null,
    isDraft: false,
    reviewDecision: null,
    ...overrides,
  };
}

function verdict(
  value: "GO" | "NO_GO",
  opts: { sha?: string; reviewer?: string | null; lens?: string | null; commentId?: number } = {},
): ParsedVerdict {
  return {
    verdict: value,
    owner: OWNER,
    repo: REPO,
    number: NUMBER,
    sha: (opts.sha ?? HEAD).toLowerCase(),
    lens: opts.lens ?? "correctness",
    reviewer: opts.reviewer ?? "silvanus",
    commentId: opts.commentId ?? 101,
    createdAt: "2026-08-18T09:00:00Z",
  };
}

function comment(id: number, author = "silvanus", createdAt = "2026-08-18T09:00:00Z"): MonitorCommentMeta {
  return { id, createdAt, author };
}

function lease(overrides: Partial<MonitorLeaseInput> = {}): MonitorLeaseInput {
  return {
    branch: "plan/pr-monitor",
    status: "active",
    taskId: "a0bbaeec",
    ownerMetadata: "{}",
    worktreePath: join("/home/hasna", ".hasna", "repos", "worktrees", "apps", "pr-monitor"),
    ...overrides,
  };
}

function input(opts: {
  pr?: Partial<PrMonitorSubject>;
  verdicts?: ParsedVerdict[];
  comments?: MonitorCommentMeta[];
  currentMainSha?: string | null;
  mergeTree?: MergeTreeProbe | null;
} = {}): EmitPrInput {
  return {
    pr: subject(opts.pr),
    verdicts: opts.verdicts ?? [],
    comments: opts.comments ?? [],
    currentMainSha: opts.currentMainSha === undefined ? MAIN : opts.currentMainSha,
    mergeTree: opts.mergeTree === undefined ? null : opts.mergeTree,
  };
}

function run(opts: { inputs: EmitPrInput[]; baseline?: boolean; leases?: MonitorLeaseInput[]; now?: string }) {
  return emitMonitorDelta({
    baseline: opts.baseline ?? false,
    inputs: opts.inputs,
    leases: opts.leases ?? [],
    now: opts.now ?? NOW,
  });
}

function expectFingerprintMarked(prKey: string, cls: PrMonitorClass, detail: string, headSha: string | null): string {
  const fingerprint = computeEventFingerprint(prKey, cls, headSha, detail);
  expect(readLastEmittedFingerprint(prKey)).toBe(fingerprint);
  return fingerprint;
}

describe("pr-monitor delta emitter", () => {
  beforeAll(() => {
    process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
    getDb(":memory:");
  });

  afterAll(() => {
    closeDb();
    delete process.env["HASNA_REPOS_DB_PATH"];
  });

  // Each test starts from a fresh watch state: the emitter persists into the
  // shared in-memory registry, and a first-sighting test must not inherit a
  // watch row an earlier test created for the same PR identity.
  beforeEach(() => {
    getDb().query("DELETE FROM pr_monitor_state").run();
  });

  describe("baseline mode (design section 2.1)", () => {
    it("records watch state and emits no per-PR NEW events on a first baseline run", () => {
      const result = run({
        baseline: true,
        inputs: [
          input({ pr: { number: 1234 } }),
          input({ pr: { number: 1235, title: "other thing" } }),
        ],
      });

      expect(result.baseline).toBe(true);
      expect(result.events).toEqual([]);
      expect(result.summary.open).toBe(2);
      expect(result.summary.events).toBe(0);
      // Watch state is recorded even though nothing is emitted, so the next
      // run sees watched PRs and never replays a NEW storm.
      expect(readWatchStateByPr(OWNER, REPO, 1234)).not.toBeNull();
      expect(readWatchStateByPr(OWNER, REPO, 1235)).not.toBeNull();
    });

    it("seeds the comment cursor at the newest comment on first sighting so older discussion never replays", () => {
      const result = run({
        baseline: true,
        inputs: [input({ comments: [comment(5), comment(9, "silvanus", "2026-08-18T08:00:00Z")] })],
      });
      expect(result.events).toEqual([]);
      expect(readCommentCursor(PR_KEY).lastSeenCommentId).toBe(9);

      // A later settled run over the same comments must not fire NEW_COMMENT
      // for the backlog the baseline run already saw.
      const settled = run({ inputs: [input({ comments: [comment(5), comment(9, "silvanus", "2026-08-18T08:00:00Z")] })] });
      expect(settled.events.map((event) => event.class)).not.toContain("NEW_COMMENT");
    });

    it("baseline suppresses only NEW — an actionable class on a watched PR still emits", () => {
      // Establish a watch row (baseline first run suppresses the NEW event).
      run({ baseline: true, inputs: [input()] });
      // Same PR, same baseline flag, but the run now sees failing CI: the
      // CI_FAILING event is actionable and must not be swallowed by baseline.
      const result = run({
        baseline: true,
        inputs: [input({ pr: { ciState: "FAILURE", ciContextsJson: '[{"name":"build","conclusion":"FAILURE"}]' } })],
      });
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.class).toBe("CI_FAILING");
    });
  });

  describe("NEW detection (first sighting outside baseline)", () => {
    it("emits a NEW event with a 16-hex fingerprint id and records the fingerprint", () => {
      const result = run({ inputs: [input()] });

      expect(result.baseline).toBe(false);
      expect(result.events).toHaveLength(1);
      const event = result.events[0]!;
      expect(event.class).toBe("NEW");
      expect(event.owner).toBe(OWNER);
      expect(event.repo).toBe(REPO);
      expect(event.number).toBe(NUMBER);
      expect(event.title).toBe("fix the thing");
      expect(event.head_sha).toBe(HEAD);
      expect(event.url).toBe(`https://github.com/${OWNER}/${REPO}/pull/${NUMBER}`);
      expect(event.detail).toBe("new PR (first sighting)");
      expect(event.id).toMatch(/^[0-9a-f]{16}$/);
      expect(event.id).toBe(computeEventFingerprint(PR_KEY, "NEW", HEAD, "new PR (first sighting)").slice(0, 16));
      // The emitted fingerprint is persisted, which is what silences re-runs.
      expectFingerprintMarked(PR_KEY, "NEW", "new PR (first sighting)", HEAD);
      expect(result.summary.by_class.NEW).toBe(1);
    });

    it("does not emit for a closed PR with no matching lease (skipped domain)", () => {
      const result = run({ inputs: [input({ pr: { state: "closed" } })] });
      expect(result.events).toEqual([]);
      expect(result.state).toHaveLength(1);
      expect(result.state[0]!.class).toBeNull();
    });
  });

  describe("idempotent re-run (acceptance criterion 4 — the no-change gate)", () => {
    it("re-running against unchanged state emits events: [] with unchanged fingerprints", () => {
      const inputs = [
        input({ pr: { number: 1234 } }),
        input({ pr: { number: 1235, title: "other thing" }, comments: [comment(7)] }),
      ];

      // Run A: baseline establishes watch state, emits nothing.
      const baselineRun = run({ baseline: true, inputs });
      expect(baselineRun.events).toEqual([]);

      // Run B: the first full run emits one event per PR (the actionable
      // classes after baseline) and persists each fingerprint.
      const firstRun = run({ inputs });
      expect(firstRun.events.length).toBeGreaterThan(0);
      const emitted = firstRun.events.map((event) => ({
        key: watchStateKey(event.owner, event.repo, event.number),
        fingerprint: readLastEmittedFingerprint(watchStateKey(event.owner, event.repo, event.number)),
        class: event.class,
      }));

      // Run C: identical inputs, identical registry — nothing new, exit 0.
      const secondRun = run({ inputs });
      expect(secondRun.events).toEqual([]);
      expect(secondRun.summary.events).toBe(0);
      expect(secondRun.summary.open).toBe(2);
      for (const event of emitted) {
        expect(readLastEmittedFingerprint(event.key)).toBe(event.fingerprint);
      }
      // The state read is unchanged too — the full classification is stable.
      expect(secondRun.state).toEqual(firstRun.state);
    });

    it("a classification change emits exactly one event, then a re-run is silent", () => {
      const inputs = [input()];
      run({ baseline: true, inputs });
      run({ inputs });

      // The PR flips to NO_GO at head: one NO_GO_OPEN event.
      const flipped = run({ inputs: [input({ verdicts: [verdict("NO_GO", { reviewer: "silvanus" })] })] });
      expect(flipped.events).toHaveLength(1);
      expect(flipped.events[0]!.class).toBe("NO_GO_OPEN");
      expect(flipped.events[0]!.detail).toBe("NO_GO at head by silvanus");

      // Unchanged inputs again: silent.
      const resettled = run({ inputs: [input({ verdicts: [verdict("NO_GO", { reviewer: "silvanus" })] })] });
      expect(resettled.events).toEqual([]);
    });

    it("a new comment emits exactly one NEW_COMMENT event, then a re-run is silent", () => {
      const baseComments = [comment(5)];
      const inputs = [input({ comments: baseComments })];
      run({ baseline: true, inputs });
      run({ inputs });
      expect(readCommentCursor(PR_KEY).lastSeenCommentId).toBe(5);

      // A genuinely new comment arrives; the class is unchanged so the tail
      // of the chain fires exactly one NEW_COMMENT event.
      const newCommentRun = run({ inputs: [input({ comments: [...baseComments, comment(100, "vespasian", "2026-08-18T09:30:00Z")] })] });
      expect(newCommentRun.events).toHaveLength(1);
      expect(newCommentRun.events[0]!.class).toBe("NEW_COMMENT");
      expect(newCommentRun.events[0]!.detail).toBe("comment by vespasian (#100)");
      expect(readCommentCursor(PR_KEY).lastSeenCommentId).toBe(100);

      // Unchanged again: the cursor is at 100, nothing fires.
      const resettled = run({ inputs: [input({ comments: [...baseComments, comment(100, "vespasian", "2026-08-18T09:30:00Z")] })] });
      expect(resettled.events).toEqual([]);
    });
  });

  describe("envelope (design section 2.2)", () => {
    it("zero-fills summary.by_class for all eight classes", () => {
      const result = run({ inputs: [input()] });
      expect(result.summary.by_class).toEqual({
        NEW: 1,
        NO_GO_OPEN: 0,
        CI_FAILING: 0,
        BASE_MOVED: 0,
        READY_TO_MERGE: 0,
        REVIEW_NEEDED: 0,
        STALE_WORKTREE: 0,
        NEW_COMMENT: 0,
      });
      const total = Object.values(result.summary.by_class).reduce((sum, count) => sum + count, 0);
      expect(total).toBe(result.summary.events);
    });

    it("builds state entries with the full classification read", () => {
      // Establish the watch row first: a first sighting would classify NEW
      // and mask the NO_GO class (NEW outranks everything).
      run({ baseline: true, inputs: [input()] });
      const result = run({
        inputs: [
          input({ verdicts: [verdict("NO_GO", { reviewer: "silvanus", lens: "correctness" })] }),
        ],
      });
      expect(result.state).toHaveLength(1);
      const entry = result.state[0]!;
      expect(entry.class).toBe("NO_GO_OPEN");
      expect(entry.verdict).toEqual({ value: "NO_GO", reviewer: "silvanus", lens: "correctness", sha: HEAD });
      expect(entry.base_ref_oid).toBe(MAIN);
      expect(entry.current_main_sha).toBe(MAIN);
      expect(entry.head_sha).toBe(HEAD);
      expect(entry.mergeable).toBe("MERGEABLE");
      expect(entry.ci_state).toBe("SUCCESS");
      expect(entry.url).toBe(`https://github.com/${OWNER}/${REPO}/pull/${NUMBER}`);
      expect(entry.first_seen_at).toBeTruthy();
    });

    it("emits a STALE_WORKTREE event for a merged PR with a matching lease, then is silent", () => {
      const inputs = [input({ pr: { state: "merged" } })];
      const leases = [lease()];
      const first = run({ inputs, leases });
      expect(first.events).toHaveLength(1);
      expect(first.events[0]!.class).toBe("STALE_WORKTREE");
      expect(first.events[0]!.detail).toContain("merged, worktree");
      const second = run({ inputs, leases });
      expect(second.events).toEqual([]);
    });

    it("skips a merged PR with no matching lease (negative control, criterion 3)", () => {
      const result = run({ inputs: [input({ pr: { state: "merged" } })] });
      expect(result.events).toEqual([]);
      expect(result.state[0]!.class).toBeNull();
    });
  });
});
