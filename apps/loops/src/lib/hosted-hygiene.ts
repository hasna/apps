import type { Loop } from "../types.js";
import type { HostedBackend, UncheckedItem } from "./hosted-diagnostics.js";
import { hostedBackend } from "./hosted-diagnostics.js";
import type { HygieneLoopSource } from "./hygiene.js";
import type { LoopStore } from "./store/index.js";

/**
 * The `loops hygiene …` checks against the hosted control plane.
 *
 * These four checks (canonical names, duplicate/overlap groups, script-backed
 * loops, and the todos routing of their findings) are pure analyses over the
 * loop inventory. They were refused on a hosted connection and ran against the
 * on-box sqlite file instead, so on this fleet — where the loops live in the
 * control plane — they reported on the wrong population.
 *
 * The classifiers are unchanged and shared: only the inventory's source
 * differs. The page cap is reported in `unchecked` rather than implied, because
 * "no duplicates found" over a truncated inventory is not "no duplicates".
 */

/** Page size for the hosted inventory sweep; matches the CLI's list page size. */
const PAGE_SIZE = 200;
/** Hard ceiling on the hosted inventory sweep, mirroring the builders' own 10k bound. */
const MAX_LOOPS = 10_000;

export interface HostedHygieneInventory {
  backend: HostedBackend;
  source: HygieneLoopSource;
  /** Loops actually fetched, after de-duplication by id. */
  fetched: number;
  unchecked: UncheckedItem[];
}

/**
 * A {@link HygieneLoopSource} over an already-fetched loop inventory.
 *
 * `renameLoop` is deliberately absent: renames go through the async hosted
 * client in the caller, so a hosted `--apply` can never silently no-op.
 */
class HostedLoopInventory implements HygieneLoopSource {
  constructor(private readonly loops: Loop[]) {}

  listLoops(opts: { includeArchived?: boolean; limit?: number } = {}): Loop[] {
    const scoped = opts.includeArchived ? this.loops : this.loops.filter((loop) => !loop.archivedAt);
    return scoped.slice(0, opts.limit ?? scoped.length);
  }
}

/**
 * Fetch the loop inventory the hygiene checks read, including archived loops
 * (the name check needs every existing name to guarantee uniqueness).
 */
export async function hostedHygieneInventory(store: LoopStore): Promise<HostedHygieneInventory> {
  const loops: Loop[] = [];
  const seen = new Set<string>();
  const unchecked: UncheckedItem[] = [];
  let offset = 0;
  let capped = false;
  while (true) {
    const page = await store.listLoops({ includeArchived: true, limit: PAGE_SIZE, offset });
    if (page.length === 0) break;
    let added = 0;
    for (const loop of page) {
      if (seen.has(loop.id)) continue;
      seen.add(loop.id);
      loops.push(loop);
      added += 1;
    }
    // A page that adds nothing new means the backend is re-serving rows (the
    // list is ordered by next_run_at, which the scheduler mutates mid-sweep).
    // Stop rather than page forever.
    if (added === 0) break;
    if (loops.length >= MAX_LOOPS) {
      capped = true;
      break;
    }
    if (page.length < PAGE_SIZE) break;
    offset += page.length;
  }
  if (capped) {
    unchecked.push({
      id: "inventory-page-cap",
      reason: `the hosted inventory sweep stopped at ${MAX_LOOPS} loops; loops beyond that window were not inspected, so a finding outside it is not claimed either way.`,
    });
  }
  return { backend: hostedBackend(store), source: new HostedLoopInventory(loops), fetched: loops.length, unchecked };
}

/**
 * Apply canonical-name renames through the hosted client.
 *
 * There is no hosted counterpart to the local pre-apply database backup, so the
 * caller states that rather than implying a snapshot was taken.
 */
export async function applyHostedRenames(
  store: LoopStore,
  changes: Array<{ id: string; newName: string }>,
): Promise<{ renamed: number }> {
  let renamed = 0;
  for (const change of changes) {
    await store.renameLoop(change.id, change.newName);
    renamed += 1;
  }
  return { renamed };
}
