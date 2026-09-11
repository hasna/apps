/**
 * Retention and eviction (§6, as corrected by §15.11.1/11.2/11.7).
 *
 * =========================================================================
 * THE INVARIANT, asserted in code and pinned by tests
 * =========================================================================
 *
 *   A staged payload's bytes may be deleted locally IFF
 *     (a) a remote copy is CONFIRMED BY MATCHING sha256 — re-verified at the
 *         moment of deletion, never on a stored boolean, or
 *     (b) the instance is LOCAL-ONLY, the entry is past `retentionDays`, and
 *         an explicit apply pass was requested.
 *
 *   In NO case may a sweep reduce the number of un-uploaded entries below
 *   `retention.minUnuploadedKeep`.
 *
 *   In NO case may a sweep delete an entry whose `pinned` flag is set.
 *
 * Two refinements the obvious version gets wrong, both implemented here:
 *
 *  1. "Remote-confirmed" is a HISTORICAL fact. If the bucket's lifecycle rule
 *     expires the object and a later sweep deletes the local payload on the
 *     stored flag, the last copy disappears. Eligibility is therefore decided
 *     by a live verification (`RemoteVerifier`) that runs immediately before
 *     the payload is removed, keyed to the remote object identity (version id)
 *     and the stored confirmation's freshness.
 *
 *  2. "Never evict the newest un-uploaded" is satisfiable to zero — a stalled
 *     daemon plus a delete burst leaves EVERY entry un-uploaded. Hence a hard
 *     COUNT floor, not a heuristic.
 *
 * The eviction order is the plan's list with the two corrections applied: the
 * first two original steps are one rule with two ORDERING KEYS (every entry
 * reachable by "past retentionDays AND remote-confirmed" is already reachable
 * by "remote-confirmed", so as separate steps the second never selects
 * anything), and the local-only arm exists EXPLICITLY as the fifth step —
 * without it "there is no local mode" would be true by omission while the
 * invariant advertised otherwise.
 */

import type { TrashConfig } from "./config.js";
import type { TrashEntry } from "./entry.js";
import { isExpired } from "./expiry.js";

export type SweepActionKind = "delete_payload" | "retry_upload" | "keep" | "skip";

export type SweepBasis =
  /** Ordering key 1: remote-confirmed and past `retentionDays`. */
  | "remote_confirmed_expired"
  /** Ordering key 2: remote-confirmed, over quota, oldest first. */
  | "remote_confirmed_over_quota"
  /** Step 3: un-uploaded — retry the upload, NEVER delete. */
  | "unuploaded_retry"
  /** Step 5 (the explicit local-only arm): local-only, past retentionDays, `--apply`. */
  | "local_only_expired"
  | "pinned"
  | "restore_in_flight"
  | "unuploaded_floor"
  | "not_expired"
  | "no_verifier"
  | "quota_ok";

export interface SweepStep {
  entry: TrashEntry;
  kind: SweepActionKind;
  basis: SweepBasis;
  detail: string;
}

export interface SweepQuota {
  maxTotalBytes: number;
  maxEntries: number;
  totalBytes: number;
  entries: number;
  overBytes: boolean;
  overEntries: boolean;
  overQuota: boolean;
  excessBytes: number;
  excessEntries: number;
}

export interface RetentionPlan {
  steps: SweepStep[];
  quota: SweepQuota;
  unuploaded: number;
  uploadable: number;
  pinned: number;
  expiredRemoteConfirmed: number;
  expiredLocalOnly: number;
  /**
   * Set when the plan cannot get under quota without deleting an un-uploaded
   * entry: stop, warn, refuse new captures (§6 step 4). Never "delete anyway".
   */
  blocked: { reason: "quota_exceeded"; detail: string } | null;
  notes: string[];
}

export interface RetentionPlanInput {
  entries: TrashEntry[];
  config: TrashConfig;
  /** The derived mode — §6's local-only arm is available ONLY in local mode. */
  mode: "local" | "hosted";
  now: number;
  /** True when a remote verifier is available; without one nothing is confirmable. */
  hasVerifier: boolean;
}

function stagingEligible(entry: TrashEntry): boolean {
  return entry.status === "staged";
}

function compareByCapture(a: TrashEntry, b: TrashEntry): number {
  return Date.parse(a.capturedAt) - Date.parse(b.capturedAt);
}

/**
 * Build the sweep plan. Pure: no filesystem access, no network, no clock of
 * its own — every decision is a function of the entries and the config, which
 * is what makes the invariant testable.
 */
