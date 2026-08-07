import type { Loop, LoopStatus } from "../types.js";
import { CodedError } from "./errors.js";
import type { LoopStore } from "./store/index.js";

/**
 * One paged read of the loop collection, shared by every caller that needs the
 * whole set rather than a window (task 886f12b7).
 *
 * This lived in the CLI, so `loops list` paged correctly while `loops health`
 * made a single unpaged call against the same endpoint and presented the first
 * page as the fleet. The asymmetry was the defect; a second implementation
 * would have been the same defect with two places to fix it.
 *
 * Raising the limit is NOT an alternative to paging: the API clamps `limit` to
 * MAX_PAGE_LIMIT (1000) in `optionalLimit` and returns the truncated page with
 * no signal, so a caller asking for 100_000 silently receives 1000 and cannot
 * tell that from a complete answer.
 */
export const LOOP_LIST_PAGE_SIZE = 200;
export const LOOP_LIST_MAX_PAGES = 1_000;
export const LOOP_LIST_MAX_ITEMS = 100_000;

export type LoopListOptions = NonNullable<Parameters<LoopStore["listLoops"]>[0]>;

export function loopListPaginationError(reason: string): CodedError {
  return new CodedError("LOOP_LIST_PAGINATION_FAILED", `loop list pagination failed: ${reason}`);
}

/**
 * Read every loop matching `opts`, following offsets until a short page.
 *
 * The guards are not decoration: a backend that repeats a page, returns a loop
 * with no id, or fails to advance its offset would otherwise produce either an
 * infinite loop or a confidently wrong set. Each one throws rather than
 * returning a plausible partial answer.
 */
export async function listAllLoops(
  store: LoopStore,
  opts: Omit<LoopListOptions, "limit" | "offset"> = {},
): Promise<Loop[]> {
  const loops: Loop[] = [];
  const seenIds = new Set<string>();
  let offset = 0;
  let pageCount = 0;
  let previousPageIds: string[] | undefined;
  while (true) {
    if (pageCount >= LOOP_LIST_MAX_PAGES) {
      throw loopListPaginationError(`exceeded the ${LOOP_LIST_MAX_PAGES}-page safety ceiling`);
    }
    const page = await store.listLoops({
      ...opts,
      limit: LOOP_LIST_PAGE_SIZE,
      offset,
    });
    pageCount += 1;
    if (page.length === 0) return loops;

    const pageIds = page.map((loop) => loop.id);
    if (
      previousPageIds?.length === pageIds.length &&
      pageIds.every((id, index) => id === previousPageIds![index])
    ) {
      throw loopListPaginationError("the backend repeated a page");
    }

    let newIds = 0;
    for (const loop of page) {
      if (typeof loop.id !== "string" || loop.id.length === 0) {
        throw loopListPaginationError("the backend returned a loop without a usable id");
      }
      if (seenIds.has(loop.id)) continue;
      seenIds.add(loop.id);
      loops.push(loop);
      newIds += 1;
      if (loops.length > LOOP_LIST_MAX_ITEMS) {
        throw loopListPaginationError(`exceeded the ${LOOP_LIST_MAX_ITEMS}-item safety ceiling`);
      }
    }
    if (newIds === 0) throw loopListPaginationError("a page contained no new loop ids");
    if (page.length < LOOP_LIST_PAGE_SIZE) return loops;

    const nextOffset = offset + page.length;
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) {
      throw loopListPaginationError("the backend did not advance the page offset");
    }
    previousPageIds = pageIds;
    offset = nextOffset;
  }
}

/**
 * Read every loop in each of `statuses`, one paged server-side query per status.
 *
 * Asking the server for the statuses we want is what makes row ordering
 * irrelevant. A single unfiltered read has to rely on ineligible loops happening
 * to sort last — and they do not: LoopStatus sorts
 * active < expired < paused < stopped under the `status ASC` ordering both
 * stores use, so expired loops sit between the two statuses health cares about.
 */
export async function listAllLoopsByStatus(
  store: LoopStore,
  statuses: readonly LoopStatus[],
  opts: Omit<LoopListOptions, "limit" | "offset" | "status"> = {},
): Promise<Loop[]> {
  const loops: Loop[] = [];
  const seenIds = new Set<string>();
  for (const status of statuses) {
    for (const loop of await listAllLoops(store, { ...opts, status })) {
      if (seenIds.has(loop.id)) continue;
      seenIds.add(loop.id);
      loops.push(loop);
    }
  }
  return loops;
}
