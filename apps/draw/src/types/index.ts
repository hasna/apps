/**
 * All domain types for @hasna/draw.
 *
 * The model is intentionally plain data: a {@link Board} holds {@link Card}s,
 * each card is either a text {@link CardKind} "note" or a "drawing" backed by a
 * {@link DrawScene}. The scene is renderer free, so the core carries no canvas
 * or drawing engine dependency; the {@link DrawElement} shape maps cleanly onto
 * Excalidraw for interchange.
 */

// ---- Card -----------------------------------------------------------------

export type CardKind = "note" | "drawing";

/** Keep style label palette. Consumers map these tokens to CSS. */
export type CardColor =
  | "default"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "blue"
  | "purple"
  | "pink"
  | "gray";

export interface Card {
  id: string;
  kind: CardKind;
  title?: string;
  /** Note body. Plain text with newlines. Present for kind "note". */
  text?: string;
  /** Freehand scene. Present for kind "drawing". */
  scene?: DrawScene;
  color: CardColor;
  labels: string[];
  pinned: boolean;
  archived: boolean;
  /** Sort key within the board (lower comes earlier). */
  order: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

// ---- Board ----------------------------------------------------------------

export interface Board {
  id: string;
  title?: string;
  cards: Card[];
  createdAt: string;
  updatedAt: string;
}

/** Versioned persistence envelope (mirrors the open-sheets WorkbookDocument). */
export interface BoardDocument {
  schema: "hasna.draw.board";
  version: 1;
  board: Board;
}

// ---- Drawing scene --------------------------------------------------------
// Portable, renderer free, Excalidraw compatible interchange.

export type DrawElementType =
  | "freedraw"
  | "line"
  | "arrow"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "text";

/** A point relative to the element origin (x,y). */
export type ScenePoint = [number, number];

export type FillStyle = "solid" | "hachure" | "cross-hatch" | "zigzag" | "transparent";

export interface DrawElement {
  id: string;
  type: DrawElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: FillStyle;
  strokeWidth?: number;
  roughness?: number;
  opacity?: number;
  seed?: number;
  /** For freedraw/line/arrow. */
  points?: ScenePoint[];
  /** Per point pen pressure, freedraw only. */
  pressures?: number[];
  /** For text elements. */
  text?: string;
  fontSize?: number;
  fontFamily?: number;
}

/** Normalized scene. Just data: no canvas, no renderer dependency. */
export interface DrawScene {
  schema: "hasna.draw.scene";
  version: 1;
  elements: DrawElement[];
  background?: string;
  width?: number;
  height?: number;
}

/** Axis aligned bounding box, as returned by {@link sceneBounds}. */
export interface SceneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---- Excalidraw interchange ----------------------------------------------

/** A single element in an Excalidraw file. Only the fields we map are typed. */
export interface ExcalidrawElement {
  id?: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  angle?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  roughness?: number;
  opacity?: number;
  seed?: number;
  points?: number[][];
  pressures?: number[];
  text?: string;
  fontSize?: number;
  fontFamily?: number;
  [key: string]: unknown;
}

/** The `.excalidraw` file envelope produced by {@link toExcalidraw}. */
export interface ExcalidrawFile {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: ExcalidrawElement[];
  appState: {
    viewBackgroundColor?: string;
    [key: string]: unknown;
  };
  files: Record<string, unknown>;
}

// ---- Options / query / stats ----------------------------------------------

export interface CreateBoardOptions {
  id?: string;
  title?: string;
}

export interface AddNoteInput {
  title?: string;
  text?: string;
  color?: CardColor;
  labels?: string[];
  pinned?: boolean;
}

export interface AddDrawingInput {
  title?: string;
  scene?: DrawScene;
  color?: CardColor;
  labels?: string[];
  pinned?: boolean;
}

export type CardPatch = Partial<
  Pick<Card, "title" | "text" | "scene" | "color" | "labels" | "pinned" | "archived">
>;

export interface CardQuery {
  kind?: CardKind;
  color?: CardColor;
  label?: string;
  pinned?: boolean;
  /** Default query hides archived cards; set true to only see archived. */
  archived?: boolean;
  /** Matches title + note text (case insensitive). */
  search?: string;
}

export type CardSort = "order" | "updated" | "created";

export interface BoardStats {
  total: number;
  notes: number;
  drawings: number;
  pinned: number;
  archived: number;
  colors: Record<CardColor, number>;
}
