/**
 * pr-monitor delta emitter.
 *
 * The lib surface of the `repos pr-monitor` verb's emission half (pr-monitor
 * design sections 2.1-2.3, acceptance criterion 4). It composes the two prior
 * layers — the watch-state accessors (`pr-monitor-state.ts`) and the pure
 * classification engine (`pr-monitor-classify.ts`) — into the run the verb
 * and the 5-minute loop consume:
 *
 * - reads each PR's watch row from the registry, classifies it, persists the
 *   observation, and decides emission;
 * - baseline mode (`--baseline`, first-run) records watch state and seeds the
 *   comment cursor but emits NO per-PR NEW events — the "no NEW storm" rule;
 * - first sighting outside baseline emits a NEW event whose `id` is the
 *   16-hex slice of the sha256 event fingerprint;
 * - the fingerprint dedupe is persisted through `markEventEmitted` for every
 *   emitted event, so a re-run against unchanged state emits `events: []`
 *   with unchanged fingerprints (the idempotency gate);
 * - the comment cursor is advanced over everything fetched (monotonic, so it
 *   seeds on first sighting and older discussion is never replayed).
 *
 * Caller contract (wired by the CLI in the next task): a PR is included in
 * `inputs` only when its classification inputs are complete — verdicts and
 * comments fetched (or legitimately empty), current-main fetch attempted. A
 * PR whose inputs could not be fetched is reported by the caller in the
 * `errors` array, never guessed (design section 3.4). The emitter itself has
 * no failure paths of its own and always returns `errors: []`; the caller
 * appends sync/fetch errors to the envelope it assembles.
 */
import { getDb } from "../db/database.js";
import {
  advanceCommentCursor,
  markEventEmitted,
  readWatchStateByPr,
  upsertWatchState,
  watchStateKey,
} from "./pr-monitor-state.js";
import {
  classifyPullRequest,
  type MonitorCommentMeta,
  type MonitorLeaseInput,
  type MergeTreeProbe,
  type PrMonitorClass,
  type PrMonitorSubject,
} from "./pr-monitor-classify.js";
import type { ParsedVerdict } from "./verdict-parser.js";

/** Everything one PR needs to classify and emit for one run. */
export interface EmitPrInput {
  pr: PrMonitorSubject;
  /** All verdict lines parsed from the fetched comments (may be empty). */
  verdicts: readonly ParsedVerdict[];
  /** Comment metadata (id, author); the cursor is advanced over these. */
  comments: readonly MonitorCommentMeta[];
  /** Base-branch head at last check; null when the fetch failed. */
  currentMainSha: string | null;
  /** Merge-tree probe result; null when the caller did not (or could not) probe. */
  mergeTree: MergeTreeProbe | null;
}

export interface EmitDeltaOptions {
  /** Baseline mode: record watch state, emit no per-PR NEW events. */
  baseline: boolean;
  /** Every classified PR of this run, in display order. */
  inputs: readonly EmitPrInput[];
  /** All local non-released worktree leases (shared across PRs). */
  leases?: readonly MonitorLeaseInput[];
  /**
   * Observation time in SQLite `datetime('now')` shape (UTC). Defaults to
   * the registry clock so the recorded timestamps are comparable to the
   * stored ones.
   */
  now?: string;
}

/** One emitted event, per design section 2.2. */
export interface EmittedEvent {
  /** The 16-hex slice of the sha256 event fingerprint. */
  id: string;
  class: PrMonitorClass;
  owner: string;
  repo: string;
  number: number;
  title: string;
  head_sha: string | null;
  url: string | null;
  /** One line: which check failed / verdict+reviewer / base moved / commenter. */
  detail: string;
}

/** The full per-PR classification read, per design section 2.2 `state`. */
export interface MonitorStateEntry {
  owner: string;
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  class: PrMonitorClass | null;
  head_sha: string | null;
  mergeable: string | null;
  ci_state: string | null;
  verdict: { value: "GO" | "NO_GO" | null; reviewer: string | null; lens: string | null; sha: string | null };
  base_ref_oid: string | null;
  current_main_sha: string | null;
  url: string | null;
  first_seen_at: string | null;
}

export interface DeltaEmissionResult {
  /** True when this run ran in baseline mode. */
  baseline: boolean;
  summary: {
    open: number;
    events: number;
    /** Emitted-event counts per class; zero-filled, sums to `events`. */
    by_class: Record<PrMonitorClass, number>;
  };
  events: EmittedEvent[];
  state: MonitorStateEntry[];
  /** Caller-owned slot for sync/fetch errors; the emitter adds none. */
  errors: string[];
}

const ALL_CLASSES: readonly PrMonitorClass[] = [
  "NEW",
  "NO_GO_OPEN",
  "CI_FAILING",
  "BASE_MOVED",
  "READY_TO_MERGE",
  "REVIEW_NEEDED",
  "STALE_WORKTREE",
  "NEW_COMMENT",
];

