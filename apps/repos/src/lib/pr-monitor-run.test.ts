import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { closeDb, getDb } from "../db/database.js";
import { upsertRepo } from "../db/repos.js";
import type { GithubPullRequestClient, GraphqlPr, MonitorClient } from "./github.js";
import { runPrMonitor, type PrMonitorEnvelope } from "./pr-monitor-run.js";

/**
 * pr-monitor run orchestration tests (T7; design sections 2.1-2.2 and
 * acceptance criteria 3-4): the JSON envelope shape, the fetch layer's
 * error reporting, org/repo scoping, the sync section, and the
 * classification flow the CLI serializes. The MonitorClient is injected;
 * no live GitHub is touched.
 */

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const MAIN = "fedcba9876543210fedcba9876543210fedcba98";
const NOW = "2026-08-18 10:00:00";

function ghPr(number: number, overrides: Partial<GraphqlPr> = {}): GraphqlPr {
  return {
    number,
    title: `PR #${number}`,
    state: "OPEN",
    isDraft: false,
    author: { login: "andrei-hasna" },
    createdAt: "2026-08-18T09:00:00Z",
    updatedAt: "2026-08-18T09:30:00Z",
    mergedAt: null,
    closedAt: null,
    url: `https://github.com/hasna/apps/pull/${number}`,
    baseRefName: "main",
    headRefName: `feature-${number}`,
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    headRefOid: HEAD,
    baseRefOid: MAIN,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS", contexts: { nodes: [] } } } }] },
    ...overrides,
  };
}

function stubGithubClient(open: GraphqlPr[]): GithubPullRequestClient {
  return {
    fetchPullRequests: () => open,
    fetchPullRequestStates: () => new Map(),
  };
}

interface FixtureComment {
  id: number;
  createdAt: string | null;
  author: string | null;
  body: string;
}

/** MonitorClient stub: comments per PR number, main per (repo, branch). */
function stubMonitor(world: {
  comments?: Record<number, FixtureComment[]>;
  main?: string | null;
  failComments?: boolean;
}): MonitorClient {
  return {
    fetchComments: (_ghRepo, numbers) => {
      if (world.failComments) throw new Error("GitHub CLI request failed exit=8");
      const map = new Map<number, FixtureComment[]>();
      for (const n of numbers) map.set(n, world.comments?.[n] ?? []);
      return map;
    },
    fetchCurrentMainSha: () => (world.main === undefined ? MAIN : world.main),
  };
}

const GO_COMMENT: FixtureComment = {
  id: 7,
  createdAt: "2026-08-18T10:00:00Z",
  author: "reviewer1",
  body: `[REVIEW] GO — hasna/apps#1 @ ${HEAD} — lens: correctness, reviewer reviewer1`,
};

let repoId: number;

