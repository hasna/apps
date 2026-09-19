/**
 * Issue detection: the read-only GraphQL reader, its page guards, and the
 * per-remote ingest.
 *
 * SCOPE — this module is the track-A slice of the issue visibility work
 * (todos 861b964b): storage + sync ingest + `repos issues`. It is additive and
 * read-only with respect to GitHub. It does NOT reconcile deletions, does NOT
 * emit monitor events, and is NOT wired into the audit->fix-PR->close
 * pipeline or pr-monitor.
 *
 * WHY THE GUARDS DIVERGE FROM THE PR PATH (normative, brief §3.1.1)
 *
 * `fetchPullRequests` deliberately accepts partial responses: a page may
 * arrive with null holes alongside an `errors` entry, the holes are dropped
 * (`collectPullRequestNodes`), and the traversal advances its cursor anyway.
 * That is survivable because every PR run re-enumerates the complete open set
 * and individually re-queries anything missing (the reconciliation net).
 *
 * Issue detection has no such net. It stores an `updated_at` high-water mark
 * and asks GitHub only for issues updated since then. An issue whose node was
 * nulled or whose page admitted an error would be silently absent; the
 * watermark would advance past it; and no later run could ever see it again.
 * A run that reads a "complete" page would then report `0 new` in a healthy
 * tone while content was lost. The rules below exist to make that impossible:
 *
 *   E — any non-empty `errors[]` fails the page, even when every node is
 *       present (`graphqlStrict` is used because `graphql()` erases errors).
 *   N — a null hole / unusable node marks the page incomplete and is counted
 *       (`nodes_dropped`), never silently filtered.
 *   C — the run-local cursor advances only from a sealed page; a traversal
 *       truncated by a local limit seals nothing.
 *   W — the durable watermark advances only after a traversal complete by
 *       exhaustion, with an inclusive 1-hour overlap, and never backwards.
 *   R — "0 new" is only reportable on a sealed, untruncated run.
 *
 * Do not "harmonise" these with the PR path. The divergence is the feature.
 */
import { graphqlStrict, isMissingRepoError, parseGithubRemote } from "./github.js";
import { getIssueSyncState, recordIssueSyncRun } from "./issue-sync-state.js";
import {
  bulkInsertIssues,
  getRepo,
  listAllRepos,
  listIssueNumbers,
  listReposByRemote,
  type IssueInput,
} from "../db/repos.js";

/** One issue node as the `repository.issues` connection returns it. */
export interface GraphqlIssue {
  number: number;
  title: string;
  state: string;
  stateReason?: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  url: string;
  author: { login: string } | null;
}

/** Why a page could not be sealed. */
export type IssuePageFailureReason =
  | "missing_repo"
  | "rate_limited"
  | "page_transient"
  | "page_info_missing"
  | "page_info_invalid"
  | "end_cursor_missing"
  | "nodes_not_array"
  | "nodes_dropped";

/** One raw response page, before any guard has been applied. */
export interface RawIssuePage {
  data: unknown;
  /** Every GraphQL error message, already whitespace-collapsed. */
  errors: string[];
  /** Set when the request itself did not come back cleanly. */
  transport_failure: string | null;
  /**
   * The `after` cursor this page was requested with. Kept on the raw page so a
   * test can assert that a failed page never became the next page's cursor.
   */
  requested_after: string | null;
}

export interface IssuePageRequest {
  state: "open" | "closed" | "all";
  since: string | null;
  after: string | null;
  first: number;
}

/** The GitHub reads the issue traversal performs. Injectable for tests. */
export interface GithubIssueClient {
  fetchIssuePage(ghRepo: string, request: IssuePageRequest): RawIssuePage;
}

export interface IssuePageVerdict {
  sealed: boolean;
  /** Usable nodes, present ONLY on a sealed page; empty on any failure. */
  nodes: GraphqlIssue[];
  /** Raw node-array length observed on this page, even when it failed. */
  nodes_seen: number;
  /** Entries that were null holes or not issue-shaped (rule N1/N3). */
  nodes_dropped: number;
  total_count: number | null;
  has_next_page: boolean;
  end_cursor: string | null;
  failure: IssuePageFailureReason | null;
  detail: string | null;
  errors: string[];
}

