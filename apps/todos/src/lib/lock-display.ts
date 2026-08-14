import { isLockExpired } from "../db/database.js";

/**
 * How a task's lock should be PRESENTED to a reader.
 *
 * The scheduler and the renderer had drifted apart: every claim path already
 * gates on `isLockExpired` (see `task-lifecycle.ts`, `task-route-sources.ts`,
 * `local-reports.ts`), while every user-facing surface rendered a bare
 * `locked_by` and so showed a lapsed lock as if it were held. `getTaskLockStatus`
 * has computed an `expired` field the whole time and no renderer consulted it.
 *
 * The measured consequence: tasks the scheduler was handing out freely read as
 * owned in `todos list`, so humans and agents skipped work that was available.
 *
 * This is the single predicate every renderer now shares, so the display can no
 * longer disagree with the claim path. It deliberately reuses `isLockExpired`
 * rather than recomputing a window: the local expiry (`LOCK_EXPIRY_MINUTES`) and
 * the cloud expiry (`CLOUD_LOCK_EXPIRY_MINUTES`) are both 30 minutes, so one
 * predicate is correct against either backend. If those two ever diverge, this
 * is the one place that has to learn the difference.
 */
export interface LockDisplayState {
  /** A holder name is recorded on the row, regardless of whether it still counts. */
  present: boolean;
  /** Recorded AND still inside its expiry window — genuinely held right now. */
  held: boolean;
  /** Recorded but lapsed. The scheduler already ignores it; the reader must too. */
  expired: boolean;
  /** The recorded holder, kept even when expired so detail views can explain it. */
  holder: string | null;
  /** When the lock was taken, for detail views. */
  lockedAt: string | null;
}

/**
 * Classify a task's lock for rendering.
 *
 * `nowMs` is injectable so tests can pin the clock instead of sleeping.
 *
 * Note `isLockExpired(null)` is `true`: a row carrying a holder but no timestamp
 * cannot be shown to be live, and the claim path treats it as free, so the
 * display treats it as expired too rather than inventing a live lock.
 */
export function lockDisplayState(
  lockedBy: string | null | undefined,
  lockedAt: string | null | undefined,
  nowMs: number = Date.now(),
): LockDisplayState {
  const holder = lockedBy ?? null;
  const at = lockedAt ?? null;
  if (!holder) {
    return { present: false, held: false, expired: false, holder: null, lockedAt: at };
  }
  const expired = isLockExpired(at, nowMs);
  return { present: true, held: !expired, expired, holder, lockedAt: at };
}

/**
 * One-line description of a lapsed lock for DETAIL surfaces.
 *
 * Compact list surfaces omit an expired lock entirely — on a dense scanning
 * surface the holder is noise, and 2584 rows currently carry a stale lock.
 * Detail surfaces keep it, because someone reading a single task wants to know
 * who last held it and when. Both forms are unmistakable: neither can be read
 * as a live claim.
 */
export function formatExpiredLock(state: LockDisplayState): string {
  const at = state.lockedAt ? ` at ${state.lockedAt}` : "";
  return `expired (last held by ${state.holder}${at})`;
}
