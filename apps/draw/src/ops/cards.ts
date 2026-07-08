/**
 * Pure functional board mutations. Every operation returns a new {@link Board}
 * (the input is never mutated), bumps the relevant `updatedAt` timestamps, and
 * keeps the `order` sort keys dense (0..n-1 in current order).
 */
import type { Board, Card, CardColor, CardPatch } from "../types/index.js";
import { cloneCard } from "../model/card.js";

function nowIso(): string {
  return new Date().toISOString();
}

/** Re-number cards to 0..n-1 following their current `order` (stable). */
function densify(cards: Card[]): Card[] {
  const sorted = [...cards].sort((a, b) => a.order - b.order);
  return sorted.map((card, index) => (card.order === index ? card : { ...card, order: index }));
}

function withCards(board: Board, cards: Card[]): Board {
  return { ...board, cards, updatedAt: nowIso() };
}

/** Append a card to the board (placed last), keeping order dense. */
export function addCard(board: Board, card: Card): Board {
  const next = cloneCard(card);
  next.order = board.cards.length;
  return withCards(board, densify([...board.cards.map(cloneCard), next]));
}

/** Apply a patch to a card by id. Unknown ids leave the board unchanged. */
export function updateCard(board: Board, id: string, patch: CardPatch): Board {
  let found = false;
  const cards = board.cards.map((card) => {
    if (card.id !== id) return cloneCard(card);
    found = true;
    const merged = cloneCard(card);
    if (patch.title !== undefined) merged.title = patch.title;
    if (patch.text !== undefined) merged.text = patch.text;
    if (patch.scene !== undefined) merged.scene = patch.scene;
    if (patch.color !== undefined) merged.color = patch.color;
    if (patch.labels !== undefined) merged.labels = [...patch.labels];
    if (patch.pinned !== undefined) merged.pinned = patch.pinned;
    if (patch.archived !== undefined) merged.archived = patch.archived;
    merged.updatedAt = nowIso();
    // Re-clone so a scene passed in via `patch` cannot mutate board state later.
    return cloneCard(merged);
  });
  if (!found) return board;
  return withCards(board, cards);
}

/** Remove a card by id, re-densifying order. Unknown ids are a no op. */
export function deleteCard(board: Board, id: string): Board {
  if (!board.cards.some((c) => c.id === id)) return board;
  const remaining = board.cards.filter((c) => c.id !== id).map(cloneCard);
  return withCards(board, densify(remaining));
}

/**
 * Move a card to `toIndex` within the order-sorted list. The index is clamped
 * to the valid range; unknown ids leave the board unchanged.
 */
export function reorderCard(board: Board, id: string, toIndex: number): Board {
  const ordered = [...board.cards].sort((a, b) => a.order - b.order).map(cloneCard);
  const from = ordered.findIndex((c) => c.id === id);
  if (from === -1) return board;
  const clamped = Math.max(0, Math.min(toIndex, ordered.length - 1));
  if (from === clamped) return board;
  const [moved] = ordered.splice(from, 1);
  if (!moved) return board;
  ordered.splice(clamped, 0, moved);
  const now = nowIso();
  const renumbered = ordered.map((card, index) =>
    card.order === index ? card : { ...card, order: index, updatedAt: now },
  );
  return withCards(board, renumbered);
}

/** Set (or toggle when `pinned` is omitted) a card's pinned flag. */
export function pinCard(board: Board, id: string, pinned?: boolean): Board {
  const card = board.cards.find((c) => c.id === id);
  if (!card) return board;
  return updateCard(board, id, { pinned: pinned ?? !card.pinned });
}

/** Set (or toggle when `archived` is omitted) a card's archived flag. */
export function archiveCard(board: Board, id: string, archived?: boolean): Board {
  const card = board.cards.find((c) => c.id === id);
  if (!card) return board;
  return updateCard(board, id, { archived: archived ?? !card.archived });
}

/** Set a card's color. */
export function setCardColor(board: Board, id: string, color: CardColor): Board {
  return updateCard(board, id, { color });
}
