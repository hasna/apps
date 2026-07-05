import type { AgentWorkflowRole } from "../template-kit.js";

/**
 * Least-loaded auth-profile pool selection + a `--max-per-profile` admission
 * guard. Drain dispatch used to pick a pool member by a pure FNV-1a hash of the
 * work-item seed (worker=pool[i], verifier=i+1, planner=i+2), with no awareness
 * of how many runs each subscription account was already carrying. At high
 * concurrency that stacked several concurrent workers on one ChatGPT account and
 * tripped the provider-side 429/stream-drop wall. This module spreads work to
 * the least-loaded account instead, and defers a route when every pool member is
 * already saturated.
 *
 * The hash order is preserved as the deterministic tie-break: with equal load
 * counts (e.g. a cold store) the selection is byte-for-byte identical to the old
 * behaviour, so it is fully reproducible and does not perturb rendered-template
 * snapshots.
 */

/** FNV-1a index into a pool of `size`. Shared by the deterministic default
 *  (templates) and the least-loaded tie-break so the two never drift. */
export function stableIndex(seed: string, size: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % size;
}

/** Historical per-role offset from the worker index (worker+0, verifier+1,
 *  planner+2, everything else +3). Kept identical to the original rolePoolValue
 *  so equal-load selection reproduces the legacy assignment. */
export function poolRoleOffset(role: AgentWorkflowRole): number {
  if (role === "worker") return 0;
  if (role === "verifier") return 1;
  if (role === "planner") return 2;
  return 3;
}

/**
 * Pick the least-loaded pool member. Selection key, minimised lexicographically:
 *   1. not in `exclude` before excluded (so verifier/planner land on a DIFFERENT
 *      profile than the worker whenever the pool is large enough),
 *   2. lower running-step load,
 *   3. deterministic order starting at `anchor` (first encountered wins ties).
 * When every member is excluded (pool smaller than the number of roles) the
 * exclusion is ignored and pure least-loaded/tie-break applies.
 */
export function selectLeastLoadedProfile(
  pool: string[],
  loadCounts: Record<string, number>,
  anchor: number,
  exclude: ReadonlySet<string>,
): string {
  const size = pool.length;
  let best: string | undefined;
  let bestExcluded = true;
  let bestLoad = Number.POSITIVE_INFINITY;
  for (let k = 0; k < size; k += 1) {
    const profile = pool[(anchor + k) % size]!;
    const excluded = exclude.has(profile);
    const load = loadCounts[profile] ?? 0;
    if (best === undefined) {
      best = profile;
      bestExcluded = excluded;
      bestLoad = load;
      continue;
    }
    // Strictly-better replaces; equal keeps the earlier (deterministic) member.
    const better = excluded === bestExcluded ? load < bestLoad : !excluded && bestExcluded;
    if (better) {
      best = profile;
      bestExcluded = excluded;
      bestLoad = load;
    }
  }
  return best!;
}

export interface PoolAuthProfileAssignmentInput {
  pool: string[];
  seed: string;
  loadCounts: Record<string, number>;
  /** Defer the whole route when EVERY pool member already has >= K running
   *  steps. Undefined disables the guard (spread only, never defer). */
  maxPerProfile?: number;
  /** Roles present in the workflow that draw from the pool. */
  roles: AgentWorkflowRole[];
}

export interface PoolAuthProfileAssignment {
  /** Chosen auth profile per role. Empty when deferred. */
  profiles: Partial<Record<AgentWorkflowRole, string>>;
  /** True when the max-per-profile guard fired: every pool member is saturated. */
  deferred: boolean;
  reason?: string;
  /** Minimum running-step load across the pool at decision time (attribution). */
  minLoad: number;
}

const ROLE_PRIORITY: AgentWorkflowRole[] = ["worker", "verifier", "planner", "triage"];

/**
 * Assign one pool member per role: the worker takes the globally least-loaded
 * account; verifier/planner/triage each take the least-loaded account not
 * already claimed by an earlier role (so reviews run on a different subscription
 * than the work they review). Returns `deferred` when the max-per-profile guard
 * fires so the caller can hold the route until an account frees up.
 */
export function assignPoolAuthProfiles(input: PoolAuthProfileAssignmentInput): PoolAuthProfileAssignment {
  const pool = input.pool.filter((entry) => entry.trim().length > 0);
  if (pool.length === 0) return { profiles: {}, deferred: false, minLoad: 0 };

  const minLoad = pool.reduce((min, profile) => Math.min(min, input.loadCounts[profile] ?? 0), Number.POSITIVE_INFINITY);
  const guard = input.maxPerProfile !== undefined && input.maxPerProfile > 0;
  if (guard && minLoad >= input.maxPerProfile!) {
    return {
      profiles: {},
      deferred: true,
      minLoad,
      reason: `per-profile active limit reached (all ${pool.length} pool members >= ${input.maxPerProfile} running; min ${minLoad})`,
    };
  }

  const workerIndex = stableIndex(input.seed, pool.length);
  const rolesToAssign = ROLE_PRIORITY.filter((role) => input.roles.includes(role));
  // Any roles the caller passed that are not in the canonical priority list keep
  // their deterministic slot (defensive; templates only use the four above).
  for (const role of input.roles) if (!rolesToAssign.includes(role)) rolesToAssign.push(role);

  const profiles: Partial<Record<AgentWorkflowRole, string>> = {};
  const taken = new Set<string>();
  for (const role of rolesToAssign) {
    const anchor = (workerIndex + poolRoleOffset(role)) % pool.length;
    const profile = selectLeastLoadedProfile(pool, input.loadCounts, anchor, taken);
    profiles[role] = profile;
    taken.add(profile);
  }
  return { profiles, deferred: false, minLoad: Number.isFinite(minLoad) ? minLoad : 0 };
}
