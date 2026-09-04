import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  classifyPullRequest,
  probeMergeTree,
  type MergeTreeProbe,
  type MonitorCommentMeta,
  type MonitorLeaseInput,
  type PrMonitorClass,
  type PrMonitorSubject,
} from "./pr-monitor-classify.js";
import { computeEventFingerprint, watchStateKey, type PrMonitorWatchRow } from "./pr-monitor-state.js";
import type { ParsedVerdict } from "./verdict-parser.js";

/**
 * pr-monitor classification engine tests.
 *
 * Fixture matrix per class from the pr-monitor design section 2.4: one class
 * per PR per run, precedence NEW > NO_GO_OPEN > CI_FAILING > BASE_MOVED >
 * READY_TO_MERGE > REVIEW_NEEDED > NEW_COMMENT, drafts restricted to
 * NEW/NEW_COMMENT, merged PRs to STALE_WORKTREE, and graceful degradation of
 * the base-freshness legs when inputs are absent (never guessed). The
 * merge-tree leg (probeMergeTree) is exercised against synthetic git repos in
 * both reachable directions (fresh tree, diverged tree) plus the
 * objects-absent degrade.
 */

const OWNER = "hasna";
const REPO = "apps";
const NUMBER = 1234;
const PR_KEY = watchStateKey(OWNER, REPO, NUMBER);
const HEAD = "abc1234abc1234abc1234abc1234abc1234abc1";
const MAIN = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const OLDER_SHA = "1111111111111111111111111111111111111111";

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

function watch(overrides: Partial<PrMonitorWatchRow> = {}): PrMonitorWatchRow {
  return {
    pr_key: PR_KEY,
    gh_owner: OWNER,
    gh_repo: REPO,
    number: NUMBER,
    first_seen_at: "2026-08-18 10:00:00",
    last_seen_at: "2026-08-18 10:00:00",
    last_observed_state: "open",
    last_head_sha: HEAD,
    last_updated_at: null,
    last_seen_comment_id: 0,
    last_seen_comment_at: null,
    last_classification: null,
    last_classification_at: null,
    last_emitted_fingerprint: null,
    verdict_json: null,
    ci_failing_json: null,
    base_ref_oid: MAIN,
    current_main_sha: MAIN,
    ...overrides,
  };
}