/** Longest GraphQL error message detail carried into a run envelope. */
const MAX_ERROR_DETAIL = 200;

/** Rate-limit / abuse responses: stop the run, never retry in a tight loop. */
const RATE_LIMIT_PATTERNS: RegExp[] = [
  /rate limit/i,
  /RATE_LIMITED/,
  /secondary rate/i,
  /\babuse\b/i,
  /http 403/i,
  /http 429/i,
  /exit=403/,
  /exit=429/,
];

/** See rule E3: rate-limit/abuse stops the run; everything else is retryable. */
export function isRateLimitedError(message: string): boolean {
  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message));
}

function collapse(message: unknown): string {
  return String(message ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_DETAIL);
}

/**
 * Rule N3: the fields an issue node must carry to be storable and to
 * participate in watermark arithmetic. `author` is deliberately absent — a
 * deleted account leaves it null and the writer stores "unknown".
 */
export function isUsableIssueNode(node: unknown): node is GraphqlIssue {
  if (!node || typeof node !== "object") return false;
  const issue = node as Partial<GraphqlIssue>;
  return typeof issue.number === "number" && Number.isSafeInteger(issue.number) && issue.number > 0
    && typeof issue.title === "string"
    && typeof issue.createdAt === "string" && issue.createdAt !== ""
    && typeof issue.state === "string" && (issue.state === "OPEN" || issue.state === "CLOSED")
    && typeof issue.updatedAt === "string" && issue.updatedAt !== "";
}

function repositoryOf(data: unknown): unknown {
  if (!data || typeof data !== "object") return undefined;
  return (data as { repository?: unknown }).repository;
}

/**
 * Apply rules E/N/C to one raw page. Never throws for a page-level fault — the
 * caller decides retry/skip/incomplete from the verdict.
 *
 * A failed page contributes NO nodes to the write batch. The brief permits
 * partial processing ("dropping the bad node from the batch of rows written
 * this pass is acceptable only as partial processing", rule N2), and this
 * slice deliberately takes the stricter branch: the local issue index has no
 * per-run completeness marker, so a reader of `repos issues` could not tell
 * rows written from a failed page apart from verified ones. Only a page whose
 * every guard passed may write rows; `nodes_seen`/`nodes_dropped` still report
 * what the page contained, so nothing is silently filtered.
 */
