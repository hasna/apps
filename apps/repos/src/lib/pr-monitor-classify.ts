/**
 * pr-monitor classification engine.
 *
 * Implements the decision table from the pr-monitor design section 2.4: one
 * class per PR per run, most-actionable-first precedence
 * NEW > NO_GO_OPEN > CI_FAILING > BASE_MOVED > READY_TO_MERGE > REVIEW_NEEDED
 * > NEW_COMMENT. Merged PRs are judged in their own domain (STALE_WORKTREE
 * only); closed PRs with no matching worktree get no class at all; drafts get
 * NEW/NEW_COMMENT only — no action classes.
 *
 * The engine is pure over typed inputs: the de-duplicated registry view row,
 * the watch row, parsed verdicts, comment metadata, the per-repo current main
 * sha, local worktree leases and (when the caller probed it) the merge-tree
 * result. Nothing here reads the database or the network — the CLI wires the
 * real inputs; the fixture matrix in the tests wires the rest.
 *
 * Degradation contract (design section 6): the base-freshness legs never
 * guess. base_ref_oid null (never captured) or current_main_sha null (fetch
 * failed) means neither BASE_MOVED nor READY_TO_MERGE can be decided, and the
 * PR falls through to the verdict-only classes. The merge-tree leg
 * (probeMergeTree) runs only when the caller can point at a checkout holding
 * the objects; when objects are absent it degrades to
 * `base_ref_oid == current_main_sha` equality and the mandatory exact
 * merge-result check remains with the merging agent at merge time.
 *
 * Event contract (design section 2.3): an event fires only when
 * `sha256(pr_key|class|head_sha|detail)` differs from the last emitted
 * fingerprint. `NEW_COMMENT` is the tail of the chain: it fires when the
 * classification did not change (fingerprint identical) AND a comment newer
 * than the cursor exists — plain chatter never overrides an actionable class,
 * and a verdict comment that flips the class emits the class event only.
 */
import { spawnSync } from "node:child_process";
import { computeEventFingerprint, watchStateKey, type PrMonitorWatchRow } from "./pr-monitor-state.js";
import { resolveVerdictAtHead, type ParsedVerdict } from "./verdict-parser.js";
import { redactGitDiagnostics } from "./worktrees.js";

/** The eight monitor classes, per design section 2.4. */
export type PrMonitorClass =
  | "NEW"
  | "NO_GO_OPEN"
  | "CI_FAILING"
  | "BASE_MOVED"
  | "READY_TO_MERGE"
  | "REVIEW_NEEDED"
  | "STALE_WORKTREE"
  | "NEW_COMMENT";

/** The PR fields the decision table reads, from the de-duplicated registry view. */
export interface PrMonitorSubject {
  /** GitHub owner from the PR's own URL — the watch-key identity. */
  owner: string;
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  url: string | null;
  headSha: string | null;
  headBranch: string | null;
  baseBranch: string | null;
  /** `baseRefOid` at last sync — the BASE_MOVED freshness input. */
  baseRefOid: string | null;
  /** GitHub `mergeable`: MERGEABLE | CONFLICTING | UNKNOWN. */
  mergeable: string | null;
  /** Rolled-up check state at head: SUCCESS | FAILURE | PENDING | ERROR | EXPECTED. */
  ciState: string | null;
  /** Status-check contexts at head, JSON `[{name, conclusion}]` (sync-captured). */
  ciContextsJson: string | null;
  isDraft: boolean;
  /** GitHub `reviewDecision`: APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED. */
  reviewDecision: string | null;
}

/** Comment metadata the NEW_COMMENT cursor and detail need. */
export interface MonitorCommentMeta {
  id: number;
  createdAt: string | null;
  author: string | null;
}

/** One local worktree lease, reduced to the fields the STALE_WORKTREE join reads. */
export interface MonitorLeaseInput {
  branch: string | null;
  /** Lease lifecycle status; `released` leases never match. */
  status: string | null;
  taskId: string | null;
  ownerMetadata: string | null;
  worktreePath: string | null;
}

/** Outcome of the local merge-tree probe, when the caller ran one. */
export type MergeTreeProbe =
  | { ok: true; fresh: boolean; treeSha: string | null }
  | { ok: false; reason: "objects-absent" | "git-failed"; stderr: string | null };

