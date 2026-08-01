/**
 * Builds the {@link AssigneeContext} that `validateAssignee` consumes, and
 * caches it briefly.
 *
 * `assignee-validation.ts` is deliberately pure and does no IO. This module is
 * the IO half, kept separate so the validator stays trivially testable.
 *
 * WHY THE CACHE EXISTS. Validation needs the agent roster, and on this fleet
 * that is a ~710KB / ~2.4s fetch against the cloud store. The one-shot CLI pays
 * it once and does not care. The MCP server is LONG-LIVED and validates on
 * every create/update/upsert, so a 50-task bulk upsert — the loop-driven path —
 * would refetch ~35MB. Found in adversarial review of todos 056f3597.
 *
 * The TTL is deliberately short. An agent that registers during the window is
 * invisible for at most that long, and the only consequence is a WARNING on an
 * assignee that is in fact valid — never a refusal, because the refusing tiers
 * (seat, ambiguous) cannot be created by a registration the cache missed:
 * a new seat requires an owner ruling and a roster edit, and a name becoming
 * ambiguous only ever ADDS a row, which at worst delays the refusal by the TTL.
 */
import type { AssigneeContext, KnownAgent } from "./assignee-validation.js";
import { loadSeatSlugs } from "./assignee-validation.js";

/** How long a fetched roster stays usable. Short by design — see above. */
const ROSTER_TTL_MS = 15_000;

interface CachedRoster {
  at: number;
  agents: KnownAgent[];
  seats: Set<string>;
  /** True when the agent list could not be fetched and is therefore empty. */
  degraded: boolean;
}

let cache: CachedRoster | undefined;

/** Drop the cache. For tests, and for any caller that has just mutated agents. */
export function resetAssigneeContextCache(): void {
  cache = undefined;
}

/**
 * Fetch (or reuse) the agent roster and seat list.
 *
 * `listAgentsFn` is injected rather than imported so this module does not pull
 * `bun:sqlite` into every consumer's module graph — the same constraint that
 * keeps `agent-name-normalize.ts` import-free.
 */
export async function loadAssigneeContext(
  listAgentsFn: () => Promise<Array<{ id: string; name: string }>> | Array<{ id: string; name: string }>,
  allowSeat: boolean,
  nowMs: number = Date.now(),
): Promise<AssigneeContext & { degraded: boolean }> {
  if (!cache || nowMs - cache.at >= ROSTER_TTL_MS) {
    let agents: Array<{ id: string; name: string }>;
    let degraded = false;
    try {
      agents = await listAgentsFn();
    } catch {
      // VALIDATION MUST NEVER TURN A WORKING ASSIGNMENT INTO A FAILURE.
      //
      // This guard is advisory. Fetching the roster added a NEW dependency to
      // the cloud assign path (`GET /v1/agents`), and on the first version of
      // this change a 404 there made `todos assign` exit 1 — caught by CI on
      // hasna/todos#146, where a synthetic /v1 fixture did not serve that
      // route. A server that lacks the endpoint, or a transient failure, is a
      // capability gap; it is not a reason to refuse to assign work.
      //
      // Degrading is SILENT on purpose, and the reasoning is narrow: if the
      // API is genuinely down, the assign's own calls (GET the task, PATCH it)
      // fail immediately afterwards and report it. So a warning here would
      // either duplicate that, or fire on every assign against a server whose
      // only fault is not exposing one optional read. The seat rule is
      // unaffected — it reads a local file — and the seat rule is the one
      // backed by an owner directive.
      agents = [];
      degraded = true;
    }
    cache = {
      at: nowMs,
      agents: agents.map((a) => ({ id: a.id, name: a.name })),
      seats: loadSeatSlugs(),
      degraded,
    };
  }
  return { agents: cache.agents, seats: cache.seats, allowSeat, degraded: cache.degraded };
}