export function adjudicateIssuePage(page: RawIssuePage): IssuePageVerdict {
  const errors = page.errors.map(collapse).filter((message) => message.length > 0);
  const verdict: IssuePageVerdict = {
    sealed: false,
    nodes: [],
    nodes_seen: 0,
    nodes_dropped: 0,
    total_count: null,
    has_next_page: false,
    end_cursor: null,
    failure: null,
    detail: null,
    errors,
  };

  // Observational counts first: the shape of `nodes` is readable even on a
  // page that fails, and R1's envelope must not under-report what arrived.
  const repository = repositoryOf(page.data);
  const connection = repository && typeof repository === "object"
    ? (repository as { issues?: unknown }).issues
    : undefined;
  const connectionRecord = connection && typeof connection === "object"
    ? connection as Record<string, unknown>
    : null;
  const rawNodes = connectionRecord?.nodes;
  if (Array.isArray(rawNodes)) {
    verdict.nodes_seen = rawNodes.length;
    verdict.nodes_dropped = rawNodes.reduce((count, node) => count + (isUsableIssueNode(node) ? 0 : 1), 0);
  }

  // Rule E1 — any non-empty errors[] fails the page, even with every node
  // present. Classify first: repository-gone must be skippable, rate limiting
  // must stop the run, anything else is retryable.
  const failureMessages = [...errors, ...(page.transport_failure ? [page.transport_failure] : [])];
  if (failureMessages.some((message) => isMissingRepoError(message))) {
    verdict.failure = "missing_repo";
    return verdict;
  }
  if (failureMessages.some((message) => isRateLimitedError(message))) {
    verdict.failure = "rate_limited";
    verdict.detail = failureMessages.find((message) => isRateLimitedError(message)) ?? null;
    return verdict;
  }
  if (errors.length > 0 || page.transport_failure) {
    verdict.failure = "page_transient";
    verdict.detail = errors[0] ?? page.transport_failure;
    return verdict;
  }

  if (repository == null) {
    // `repository: null` with a clean body means the repository is not
    // resolvable (deleted/renamed), matching the PR path's classification.
    verdict.failure = "missing_repo";
    return verdict;
  }
  if (!connectionRecord) {
    // The PR precedent treats a missing connection as a hard error, not a
    // skip; here it is retryable-then-incomplete rather than silently empty.
    verdict.failure = "page_transient";
    verdict.detail = "GitHub GraphQL returned no issue connection";
    return verdict;
  }

  // Rules C1/N1/N3 — node array shape and per-node usability.
  if (!Array.isArray(rawNodes)) {
    verdict.failure = "nodes_not_array";
    return verdict;
  }

  const totalCount = connectionRecord.totalCount;
  verdict.total_count = typeof totalCount === "number" ? totalCount : null;

  const pageInfo = connectionRecord.pageInfo;
  if (!pageInfo || typeof pageInfo !== "object") {
    verdict.failure = "page_info_missing";
    return verdict;
  }
  const hasNextPage = (pageInfo as { hasNextPage?: unknown }).hasNextPage;
  if (typeof hasNextPage !== "boolean") {
    verdict.failure = "page_info_invalid";
    return verdict;
  }
  verdict.has_next_page = hasNextPage;

  // Rule C1 — a page that promises more must name where "more" starts.
  const endCursor = (pageInfo as { endCursor?: unknown }).endCursor;
  if (hasNextPage && (typeof endCursor !== "string" || endCursor === "")) {
    verdict.failure = "end_cursor_missing";
    return verdict;
  }
  verdict.end_cursor = typeof endCursor === "string" && endCursor !== "" ? endCursor : null;

  if (verdict.nodes_dropped > 0) {
    verdict.failure = "nodes_dropped";
    verdict.detail = `${verdict.nodes_dropped} node(s) dropped`;
    return verdict;
  }

  verdict.sealed = true;
  verdict.nodes = (rawNodes as unknown[]).filter(isUsableIssueNode);
  return verdict;
}

/** Default per-page attempt count (rule E3: bounded retry, then incomplete). */
export const DEFAULT_PAGE_ATTEMPTS = 3;
/** Base backoff between page attempts; doubles per attempt. */
export const DEFAULT_PAGE_BACKOFF_MS = 250;
/** Hard cap on error messages carried by one traversal envelope. */
const MAX_RUN_ERRORS = 20;

export interface IssueTraversalOptions {
  state?: "open" | "closed" | "all";
  /** Pinned ONCE per run and never slid mid-traversal (brief §3.2). */
  since?: string | null;
  /** Local cap; 0/undefined means the traversal is not locally capped. */
  limit?: number;
  pageSize?: number;
  retryAttempts?: number;
  retryBackoffMs?: number;
  /** Injected by tests so retry backoff never sleeps for real. */
  sleep?: (ms: number) => void;
  client?: GithubIssueClient;
}

export interface IssueTraversalResult {
  nodes: GraphqlIssue[];
  /** Request attempts made, including retries. */
  pages_fetched: number;
  nodes_seen: number;
  nodes_dropped: number;
  /** A local `limit` stopped the traversal before exhaustion (rule C3). */
  truncated: boolean;
  /** Every page sealed and the last page reported `hasNextPage: false`. */
  sealed: boolean;
  failure: IssuePageFailureReason | null;
  detail: string | null;
  errors: string[];
  /** Max `updatedAt` over usable nodes; watermark-eligible only when sealed. */
  max_updated_at: string | null;
  /** Every `after` requested, in order — the cursor-advance audit trail. */
  requested_cursors: Array<string | null>;
  rate_limited: boolean;
}