export interface ClassifyPrInput {
  pr: PrMonitorSubject;
  /** The watch row; null means the PR was never seen — the NEW condition. */
  watch: PrMonitorWatchRow | null;
  /** All verdict lines parsed from the fetched comments. */
  verdicts: readonly ParsedVerdict[];
  /** Comment metadata (id, author) for the NEW_COMMENT cursor and detail. */
  comments: readonly MonitorCommentMeta[];
  /** Base-branch head at last check, per repo; null when the fetch failed. */
  currentMainSha: string | null;
  /** Local non-released worktree leases, for the STALE_WORKTREE join. */
  leases: readonly MonitorLeaseInput[];
  /** Merge-tree probe result; null when the caller did not (or could not) probe. */
  mergeTree: MergeTreeProbe | null;
}

/**
 * The event this run would emit for the PR; null when nothing is new — the
 * fingerprint dedupe is applied here, so the emitter never re-checks it
 * (design section 2.3: an event is emitted only when its fingerprint differs
 * from the last emitted one).
 */
export interface PrClassificationEvent {
  cls: PrMonitorClass;
  /** The detail the event carries (comment detail for NEW_COMMENT events). */
  detail: string;
  fingerprint: string;
}

export interface PrClassification {
  /**
   * The class per the decision table: the actionable class when one applies,
   * NEW_COMMENT when chatter is the only new thing, null when the PR sits in
   * the skipped domain (closed/merged with no stale worktree, GO-but-blocked
   * with no comment activity).
   */
  cls: PrMonitorClass | null;
  /** One-line detail, per design section 2.2. */
  detail: string;
  event: PrClassificationEvent | null;
  /** The effective verdict at head, when one names the head sha. */
  verdictAtHead: ParsedVerdict | null;
  /** Failing check names from the CI contexts at head (CI_FAILING detail). */
  failingChecks: string[];
  /** Newest commenter when a NEW_COMMENT candidate fired. */
  newCommenter: string | null;
}

const FAILING_CONCLUSIONS = new Set(["FAILURE", "ERROR", "CANCELLED"]);

/** Git command budget for the merge-tree probe — bounded like the gh helper. */
const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;

