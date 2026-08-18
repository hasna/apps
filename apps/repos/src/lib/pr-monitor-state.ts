/**
 * pr-monitor watch-state accessors.
 *
 * State persistence for the `repos pr-monitor` verb, per the pr-monitor design
 * section 2.3. `pr_monitor_state` is LOCAL-ONLY by design: monitor cursors are
 * per-machine (the loop is single-owner), so the table is deliberately absent
 * from the auto-index SYNC_TABLES list and never propagates to shared Postgres.
 * Rows are bounded — one per PR ever watched — and pruned by the maintenance
 * mode below.
 *
 * The dedupe contract this module owns, in two layers:
 *
 * 1. Comment cursor — `last_seen_comment_id` is the max comment id seen.
 *    A comment id greater than the cursor is new. Monotonic per issue, bounded
 *    by construction: no seen-set of ids is stored, and the cursor never moves
 *    backwards regardless of caller ordering.
 * 2. Event fingerprint — an event is emitted only when
 *    `sha256(pr_key|class|head_sha|detail)` differs from
 *    `last_emitted_fingerprint`, so an unchanged re-run emits nothing and a
 *    classification flip-flop emits on each actual flip.
 */
import { createHash } from "node:crypto";
import type { SQLQueryBindings } from "bun:sqlite";
import { getDb } from "../db/database.js";
import { parsePullRequestUrl } from "./pr-identity.js";

/** Default age bound for the prune maintenance mode (design section 2.3). */
export const DEFAULT_PRUNE_OLDER_THAN_DAYS = 30;

/** One row of `pr_monitor_state`, exactly as stored. */
export interface PrMonitorWatchRow {
  pr_key: string;
  gh_owner: string;
  gh_repo: string;
  number: number;
  first_seen_at: string;
  last_seen_at: string;
  last_observed_state: string;
  last_head_sha: string | null;
  last_updated_at: string | null;
  last_seen_comment_id: number;
  last_seen_comment_at: string | null;
  last_classification: string | null;
  last_classification_at: string | null;
  last_emitted_fingerprint: string | null;
  verdict_json: string | null;
  ci_failing_json: string | null;
  base_ref_oid: string | null;
  current_main_sha: string | null;
}

/** The observation fields an upsert writes; the watch bookkeeping keeps its own values. */
export interface WatchStateObservation {
  prKey: string;
  ghOwner: string;
  ghRepo: string;
  number: number;
  /** SQLite `datetime('now')`-shaped observation timestamp (UTC). */
  lastSeenAt: string;
  observedState: "open" | "closed" | "merged";
  headSha: string | null;
  /** GitHub updatedAt at last observation, when the sync carried it. */
  updatedAt: string | null;
}

export interface CommentCursor {
  lastSeenCommentId: number;
  lastSeenCommentAt: string | null;
}

export interface PruneWatchStateOptions {
  /** SQLite `datetime('now')`-shaped reference time; defaults to the clock. */
  now?: string;
  /** Rows not seen within this many days are candidates; default 30. */
  olderThanDays?: number;
}

export interface PruneResult {
  /** Rows considered for pruning (all watch rows at call time). */
  scanned: number;
  /** Rows actually deleted. */
  pruned: number;
}

/**
 * Canonical `pr_monitor_state` key for a PR identity: the PR's own html url,
 * lowercased — the package's stable PR identity (design section 2.3).
 */
export function watchStateKey(owner: string, repo: string, number: number): string {
  return `https://github.com/${owner}/${repo}/pull/${number}`.toLowerCase();
}

/**
 * Normalize a stored PR url to the watch key. The key is case-insensitive
 * identity, so the url is lowercased before parsing; anything still
 * unparseable returns null so callers never write a garbage key for an
 * unidentifiable row.
 */
export function normalizePrKey(url: unknown): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  const identity = parsePullRequestUrl(url.toLowerCase());
  if (!identity) return null;
  return watchStateKey(identity.owner, identity.repo, identity.number);
}

