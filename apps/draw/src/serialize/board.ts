/**
 * JSON serialization and structural validation for boards. Boards persist in a
 * versioned {@link BoardDocument} envelope; {@link parseBoard} accepts either the
 * envelope or a bare board (string or object) and coerces missing fields.
 */
import { nanoid } from "nanoid";
import type { Board, BoardDocument, Card } from "../types/index.js";
import { validateCard } from "../model/card.js";

export const BOARD_SCHEMA = "hasna.draw.board";
export const BOARD_VERSION = 1 as const;

/** Wrap a board in the versioned document envelope. */
export function toBoardDocument(board: Board): BoardDocument {
  return { schema: BOARD_SCHEMA, version: BOARD_VERSION, board };
}

/** Serialize a board to a JSON string (optionally pretty printed). */
export function serializeBoard(board: Board, pretty = false): string {
  return JSON.stringify(toBoardDocument(board), null, pretty ? 2 : undefined);
}

/** A structural, throwing error used by {@link validateBoard}. */
export class BoardValidationError extends Error {
  constructor(message: string) {
    super(`Invalid board: ${message}`);
    this.name = "BoardValidationError";
  }
}

/** Validate an unknown value as a {@link Board}, coercing defaults. */
export function validateBoard(value: unknown): Board {
  if (typeof value !== "object" || value === null) {
    throw new BoardValidationError("not an object");
  }
  const b = value as Record<string, unknown>;
  const rawCards = Array.isArray(b.cards) ? b.cards : [];
  const cards: Card[] = rawCards.map((c, i) => validateCard(c, i));
  const now = new Date().toISOString();
  const board: Board = {
    id: typeof b.id === "string" && b.id.length > 0 ? b.id : nanoid(),
    cards,
    createdAt: typeof b.createdAt === "string" ? b.createdAt : now,
    updatedAt: typeof b.updatedAt === "string" ? b.updatedAt : now,
  };
  if (typeof b.title === "string") board.title = b.title;
  return board;
}

/**
 * Parse a JSON string or object (envelope or bare board) into a board. Throws
 * {@link BoardValidationError} on structurally invalid input.
 */
export function parseBoard(input: string | BoardDocument | Board | unknown): Board {
  let raw: unknown;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (error) {
      throw new BoardValidationError(`not valid JSON (${(error as Error).message})`);
    }
  } else {
    raw = input;
  }
  const candidate =
    raw && typeof raw === "object" && "board" in raw
      ? (raw as { board: unknown }).board
      : raw;
  return validateBoard(candidate);
}
