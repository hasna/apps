import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { closeDb, getDb } from "../db/database.js";
import { upsertRepo } from "../db/repos.js";
import type { MonitorClient } from "./github.js";
import { runPrMonitor, type PrMonitorEnvelope } from "./pr-monitor-run.js";

/**
 * T10 acceptance suite — the pr-monitor design section 5 gate, exercised at
 * the run level through the injected MonitorClient (no live GitHub):
 *
 * - acceptance criterion 1 (positive control per class): a fixture registry
 *   holding PRs in each of the 8 states classifies exactly as the design
 *   section 2.4 table specifies, including precedence (a NO_GO'd PR with
 *   failing CI is NO_GO_OPEN, never CI_FAILING);
 * - acceptance criterion 3 (negative control): an all-merged PR set with no
 *   matching (or only released) worktree leases produces no STALE_WORKTREE
 *   and no other events;
 * - acceptance criterion 4 (idempotency): after each class event is emitted
 *   once, an unchanged re-run emits `events: []` with the watch fingerprints
 *   and comment cursors unperturbed.
 *
 * The per-class engine matrix and the two-sided verdict parser fixtures live
 * in pr-monitor-classify.test.ts and verdict-parser.test.ts; this file proves
 * the same classes through the orchestration path the CLI and the loop run.
 */

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const MAIN = "fedcba9876543210fedcba9876543210fedcba98";
const OLDER_MAIN = "1111111111111111111111111111111111111111";
const NOW = "2026-08-18 10:00:00";

interface FixtureComment {
  id: number;
  createdAt: string | null;
  author: string | null;
  body: string;
}

/** MonitorClient stub: comments per PR number, main sha per repo. */
function stubMonitor(world: {
  comments?: Record<number, FixtureComment[]>;
  main?: string | null;
}): MonitorClient {
  return {
    fetchComments: (_ghRepo, numbers) => {
      const map = new Map<number, FixtureComment[]>();
      for (const n of numbers) map.set(n, world.comments?.[n] ?? []);
      return map;
    },
    fetchCurrentMainSha: () => (world.main === undefined ? MAIN : world.main),
  };
}

function verdictComment(id: number, verdict: "GO" | "NO_GO", reviewer = "reviewer1"): FixtureComment {
  return {
    id,
    createdAt: "2026-08-18T09:30:00Z",
    author: reviewer,
    body: `[REVIEW] ${verdict} — hasna/apps#0 @ ${HEAD} — lens: correctness, reviewer ${reviewer}`,
  };
}

interface SeedPrOverrides {
  number: number;
  state?: string;
  mergedAt?: string | null;
  ciState?: string | null;
  ciContexts?: Array<{ name: string; status: string; conclusion: string }>;
  baseRefOid?: string | null;
  headBranch?: string;
}

/** Insert one pull_requests row the way the sync path writes them. */
function seedPr(overrides: SeedPrOverrides): void {
  const gh = {
    number: overrides.number,
    state: overrides.state ?? "open",
    ciState: overrides.ciState ?? "SUCCESS",
    contexts: overrides.ciContexts ?? [],
    baseRefOid: overrides.baseRefOid ?? MAIN,
  };
  const db = getDb();
  db.query(
    `INSERT INTO pull_requests
      (repo_id, number, title, state, author, created_at, updated_at, merged_at, closed_at, url,
       base_branch, head_branch, additions, deletions, changed_files,
       head_sha, base_ref_oid, mergeable, merge_state_status, ci_state, ci_contexts_json,
       is_draft, review_decision, gh_owner, gh_repo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    repoId, gh.number, `PR #${gh.number}`, gh.state, "andrei-hasna",
    "2026-08-18T09:00:00Z", "2026-08-18T09:30:00Z",
    overrides.mergedAt ?? null, null, `https://github.com/hasna/apps/pull/${gh.number}`,
    "main", overrides.headBranch ?? `feature-${gh.number}`, 10, 2, 3,
    HEAD, gh.baseRefOid, "MERGEABLE", "CLEAN", gh.ciState,
    JSON.stringify(gh.contexts), 0, null, "hasna", "apps",
  );
}

