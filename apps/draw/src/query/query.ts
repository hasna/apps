/**
 * Read only board queries. {@link listCards} applies a {@link CardQuery} filter
 * and a {@link CardSort}, always floating pinned cards to the top (Keep style).
 * Results are deep copied so callers cannot mutate board state.
 */
import type {
  Board,
  BoardStats,
  Card,
  CardColor,
  CardQuery,
  CardSort,
} from "../types/index.js";
import { CARD_COLORS, cloneCard } from "../model/card.js";

function matches(card: Card, query: CardQuery): boolean {
  if (query.kind !== undefined && card.kind !== query.kind) return false;
  if (query.color !== undefined && card.color !== query.color) return false;
  if (query.label !== undefined && !card.labels.includes(query.label)) return false;
  if (query.pinned !== undefined && card.pinned !== query.pinned) return false;

  // Archived defaults to hidden. Explicit true shows only archived.
  const wantArchived = query.archived === true;
  if (card.archived !== wantArchived) return false;

  if (query.search !== undefined && query.search.length > 0) {
    const term = query.search.toLowerCase();
    const haystack = `${card.title ?? ""}\n${card.text ?? ""}`.toLowerCase();
    if (!haystack.includes(term)) return false;
  }
  return true;
}

function compare(a: Card, b: Card, sort: CardSort): number {
  switch (sort) {
    case "updated":
      return b.updatedAt.localeCompare(a.updatedAt);
    case "created":
      return b.createdAt.localeCompare(a.createdAt);
    case "order":
    default:
      return a.order - b.order;
  }
}

/**
 * Return the cards matching `query`, sorted by `sort` (default "order") with
 * pinned cards always first.
 */
export function listCards(board: Board, query: CardQuery = {}, sort: CardSort = "order"): Card[] {
  const filtered = board.cards.filter((card) => matches(card, query));
  const sorted = [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return compare(a, b, sort);
  });
  return sorted.map(cloneCard);
}

/**
 * Free text search across title and note text of non archived cards, ordered by
 * most recently updated.
 */
export function searchBoard(board: Board, term: string): Card[] {
  return listCards(board, { search: term }, "updated");
}

/** Aggregate counts for a board, including a per color breakdown. */
export function boardStats(board: Board): BoardStats {
  const colors = Object.fromEntries(CARD_COLORS.map((c) => [c, 0])) as Record<CardColor, number>;
  let notes = 0;
  let drawings = 0;
  let pinned = 0;
  let archived = 0;
  for (const card of board.cards) {
    if (card.kind === "note") notes++;
    else drawings++;
    if (card.pinned) pinned++;
    if (card.archived) archived++;
    colors[card.color]++;
  }
  return {
    total: board.cards.length,
    notes,
    drawings,
    pinned,
    archived,
    colors,
  };
}
