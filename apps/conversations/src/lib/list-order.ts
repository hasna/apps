/**
 * ONE source for "which rows did you just hand me".
 *
 * Every list verb in this CLI told a reader HOW MANY rows it returned and never
 * WHICH rows. `read --limit 40` returns the OLDEST 40, and nothing on either
 * surface said so. Seven consequences were measured on this fleet in a single
 * day, including an incident blast-radius count that omitted the entire window
 * under investigation and a liveness check that read the START of a window and
 * reported it as current.
 *
 * The obvious fix — print "sort=created_at asc" in the footer — is a lie
 * waiting to happen: the string sits next to the ORDER BY it describes and
 * nothing stops the two drifting, and a test that greps for the word "sort"
 * passes against a hardcoded string forever. So the ORDER BY clauses are BUILT
 * from these descriptors. A wrong descriptor produces a wrong query, and the
 * ordering assertions fail loudly instead of the disclosure lying quietly.
 *
 * Ordering is a property of the STORE, not of the CLI: `searchMessages` sorts
 * by FTS relevance on LocalStore and by `created_at DESC` on ApiStore, so the
 * descriptor is asked of the store rather than assumed by the caller.
 */

export type SortDirection = "asc" | "desc";

export interface SortDescriptor {
  /** The column or ranking the rows are ordered by, as a reader would name it. */
  sort: string;
  direction: SortDirection;
}

/**
 * The disclosure string, in the shape `knowledge list` already prints
 * (`sort=created asc`). Copied rather than invented so the two CLIs read the
 * same way.
 */
export function formatSortDescriptor(descriptor: SortDescriptor): string {
  return `sort=${descriptor.sort} ${descriptor.direction}`;
}

export function normalizeSortDirection(value: unknown): SortDirection {
  return String(value ?? "").toLowerCase() === "desc" ? "desc" : "asc";
}

function sqlDirection(direction: SortDirection): "ASC" | "DESC" {
  return direction === "desc" ? "DESC" : "ASC";
}

/** The message tables are ordered by creation time, with the id as tie-break. */
export const MESSAGE_SORT_FIELD = "created_at";

export function describeMessageOrder(direction: SortDirection | string | undefined): SortDescriptor {
  return { sort: MESSAGE_SORT_FIELD, direction: normalizeSortDirection(direction) };
}

/**
 * The ordering `readMessages` will ACTUALLY apply for a given query.
 *
 * `latest: N` overrides `order` to DESC in both stores (`messages.ts`,
 * `api-store.ts`), and a disclosure derived from `order` alone therefore states
 * the exact opposite of what ran. That is not hypothetical: measured over a live
 * MCP session, `read_messages{latest:3}` returned ids 6,5,4 — strictly
 * descending — while disclosing `created_at asc`. Replacing silence with a
 * FALSE statement is worse than the silence, because a reader now has a warrant
 * to trust rows they would otherwise have checked.
 *
 * Every surface that discloses a message read must go through here rather than
 * reading `order` itself. `src/mcp/message-order.test.ts` asserts this function
 * against real returned row order, so the rule cannot drift from the query
 * without a test failing.
 */
export function describeReadMessagesOrder(opts: { latest?: unknown; order?: unknown }): SortDescriptor {
  const latest = typeof opts.latest === "number" ? opts.latest : Number(opts.latest);
  const isLatest = Number.isFinite(latest) && latest > 0;
  return describeMessageOrder(isLatest ? "desc" : (opts.order as string | undefined));
}

/**
 * `ORDER BY created_at <dir>, id <dir>` built from the descriptor above.
 * `prefix` carries the table alias for the joined FTS query (`m.`).
 */
export function messageOrderByClause(direction: SortDirection | string | undefined, prefix = ""): string {
  const dir = sqlDirection(normalizeSortDirection(direction));
  return `ORDER BY ${prefix}${MESSAGE_SORT_FIELD} ${dir}, ${prefix}id ${dir}`;
}

/** `ORDER BY <field> <dir>` for the single-column listing queries. */
export function simpleOrderByClause(descriptor: SortDescriptor, prefix = ""): string {
  return `ORDER BY ${prefix}${descriptor.sort} ${sqlDirection(descriptor.direction)}`;
}

export const CHANNEL_LIST_ORDER: SortDescriptor = { sort: "name", direction: "asc" };
export const AGENT_LIST_ORDER: SortDescriptor = { sort: "last_seen_at", direction: "desc" };

/** FTS5 BM25 rank, boosted by priority/pinned/blocking. Best match first. */
export const SEARCH_RELEVANCE_ORDER: SortDescriptor = { sort: "relevance", direction: "desc" };
/** `search --sort recent`, and the only ordering the HTTP API offers for search. */
export const SEARCH_RECENT_ORDER: SortDescriptor = { sort: MESSAGE_SORT_FIELD, direction: "desc" };

/** `pinned` — most recently pinned first. */
export const PINNED_LIST_ORDER: SortDescriptor = { sort: "pinned_at", direction: "desc" };
/** `blockers` — oldest unanswered blocker first; a backlog, not a recency window. */
export const BLOCKERS_LIST_ORDER: SortDescriptor = { sort: "created_at", direction: "asc" };
/** `locks list` — longest-held lock first. */
export const LOCKS_LIST_ORDER: SortDescriptor = { sort: "locked_at", direction: "asc" };
/** `projects list` — alphabetical. */
export const PROJECT_LIST_ORDER: SortDescriptor = { sort: "name", direction: "asc" };
/** `sessions` — most recently active session first. */
export const SESSION_LIST_ORDER: SortDescriptor = { sort: "last_message_at", direction: "desc" };
/** `channel members` — earliest joiner first. */
export const CHANNEL_MEMBER_ORDER: SortDescriptor = { sort: "joined_at", direction: "asc" };
/** `channel notifications list --agent <a>` — earliest subscription first. */
export const CHANNEL_SUBSCRIPTION_AGENT_ORDER: SortDescriptor = { sort: "created_at", direction: "asc" };
/** `channel notifications list` across all agents — grouped by agent name. */
export const CHANNEL_SUBSCRIPTION_ALL_ORDER: SortDescriptor = { sort: "agent", direction: "asc" };

/** The list surfaces whose ordering a caller can ask a store to describe. */
export type ListOrderKind = "messages" | "search" | "channels" | "agents";
