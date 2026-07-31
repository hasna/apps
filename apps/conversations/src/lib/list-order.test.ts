import { describe, expect, test } from "bun:test";
import {
  AGENT_LIST_ORDER,
  CHANNEL_LIST_ORDER,
  SEARCH_RECENT_ORDER,
  SEARCH_RELEVANCE_ORDER,
  describeMessageOrder,
  formatSortDescriptor,
  messageOrderByClause,
  simpleOrderByClause,
} from "./list-order.js";

/**
 * The disclosure and the query it describes must come from ONE source.
 *
 * A footer that prints a hardcoded "sort=created_at asc" passes any test that
 * only greps for the word "sort", and keeps passing after someone changes the
 * ORDER BY. These tests exist so the descriptor and the SQL cannot drift: the
 * clause is BUILT from the descriptor, so a wrong descriptor produces a wrong
 * query and every ordering test fails loudly.
 */
describe("list order descriptors", () => {
  test("message order descriptor and its SQL clause agree in both directions", () => {
    expect(describeMessageOrder("asc")).toEqual({ sort: "created_at", direction: "asc" });
    expect(describeMessageOrder("desc")).toEqual({ sort: "created_at", direction: "desc" });

    expect(messageOrderByClause("asc")).toBe("ORDER BY created_at ASC, id ASC");
    expect(messageOrderByClause("desc")).toBe("ORDER BY created_at DESC, id DESC");
    expect(messageOrderByClause("desc", "m.")).toBe("ORDER BY m.created_at DESC, m.id DESC");
  });

  test("listing descriptors match the clauses their queries use", () => {
    expect(CHANNEL_LIST_ORDER).toEqual({ sort: "name", direction: "asc" });
    expect(simpleOrderByClause(CHANNEL_LIST_ORDER, "c.")).toBe("ORDER BY c.name ASC");

    expect(AGENT_LIST_ORDER).toEqual({ sort: "last_seen_at", direction: "desc" });
    expect(simpleOrderByClause(AGENT_LIST_ORDER)).toBe("ORDER BY last_seen_at DESC");
  });

  test("search has two orderings and they are not the same descriptor", () => {
    expect(SEARCH_RELEVANCE_ORDER).toEqual({ sort: "relevance", direction: "desc" });
    expect(SEARCH_RECENT_ORDER).toEqual({ sort: "created_at", direction: "desc" });
    expect(SEARCH_RELEVANCE_ORDER).not.toEqual(SEARCH_RECENT_ORDER);
  });

  test("formatSortDescriptor renders the knowledge-list shape", () => {
    expect(formatSortDescriptor({ sort: "created_at", direction: "asc" })).toBe("sort=created_at asc");
    expect(formatSortDescriptor(AGENT_LIST_ORDER)).toBe("sort=last_seen_at desc");
  });
});
