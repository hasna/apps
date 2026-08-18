/**
 * pr-monitor run orchestration — the `repos pr-monitor` verb's build half
 * (pr-monitor design sections 2.1-2.2, 2.5, 3.4).
 *
 * The CLI parses flags and calls `runPrMonitor`; this module owns the run:
 *
 * - sync (on by default, design 2.1: "a monitor classifying from a stale
 *   registry is a vacuous instrument") through the existing sync path, with
 *   the open set always fetched and reconciliation against it;
 * - read the de-duplicated registry view (`listPullRequestsWithRepo`, the
 *   same surface `prs` and `ops pr-queue` consume — never raw rows);
 * - fetch comments and the current-main sha through the injectable
 *   `MonitorClient` seam, batched like `fetchPullRequestStates`;
 * - report failures in `errors` and never guess: a PR whose comment fetch
 *   failed outright is excluded from classification; a failed current-main
 *   fetch degrades the freshness signal and is reported;
 * - run the delta emitter and assemble the `open-repos.pr-monitor.v1`
 *   envelope the loop consumes.
 *
 * The verb does not post and does not create tasks (design 3.4): transport
 * to `git-prs` lives in the loop.
 */
import { existsSync } from "node:fs";
import { getDb } from "../db/database.js";
import { listPullRequestsWithRepo } from "../db/repos.js";
import type { PullRequestRecord } from "../types/index.js";
import {
  liveMonitorClient,
  syncAllGithubPRs,
  syncGithubPRs,
  type GithubPullRequestClient,
  type MonitorClient,
  type MonitorComment,
} from "./github.js";
import { emitMonitorDelta, type EmitPrInput, type EmittedEvent, type MonitorStateEntry } from "./pr-monitor-emit.js";
import {
  probeMergeTree,
  type MergeTreeProbe,
  type MonitorLeaseInput,
  type PrMonitorClass,
  type PrMonitorSubject,
} from "./pr-monitor-classify.js";
import { parseVerdictsFromBody, type ParsedVerdict } from "./verdict-parser.js";

/** Envelope schema, per design section 2.2. */
export const PR_MONITOR_SCHEMA = "open-repos.pr-monitor.v1" as const;

/** Default cap on PRs classified per run (design section 2.1). */
export const DEFAULT_MONITOR_LIMIT = 500;

/** Sync scope: the open set only — reconciliation drives terminal states. */
const MONITOR_SYNC_STATE = "open";
const MONITOR_SYNC_LIMIT = 1000;

export interface PrMonitorFilters {
  org: string | null;
  repo: string | null;
  limit: number;
}

/** The `synced` envelope section; present when the run synced (design 2.2). */
export interface PrMonitorSyncedSection {
  repos_seen: number;
  repos_checked: number;
  repos_synced: number;
  total_synced: number;
  truncated: boolean;
  errors: string[];
  skipped: string[];
}

export interface PrMonitorEnvelope {
  schema: typeof PR_MONITOR_SCHEMA;
  generated_at: string;
  filters: PrMonitorFilters;
  synced: PrMonitorSyncedSection | null;
  baseline: boolean;
  summary: {
    open: number;
    events: number;
    by_class: Record<PrMonitorClass, number>;
  };
  events: EmittedEvent[];
  state: MonitorStateEntry[];
  errors: string[];
}

export interface RunPrMonitorOptions {
  /** Sync GitHub PR metadata first (default true; `--no-sync` reads only). */
  sync?: boolean;
  /** Scope to one GitHub owner. */
  org?: string;
  /** Scope to one local repo record. */
  repo?: string;
  /** Max PRs to classify (default 500). */
  limit?: number;
  /** First-run mode: record watch state, emit no per-PR NEW events. */
  baseline?: boolean;
  /** Injectable GitHub reads for the monitor fetches (tests use fixtures). */
  client?: MonitorClient;
  /** Injectable sync reads (tests use fixtures). */
  githubClient?: GithubPullRequestClient;
  /** Observation clock in SQLite `datetime('now')` shape (tests pin it). */
  now?: string;
}

interface WatchRecord extends PullRequestRecord {
  repo_name: string;
  repo_org: string | null;
  repo_path: string;
  repo_remote_url: string | null;
}