function sleepSync(ms: number): void {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function maxUpdatedAt(nodes: GraphqlIssue[]): string | null {
  let max: string | null = null;
  for (const node of nodes) {
    if (max === null || node.updatedAt > max) max = node.updatedAt;
  }
  return max;
}

/**
 * Traverse `repository.issues` from an optional `since` boundary.
 *
 * The `since` value is passed verbatim to every page of the run and is never
 * recomputed mid-traversal, so a slow page cannot slide the boundary past
 * content. On any unsealed page the traversal stops for that repository and
 * the run-local cursor is left where it was: no page is ever skipped past.
 */
export function fetchIssues(ghRepo: string, opts: IssueTraversalOptions = {}): IssueTraversalResult {
  const client = opts.client ?? liveIssueClient;
  const state = opts.state ?? "all";
  const since = opts.since ?? null;
  const pageSize = Math.max(1, Math.min(100, Math.floor(opts.pageSize ?? 100)));
  const limit = opts.limit && opts.limit > 0 ? Math.floor(opts.limit) : Number.POSITIVE_INFINITY;
  const attempts = Math.max(1, Math.floor(opts.retryAttempts ?? DEFAULT_PAGE_ATTEMPTS));
  const backoff = Math.max(0, Math.floor(opts.retryBackoffMs ?? DEFAULT_PAGE_BACKOFF_MS));
  const sleep = opts.sleep ?? sleepSync;

  const nodes: GraphqlIssue[] = [];
  const errors: string[] = [];
  const requested_cursors: Array<string | null> = [];
  let after: string | null = null;
  let pages_fetched = 0;
  let nodes_seen = 0;
  let nodes_dropped = 0;
  let sealed = false;
  let truncated = false;
  let failure: IssuePageFailureReason | null = null;
  let detail: string | null = null;
  let rate_limited = false;

  for (;;) {
    const remaining = limit === Number.POSITIVE_INFINITY ? pageSize : Math.min(pageSize, limit - nodes.length);
    if (remaining <= 0) {
      // Rule C3 — the local limit stopped this traversal. It is truncated, so
      // nothing is sealed and the watermark must not move.
      truncated = true;
      break;
    }

    let verdict: IssuePageVerdict;
    let attemptsUsed = 0;
    for (;;) {
      attemptsUsed++;
      const page = client.fetchIssuePage(ghRepo, { state, since, after, first: remaining });
      requested_cursors.push(after);
      pages_fetched++;
      verdict = adjudicateIssuePage(page);
      if (verdict.sealed) break;
      // Repository-gone is not a page fault: the fan-out classifies it as
      // skipped-and-continued exactly like the PR sync does.
      if (verdict.failure === "missing_repo") throw new Error("GitHub repository is unavailable");
      // Rule E3 — rate limiting stops the run; retrying inside a rate limit
      // only burns the budget the backoff exists to protect.
      if (verdict.failure === "rate_limited") {
        rate_limited = true;
        break;
      }
      if (attemptsUsed >= attempts) break;
      sleep(backoff * 2 ** (attemptsUsed - 1));
    }

    nodes_seen += verdict.nodes_seen;
    nodes_dropped += verdict.nodes_dropped;
    // Only a sealed page may contribute rows. Nothing is lost by refusing a
    // failed page's nodes: the watermark has not moved, so the next run
    // re-reads from the same boundary.
    nodes.push(...verdict.nodes);
    for (const message of verdict.errors) {
      if (errors.length < MAX_RUN_ERRORS) errors.push(message);
    }

    if (!verdict.sealed) {
      failure = verdict.failure;
      detail = verdict.detail ?? (verdict.failure === "nodes_dropped" ? `${verdict.nodes_dropped} node(s) dropped` : null);
      break;
    }

    // Rule C1 — the cursor may advance ONLY from this point: errors empty, all
    // nodes usable, pageInfo valid, and an endCursor present when another page
    // is promised.
    if (!verdict.has_next_page) {
      sealed = true;
      break;
    }
    after = verdict.end_cursor;
  }

  return {
    nodes,
    pages_fetched,
    nodes_seen,
    nodes_dropped,
    truncated,
    sealed,
    failure,
    detail,
    errors,
    max_updated_at: maxUpdatedAt(nodes),
    requested_cursors,
    rate_limited,
  };
}

/** Page size ceiling of the GitHub connection. */
const MAX_PAGE_SIZE = 100;

/**
 * Live page fetch. Uses `graphqlStrict`, never `graphql`: the accepting
 * transport erases `errors[]` and this reader must see them (rule E2).
 */
export function fetchLiveIssuePage(ghRepo: string, request: IssuePageRequest): RawIssuePage {
  const [owner, name] = ghRepo.split("/");
  if (!owner || !name) throw new Error("Cannot parse GitHub repository identity");

  const first = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(request.first)));
  // `state` is a closed union, so only these two literals can reach the query.
  const statesArg = request.state === "all" ? "" : `states: [${request.state.toUpperCase()}], `;
  const cursorArg = request.after ? ", after: $after" : "";
  const sinceArg = request.since ? ", filterBy: { since: $since }" : "";

  const query = `query($owner: String!, $name: String!${request.after ? ", $after: String!" : ""}${request.since ? ", $since: DateTime" : ""}) {
    repository(owner: $owner, name: $name) {
      issues(${statesArg}first: ${first}${cursorArg}, orderBy: { field: UPDATED_AT, direction: DESC }${sinceArg}) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { number title state stateReason createdAt updatedAt closedAt url author { login } }
      }
    }
  }`;

  const variables: Record<string, string> = { owner, name };
  if (request.after) variables["after"] = request.after;
  if (request.since) variables["since"] = request.since;

  const response = graphqlStrict(query, variables);
  return { ...response, requested_after: request.after };
}

