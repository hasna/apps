/**
 * The high level {@link BoardModel} wrapper: a stateful, chainable convenience
 * API over the pure functional core (card factories, board ops, query, and
 * serialization).
 *
 * Note the split, mirroring open-docs (`DocJSON` data vs the `Document` class):
 * the plain serializable board shape is the {@link Board} interface, which the
 * functional ops, query, serialization, and React props all use; this class is
 * the ergonomic wrapper returned by {@link createBoard} / {@link loadBoard}.
 */
import { nanoid } from "nanoid";
import type {
  AddDrawingInput,
  AddNoteInput,
  Board,
  BoardStats,
  Card,
  CardColor,
  CardPatch,
  CardQuery,
  CardSort,
  CreateBoardOptions,
} from "../types/index.js";
import { cloneCard, drawing, note } from "./card.js";
import {
  addCard,
  archiveCard,
  deleteCard,
  pinCard,
  reorderCard,
  setCardColor,
  updateCard,
} from "../ops/cards.js";
import { boardStats, listCards } from "../query/query.js";
import { parseBoard, serializeBoard } from "../serialize/board.js";

/** A board of note and drawing cards. */
export class BoardModel {
  private board: Board;

  constructor(board: Board) {
    this.board = board;
  }

  // --- Factories -----------------------------------------------------------

  /** Create a new, empty board. */
  static create(options: CreateBoardOptions = {}): BoardModel {
    const now = new Date().toISOString();
    const board: Board = {
      id: options.id ?? nanoid(),
      cards: [],
      createdAt: now,
      updatedAt: now,
    };
    if (options.title !== undefined) board.title = options.title;
    return new BoardModel(board);
  }

  /** Load a board from a serialized document, bare board object, or JSON string. */
  static fromJSON(json: unknown): BoardModel {
    return new BoardModel(parseBoard(json));
  }

  // --- Serialization -------------------------------------------------------

  /** Return a deep copy of the underlying board data. */
  toJSON(): Board {
    return {
      ...this.board,
      cards: this.board.cards.map(cloneCard),
    };
  }

  /** Serialize the board to a JSON string. */
  serialize(pretty = false): string {
    return serializeBoard(this.board, pretty);
  }

  // --- Reads ---------------------------------------------------------------

  /** The board id. */
  get id(): string {
    return this.board.id;
  }

  /** The board title, if any. */
  get title(): string | undefined {
    return this.board.title;
  }

  /** All cards (deep copied). */
  get cards(): Card[] {
    return this.board.cards.map(cloneCard);
  }

  /** Look up a single card by id (deep copied), or undefined. */
  card(id: string): Card | undefined {
    const found = this.board.cards.find((c) => c.id === id);
    return found ? cloneCard(found) : undefined;
  }

  /** Query cards with an optional filter and sort. */
  query(q: CardQuery = {}, sort: CardSort = "order"): Card[] {
    return listCards(this.board, q, sort);
  }

  /** Aggregate counts for the board. */
  stats(): BoardStats {
    return boardStats(this.board);
  }

  // --- Mutations (chainable) -----------------------------------------------

  /** Add a note card. */
  addNote(input: AddNoteInput = {}): this {
    this.board = addCard(this.board, note(input));
    return this;
  }

  /** Add a drawing card. */
  addDrawing(input: AddDrawingInput = {}): this {
    this.board = addCard(this.board, drawing(input));
    return this;
  }

  /** Apply a patch to a card. */
  update(id: string, patch: CardPatch): this {
    this.board = updateCard(this.board, id, patch);
    return this;
  }

  /** Remove a card. */
  remove(id: string): this {
    this.board = deleteCard(this.board, id);
    return this;
  }

  /** Move a card to a new index in the ordered list. */
  reorder(id: string, toIndex: number): this {
    this.board = reorderCard(this.board, id, toIndex);
    return this;
  }

  /** Set or toggle a card's pinned flag. */
  pin(id: string, pinned?: boolean): this {
    this.board = pinCard(this.board, id, pinned);
    return this;
  }

  /** Set or toggle a card's archived flag. */
  archive(id: string, archived?: boolean): this {
    this.board = archiveCard(this.board, id, archived);
    return this;
  }

  /** Set a card's color. */
  setColor(id: string, color: CardColor): this {
    this.board = setCardColor(this.board, id, color);
    return this;
  }

  /** A detached deep copy of this board. */
  clone(): BoardModel {
    return new BoardModel(this.toJSON());
  }
}

/** Functional alias for {@link BoardModel.create}. */
export function createBoard(options: CreateBoardOptions = {}): BoardModel {
  return BoardModel.create(options);
}

/** Functional alias for {@link BoardModel.fromJSON}. */
export function loadBoard(json: unknown): BoardModel {
  return BoardModel.fromJSON(json);
}