/** Read the registry clock once so the envelope and the watch rows agree. */
function registryNow(): string {
  const row = getDb().query("SELECT datetime('now') AS now").get() as { now: string };
  return row.now;
}

/** SQLite `YYYY-MM-DD HH:MM:SS` (UTC) -> ISO-8601 with milliseconds. */
function toIso(sqliteNow: string): string {
  const normalized = sqliteNow.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function runSyncSection(opts: {
  org?: string;
  repo?: string;
  githubClient?: GithubPullRequestClient;
}): PrMonitorSyncedSection {
  const { org, repo, githubClient } = opts;
  if (repo) {
    // Single-repo sync: `syncGithubPRs` resolves the record by name and throws
    // on an unknown repo — an explicit error, never a silent zero.
    try {
      const result = syncGithubPRs(repo, {
        limit: MONITOR_SYNC_LIMIT,
        state: MONITOR_SYNC_STATE,
        reconcile: true,
        client: githubClient,
      });
      return {
        repos_seen: 1,
        repos_checked: 1,
        repos_synced: 1,
        total_synced: result.synced,
        truncated: false,
        errors: [],
        skipped: [],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        repos_seen: 1,
        repos_checked: 1,
        repos_synced: 0,
        total_synced: 0,
        truncated: false,
        errors: [`${repo}: ${message}`],
        skipped: [],
      };
    }
  }
  const result = syncAllGithubPRs({
    org,
    limit: MONITOR_SYNC_LIMIT,
    state: MONITOR_SYNC_STATE,
    client: githubClient,
  });
  return {
    repos_seen: result.repos_seen,
    repos_checked: result.repos_checked,
    repos_synced: result.repos_synced,
    total_synced: result.total_synced,
    truncated: result.truncated,
    errors: result.errors,
    skipped: result.skipped,
  };
}

/** All non-released local worktree leases, reduced to the STALE_WORKTREE join. */
function listMonitorLeases(): MonitorLeaseInput[] {
  const rows = getDb()
    .query(
      `SELECT branch, status, task_id, owner_metadata, worktree_path
       FROM worktree_leases WHERE status != 'released'`,
    )
    .all() as Array<{
      branch: string | null;
      status: string | null;
      task_id: string | null;
      owner_metadata: string | null;
      worktree_path: string | null;
    }>;
  return rows.map((row) => ({
    branch: row.branch ?? null,
    status: row.status ?? null,
    taskId: row.task_id ?? null,
    ownerMetadata: row.owner_metadata ?? null,
    worktreePath: row.worktree_path ?? null,
  }));
}

/**
 * The merge-tree leg (design section 2.4/6): run only when the current-main
 * fetch succeeded and the checkout path exists; `probeMergeTree` itself
 * degrades to `objects-absent` when the objects are not local.
 */
function probeFor(record: WatchRecord, subject: PrMonitorSubject, currentMainSha: string | null): MergeTreeProbe | null {
  if (!currentMainSha || !subject.headSha || !record.repo_path) return null;
  if (!existsSync(record.repo_path)) return null;
  try {
    return probeMergeTree({ checkoutPath: record.repo_path, baseSha: currentMainSha, headSha: subject.headSha });
  } catch {
    return { ok: false, reason: "git-failed", stderr: null };
  }
}

/** One PR from the de-duplicated registry view onto the classification subject. */
function toSubject(record: WatchRecord): PrMonitorSubject | null {
  // PRs without a github.com identity (unparsed URLs, pre-v12 rows) are
  // outside the monitor scope — the same exclusion parseGithubRemote applies.
  if (!record.org || !record.repo) return null;
  return {
    owner: record.org,
    repo: record.repo,
    number: record.number,
    title: record.title,
    state: record.state,
    url: record.url,
    headSha: record.head_sha,
    headBranch: record.head_branch,
    baseBranch: record.base_branch,
    baseRefOid: record.base_ref_oid,
    mergeable: record.mergeable,
    ciState: record.ci_state,
    ciContextsJson: record.ci_contexts_json,
    isDraft: record.is_draft,
    reviewDecision: record.review_decision,
  };
}

/**
 * Run one monitor pass and assemble the envelope the CLI serializes.
 * Pure over the registry clock and the injected clients: identical inputs
 * against identical state produce identical output.
 */
export function runPrMonitor(options: RunPrMonitorOptions = {}): PrMonitorEnvelope {
  const { org, repo, baseline = false } = options;
  // Sync is ON by default (design 2.1): a monitor classifying from a stale
  // registry is a vacuous instrument.
  const sync = options.sync ?? true;
  const limit = options.limit ?? DEFAULT_MONITOR_LIMIT;
  const client = options.client ?? liveMonitorClient;
  const githubClient = options.githubClient;
  const now = options.now ?? registryNow();
  const errors: string[] = [];

  const synced = sync ? runSyncSection({ org, repo, githubClient }) : null;

  const records = listPullRequestsWithRepo({ org, repo_name: repo, limit }) as WatchRecord[];

  const numbersByGhRepo = new Map<string, number[]>();
  const baseBranchesByGhRepo = new Map<string, Set<string>>();

  for (const record of records) {
    const subject = toSubject(record);
    if (!subject) continue; // non-github.com scope — silent skip (design 3.4)
    const ghRepo = `${subject.owner}/${subject.repo}`;
    let numbers = numbersByGhRepo.get(ghRepo);
    if (!numbers) {
      numbers = [];
      numbersByGhRepo.set(ghRepo, numbers);
    }
    numbers.push(subject.number);
    let bases = baseBranchesByGhRepo.get(ghRepo);
    if (!bases) {
      bases = new Set();
      baseBranchesByGhRepo.set(ghRepo, bases);
    }
    if (subject.baseBranch) bases.add(subject.baseBranch);
  }

  // ── Fetch layer: comments (batched per repo) and current-main (per repo +
  // base branch). Failures land in `errors`, never in guessed classes. ──
  const commentsByKey = new Map<string, MonitorComment[]>();
  for (const [ghRepo, numbers] of numbersByGhRepo) {
    let fetched: Map<number, MonitorComment[]>;
    try {
      fetched = client.fetchComments(ghRepo, numbers);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${ghRepo}: comments could not be fetched: ${message}`);
      continue;
    }
    for (const number of numbers) {
      const entry = fetched.get(number);
      if (entry === undefined) {
        errors.push(`${ghRepo}#${number}: comments could not be fetched`);
        continue;
      }
      commentsByKey.set(`${ghRepo}#${number}`, entry);
    }
  }

  const mainShaByKey = new Map<string, string | null>();
  for (const [ghRepo, bases] of baseBranchesByGhRepo) {
    for (const baseBranch of bases) {
      const key = `${ghRepo}|${baseBranch}`;
      const mainSha = client.fetchCurrentMainSha(ghRepo, baseBranch);
      mainShaByKey.set(key, mainSha);
      if (mainSha === null) {
        errors.push(`${ghRepo}: current-main fetch failed for branch ${baseBranch}`);
      }
    }
  }

  const leases = listMonitorLeases();

  // ── Assemble the emitter inputs in registry display order. ──
  const inputs: EmitPrInput[] = [];
  for (const record of records) {
    const subject = toSubject(record);
    if (!subject) continue;
    const key = `${subject.owner}/${subject.repo}#${subject.number}`;
    const comments = commentsByKey.get(key);
    if (comments === undefined) continue; // comment fetch failed — already reported

    const ghRepo = `${subject.owner}/${subject.repo}`;
    const mainKey = subject.baseBranch ? `${ghRepo}|${subject.baseBranch}` : null;
    const currentMainSha = mainKey ? (mainShaByKey.get(mainKey) ?? null) : null;
    const mergeTree = probeFor(record, subject, currentMainSha);

    const verdicts: ParsedVerdict[] = [];
    for (const comment of comments) {
      verdicts.push(...parseVerdictsFromBody(comment.body, { id: comment.id, createdAt: comment.createdAt }));
    }

    inputs.push({
      pr: subject,
      verdicts,
      comments: comments.map((c) => ({ id: c.id, createdAt: c.createdAt, author: c.author })),
      currentMainSha,
      mergeTree,
    });
  }

  const result = emitMonitorDelta({ baseline, inputs, leases, now });

  return {
    schema: PR_MONITOR_SCHEMA,
    generated_at: toIso(now),
    filters: { org: org ?? null, repo: repo ?? null, limit },
    synced,
    baseline: result.baseline,
    summary: result.summary,
    events: result.events,
    state: result.state,
    errors,
  };
}
