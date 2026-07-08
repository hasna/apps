/**
 * @hasna/draw — headless board SDK for quick notes and freehand drawings.
 *
 * The default entry point is framework agnostic: a board and card model with a
 * portable, renderer free drawing scene and Excalidraw compatible interchange.
 * It runs anywhere (Node, Bun, edge, browser) with no DOM and no drawing engine.
 * For the React board, card, and draw surface components, import from
 * "@hasna/draw/react".
 */

// Types
export type {
  AddDrawingInput,
  AddNoteInput,
  Board,
  BoardDocument,
  BoardStats,
  Card,
  CardColor,
  CardKind,
  CardPatch,
  CardQuery,
  CardSort,
  CreateBoardOptions,
  DrawElement,
  DrawElementType,
  DrawScene,
  ExcalidrawElement,
  ExcalidrawFile,
  FillStyle,
  ScenePoint,
  SceneBounds,
} from "./types/index.js";

// Board model + factories
export { BoardModel, createBoard, loadBoard } from "./model/board.js";

// Card factories + validation
export {
  CARD_COLORS,
  CardValidationError,
  cloneCard,
  drawing,
  isCardColor,
  note,
  validateCard,
} from "./model/card.js";

// Scene model (functional)
export {
  SCENE_SCHEMA,
  SCENE_VERSION,
  addElement,
  addStroke,
  clearScene,
  createScene,
  removeElement,
  sceneBounds,
} from "./model/scene.js";
export type { StrokeOptions } from "./model/scene.js";

// Board operations (functional)
export {
  addCard,
  archiveCard,
  deleteCard,
  pinCard,
  reorderCard,
  setCardColor,
  updateCard,
} from "./ops/cards.js";

// Query
export { boardStats, listCards, searchBoard } from "./query/query.js";

// Serialization
export {
  BOARD_SCHEMA,
  BOARD_VERSION,
  BoardValidationError,
  parseBoard,
  serializeBoard,
  toBoardDocument,
  validateBoard,
} from "./serialize/board.js";

// Excalidraw interchange
export { EXCALIDRAW_SOURCE, fromExcalidraw, toExcalidraw } from "./serialize/excalidraw.js";

// Version
export { VERSION } from "./version.js";