function mapRow(row: Record<string, unknown>): PrMonitorWatchRow {
  return {
    pr_key: row.pr_key as string,
    gh_owner: row.gh_owner as string,
    gh_repo: row.gh_repo as string,
    number: Number(row.number),
    first_seen_at: row.first_seen_at as string,
    last_seen_at: row.last_seen_at as string,
    last_observed_state: row.last_observed_state as string,
    last_head_sha: (row.last_head_sha as string | null) ?? null,
    last_updated_at: (row.last_updated_at as string | null) ?? null,
    last_seen_comment_id: Number(row.last_seen_comment_id),
    last_seen_comment_at: (row.last_seen_comment_at as string | null) ?? null,
    last_classification: (row.last_classification as string | null) ?? null,
    last_classification_at: (row.last_classification_at as string | null) ?? null,
    last_emitted_fingerprint: (row.last_emitted_fingerprint as string | null) ?? null,
    verdict_json: (row.verdict_json as string | null) ?? null,
    ci_failing_json: (row.ci_failing_json as string | null) ?? null,
    base_ref_oid: (row.base_ref_oid as string | null) ?? null,
    current_main_sha: (row.current_main_sha as string | null) ?? null,
  };
}

const WATCH_ROW_COLUMNS = [
  "pr_key",
  "gh_owner",
  "gh_repo",
  "number",
  "first_seen_at",
  "last_seen_at",
  "last_observed_state",
  "last_head_sha",
  "last_updated_at",
  "last_seen_comment_id",
  "last_seen_comment_at",
  "last_classification",
  "last_classification_at",
  "last_emitted_fingerprint",
  "verdict_json",
  "ci_failing_json",
  "base_ref_oid",
  "current_main_sha",
].join(", ");

/** Read the watch row by its canonical key; null when never watched. */
export function readWatchState(prKey: string): PrMonitorWatchRow | null {
  const db = getDb();
  const row = db
    .query(`SELECT ${WATCH_ROW_COLUMNS} FROM pr_monitor_state WHERE pr_key = ?`)
    .get(prKey) as Record<string, unknown> | null;
  return row ? mapRow(row) : null;
}

/** Read the watch row by its GitHub identity (casing-insensitive key). */
export function readWatchStateByPr(owner: string, repo: string, number: number): PrMonitorWatchRow | null {
  const db = getDb();
  const row = db
    .query(
      `SELECT ${WATCH_ROW_COLUMNS} FROM pr_monitor_state
       WHERE gh_owner = ? AND gh_repo = ? AND number = ?`,
    )
    .get(owner, repo, number) as Record<string, unknown> | null;
  return row ? mapRow(row) : null;
}

/** All watch rows, optionally scoped to one owner/repo, ordered by number. */
export function listWatchState(scope?: { owner?: string; repo?: string }): PrMonitorWatchRow[] {
  const db = getDb();
  let sql = `SELECT ${WATCH_ROW_COLUMNS} FROM pr_monitor_state`;
  const params: SQLQueryBindings[] = [];
  if (scope?.owner) {
    sql += ` WHERE gh_owner = ?`;
    params.push(scope.owner);
    if (scope.repo) {
      sql += ` AND gh_repo = ?`;
      params.push(scope.repo);
    }
  }
  sql += ` ORDER BY number`;
  return (db.query(sql).all(...params) as Record<string, unknown>[]).map(mapRow);
}

/**
 * Record an observation of a PR. First sighting inserts the row with
 * first_seen_at at the observation time; later sightings update only the
 * observation columns. If the same GitHub identity already exists under a
 * differently-cased pr_key (SQLite TEXT PRIMARY KEY is case-sensitive), the
 * row is re-keyed to the canonical spelling so the UNIQUE(gh_owner, gh_repo,
 * number) identity constraint is never tripped.
 */
export function upsertWatchState(observation: WatchStateObservation): PrMonitorWatchRow {
  const db = getDb();
  const existing = db
    .query("SELECT pr_key FROM pr_monitor_state WHERE gh_owner = ? AND gh_repo = ? AND number = ?")
    .get(observation.ghOwner, observation.ghRepo, observation.number) as { pr_key: string } | null;

  if (existing && existing.pr_key !== observation.prKey) {
    db.query("UPDATE pr_monitor_state SET pr_key = ? WHERE pr_key = ?").run(
      observation.prKey,
      existing.pr_key,
    );
  }

  db.query(
    `INSERT INTO pr_monitor_state (
       pr_key, gh_owner, gh_repo, number, last_seen_at, last_observed_state,
       last_head_sha, last_updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(pr_key) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       last_observed_state = excluded.last_observed_state,
       last_head_sha = excluded.last_head_sha,
       last_updated_at = excluded.last_updated_at`,
  ).run(
    observation.prKey,
    observation.ghOwner,
    observation.ghRepo,
    observation.number,
    observation.lastSeenAt,
    observation.observedState,
    observation.headSha,
    observation.updatedAt,
  );

  return readWatchState(observation.prKey)!;
}