/** Parse the sync-captured contexts JSON; malformed payloads yield no checks. */
function parseFailingChecks(ciContextsJson: string | null): string[] {
  if (!ciContextsJson) return [];
  try {
    const parsed = JSON.parse(ciContextsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    const names: string[] = [];
    for (const entry of parsed) {
      if (entry && typeof entry === "object" && "name" in entry && "conclusion" in entry) {
        const { name, conclusion } = entry as { name: unknown; conclusion: unknown };
        if (typeof name === "string" && name.length > 0 && typeof conclusion === "string") {
          if (FAILING_CONCLUSIONS.has(conclusion)) names.push(name);
        }
      }
    }
    return names;
  } catch {
    return [];
  }
}

/**
 * The STALE_WORKTREE join: a non-released lease whose branch equals the PR's
 * head branch, with a fallback to task_id / owner_metadata mentioning the PR
 * number (design section 2.4). The number mention is boundary-safe — the
 * digits inside a longer hex id never match.
 */
export function leaseMatchesPr(lease: MonitorLeaseInput, pr: PrMonitorSubject): boolean {
  if (!lease.status || lease.status === "released") return false;
  if (lease.branch && pr.headBranch && lease.branch === pr.headBranch) return true;
  const mention = new RegExp(`(^|[^0-9])${pr.number}([^0-9]|$)`);
  if (lease.taskId && mention.test(lease.taskId)) return true;
  if (lease.ownerMetadata && lease.ownerMetadata.includes(`#${pr.number}`)) return true;
  if (lease.ownerMetadata) {
    try {
      const meta = JSON.parse(lease.ownerMetadata) as unknown;
      if (meta && typeof meta === "object") {
        for (const value of Object.values(meta as Record<string, unknown>)) {
          if (value === pr.number || value === `#${pr.number}` || value === `pr-${pr.number}`) {
            return true;
          }
        }
      }
    } catch {
      // Not JSON; the raw `#<number>` scan above already ran.
    }
  }
  return false;
}

function newestComment(comments: readonly MonitorCommentMeta[]): MonitorCommentMeta | null {
  let best: MonitorCommentMeta | null = null;
  for (const comment of comments) {
    if (!best) {
      best = comment;
      continue;
    }
    const bestAt = best.createdAt ?? "";
    const at = comment.createdAt ?? "";
    if (at !== bestAt) {
      if (at > bestAt) best = comment;
    } else if (comment.id > best.id) {
      best = comment;
    }
  }
  return best;
}

function maxCommentId(comments: readonly MonitorCommentMeta[]): number {
  let max = 0;
  for (const comment of comments) {
    if (comment.id > max) max = comment.id;
  }
  return max;
}

/**
 * Classify one PR for one run. Pure: same inputs, same outcome, same
 * fingerprint — the idempotency property the design's re-run contract rests
 * on. Returns the class, a one-line detail, and the event this run would
 * emit (null when nothing is new).
 */
export function classifyPullRequest(input: ClassifyPrInput): PrClassification {
  const { pr, watch } = input;
  const prKey = watchStateKey(pr.owner, pr.repo, pr.number);

  // ── Terminal domain: merged PRs only get STALE_WORKTREE; closed PRs get
  // nothing (design section 2.4 / 3.4). ───────────────────────────────────
  if (pr.state !== "open") {
    if (pr.state === "merged") {
      const match = input.leases.find((lease) => leaseMatchesPr(lease, pr));
      if (match) {
        const where = match.worktreePath ?? match.branch ?? "a matching worktree";
        const detail = `merged, worktree ${where} present — remove via repos worktree`;
        const fingerprint = computeEventFingerprint(prKey, "STALE_WORKTREE", pr.headSha, detail);
        return {
          cls: "STALE_WORKTREE",
          detail,
          event: fingerprint !== (watch?.last_emitted_fingerprint ?? null)
            ? { cls: "STALE_WORKTREE", detail, fingerprint }
            : null,
          verdictAtHead: null,
          failingChecks: [],
          newCommenter: null,
        };
      }
    }
    return { cls: null, detail: "", event: null, verdictAtHead: null, failingChecks: [], newCommenter: null };
  }

  // ── First sighting: NEW outranks everything (design: "NEW first so first
  // sighting is never masked by a class"). ─────────────────────────────────
  if (!watch) {
    const detail = "new PR (first sighting)";
    const fingerprint = computeEventFingerprint(prKey, "NEW", pr.headSha, detail);
    return {
      cls: "NEW",
      detail,
      event: { cls: "NEW", detail, fingerprint },
      verdictAtHead: null,
      failingChecks: [],
      newCommenter: null,
    };
  }

  const verdictAtHead = resolveVerdictAtHead(input.verdicts, pr.headSha);
  const failingChecks = parseFailingChecks(pr.ciContextsJson);
  const ciFailing = pr.ciState === "FAILURE" || pr.ciState === "ERROR";
  const baseKnown = pr.baseRefOid !== null && input.currentMainSha !== null;
  const baseFresh = baseKnown && pr.baseRefOid === input.currentMainSha;
  const treeDiverged = input.mergeTree?.ok === true && input.mergeTree.fresh === false;
  const baseMoved = (baseKnown && pr.baseRefOid !== input.currentMainSha) || treeDiverged;

  // ── Actionable classes; drafts get none of these (design section 2.4). ──
  let cls: PrMonitorClass | null = null;
  let detail = "";
  if (!pr.isDraft) {
    if (verdictAtHead?.verdict === "NO_GO") {
      cls = "NO_GO_OPEN";
      detail = `NO_GO at head by ${verdictAtHead.reviewer ?? "reviewer"}`;
      if (failingChecks.length > 0) detail += `; failing: ${failingChecks.join(", ")}`;
    } else if (ciFailing) {
      cls = "CI_FAILING";
      detail = failingChecks.length > 0
        ? `failing: ${failingChecks.join(", ")}`
        : `rollup ${pr.ciState}`;
    } else if (baseMoved) {
      cls = "BASE_MOVED";
      detail = treeDiverged
        ? "main moved past last sync; merge-tree diverged"
        : "main moved past last sync";
    } else if (
      verdictAtHead?.verdict === "GO"
      && pr.mergeable === "MERGEABLE"
      && baseFresh
      && !ciFailing
      && (input.mergeTree === null || input.mergeTree.ok)
    ) {
      cls = "READY_TO_MERGE";
      detail = `GO by ${verdictAtHead.reviewer ?? "reviewer"}`;
    } else if (!verdictAtHead) {
      cls = "REVIEW_NEEDED";
      detail = "no verdict at head";
      // Fallback signal (design section 2.4): when the PR has no [REVIEW]
      // comments at all, GitHub's own review_decision corroborates.
      if (input.verdicts.length === 0 && pr.reviewDecision === "REVIEW_REQUIRED") {
        detail += "; GitHub review required";
      }
    }
  }

  // ── Event decision, with NEW_COMMENT as the tail of the chain. ──────────
  // The event detail is what the fingerprint is computed over, so a
  // NEW_COMMENT event carries the comment detail while the PR's class detail
  // stays in `detail` (the state envelope reads the class; the event line
  // reads the event).
  let event: PrClassificationEvent | null = null;
  let newCommenter: string | null = null;
  const lastEmitted = watch.last_emitted_fingerprint ?? null;
  const newComment = maxCommentId(input.comments) > (watch.last_seen_comment_id ?? 0);
  const newest = newestComment(input.comments);
  if (newest) newCommenter = newest.author ?? null;
  const commentDetail = newest
    ? `comment by ${newest.author ?? "unknown"} (#${newest.id})`
    : "new comment";

  if (cls !== null) {
    const fingerprint = computeEventFingerprint(prKey, cls, pr.headSha, detail);
    if (fingerprint !== lastEmitted) {
      event = { cls, detail, fingerprint };
    } else if (newComment) {
      const commentFingerprint = computeEventFingerprint(prKey, "NEW_COMMENT", pr.headSha, commentDetail);
      if (commentFingerprint !== lastEmitted) {
        event = { cls: "NEW_COMMENT", detail: commentDetail, fingerprint: commentFingerprint };
      }
    }
  } else if (newComment) {
    const commentFingerprint = computeEventFingerprint(prKey, "NEW_COMMENT", pr.headSha, commentDetail);
    if (commentFingerprint !== lastEmitted) {
      event = { cls: "NEW_COMMENT", detail: commentDetail, fingerprint: commentFingerprint };
    }
    cls = "NEW_COMMENT";
    detail = commentDetail;
  }

  return { cls, detail, event, verdictAtHead, failingChecks, newCommenter };
}

/**
 * The merge-tree leg (design section 2.4/6): when the head and base objects
 * exist in the checkout, run `git merge-tree --write-tree <base> <head>` and
 * compare the merged tree to the head tree with `git diff --quiet <head>
 * <tree>`. A tree that equals the head means current main changes nothing in
 * the PR's tree; a divergent tree is the base-moved hazard the fleet rule
 * guards, and the merge result no longer matches what a reviewer read.
 *
 * Degrades with `objects-absent` when either commit is not local (partial
 * clones, pruned packs, unknown shas) — the caller then falls back to
 * `base_ref_oid == current_main_sha` equality and the exact merge-result
 * check stays with the merging agent at merge time. Git diagnostics are
 * redacted and truncated so no credential-shaped text reaches the envelope.
 */
export function probeMergeTree(opts: { checkoutPath: string; baseSha: string; headSha: string }): MergeTreeProbe {
  const { checkoutPath, baseSha, headSha } = opts;

  for (const oid of [headSha, baseSha]) {
    const probe = spawnSync("git", ["cat-file", "-e", `${oid}^{commit}`], {
      cwd: checkoutPath,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ["ignore", "ignore", "pipe"],
    });
    if (probe.status !== 0) {
      return { ok: false, reason: "objects-absent", stderr: null };
    }
  }

  const merged = spawnSync("git", ["merge-tree", "--write-tree", baseSha, headSha], {
    cwd: checkoutPath,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (merged.error || merged.status === null || merged.status > 1) {
    return {
      ok: false,
      reason: "git-failed",
      stderr: redactGitDiagnostics((merged.stderr ?? merged.error?.message ?? "").slice(0, 300)),
    };
  }
  const treeSha = (merged.stdout ?? "").trim().split("\n")[0] ?? "";
  if (!/^[0-9a-f]{40}$/i.test(treeSha)) {
    return { ok: false, reason: "git-failed", stderr: "merge-tree wrote no tree oid" };
  }

  const diff = spawnSync("git", ["diff", "--quiet", headSha, treeSha], {
    cwd: checkoutPath,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (diff.error || diff.status === null || diff.status > 1) {
    return {
      ok: false,
      reason: "git-failed",
      stderr: redactGitDiagnostics((diff.stderr ?? diff.error?.message ?? "").slice(0, 300)),
    };
  }
  return { ok: true, fresh: diff.status === 0, treeSha };
}
