import type { DeckData } from "./types.js";
import { parseDeckData } from "./validation.js";

/**
 * Serialize a deck to a JSON string. The result round-trips through
 * {@link deserializeDeck}.
 */
export function serializeDeck(deck: DeckData, pretty = true): string {
  return JSON.stringify(deck, null, pretty ? 2 : undefined);
}

/**
 * Parse and validate a deck from a JSON string or a plain object. Throws if
 * the input is not a well-formed {@link DeckData}.
 */
export function deserializeDeck(input: string | unknown): DeckData {
  const value = typeof input === "string" ? JSON.parse(input) : input;
  return parseDeckData(value);
}

/** Deep-clone a deck (structured, JSON-safe). */
export function cloneDeckData(deck: DeckData): DeckData {
  return JSON.parse(JSON.stringify(deck)) as DeckData;
}
