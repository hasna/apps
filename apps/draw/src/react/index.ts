/**
 * @hasna/draw/react — optional React components for @hasna/draw.
 *
 * This entry pulls in React (an optional peer dependency). For headless,
 * server safe board handling, import from "@hasna/draw".
 *
 * Note: the values exported here named `Board` and `Card` are the React
 * components. The plain board/card *data types* also named `Board` and `Card`
 * live at the package root ("@hasna/draw"); import them from there.
 */
export { Board } from "./Board.js";
export type { BoardProps } from "./Board.js";
export { Card } from "./Card.js";
export type { CardProps } from "./Card.js";
export { DrawSurface } from "./DrawSurface.js";
export type { DrawSurfaceProps } from "./DrawSurface.js";
export { NoteEditor } from "./NoteEditor.js";
export type { NoteEditorProps } from "./NoteEditor.js";

// SVG helpers used by the components, exported for advanced/custom rendering.
export {
  cn,
  DEFAULT_STROKE,
  elementToShape,
  opacityOf,
  pointsToPath,
  sceneViewBox,
  strokeOf,
  strokeWidthOf,
} from "./svg.js";
export type { SvgShape } from "./svg.js";

// Re-export the headless SDK for convenience.
export * from "../index.js";