export function planRetention(input: RetentionPlanInput): RetentionPlan {
  const { entries, config, mode, now, hasVerifier } = input;
  const quota: SweepQuota = {
    maxTotalBytes: Math.min(config.retention.maxTotalBytes, config.storage.maxSizeBytes),
    maxEntries: config.retention.maxEntries,
    totalBytes: 0,
    entries: 0,
    overBytes: false,
    overEntries: false,
    overQuota: false,
    excessBytes: 0,
    excessEntries: 0,
  };

  const steps: SweepStep[] = [];
  const notes: string[] = [];

  let unuploaded = 0;
  let expiredRemoteConfirmed = 0;
  let expiredLocalOnly = 0;

  // Live payload usage: metadata only, no payload reads.
  for (const entry of entries) {
    if (entry.status === "restored") continue;
    quota.entries += 1;
    quota.totalBytes += entry.sizeBytes;
  }
  quota.overBytes = quota.totalBytes > quota.maxTotalBytes;
  quota.overEntries = quota.entries > quota.maxEntries;
  quota.overQuota = quota.overBytes || quota.overEntries;
  quota.excessBytes = Math.max(0, quota.totalBytes - quota.maxTotalBytes);
  quota.excessEntries = Math.max(0, quota.entries - quota.maxEntries);

  const staged = entries.filter(stagingEligible);
  for (const entry of staged) {
    if (entry.remote === null) unuploaded += 1;
  }

  const remoteConfirmed = staged
    .filter((entry) => entry.remote !== null)
    .sort((a, b) => {
      // Two ordering keys: expired-first, then oldest-first. That IS the plan's
      // steps 1 and 2 collapsed into one rule (they are the same set).
      const aExpired = isExpired(a.expiresAt, now) ? 0 : 1;
      const bExpired = isExpired(b.expiresAt, now) ? 0 : 1;
      if (aExpired !== bExpired) return aExpired - bExpired;
      return compareByCapture(a, b);
    });

  const unuploadedEntries = staged.filter((entry) => entry.remote === null).sort(compareByCapture);

  const keep = (entry: TrashEntry, basis: SweepBasis, detail: string): void => {
    steps.push({ entry, kind: "keep", basis, detail });
  };

  // --- the retention clock (runs whether or not the store is over quota) ----
  for (const entry of remoteConfirmed) {
    if (entry.pinned) continue;
    if (!isExpired(entry.expiresAt, now)) continue;
    if (!hasVerifier) {
      steps.push({
        entry,
        kind: "skip",
        basis: "no_verifier",
        detail: "past retentionDays and remote-confirmed, but no verifier is configured to re-confirm at deletion time",
      });
      continue;
    }
    expiredRemoteConfirmed += 1;
    steps.push({
      entry,
      kind: "delete_payload",
      basis: "remote_confirmed_expired",
      detail:
        "past retentionDays with a remote confirmation — re-verified live immediately before the payload is removed",
    });
  }

  // --- the local-only arm (step 5, explicit) -------------------------------
  if (mode === "local") {
    for (const entry of unuploadedEntries) {
      if (entry.pinned) continue;
      if (!isExpired(entry.expiresAt, now)) continue;
      expiredLocalOnly += 1;
      steps.push({
        entry,
        kind: "delete_payload",
        basis: "local_only_expired",
        detail:
          "local-only instance, past retentionDays, explicit apply — no remote copy exists and none is expected (§15.11.1)",
      });
    }
  }

  // --- the quota pass: first pass that clears the quota wins ---------------
  const localArmSelected = new Set(steps.filter((s) => s.basis === "local_only_expired").map((s) => s.entry.id));
  if (quota.overQuota) {
    let projectedBytes = quota.totalBytes;
    let projectedEntries = quota.entries;
    const alreadyPlanned = new Set(
      steps
        .filter((s) => s.kind === "delete_payload")
        .map((s) => s.entry.id),
    );
    for (const step of steps) {
      if (step.kind !== "delete_payload") continue;
      projectedBytes -= step.entry.sizeBytes;
      projectedEntries -= 1;
    }

    // Ordering key 2: remaining remote-confirmed, oldest first.
    for (const entry of remoteConfirmed) {
      if (projectedBytes <= quota.maxTotalBytes && projectedEntries <= quota.maxEntries) break;
      if (alreadyPlanned.has(entry.id)) continue;
      if (entry.pinned) continue;
      if (!hasVerifier) {
        continue;
      }
      alreadyPlanned.add(entry.id);
      projectedBytes -= entry.sizeBytes;
      projectedEntries -= 1;
      steps.push({
        entry,
        kind: "delete_payload",
        basis: "remote_confirmed_over_quota",
        detail: "over quota — remote-confirmed, oldest first, re-verified live at deletion time",
      });
    }

    // Step 3: un-uploaded entries are re-uploaded, NEVER deleted.
    for (const entry of unuploadedEntries) {
      if (projectedBytes <= quota.maxTotalBytes && projectedEntries <= quota.maxEntries) break;
      if (alreadyPlanned.has(entry.id)) continue;
      if (entry.pinned) continue;
      steps.push({
        entry,
        kind: "retry_upload",
        basis: "unuploaded_retry",
        detail: "over quota — retry the upload; an un-uploaded entry is never deleted to make room",
      });
    }
  } else if (!steps.some((s) => s.kind === "delete_payload")) {
    notes.push("within quota and nothing past retention — no sweep actions");
  }

  // Step 4: still over quota with nothing but un-uploaded entries left → stop,
  // warn, refuse new captures. Deleting them is exactly what must not happen.
  let blocked: RetentionPlan["blocked"] = null;
  if (quota.overQuota) {
    const deletable = steps.filter((s) => s.kind === "delete_payload");
    const deletableBytes = deletable.reduce((sum, s) => sum + s.entry.sizeBytes, 0);
    const deletableCount = deletable.length;
    const projectedBytes = quota.totalBytes - deletableBytes;
    const projectedEntries = quota.entries - deletableCount;
    if (projectedBytes > quota.maxTotalBytes || projectedEntries > quota.maxEntries) {
      blocked = {
        reason: "quota_exceeded",
        detail:
          `over quota and the only remaining entries are un-uploaded (or pinned/restoring): ` +
          `projected ${projectedBytes}/${quota.maxTotalBytes} bytes, ${projectedEntries}/${quota.maxEntries} entries — ` +
          "new captures are refused until the uploads catch up",
      };
    }
  }

  // --- the floor: never take un-uploaded entries below minUnuploadedKeep ----
  const floor = config.retention.minUnuploadedKeep;
  let takenUnuploaded = 0;
  const floorAdjusted: SweepStep[] = [];
  for (const step of steps) {
    const isUnuploadedDeletion = step.kind === "delete_payload" && step.entry.remote === null;
    if (!isUnuploadedDeletion) {
      floorAdjusted.push(step);
      continue;
    }
    const remainingAfter = unuploaded - takenUnuploaded - 1;
    if (remainingAfter < floor) {
      if (!localArmSelected.has(step.entry.id)) {
        floorAdjusted.push(step);
        continue;
      }
      floorAdjusted.push({
        entry: step.entry,
        kind: "keep",
        basis: "unuploaded_floor",
        detail: `retention.minUnuploadedKeep (${floor}) would be breached — ${remainingAfter} would remain`,
      });
      continue;
    }
    takenUnuploaded += 1;
    floorAdjusted.push(step);
  }

  // --- completeness: every staged entry gets exactly one stated decision ----
  // A plan that silently omits entries cannot be audited, and "we did nothing
  // and said nothing" reads identically to "we forgot". The first decision
  // already recorded for an entry wins (`dedupeSteps` keeps the earliest).
  const decided = new Set(floorAdjusted.map((step) => step.entry.id));
  for (const entry of staged) {
    if (decided.has(entry.id)) continue;
    if (entry.pinned) {
      floorAdjusted.push({ entry, kind: "keep", basis: "pinned", detail: "pinned entries are never evicted" });
      continue;
    }
    if (!isExpired(entry.expiresAt, now)) {
      floorAdjusted.push({ entry, kind: "keep", basis: "not_expired", detail: "inside its retention window" });
      continue;
    }
    floorAdjusted.push({
      entry,
      kind: "keep",
      basis: "quota_ok",
      detail:
        entry.remote === null
          ? "past retentionDays with no remote copy: in a hosted instance the clock never deletes it (§15.11.1) — the upload is what clears it"
          : "past retentionDays and within quota, with room left — nothing needed for it in this pass",
    });
  }

  if (unuploaded > 0 && unuploaded <= floor && mode === "local") {
    notes.push(
      `minUnuploadedKeep=${floor} and only ${unuploaded} un-uploaded entr${unuploaded === 1 ? "y" : "ies"}: ` +
        "a local-only instance below the floor can expire nothing (this is the floor working, not a bug)",
    );
  }

  return {
    steps: dedupeSteps(floorAdjusted),
    quota,
    unuploaded,
    uploadable: unuploadedEntries.length,
    // Counted from the entries themselves, not from the steps: every staged
    // pinned entry is protected whether or not this pass had a reason to look
    // at it.
    pinned: staged.filter((entry) => entry.pinned).length,
    expiredRemoteConfirmed,
    expiredLocalOnly,
    blocked,
    notes,
  };
}

/** One step per entry: the first decision that applies wins. */
function dedupeSteps(steps: SweepStep[]): SweepStep[] {
  const seen = new Set<string>();
  const out: SweepStep[] = [];
  for (const step of steps) {
    if (seen.has(step.entry.id)) continue;
    seen.add(step.entry.id);
    out.push(step);
  }
  return out;
}