function emptyByClass(): Record<PrMonitorClass, number> {
  return Object.fromEntries(ALL_CLASSES.map((cls) => [cls, 0])) as Record<PrMonitorClass, number>;
}

/** Max comment id seen; 0 when nothing was fetched. */
function maxCommentId(comments: readonly MonitorCommentMeta[]): number {
  let max = 0;
  for (const comment of comments) {
    if (comment.id > max) max = comment.id;
  }
  return max;
}

/** The createdAt of the comment carrying the max id (cursor timestamp). */
function newestFetchedCommentAt(comments: readonly MonitorCommentMeta[]): string | null {
  let maxId = 0;
  let at: string | null = null;
  for (const comment of comments) {
    if (comment.id >= maxId) {
      maxId = comment.id;
      at = comment.createdAt ?? null;
    }
  }
  return at;
}

/**
 * Run one delta-emission pass over the classified PR set: persist the watch
 * observations, apply baseline suppression and the fingerprint dedupe, and
 * return the envelope sections the verb serializes. Pure over the registry
 * clock: identical inputs against identical registry state produce identical
 * output — the property the no-change re-run gate tests.
 */
export function emitMonitorDelta(options: EmitDeltaOptions): DeltaEmissionResult {
  const now =
    options.now ??
    (getDb().query("SELECT datetime('now') AS now").get() as { now: string }).now;

  const events: EmittedEvent[] = [];
  const state: MonitorStateEntry[] = [];
  const byClass = emptyByClass();
  let open = 0;

  for (const input of options.inputs) {
    const { pr } = input;
    const prKey = watchStateKey(pr.owner, pr.repo, pr.number);

    const classification = classifyPullRequest({
      pr,
      watch: readWatchStateByPr(pr.owner, pr.repo, pr.number),
      verdicts: input.verdicts,
      comments: input.comments,
      currentMainSha: input.currentMainSha,
      leases: options.leases ?? [],
      mergeTree: input.mergeTree,
    });

    // Persist the observation first so the cursor and fingerprint writes land
    // on a row that exists (the accessors are no-ops on a missing row).
    const row = upsertWatchState({
      prKey,
      ghOwner: pr.owner,
      ghRepo: pr.repo,
      number: pr.number,
      lastSeenAt: now,
      observedState: pr.state,
      headSha: pr.headSha,
      updatedAt: null,
    });

    // Dedupe layer 1 — the comment cursor. Advance over everything fetched:
    // monotonic, so on first sighting this seeds at the newest comment and
    // older discussion is never replayed as NEW_COMMENT (design section 6).
    const maxCommentIdSeen = maxCommentId(input.comments);
    if (maxCommentIdSeen > 0) {
      advanceCommentCursor(prKey, maxCommentIdSeen, newestFetchedCommentAt(input.comments));
    }

    // Dedupe layer 2 — the event fingerprint. The classification engine
    // already judged the event against the last emitted fingerprint; the
    // emitter applies baseline suppression on top (NEW only) and persists
    // the mark for what was actually emitted.
    //
    // The fingerprint slot is owned by CLASS events. A NEW_COMMENT event is
    // deduped by the comment cursor (layer 1) and must NOT overwrite the
    // slot: writing a comment fingerprint there would make the next unchanged
    // run re-emit the class event (its fingerprint would differ from the
    // comment's), breaking the no-change re-run gate (acceptance criterion
    // 4). The two layers compose exactly as the design section 2.3 describes:
    // the cursor makes re-runs report only NEW state for comments, the
    // fingerprint does the same for classes.
    if (classification.event && !(options.baseline && classification.event.cls === "NEW")) {
      const event = classification.event;
      events.push({
        id: event.fingerprint.slice(0, 16),
        class: event.cls,
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        head_sha: pr.headSha,
        url: pr.url,
        detail: event.detail,
      });
      if (event.cls !== "NEW_COMMENT") {
        markEventEmitted(prKey, event.fingerprint, event.cls, now);
      }
      byClass[event.cls] += 1;
    }

    if (pr.state === "open") open += 1;

    const verdict = classification.verdictAtHead;
    state.push({
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      state: pr.state,
      class: classification.cls,
      head_sha: pr.headSha,
      mergeable: pr.mergeable,
      ci_state: pr.ciState,
      verdict: {
        value: verdict?.verdict ?? null,
        reviewer: verdict?.reviewer ?? null,
        lens: verdict?.lens ?? null,
        sha: verdict?.sha ?? null,
      },
      base_ref_oid: pr.baseRefOid,
      current_main_sha: input.currentMainSha,
      url: pr.url,
      first_seen_at: row.first_seen_at,
    });
  }

  return {
    baseline: options.baseline,
    summary: { open, events: events.length, by_class: byClass },
    events,
    state,
    errors: [],
  };
}