/** The live client: every page goes through `graphqlStrict`. */
export const liveIssueClient: GithubIssueClient = { fetchIssuePage: fetchLiveIssuePage };

/** Default overlap subtracted from the high-water mark (rule W3). */
export const DEFAULT_WATERMARK_OVERLAP_MS = 60 * 60 * 1000;

export interface SyncIssuesOptions {
  state?: "open" | "closed" | "all";
  limit?: number;
  pageSize?: number;
  /** Inclusive re-read window; 0 disables the overlap (not recommended). */
  overlapMs?: number;
  client?: GithubIssueClient;
  retryAttempts?: number;
  retryBackoffMs?: number;
  sleep?: (ms: number) => void;
}

export interface IssueIncompleteEntry {
  repo: string;
  reason: string;
  detail: string | null;
}

export interface SyncIssuesResult {
  repo_name: string;
  remote: string;
  checkouts: number;
  /** Distinct issues fetched (not rows written across checkouts). */
  synced: number;
  rows_written: number;
  /** Fetched issues this index had never stored for the remote. */
  new_issues: number;
  pages_fetched: number;
  nodes_seen: number;
  nodes_dropped: number;
  /** Complete by exhaustion: every page sealed and none truncated. */
  sealed: boolean;
  truncated: boolean;
  incomplete: IssueIncompleteEntry[];
  errors: string[];
  /** First complete traversal for this remote (W6 baseline). */
  baseline: boolean;
  watermark_advanced: boolean;
  /** The `since` boundary the next run will use. */
  watermark: string | null;
  max_updated_at: string | null;
  rate_limited: boolean;
  anomalies: string[];
}

function toIssueInput(repoId: number, issue: GraphqlIssue): IssueInput {
  return {
    repo_id: repoId,
    number: issue.number,
    title: issue.title,
    // Guards already restricted state to OPEN|CLOSED; the storage vocabulary
    // is lowercase, and there is no merged state for issues.
    state: issue.state === "CLOSED" ? "closed" : "open",
    state_reason: issue.stateReason ?? null,
    author: issue.author?.login || "unknown",
    created_at: issue.createdAt,
    updated_at: issue.updatedAt || null,
    closed_at: issue.closedAt || null,
    url: issue.url ?? null,
  };
}

/**
 * Rule W3: `max(updatedAt) − overlap`, as the next run's inclusive `since`.
 *
 * Normalized back to GitHub's second-granularity shape (`...:00Z`, not
 * `...:00.000Z`): the stored value is compared and fed back as a GraphQL
 * `DateTime`, and mixing shapes would make a lexicographic comparison
 * disagree with the instant comparison.
 */