/**
 * The comment cursor: the max comment id seen so far. Reads a zero cursor for
 * a PR never watched, so first-sighting seeding works without a branch.
 */
export function readCommentCursor(prKey: string): CommentCursor {
  const row = readWatchState(prKey);
  if (!row) return { lastSeenCommentId: 0, lastSeenCommentAt: null };
  return { lastSeenCommentId: row.last_seen_comment_id, lastSeenCommentAt: row.last_seen_comment_at };
}

/**
 * Advance the comment cursor. The cursor only ever moves forward — a comment
 * id lower than the stored max is ignored and does not move the timestamp —
 * which is what makes re-runs deduplicate even if a caller passes an
 * out-of-order batch. A no-op for a PR never watched.
 */
export function advanceCommentCursor(prKey: string, commentId: number, commentAt: string | null): void {
  const db = getDb();
  db.query(
    `UPDATE pr_monitor_state SET
       last_seen_comment_id = max(last_seen_comment_id, ?),
       last_seen_comment_at = CASE
         WHEN ? > last_seen_comment_id THEN ?
         ELSE last_seen_comment_at
       END
     WHERE pr_key = ?`,
  ).run(commentId, commentId, commentAt, prKey);
}

/**
 * The event fingerprint an event's dedupe is judged on:
 * sha256(pr_key|class|head_sha|detail). An event is emitted only when this
 * differs from last_emitted_fingerprint. Full 64-hex sha256; the verb's event
 * `id` presentation (16-hex slice) is the emitter's choice.
 */
export function computeEventFingerprint(
  prKey: string,
  cls: string,
  headSha: string | null,
  detail: string,
): string {
  return createHash("sha256")
    .update(`${prKey}|${cls}|${headSha ?? ""}|${detail}`)
    .digest("hex");
}

/** The fingerprint of the last emitted event for a PR; null when none yet. */
export function readLastEmittedFingerprint(prKey: string): string | null {
  return readWatchState(prKey)?.last_emitted_fingerprint ?? null;
}

/** Record that an event with this fingerprint was emitted, at this time. */
export function markEventEmitted(
  prKey: string,
  fingerprint: string,
  classification: string,
  at: string,
): void {
  const db = getDb();
  db.query(
    `UPDATE pr_monitor_state SET
       last_emitted_fingerprint = ?,
       last_classification = ?,
       last_classification_at = ?
     WHERE pr_key = ?`,
  ).run(fingerprint, classification, at, prKey);
}

/**
 * Prune maintenance mode: delete watch rows whose PR is terminal — no
 * `open` row for that GitHub identity anywhere in the registry (which also
 * covers rows orphaned when their pull_requests rows were removed) — and
 * whose last_seen_at is older than `olderThanDays` from `now`. The reference
 * time defaults to the registry clock (`datetime('now')`) so the cutoff is
 * computed in the same format the stored timestamps use.
 */
export function pruneWatchState(options: PruneWatchStateOptions = {}): PruneResult {
  const db = getDb();
  const olderThanDays = options.olderThanDays ?? DEFAULT_PRUNE_OLDER_THAN_DAYS;
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
    throw new Error(`pruneWatchState: olderThanDays must be a non-negative number, got ${olderThanDays}`);
  }

  const now = options.now ?? (db.query("SELECT datetime('now') AS now").get() as { now: string }).now;

  const { scanned } = db
    .query("SELECT COUNT(*) AS scanned FROM pr_monitor_state")
    .get() as { scanned: number };

  const { changes } = db
    .query(
      `DELETE FROM pr_monitor_state AS s
       WHERE s.last_seen_at < datetime(?, '-' || ? || ' days')
         AND NOT EXISTS (
           SELECT 1 FROM pull_requests AS p
           WHERE p.gh_owner = s.gh_owner
             AND p.gh_repo = s.gh_repo
             AND p.number = s.number
             AND p.state = 'open'
         )`,
    )
    .run(now, String(olderThanDays));

  return { scanned, pruned: changes };
}