/** Insert one non-released worktree lease for the STALE_WORKTREE fixture. */
function seedLease(branch: string, status: string, taskId = "task-x"): void {
  const db = getDb();
  db.query(
    `INSERT INTO worktree_leases
      (lease_id, repo_id, repo_path, machine_id, worktree_path, branch, base_ref, base_sha,
       task_id, run_id, mode, owner_metadata, cleanup_policy, status,
       created_at, updated_at, claimed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `lease-${branch}`, String(repoId), "/tmp/nowhere/hasna-apps", "test-machine",
    join("/home/u", ".hasna", "repos", "worktrees", "apps", branch), branch, "main", MAIN,
    taskId, "run-x", "worktree", "{}", "remove", status,
    "2026-08-18T08:00:00Z", "2026-08-18T08:00:00Z", "2026-08-18T08:00:00Z",
  );
}

let repoId: number;

function seedMatrix(): void {
  getDb(":memory:");
  repoId = upsertRepo({
    path: "/tmp/nowhere/hasna-apps",
    name: "apps",
    org: "hasna",
    remote_url: "github.com/hasna/apps",
  }).id;

  // NO_GO_OPEN: NO_GO verdict at head AND failing CI — precedence demands
  // NO_GO_OPEN, never CI_FAILING (design 2.4 precedence rationale).
  seedPr({ number: 101, ciState: "FAILURE", ciContexts: [{ name: "ci-check", status: "COMPLETED", conclusion: "FAILURE" }] });
  // CI_FAILING: failing rollup + named failing check, no verdict.
  seedPr({ number: 102, ciState: "FAILURE", ciContexts: [{ name: "ci-check", status: "COMPLETED", conclusion: "FAILURE" }] });
  // BASE_MOVED: base_ref_oid behind the current main, no verdict.
  seedPr({ number: 103, baseRefOid: OLDER_MAIN });
  // READY_TO_MERGE: GO at head, mergeable, base fresh, CI green.
  seedPr({ number: 104 });
  // REVIEW_NEEDED: no verdict at head, base fresh.
  seedPr({ number: 105 });
  // NEW_COMMENT: same class as #105, but a comment newer than the seeded
  // cursor on the later runs.
  seedPr({ number: 106 });
  // NEW: an ordinary open PR — the first-sighting positive control.
  seedPr({ number: 107 });
  // STALE_WORKTREE: merged PR with a live, branch-matching worktree lease.
  seedPr({ number: 1300, state: "merged", mergedAt: "2026-08-18T09:30:00Z", headBranch: "plan/1300" });
  seedLease("plan/1300", "active");
}

function byNumber(envelope: PrMonitorEnvelope): Map<number, string | null> {
  return new Map(envelope.state.map((s) => [s.number, s.class]));
}

function commentWorld(extra106?: FixtureComment[]): Record<number, FixtureComment[]> {
  return {
    101: [verdictComment(8, "NO_GO", "reviewer2")],
    104: [verdictComment(7, "GO")],
    106: [
      { id: 5, createdAt: "2026-08-18T09:00:00Z", author: "silvanus", body: "looks fine" },
      ...(extra106 ?? []),
    ],
  };
}

beforeEach(() => {
  closeDb();
  process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
  seedMatrix();
});

afterAll(() => {
  closeDb();
  delete process.env["HASNA_REPOS_DB_PATH"];
});

describe("T10 acceptance — positive control per class through the run path", () => {
  it("run 1: every open PR emits NEW, the merged-with-lease PR emits STALE_WORKTREE (acceptance 1 + 3)", () => {
    const client = stubMonitor({ comments: commentWorld() });
    const envelope = runPrMonitor({ sync: false, client, now: NOW });

    expect(envelope.errors).toEqual([]);
    expect(envelope.summary.open).toBe(7);
    expect(envelope.summary.events).toBe(8);
    expect(envelope.summary.by_class).toEqual({
      NEW: 7, NO_GO_OPEN: 0, CI_FAILING: 0, BASE_MOVED: 0,
      READY_TO_MERGE: 0, REVIEW_NEEDED: 0, STALE_WORKTREE: 1, NEW_COMMENT: 0,
    });
    for (const event of envelope.events) {
      expect(event.id).toMatch(/^[0-9a-f]{16}$/);
    }
    const classes = envelope.events.map((e) => e.class).sort();
    expect(classes.filter((c) => c === "NEW")).toHaveLength(7);
    expect(classes.filter((c) => c === "STALE_WORKTREE")).toHaveLength(1);
  });

  it("run 2: each open PR classifies to exactly its table class, NO_GO outranks failing CI (acceptance 1)", () => {
    const client = stubMonitor({ comments: commentWorld() });
    runPrMonitor({ sync: false, client, now: NOW }); // first sighting -> NEW
    const envelope = runPrMonitor({ sync: false, client, now: NOW });

    // #105, #106 and #107 all have no verdict at head -> REVIEW_NEEDED.
    expect(envelope.summary.by_class).toEqual({
      NEW: 0, NO_GO_OPEN: 1, CI_FAILING: 1, BASE_MOVED: 1,
      READY_TO_MERGE: 1, REVIEW_NEEDED: 3, STALE_WORKTREE: 0, NEW_COMMENT: 0,
    });
    const classes = byNumber(envelope);
    expect(classes.get(101)).toBe("NO_GO_OPEN"); // NO_GO beats failing CI
    expect(classes.get(102)).toBe("CI_FAILING");
    expect(classes.get(103)).toBe("BASE_MOVED");
    expect(classes.get(104)).toBe("READY_TO_MERGE");
    expect(classes.get(105)).toBe("REVIEW_NEEDED");
    expect(classes.get(106)).toBe("REVIEW_NEEDED");
    expect(classes.get(107)).toBe("REVIEW_NEEDED");
    // State is the full current classification; the merged PR stays
    // STALE_WORKTREE while its lease lives — only the EVENT is deduped.
    expect(classes.get(1300)).toBe("STALE_WORKTREE");

    const detailOf = new Map(envelope.events.map((e) => [e.class, e.detail]));
    expect(detailOf.get("NO_GO_OPEN")).toContain("failing: ci-check");
    expect(detailOf.get("CI_FAILING")).toContain("failing: ci-check");
    expect(detailOf.get("BASE_MOVED")).toContain("main moved past last sync");
    expect(detailOf.get("READY_TO_MERGE")).toContain("GO by reviewer1");
    expect(detailOf.get("REVIEW_NEEDED")).toContain("no verdict at head");
  });

  it("run 3: a newer comment on an unchanged PR emits NEW_COMMENT and nothing else (acceptance 1)", () => {
    // The cursor is seeded at the newest comment on first sighting (design
    // section 6), so the newer comment must NOT be present on runs 1-2 — it
    // arrives only for run 3.
    const client = stubMonitor({ comments: commentWorld() });
    runPrMonitor({ sync: false, client, now: NOW }); // NEW
    runPrMonitor({ sync: false, client, now: NOW }); // classes
    const later = stubMonitor({
      comments: commentWorld([{ id: 7, createdAt: "2026-08-18T10:05:00Z", author: "silvanus", body: "bump" }]),
    });
    const envelope = runPrMonitor({ sync: false, client: later, now: NOW });

    expect(envelope.summary.by_class).toEqual({
      NEW: 0, NO_GO_OPEN: 0, CI_FAILING: 0, BASE_MOVED: 0,
      READY_TO_MERGE: 0, REVIEW_NEEDED: 0, STALE_WORKTREE: 0, NEW_COMMENT: 1,
    });
    expect(envelope.events).toHaveLength(1);
    expect(envelope.events[0]!.class).toBe("NEW_COMMENT");
    expect(envelope.events[0]!.detail).toBe("comment by silvanus (#7)");
    // The class itself is unchanged — the state entry still reads the class.
    expect(byNumber(envelope).get(106)).toBe("REVIEW_NEEDED");
  });

  it("run 4: an unchanged re-run emits nothing — the idempotency tail (acceptance 4)", () => {
    const client = stubMonitor({ comments: commentWorld() });
    runPrMonitor({ sync: false, client, now: NOW }); // NEW
    runPrMonitor({ sync: false, client, now: NOW }); // classes
    const later = stubMonitor({
      comments: commentWorld([{ id: 7, createdAt: "2026-08-18T10:05:00Z", author: "silvanus", body: "bump" }]),
    });
    runPrMonitor({ sync: false, client: later, now: NOW }); // NEW_COMMENT
    const envelope = runPrMonitor({ sync: false, client: later, now: NOW });

    expect(envelope.events).toEqual([]);
    expect(envelope.summary.events).toBe(0);
    expect(envelope.summary.by_class).toEqual({
      NEW: 0, NO_GO_OPEN: 0, CI_FAILING: 0, BASE_MOVED: 0,
      READY_TO_MERGE: 0, REVIEW_NEEDED: 0, STALE_WORKTREE: 0, NEW_COMMENT: 0,
    });
    expect(envelope.errors).toEqual([]);
  });
});

describe("T10 acceptance — negative control: all-merged set, no events (acceptance 3)", () => {
  it("merged PRs with no worktree leases produce no STALE_WORKTREE and no other events", () => {
    closeDb();
    process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
    getDb(":memory:");
    repoId = upsertRepo({
      path: "/tmp/nowhere/hasna-apps",
      name: "apps",
      org: "hasna",
      remote_url: "github.com/hasna/apps",
    }).id;
    for (const number of [2001, 2002, 2003]) {
      seedPr({ number, state: "merged", mergedAt: "2026-08-18T09:30:00Z", headBranch: `plan/${number}` });
    }

    const client = stubMonitor({});
    const first = runPrMonitor({ sync: false, client, now: NOW });
    expect(first.summary.open).toBe(0);
    expect(first.summary.events).toBe(0);
    expect(first.summary.by_class).toEqual({
      NEW: 0, NO_GO_OPEN: 0, CI_FAILING: 0, BASE_MOVED: 0,
      READY_TO_MERGE: 0, REVIEW_NEEDED: 0, STALE_WORKTREE: 0, NEW_COMMENT: 0,
    });
    expect(first.events).toEqual([]);
    expect(first.state).toHaveLength(3);
    for (const entry of first.state) expect(entry.class).toBeNull();
    expect(first.errors).toEqual([]);

    // A re-run against the same state stays silent.
    const second = runPrMonitor({ sync: false, client, now: NOW });
    expect(second.events).toEqual([]);
    expect(second.summary.events).toBe(0);
  });

  it("a released lease never fires STALE_WORKTREE (only non-released leases match)", () => {
    closeDb();
    process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
    getDb(":memory:");
    repoId = upsertRepo({
      path: "/tmp/nowhere/hasna-apps",
      name: "apps",
      org: "hasna",
      remote_url: "github.com/hasna/apps",
    }).id;
    seedPr({ number: 2004, state: "merged", mergedAt: "2026-08-18T09:30:00Z", headBranch: "plan/2004" });
    seedLease("plan/2004", "released");

    const client = stubMonitor({});
    const envelope = runPrMonitor({ sync: false, client, now: NOW });
    expect(envelope.events).toEqual([]);
    expect(envelope.summary.by_class.STALE_WORKTREE).toBe(0);
    expect(byNumber(envelope).get(2004)).toBeNull();
  });
});