function seedOpenPr(dbPath: string, number: number, overrides: Partial<GraphqlPr> = {}): void {
  getDb(dbPath);
  const gh = ghPr(number, overrides);
  // Mirror the real sync path: upsert the repo record, then write the PR rows
  // the way bulkInsertPullRequests does (gh_owner/gh_repo derived from URL).
  repoId = upsertRepo({
    path: `/tmp/nowhere/hasna-apps`,
    name: "apps",
    org: "hasna",
    remote_url: "github.com/hasna/apps",
  }).id;
  const db = getDb();
  db.query(
    `INSERT INTO pull_requests
      (repo_id, number, title, state, author, created_at, updated_at, merged_at, closed_at, url,
       base_branch, head_branch, additions, deletions, changed_files,
       head_sha, base_ref_oid, mergeable, merge_state_status, ci_state, ci_contexts_json,
       is_draft, review_decision, gh_owner, gh_repo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    repoId, gh.number, gh.title, "open", gh.author?.login ?? "unknown",
    gh.createdAt, gh.updatedAt, gh.mergedAt, gh.closedAt, gh.url,
    gh.baseRefName, gh.headRefName, gh.additions, gh.deletions, gh.changedFiles,
    gh.headRefOid, gh.baseRefOid, gh.mergeable, gh.mergeStateStatus ?? null,
    gh.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
    JSON.stringify(gh.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []),
    gh.isDraft ? 1 : 0, gh.reviewDecision, "hasna", "apps",
  );
  // NOTE: no closeDb here — the in-process run must see the same in-memory
  // registry instance the seeding wrote into.
}

beforeEach(() => {
  closeDb();
  process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
  getDb(":memory:");
});

afterAll(() => {
  closeDb();
  delete process.env["HASNA_REPOS_DB_PATH"];
});

describe("runPrMonitor envelope", () => {
  it("negative control: an empty registry yields a zero-filled envelope, exit-safe", () => {
    const envelope = runPrMonitor({ sync: false, limit: 500, now: NOW });

    expect(envelope.schema).toBe("open-repos.pr-monitor.v1");
    expect(envelope.generated_at).toBe("2026-08-18T10:00:00.000Z");
    expect(envelope.filters).toEqual({ org: null, repo: null, limit: 500 });
    expect(envelope.synced).toBeNull();
    expect(envelope.baseline).toBe(false);
    expect(envelope.summary).toEqual({
      open: 0,
      events: 0,
      by_class: {
        NEW: 0, NO_GO_OPEN: 0, CI_FAILING: 0, BASE_MOVED: 0,
        READY_TO_MERGE: 0, REVIEW_NEEDED: 0, STALE_WORKTREE: 0, NEW_COMMENT: 0,
      },
    });
    expect(envelope.events).toEqual([]);
    expect(envelope.state).toEqual([]);
    expect(envelope.errors).toEqual([]);
  });

  it("emits NEW on first sighting, the class on the next run, nothing on the third (acceptance 4)", () => {
    seedOpenPr(":memory:", 1);
    const client = stubMonitor({ comments: { 1: [GO_COMMENT] } });
    const opts = { sync: false, client, now: NOW };

    const run1 = runPrMonitor(opts);
    expect(run1.summary.open).toBe(1);
    expect(run1.summary.events).toBe(1);
    expect(run1.events[0]).toMatchObject({ class: "NEW", owner: "hasna", repo: "apps", number: 1, head_sha: HEAD });
    expect(run1.events[0].id).toMatch(/^[0-9a-f]{16}$/);
    // first_seen_at is the registry's own insertion clock (column default),
    // not the run's observation time — assert presence, not the exact value.
    expect(run1.state[0]).toMatchObject({ class: "NEW" });
    expect(run1.state[0].first_seen_at).toEqual(expect.any(String));

    const run2 = runPrMonitor(opts);
    expect(run2.summary.events).toBe(1);
    expect(run2.events[0].class).toBe("READY_TO_MERGE");
    expect(run2.events[0].detail).toContain("GO by reviewer1");
    expect(run2.state[0].verdict).toEqual({ value: "GO", reviewer: "reviewer1", lens: "correctness", sha: HEAD });

    const run3 = runPrMonitor(opts);
    expect(run3.events).toEqual([]);
    expect(run3.state[0].class).toBe("READY_TO_MERGE");
  });

  it("baseline records watch state and suppresses NEW; the class event fires on the next run", () => {
    seedOpenPr(":memory:", 1);
    const client = stubMonitor({ comments: { 1: [GO_COMMENT] } });

    const baselineRun = runPrMonitor({ sync: false, baseline: true, client, now: NOW });
    expect(baselineRun.baseline).toBe(true);
    expect(baselineRun.summary.events).toBe(0);
    expect(baselineRun.events).toEqual([]);
    expect(baselineRun.summary.open).toBe(1);

    const nextRun = runPrMonitor({ sync: false, client, now: NOW });
    expect(nextRun.events).toHaveLength(1);
    expect(nextRun.events[0].class).toBe("READY_TO_MERGE");
  });

  it("a NO_GO at head outranks failing CI (precedence: NO_GO_OPEN)", () => {
    seedOpenPr(":memory:", 1, { commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE", contexts: { nodes: [{ name: "ci-check", status: "COMPLETED", conclusion: "FAILURE" }] } } } }] } });
    const client = stubMonitor({
      comments: { 1: [{ id: 8, createdAt: "2026-08-18T10:01:00Z", author: "reviewer2", body: `[REVIEW] NO_GO — hasna/apps#1 @ ${HEAD} — lens: correctness, reviewer reviewer2` }] },
    });

    const first = runPrMonitor({ sync: false, client, now: NOW });
    expect(first.events[0].class).toBe("NEW");
    const second = runPrMonitor({ sync: false, client, now: NOW });
    expect(second.events[0].class).toBe("NO_GO_OPEN");
    expect(second.events[0].detail).toContain("failing: ci-check");
  });

  it("a failed current-main fetch reports an error and degrades, never guesses", () => {
    seedOpenPr(":memory:", 1);
    const client = stubMonitor({ main: null }); // fetch attempted, returned null

    // First run is NEW regardless (first-sighting precedence); the degraded
    // class is what the SECOND run reports.
    runPrMonitor({ sync: false, client, now: NOW });
    const envelope = runPrMonitor({ sync: false, client, now: NOW });
    expect(envelope.errors.some((e) => e.includes("hasna/apps") && e.includes("main"))).toBe(true);
    // The PR is still classified (REVIEW_NEEDED), just without a freshness signal.
    expect(envelope.state).toHaveLength(1);
    expect(envelope.state[0].class).toBe("REVIEW_NEEDED");
    expect(envelope.state[0].current_main_sha).toBeNull();
  });

  it("a total comment-fetch failure excludes the PR's inputs and reports it", () => {
    seedOpenPr(":memory:", 1);
    const client = stubMonitor({ failComments: true });

    const envelope = runPrMonitor({ sync: false, client, now: NOW });
    expect(envelope.errors.length).toBeGreaterThan(0);
    expect(envelope.errors.some((e) => e.includes("hasna/apps"))).toBe(true);
    // No guessed classification: the PR is absent from both events and state.
    expect(envelope.events).toEqual([]);
    expect(envelope.state).toEqual([]);
  });

  it("scopes by org and repo", () => {
    getDb(":memory:");
    // hasna/apps PR 1 and a second repo hasna/todos PR 2, plus hasnaxyz/other PR 3.
    repoId = upsertRepo({ path: "/tmp/nowhere/hasna-apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" }).id;
    const db = getDb();
    const insert = (id: number, ghOwner: string, ghRepo: string, number: number, url: string) => {
      db.query(
        `INSERT INTO pull_requests
          (repo_id, number, title, state, author, created_at, updated_at, merged_at, closed_at, url,
           base_branch, head_branch, additions, deletions, changed_files,
           head_sha, base_ref_oid, mergeable, merge_state_status, ci_state, ci_contexts_json,
           is_draft, review_decision, gh_owner, gh_repo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, number, `PR ${number}`, "open", "andrei-hasna",
        "2026-08-18T09:00:00Z", "2026-08-18T09:30:00Z", null, null, url,
        "main", `feature-${number}`, 1, 1, 1,
        HEAD, MAIN, "MERGEABLE", "CLEAN", "SUCCESS", "[]", 0, null, ghOwner, ghRepo,
      );
    };
    insert(repoId, "hasna", "apps", 1, "https://github.com/hasna/apps/pull/1");
    const todosId = upsertRepo({ path: "/tmp/nowhere/hasna-todos", name: "todos", org: "hasna", remote_url: "github.com/hasna/todos" }).id;
    insert(todosId, "hasna", "todos", 2, "https://github.com/hasna/todos/pull/2");
    const otherId = upsertRepo({ path: "/tmp/nowhere/hasnaxyz-other", name: "other", org: "hasnaxyz", remote_url: "github.com/hasnaxyz/other" }).id;
    insert(otherId, "hasnaxyz", "other", 3, "https://github.com/hasnaxyz/other/pull/3");

    const byOrg = runPrMonitor({ sync: false, org: "hasna", client: stubMonitor({}), now: NOW });
    expect(byOrg.state.map((s) => `${s.owner}/${s.repo}#${s.number}`).sort()).toEqual([
      "hasna/apps#1",
      "hasna/todos#2",
    ]);

    const byRepo = runPrMonitor({ sync: false, repo: "apps", client: stubMonitor({}), now: NOW });
    expect(byRepo.state.map((s) => `${s.owner}/${s.repo}#${s.number}`)).toEqual(["hasna/apps#1"]);
    expect(byRepo.filters).toEqual({ org: null, repo: "apps", limit: 500 });
  });

  it("reports a STALE_WORKTREE for a merged PR with a non-released lease", () => {
    getDb(":memory:");
    repoId = upsertRepo({ path: "/tmp/nowhere/hasna-apps", name: "apps", org: "hasna", remote_url: "github.com/hasna/apps" }).id;
    const db = getDb();
    db.query(
      `INSERT INTO pull_requests
        (repo_id, number, title, state, author, created_at, updated_at, merged_at, closed_at, url,
         base_branch, head_branch, additions, deletions, changed_files,
         head_sha, base_ref_oid, mergeable, merge_state_status, ci_state, ci_contexts_json,
         is_draft, review_decision, gh_owner, gh_repo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      repoId, 1300, "merged thing", "merged", "andrei-hasna",
      "2026-08-01T09:00:00Z", "2026-08-01T09:30:00Z", "2026-08-01T09:30:00Z", null,
      "https://github.com/hasna/apps/pull/1300",
      "main", "plan/1300", 1, 1, 1,
      HEAD, MAIN, "MERGEABLE", "CLEAN", "SUCCESS", "[]", 0, null, "hasna", "apps",
    );
    db.query(
      `INSERT INTO worktree_leases
        (lease_id, repo_id, repo_path, machine_id, worktree_path, branch, base_ref, base_sha,
         task_id, run_id, mode, owner_metadata, cleanup_policy, status,
         created_at, updated_at, claimed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "lease-1300", String(repoId), "/tmp/nowhere/hasna-apps", "test-machine",
      join("/home/u", ".hasna", "repos", "worktrees", "apps", "1300"), "plan/1300", "main", MAIN,
      "task-1300", "run-1300", "worktree", "{}", "remove", "active",
      "2026-08-18T08:00:00Z", "2026-08-18T08:00:00Z", "2026-08-18T08:00:00Z",
    );

    const envelope = runPrMonitor({ sync: false, client: stubMonitor({}), now: NOW });
    expect(envelope.events).toHaveLength(1);
    expect(envelope.events[0].class).toBe("STALE_WORKTREE");
    expect(envelope.events[0].detail).toContain("remove via repos worktree");
    expect(envelope.state[0].class).toBe("STALE_WORKTREE");
    expect(envelope.summary.by_class.STALE_WORKTREE).toBe(1);
  });

  it("sync:true fills the synced section from the sync pass", () => {
    seedOpenPr(":memory:", 1);
    const envelope = runPrMonitor({
      sync: true,
      org: "hasna",
      client: stubMonitor({}),
      githubClient: stubGithubClient([ghPr(1)]),
      now: NOW,
    });
    expect(envelope.synced).toEqual({
      repos_seen: 1,
      repos_checked: 1,
      repos_synced: 1,
      total_synced: 1,
      truncated: false,
      errors: [],
      skipped: [],
    });
    expect(envelope.summary.open).toBe(1);
    expect(envelope.events[0].class).toBe("NEW");
  });
});