function verdict(
  value: "GO" | "NO_GO",
  opts: { sha?: string; reviewer?: string | null; lens?: string | null; commentId?: number; createdAt?: string | null } = {},
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
    createdAt: opts.createdAt ?? "2026-08-18T09:00:00Z",
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

function classify(opts: {
  pr?: Partial<PrMonitorSubject>;
  watch?: PrMonitorWatchRow | null;
  verdicts?: ParsedVerdict[];
  comments?: MonitorCommentMeta[];
  currentMainSha?: string | null;
  leases?: MonitorLeaseInput[];
  mergeTree?: MergeTreeProbe | null;
}) {
  return classifyPullRequest({
    pr: subject(opts.pr),
    watch: opts.watch === undefined ? null : opts.watch,
    verdicts: opts.verdicts ?? [],
    comments: opts.comments ?? [],
    currentMainSha: opts.currentMainSha === undefined ? MAIN : opts.currentMainSha,
    leases: opts.leases ?? [],
    mergeTree: opts.mergeTree === undefined ? null : opts.mergeTree,
  });
}

function expectEvent(
  outcome: ReturnType<typeof classifyPullRequest>,
  cls: PrMonitorClass,
  detail: string,
): void {
  expect(outcome.event).not.toBeNull();
  expect(outcome.event!.cls).toBe(cls);
  expect(outcome.event!.detail).toBe(detail);
  expect(outcome.event!.fingerprint).toBe(
    computeEventFingerprint(PR_KEY, cls, HEAD, detail),
  );
}

describe("classifyPullRequest — NEW (first sighting)", () => {
  it("classifies an open PR with no watch row as NEW", () => {
    const outcome = classify({ watch: null });
    expect(outcome.cls).toBe("NEW");
    expect(outcome.detail).toBe("new PR (first sighting)");
    expectEvent(outcome, "NEW", "new PR (first sighting)");
  });

  it("NEW outranks every other class on first sighting — a NO_GO'd failing PR is still NEW", () => {
    const outcome = classify({
      watch: null,
      verdicts: [verdict("NO_GO")],
      pr: { ciState: "FAILURE" },
    });
    expect(outcome.cls).toBe("NEW");
  });

  it("classifies a draft PR with no watch row as NEW", () => {
    const outcome = classify({ watch: null, pr: { isDraft: true } });
    expect(outcome.cls).toBe("NEW");
  });

  it("does not classify a closed PR with no watch row as NEW", () => {
    const outcome = classify({ watch: null, pr: { state: "closed" } });
    expect(outcome.cls).toBeNull();
    expect(outcome.event).toBeNull();
  });
});

describe("classifyPullRequest — NO_GO_OPEN", () => {
  it("classifies NO_GO at head with no newer GO as NO_GO_OPEN", () => {
    const outcome = classify({ watch: watch(), verdicts: [verdict("NO_GO", { reviewer: "silvanus" })] });
    expect(outcome.cls).toBe("NO_GO_OPEN");
    expect(outcome.detail).toBe("NO_GO at head by silvanus");
    expectEvent(outcome, "NO_GO_OPEN", "NO_GO at head by silvanus");
  });

  it("NO_GO at head outranks failing CI — precedence over CI_FAILING", () => {
    const outcome = classify({
      watch: watch(),
      verdicts: [verdict("NO_GO")],
      pr: { ciState: "FAILURE", ciContextsJson: '[{"name":"build","conclusion":"FAILURE"}]' },
    });
    expect(outcome.cls).toBe("NO_GO_OPEN");
    expect(outcome.failingChecks).toEqual(["build"]);
  });

  it("NO_GO at an older sha is ignored at head — falls to REVIEW_NEEDED", () => {
    const outcome = classify({ watch: watch(), verdicts: [verdict("NO_GO", { sha: OLDER_SHA })] });
    expect(outcome.cls).toBe("REVIEW_NEEDED");
    expect(outcome.verdictAtHead).toBeNull();
  });

  it("a newer GO at the same head supersedes an older NO_GO", () => {
    const outcome = classify({
      watch: watch(),
      verdicts: [
        verdict("NO_GO", { commentId: 100, createdAt: "2026-08-18T08:00:00Z" }),
        verdict("GO", { commentId: 200, createdAt: "2026-08-18T09:00:00Z" }),
      ],
    });
    expect(outcome.cls).toBe("READY_TO_MERGE");
  });
});

describe("classifyPullRequest — CI_FAILING", () => {
  it("classifies a FAILURE rollup at head as CI_FAILING, naming the failing check", () => {
    const outcome = classify({
      watch: watch(),
      pr: { ciState: "FAILURE", ciContextsJson: '[{"name":"build","conclusion":"FAILURE"},{"name":"lint","conclusion":"SUCCESS"}]' },
    });
    expect(outcome.cls).toBe("CI_FAILING");
    expect(outcome.failingChecks).toEqual(["build"]);
    expect(outcome.detail).toBe("failing: build");
    expectEvent(outcome, "CI_FAILING", "failing: build");
  });

  it("classifies an ERROR rollup as CI_FAILING", () => {
    const outcome = classify({ watch: watch(), pr: { ciState: "ERROR" } });
    expect(outcome.cls).toBe("CI_FAILING");
  });

  it("counts CANCELLED contexts among the failing checks", () => {
    const outcome = classify({
      watch: watch(),
      pr: { ciState: "FAILURE", ciContextsJson: '[{"name":"build","conclusion":"CANCELLED"}]' },
    });
    expect(outcome.failingChecks).toEqual(["build"]);
  });

  it("CI_FAILING outranks a GO verdict at head", () => {
    const outcome = classify({
      watch: watch(),
      verdicts: [verdict("GO")],
      pr: { ciState: "FAILURE" },
    });
    expect(outcome.cls).toBe("CI_FAILING");
  });

  it("does not fire on PENDING or SUCCESS rollups", () => {
    for (const ciState of ["PENDING", "SUCCESS"]) {
      const outcome = classify({ watch: watch(), pr: { ciState } });
      expect(outcome.cls).not.toBe("CI_FAILING");
    }
  });

  it("degrades to the rollup when contexts are absent — detail names the rollup", () => {
    const outcome = classify({ watch: watch(), pr: { ciState: "FAILURE", ciContextsJson: null } });
    expect(outcome.cls).toBe("CI_FAILING");
    expect(outcome.failingChecks).toEqual([]);
    expect(outcome.detail).toBe("rollup FAILURE");
  });

  it("tolerates malformed contexts JSON — no throw, no failing checks", () => {
    const outcome = classify({
      watch: watch(),
      pr: { ciState: "FAILURE", ciContextsJson: "{not json" },
    });
    expect(outcome.cls).toBe("CI_FAILING");
    expect(outcome.failingChecks).toEqual([]);
  });
});

describe("classifyPullRequest — BASE_MOVED", () => {
  it("classifies a PR whose base moved past last sync as BASE_MOVED, outranking a GO verdict", () => {
    const outcome = classify({
      watch: watch(),
      verdicts: [verdict("GO")],
      pr: { baseRefOid: OLDER_SHA },
    });
    expect(outcome.cls).toBe("BASE_MOVED");
    expect(outcome.detail).toBe("main moved past last sync");
    expectEvent(outcome, "BASE_MOVED", "main moved past last sync");
  });

  it("does not fire when base_ref_oid equals current main", () => {
    const outcome = classify({ watch: watch(), pr: { baseRefOid: MAIN } });
    expect(outcome.cls).not.toBe("BASE_MOVED");
  });

  it("degrades when base_ref_oid was never captured — never guessed", () => {
    const outcome = classify({ watch: watch(), pr: { baseRefOid: null } });
    expect(outcome.cls).not.toBe("BASE_MOVED");
    expect(outcome.cls).not.toBe("READY_TO_MERGE");
  });

  it("degrades when current main could not be fetched — never guessed", () => {
    const outcome = classify({ watch: watch(), currentMainSha: null });
    expect(outcome.cls).not.toBe("BASE_MOVED");
    expect(outcome.cls).not.toBe("READY_TO_MERGE");
  });

  it("a diverged merge-tree leg classifies BASE_MOVED even when stored refs match", () => {
    const outcome = classify({
      watch: watch(),
      verdicts: [verdict("GO")],
      pr: { baseRefOid: MAIN },
      mergeTree: { ok: true, fresh: false, treeSha: "3333333333333333333333333333333333333333" },
    });
    expect(outcome.cls).toBe("BASE_MOVED");
    expect(outcome.detail).toContain("merge-tree diverged");
  });

  it("classifies objects-absent + GO + stale base as BASE_MOVED — the equality leg outranks the absent merge-tree leg", () => {
    // Design section 6: when the merge-tree probe degrades to
    // `{ok:false, reason:"objects-absent"}` the monitor falls back to
    // `base_ref_oid == current_main_sha` equality; a stale base must still
    // classify BASE_MOVED, never READY_TO_MERGE.
    const outcome = classify({
      watch: watch(),
      verdicts: [verdict("GO")],
      pr: { baseRefOid: OLDER_SHA },
      mergeTree: { ok: false, reason: "objects-absent", stderr: null },
    });
    expect(outcome.cls).toBe("BASE_MOVED");
    expect(outcome.detail).toBe("main moved past last sync");
    expectEvent(outcome, "BASE_MOVED", "main moved past last sync");
  });
});

describe("classifyPullRequest — READY_TO_MERGE", () => {
  it("classifies GO at head + mergeable + fresh base + clean CI as READY_TO_MERGE", () => {
    const outcome = classify({
      watch: watch(),
      verdicts: [verdict("GO", { reviewer: "silvanus" })],
    });
    expect(outcome.cls).toBe("READY_TO_MERGE");
    expect(outcome.detail).toBe("GO by silvanus");
    expectEvent(outcome, "READY_TO_MERGE", "GO by silvanus");
  });

  it("stays READY_TO_MERGE when the merge-tree leg confirms the tree is unchanged at current main", () => {
    const outcome = classify({
      watch: watch(),
      verdicts: [verdict("GO")],
      mergeTree: { ok: true, fresh: true, treeSha: HEAD },
    });
    expect(outcome.cls).toBe("READY_TO_MERGE");
  });

  it("degrades to READY_TO_MERGE when the merge-tree probe reports objects-absent — design section 6 equality fallback", () => {
    // Design section 6: the merge-tree leg runs only when the head/base
    // objects exist in a local checkout; otherwise the monitor degrades to
    // `base_ref_oid == current_main_sha` equality. `objects-absent` must be
    // treated like a probe that was never run.
    const outcome = classify({
      watch: watch(),
      verdicts: [verdict("GO")],
      mergeTree: { ok: false, reason: "objects-absent", stderr: null },
    });
    expect(outcome.cls).toBe("READY_TO_MERGE");
    expect(outcome.detail).toBe("GO by silvanus");
    expectEvent(outcome, "READY_TO_MERGE", "GO by silvanus");
  });

  it("is not READY when the merge-tree probe failed for a real git error — only objects-absent degrades", () => {
    // A genuine probe failure (git-failed) is not evidence of freshness; the
    // READY condition must stay undecided, never guessed.
    const outcome = classify({
      watch: watch(),
      verdicts: [verdict("GO")],
      mergeTree: { ok: false, reason: "git-failed", stderr: "fatal: not a git repository" },
    });
    expect(outcome.cls).toBeNull();
    expect(outcome.event).toBeNull();
  });

  it("is not READY when the PR is CONFLICTING", () => {
    const outcome = classify({
      watch: watch(),
      verdicts: [verdict("GO")],
      pr: { mergeable: "CONFLICTING" },
    });
    expect(outcome.cls).toBeNull();
    expect(outcome.event).toBeNull();
  });

  it("is not READY when mergeability is UNKNOWN", () => {
    const outcome = classify({
      watch: watch(),
      verdicts: [verdict("GO")],
      pr: { mergeable: "UNKNOWN" },
    });
    expect(outcome.cls).toBeNull();
  });

  it("is not READY when the GO verdict names an older sha", () => {
    const outcome = classify({
      watch: watch(),
      verdicts: [verdict("GO", { sha: OLDER_SHA })],
    });
    expect(outcome.cls).toBe("REVIEW_NEEDED");
  });

  it("is not READY when CI is failing", () => {
    const outcome = classify({
      watch: watch(),
      verdicts: [verdict("GO")],
      pr: { ciState: "FAILURE" },
    });
    expect(outcome.cls).toBe("CI_FAILING");
  });
});

describe("classifyPullRequest — REVIEW_NEEDED", () => {
  it("classifies a PR with no verdicts at all as REVIEW_NEEDED", () => {
    const outcome = classify({ watch: watch() });
    expect(outcome.cls).toBe("REVIEW_NEEDED");
    expect(outcome.detail).toBe("no verdict at head");
    expectEvent(outcome, "REVIEW_NEEDED", "no verdict at head");
  });

  it("enriches the detail with the GitHub review-required signal when no [REVIEW] comments exist", () => {
    const outcome = classify({ watch: watch(), pr: { reviewDecision: "REVIEW_REQUIRED" } });
    expect(outcome.cls).toBe("REVIEW_NEEDED");
    expect(outcome.detail).toBe("no verdict at head; GitHub review required");
    expectEvent(outcome, "REVIEW_NEEDED", "no verdict at head; GitHub review required");
  });

  it("keeps the plain detail when a verdict comment exists at an older sha", () => {
    const outcome = classify({ watch: watch(), verdicts: [verdict("GO", { sha: OLDER_SHA })] });
    expect(outcome.cls).toBe("REVIEW_NEEDED");
    expect(outcome.detail).toBe("no verdict at head");
  });

  it("does not fire when a verdict exists at head", () => {
    const outcome = classify({ watch: watch(), verdicts: [verdict("NO_GO")] });
    expect(outcome.cls).not.toBe("REVIEW_NEEDED");
  });
});

describe("classifyPullRequest — NEW_COMMENT (tail of the precedence chain)", () => {
  const unchangedWatch = watch({
    last_emitted_fingerprint: computeEventFingerprint(PR_KEY, "REVIEW_NEEDED", HEAD, "no verdict at head"),
  });

  it("emits NEW_COMMENT when the class is unchanged and a newer comment exists", () => {
    const outcome = classify({
      watch: unchangedWatch,
      comments: [comment(500, "vespasian")],
    });
    expect(outcome.cls).toBe("REVIEW_NEEDED");
    expect(outcome.event!.cls).toBe("NEW_COMMENT");
    expect(outcome.newCommenter).toBe("vespasian");
    expect(outcome.detail).toBe("no verdict at head");
    expectEvent(outcome, "NEW_COMMENT", "comment by vespasian (#500)");
  });

  it("emits nothing when the class is unchanged and no new comments exist", () => {
    const outcome = classify({ watch: unchangedWatch });
    expect(outcome.cls).toBe("REVIEW_NEEDED");
    expect(outcome.event).toBeNull();
  });

  it("emits the class event, not NEW_COMMENT, when the classification changed", () => {
    const outcome = classify({
      watch: watch({
        last_emitted_fingerprint: computeEventFingerprint(PR_KEY, "READY_TO_MERGE", HEAD, "GO by silvanus"),
      }),
      verdicts: [verdict("NO_GO")],
      comments: [comment(500)],
    });
    expect(outcome.cls).toBe("NO_GO_OPEN");
    expect(outcome.event!.cls).toBe("NO_GO_OPEN");
  });

  it("fires for a draft with new comments and no actionable class", () => {
    const outcome = classify({
      watch: watch(),
      pr: { isDraft: true },
      comments: [comment(500, "silvanus")],
    });
    expect(outcome.cls).toBe("NEW_COMMENT");
    expect(outcome.event!.cls).toBe("NEW_COMMENT");
  });

  it("does not re-emit when the last emitted event is already the same NEW_COMMENT", () => {
    const fp = computeEventFingerprint(PR_KEY, "NEW_COMMENT", HEAD, "comment by silvanus (#500)");
    const outcome = classify({
      watch: watch({ last_emitted_fingerprint: fp }),
      pr: { isDraft: true },
      comments: [comment(500, "silvanus")],
    });
    expect(outcome.cls).toBe("NEW_COMMENT");
    expect(outcome.event).toBeNull();
  });

  it("a verdict comment that flips the class emits the class event only, never NEW_COMMENT", () => {
    const outcome = classify({
      watch: watch({
        last_emitted_fingerprint: computeEventFingerprint(PR_KEY, "REVIEW_NEEDED", HEAD, "no verdict at head"),
      }),
      verdicts: [verdict("GO")],
      comments: [comment(500, "silvanus")],
    });
    expect(outcome.event!.cls).toBe("READY_TO_MERGE");
  });
});

describe("classifyPullRequest — STALE_WORKTREE (merged domain)", () => {
  it("classifies a merged PR with a non-released branch-matching lease as STALE_WORKTREE", () => {
    const outcome = classify({
      watch: watch(),
      pr: { state: "merged" },
      leases: [lease({ status: "active" })],
    });
    expect(outcome.cls).toBe("STALE_WORKTREE");
    expect(outcome.detail).toBe(
      "merged, worktree " + join("/home/hasna", ".hasna", "repos", "worktrees", "apps", "pr-monitor") + " present — remove via repos worktree",
    );
    expectEvent(outcome, "STALE_WORKTREE", outcome.detail);
  });

  it("does not fire when the matching lease is released", () => {
    const outcome = classify({
      watch: watch(),
      pr: { state: "merged" },
      leases: [lease({ status: "released" })],
    });
    expect(outcome.cls).toBeNull();
    expect(outcome.event).toBeNull();
  });

  it("does not fire for a merged PR with no matching lease", () => {
    const outcome = classify({ watch: watch(), pr: { state: "merged" } });
    expect(outcome.cls).toBeNull();
  });

  it("falls back to a task_id that mentions the PR number", () => {
    const outcome = classify({
      watch: watch(),
      pr: { state: "merged", headBranch: "some-branch" },
      leases: [lease({ branch: "other-branch", taskId: `plan/alpha#${NUMBER}` })],
    });
    expect(outcome.cls).toBe("STALE_WORKTREE");
  });

  it("falls back to owner_metadata that mentions the PR number", () => {
    const outcome = classify({
      watch: watch(),
      pr: { state: "merged", headBranch: "some-branch" },
      leases: [lease({ branch: "other-branch", taskId: "unrelated", ownerMetadata: `{"ref":"#${NUMBER}"}` })],
    });
    expect(outcome.cls).toBe("STALE_WORKTREE");
  });

  it("never matches a task_id that merely contains the digits inside a hex id", () => {
    const outcome = classify({
      watch: watch(),
      pr: { state: "merged", headBranch: "some-branch", number: 123 },
      leases: [lease({ branch: "other-branch", taskId: "a0bbaeec7ea24c71b1b374f742b9787c" })],
    });
    expect(outcome.cls).toBeNull();
  });

  it("does not fire for a closed (non-merged) PR even with a matching lease", () => {
    const outcome = classify({
      watch: watch(),
      pr: { state: "closed" },
      leases: [lease()],
    });
    expect(outcome.cls).toBeNull();
  });

  it("does not fire for an open PR with a matching lease", () => {
    const outcome = classify({ watch: watch(), leases: [lease()] });
    expect(outcome.cls).not.toBe("STALE_WORKTREE");
  });
});

describe("classifyPullRequest — drafts get no action classes", () => {
  it("never assigns NO_GO_OPEN / CI_FAILING / BASE_MOVED / READY_TO_MERGE / REVIEW_NEEDED to a draft", () => {
    const outcome = classify({
      watch: watch(),
      pr: { isDraft: true, ciState: "FAILURE", baseRefOid: OLDER_SHA },
      verdicts: [verdict("NO_GO")],
    });
    expect(outcome.cls).not.toBe("NO_GO_OPEN");
    expect(outcome.cls).not.toBe("CI_FAILING");
    expect(outcome.cls).not.toBe("BASE_MOVED");
    expect(outcome.cls).not.toBe("READY_TO_MERGE");
    expect(outcome.cls).not.toBe("REVIEW_NEEDED");
    expect(outcome.event).toBeNull();
  });

  it("classifies a draft with no actionable class and no comments as no-event", () => {
    const outcome = classify({ watch: watch(), pr: { isDraft: true } });
    expect(outcome.cls).toBeNull();
    expect(outcome.event).toBeNull();
  });
});

describe("classifyPullRequest — idempotency and fingerprints", () => {
  it("produces the identical fingerprint for identical inputs", () => {
    const inputs = { watch: watch(), verdicts: [verdict("NO_GO")] };
    const first = classify(inputs);
    const second = classify(inputs);
    expect(first.event!.fingerprint).toBe(second.event!.fingerprint);
  });

  it("a class flip changes the fingerprint", () => {
    const reviewFp = classify({ watch: watch() }).event!.fingerprint;
    const noGoFp = classify({ watch: watch(), verdicts: [verdict("NO_GO")] }).event!.fingerprint;
    expect(noGoFp).not.toBe(reviewFp);
  });

  it("emits no event when the last emitted fingerprint matches — the re-run dedupe", () => {
    const outcome = classify({
      watch: watch({
        last_emitted_fingerprint: computeEventFingerprint(PR_KEY, "REVIEW_NEEDED", HEAD, "no verdict at head"),
      }),
    });
    expect(outcome.cls).toBe("REVIEW_NEEDED");
    expect(outcome.event).toBeNull();
  });

  it("emits an event when nothing was ever emitted", () => {
    const outcome = classify({ watch: watch() });
    expect(outcome.event).not.toBeNull();
  });
});

describe("probeMergeTree — the merge-tree leg", () => {
  function makeRepo(): { dir: string; main: string; feature: string; mainAfter: string } {
    const dir = mkdtempSync(join(tmpdir(), "repos-classify-"));
    // Fleet stations carry a global core.hooksPath commit hook; fixture
    // commits must not pay for it (and must not depend on it existing), so
    // the fixture repo points its hooks at an empty directory.
    const noHooks = join(dir, ".no-hooks");
    mkdirSync(noHooks);
    const git = (args: string[], cwd = dir): void => {
      const res = spawnSync("git", args, { cwd, encoding: "utf8" });
      if (res.status !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
      }
    };
    const revParse = (cwd: string): string =>
      spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).stdout.trim();
    git(["init", "-b", "main", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "test"]);
    git(["config", "core.hooksPath", noHooks]);
    git(["commit", "--allow-empty", "-m", "base", "-q"]);
    const main = revParse(dir);
    // Feature branch: its own tree content so merge-tree comparisons are
    // meaningful (empty commits share the empty tree and cannot diverge).
    git(["checkout", "-b", "feature", "-q"]);
    writeFileSync(join(dir, "b.txt"), "b\n");
    git(["add", "."]);
    git(["commit", "-m", "feature work", "-q"]);
    const feature = revParse(dir);
    // Main moves past the feature's base with its own tree content.
    git(["checkout", "main", "-q"]);
    writeFileSync(join(dir, "c.txt"), "c\n");
    git(["add", "."]);
    git(["commit", "-m", "main moved", "-q"]);
    const mainAfter = revParse(dir);
    return { dir, main, feature, mainAfter };
  }

  it("reports fresh when the merge tree at current main equals the head tree", () => {
    const repo = makeRepo();
    try {
      const probe = probeMergeTree({ checkoutPath: repo.dir, baseSha: repo.main, headSha: repo.feature });
      expect(probe.ok).toBe(true);
      if (probe.ok) expect(probe.fresh).toBe(true);
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  it("reports diverged when main moved past the PR's base", () => {
    const repo = makeRepo();
    try {
      const probe = probeMergeTree({ checkoutPath: repo.dir, baseSha: repo.mainAfter, headSha: repo.feature });
      expect(probe.ok).toBe(true);
      if (probe.ok) expect(probe.fresh).toBe(false);
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  it("degrades with objects-absent when the head commit is not local", () => {
    const repo = makeRepo();
    try {
      const probe = probeMergeTree({
        checkoutPath: repo.dir,
        baseSha: repo.main,
        headSha: "ffffffffffffffffffffffffffffffffffffffff",
      });
      expect(probe).toEqual({ ok: false, reason: "objects-absent", stderr: null });
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  it("degrades with objects-absent when the base commit is not local", () => {
    const repo = makeRepo();
    try {
      const probe = probeMergeTree({
        checkoutPath: repo.dir,
        baseSha: "ffffffffffffffffffffffffffffffffffffffff",
        headSha: repo.feature,
      });
      expect(probe).toEqual({ ok: false, reason: "objects-absent", stderr: null });
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  it("degrades with objects-absent when the checkout is not a git repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "repos-classify-nongit-"));
    try {
      const probe = probeMergeTree({ checkoutPath: dir, baseSha: MAIN, headSha: HEAD });
      expect(probe.ok).toBe(false);
      if (!probe.ok) expect(probe.reason).toBe("objects-absent");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