export function watermarkCandidate(maxUpdatedAt: string, overlapMs: number): string | null {
  const parsed = Date.parse(maxUpdatedAt);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed - overlapMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Sync one GitHub remote's issues into every local checkout of it.
 *
 * One fetch per remote, not per directory: the same repository is routinely
 * checked out many times and every checkout stores the same issue rows.
 */
export function syncRemoteIssues(
  remoteUrl: string,
  ghRepo: string,
  opts: SyncIssuesOptions = {},
): SyncIssuesResult {
  const [ghOwner, ghRepoName] = ghRepo.split("/");
  if (!ghOwner || !ghRepoName) throw new Error("Cannot parse GitHub repository identity");

  const overlapMs = Math.max(0, opts.overlapMs ?? DEFAULT_WATERMARK_OVERLAP_MS);
  const checkouts = listReposByRemote(remoteUrl);
  const prior = getIssueSyncState(remoteUrl);

  // W1 — `since` comes from the stored GitHub watermark, never the local clock.
  const since = prior?.watermark_updated_at ?? null;
  const traversal = fetchIssues(ghRepo, { ...opts, since });

  const byNumber = new Map<number, GraphqlIssue>();
  for (const issue of traversal.nodes) byNumber.set(issue.number, issue);
  const fetched = [...byNumber.values()];

  // New-issue count is computed BEFORE the write: an issue is new when this
  // index had never stored that number for this remote.
  const known = new Set<number>();
  for (const checkout of checkouts) {
    for (const number of listIssueNumbers(checkout.id)) known.add(number);
  }
  const newIssues = fetched.filter((issue) => !known.has(issue.number)).length;

  const inputs = checkouts.flatMap((checkout) => fetched.map((issue) => toIssueInput(checkout.id, issue)));
  const rowsWritten = bulkInsertIssues(inputs);

  const completed = traversal.sealed && !traversal.truncated && traversal.failure === null;
  const anomalies: string[] = [];
  let watermarkAdvanced = false;
  let watermark = prior?.watermark_updated_at ?? null;
  let baseline = false;

  if (completed) {
    baseline = !prior?.first_complete_at;
    const candidate = traversal.max_updated_at ? watermarkCandidate(traversal.max_updated_at, overlapMs) : null;
    if (candidate) {
      if (watermark && candidate < watermark) {
        // W7 — a re-created repo or edited timestamps must not lower the mark.
        anomalies.push(
          `observed max updatedAt ${traversal.max_updated_at} maps below the stored watermark; watermark not lowered`,
        );
      } else {
        watermarkAdvanced = !watermark || candidate > watermark;
        if (watermarkAdvanced) watermark = candidate;
      }
    }
    recordIssueSyncRun({
      remoteUrl,
      ghOwner,
      ghRepo: ghRepoName,
      watermarkUpdatedAt: watermark,
      outcome: "complete",
      incompleteReason: null,
    });
  } else {
    const reason = traversal.truncated && traversal.failure === null
      ? "truncated by local limit"
      : (traversal.failure ?? "page failed");
    // W2/W5 — the watermark is left exactly where it was (null passes through
    // COALESCE), and the repo is named in the run's incomplete[] list.
    recordIssueSyncRun({
      remoteUrl,
      ghOwner,
      ghRepo: ghRepoName,
      watermarkUpdatedAt: null,
      outcome: traversal.truncated && traversal.failure === null ? "truncated" : "incomplete",
      incompleteReason: reason,
    });
  }

  const incomplete: IssueIncompleteEntry[] = completed
    ? []
    : [{
        repo: ghRepo,
        reason: traversal.truncated && traversal.failure === null
          ? "truncated"
          : (traversal.failure ?? "page_failed"),
        detail: traversal.truncated && traversal.failure === null
          ? `local limit ${opts.limit} reached before exhaustion`
          : traversal.detail,
      }];

  return {
    repo_name: ghRepo,
    remote: remoteUrl,
    checkouts: checkouts.length,
    synced: fetched.length,
    rows_written: rowsWritten,
    new_issues: newIssues,
    pages_fetched: traversal.pages_fetched,
    nodes_seen: traversal.nodes_seen,
    nodes_dropped: traversal.nodes_dropped,
    sealed: completed,
    truncated: traversal.truncated,
    incomplete,
    errors: traversal.errors,
    baseline,
    watermark_advanced: watermarkAdvanced,
    watermark,
    max_updated_at: traversal.max_updated_at,
    rate_limited: traversal.rate_limited,
    anomalies,
  };
}

/** Sync one local repo record by id or name. */
export function syncGithubIssues(repoIdOrName: string | number, opts: SyncIssuesOptions = {}): SyncIssuesResult {
  const repo = getRepo(repoIdOrName);
  if (!repo) throw new Error(`Repo not found: ${repoIdOrName}`);
  if (!repo.remote_url) throw new Error(`Repo has no remote URL: ${repo.name}`);

  const ghRepo = parseGithubRemote(repo.remote_url);
  if (!ghRepo) throw new Error(`Cannot parse GitHub repo from: ${repo.remote_url}`);

  return syncRemoteIssues(repo.remote_url, ghRepo, opts);
}

export interface SyncAllIssuesResult {
  total_synced: number;
  total_rows_written: number;
  total_new_issues: number;
  total_pages_fetched: number;
  total_nodes_seen: number;
  total_nodes_dropped: number;
  repos_seen: number;
  repos_checked: number;
  repos_synced: number;
  remotes_seen: number;
  /** The local `--max-repos` cap cut the remote list. */
  truncated: boolean;
  /** A rate limit stopped the fleet run early; unvisited remotes are not checked. */
  stopped_early: boolean;
  /** Aggregate completion across every remote the run visited. */
  sealed: boolean;
  errors: string[];
  skipped: string[];
  incomplete: IssueIncompleteEntry[];
  anomalies: string[];
  results: SyncIssuesResult[];
}

/**
 * Fan the issue sync out across distinct GitHub remotes, exactly the way
 * `syncAllGithubPRs` collapses local checkouts to remotes. A gone repository
 * is skipped-and-continued; any other per-repo failure is recorded and the
 * fleet run keeps going; a rate limit stops the fleet run.
 */
export function syncAllGithubIssues(
  opts: SyncIssuesOptions & { org?: string; maxRepos?: number; onProgress?: (msg: string) => void } = {},
): SyncAllIssuesResult {
  const repos = listAllRepos(opts.org ? { org: opts.org } : {})
    .filter((repo) => repo.remote_url?.startsWith("github.com/"));

  const remotes = new Map<string, string>();
  for (const repo of repos) {
    const ghRepo = parseGithubRemote(repo.remote_url);
    if (ghRepo && !remotes.has(repo.remote_url!)) remotes.set(repo.remote_url!, ghRepo);
  }

  let entries = [...remotes.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  const remotes_seen = entries.length;
  let truncated = false;
  if (opts.maxRepos && opts.maxRepos > 0 && entries.length > opts.maxRepos) {
    entries = entries.slice(0, Math.floor(opts.maxRepos));
    truncated = true;
  }

  const errors: string[] = [];
  const skipped: string[] = [];
  const incomplete: IssueIncompleteEntry[] = [];
  const anomalies: string[] = [];
  const results: SyncIssuesResult[] = [];
  let stopped_early = false;
  let visited = 0;

  for (let i = 0; i < entries.length; i++) {
    const [remoteUrl, ghRepo] = entries[i]!;
    opts.onProgress?.(`[${i + 1}/${entries.length}] Syncing issues for ${ghRepo}...`);
    visited++;
    try {
      const result = syncRemoteIssues(remoteUrl, ghRepo, opts);
      results.push(result);
      incomplete.push(...result.incomplete);
      anomalies.push(...result.anomalies);
      if (result.rate_limited) {
        stopped_early = true;
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isMissingRepoError(message)) {
        skipped.push(`${ghRepo}: ${message}`);
      } else {
        errors.push(`${ghRepo}: ${message}`);
      }
    }
  }

  return {
    total_synced: results.reduce((sum, result) => sum + result.synced, 0),
    total_rows_written: results.reduce((sum, result) => sum + result.rows_written, 0),
    total_new_issues: results.reduce((sum, result) => sum + result.new_issues, 0),
    total_pages_fetched: results.reduce((sum, result) => sum + result.pages_fetched, 0),
    total_nodes_seen: results.reduce((sum, result) => sum + result.nodes_seen, 0),
    total_nodes_dropped: results.reduce((sum, result) => sum + result.nodes_dropped, 0),
    repos_seen: repos.length,
    repos_checked: visited,
    repos_synced: results.length,
    remotes_seen,
    truncated,
    stopped_early,
    // A scope with zero checkable remotes is honestly not "sealed": there is
    // nothing it could have verified. A skipped (gone) or errored remote is
    // not a verified empty one either — "0 new" must never be claimed for a
    // remote the run could not read.
    sealed: entries.length > 0
      && visited === entries.length
      && results.every((result) => result.sealed)
      && skipped.length === 0
      && errors.length === 0,
    errors,
    skipped,
    incomplete,
    anomalies,
    results,
  };
}

export interface IssueSyncDigestInput {
  sealed: boolean;
  truncated: boolean;
  baseline: boolean;
  new_issues: number;
  synced: number;
  pages_fetched: number;
  nodes_dropped: number;
  incomplete: Array<{ repo: string; reason: string; detail?: string | null }>;
}

export interface IssueSyncDigest {
  /** True only when the run may claim an unqualified, complete result. */
  reportable: boolean;
  degraded_reasons: string[];
  line: string;
}

/**
 * Rule R2 — "0 new" is reportable ONLY on a run that is sealed, untruncated,
 * and free of incomplete pages. Any failed page, null hole, or local limit
 * renders as a degraded line instead, so a lossy run can never read as quiet.
 * The first complete run is a baseline (W6) and makes no new-issue claim.
 */
export function issueSyncDigest(input: IssueSyncDigestInput): IssueSyncDigest {
  const degradedReasons: string[] = [];
  for (const entry of input.incomplete) degradedReasons.push(`${entry.repo}: ${entry.reason}`);
  if (input.truncated) degradedReasons.push("traversal truncated by a local limit");
  if (input.nodes_dropped > 0) degradedReasons.push(`${input.nodes_dropped} node(s) dropped`);

  const reportable = input.sealed && !input.truncated && input.incomplete.length === 0;
  if (!reportable) {
    const where = input.incomplete.length > 0
      ? input.incomplete.map((entry) => entry.repo).join(", ")
      : "the traversal";
    return {
      reportable: false,
      degraded_reasons: degradedReasons,
      line: `issue sync degraded: incomplete pages in ${where} — not reporting new counts`
        + (degradedReasons.length > 0 ? ` (${degradedReasons.join("; ")})` : ""),
    };
  }
  if (input.baseline) {
    return {
      reportable: true,
      degraded_reasons: [],
      line: `issue sync baseline: ${input.synced} issue(s) recorded over ${input.pages_fetched} page(s); `
        + "first complete run makes no new-issue claims",
    };
  }
  if (input.new_issues === 0) {
    return {
      reportable: true,
      degraded_reasons: [],
      line: `issue sync: 0 new (${input.synced} issue(s) seen over ${input.pages_fetched} page(s))`,
    };
  }
  return {
    reportable: true,
    degraded_reasons: [],
    line: `issue sync: ${input.new_issues} new (${input.synced} issue(s) seen over ${input.pages_fetched} page(s))`,
  };
}

/**
 * Aggregate the digest over the per-remote results of one run (single-repo or
 * fleet). `truncated` also covers a `--max-repos` cut, which never visited
 * every scope remote and therefore cannot be reported as complete.
 */
export function issueSyncDigestFromResults(
  results: SyncIssuesResult[],
  truncated = false,
  extraIncomplete: IssueIncompleteEntry[] = [],
): IssueSyncDigest {
  const incomplete = [...results.flatMap((result) => result.incomplete), ...extraIncomplete];
  return issueSyncDigest({
    sealed: results.length > 0 && results.every((result) => result.sealed),
    truncated: truncated || results.some((result) => result.truncated),
    // Any baseline repo in the set reports its whole backfill as new, so the
    // aggregate makes no new-issue claim until every repo has a watermark.
    baseline: results.some((result) => result.baseline),
    new_issues: results.reduce((sum, result) => sum + result.new_issues, 0),
    synced: results.reduce((sum, result) => sum + result.synced, 0),
    pages_fetched: results.reduce((sum, result) => sum + result.pages_fetched, 0),
    nodes_dropped: results.reduce((sum, result) => sum + result.nodes_dropped, 0),
    incomplete,
  });
}
