/**
 * @hasna/docs/react — a TipTap-based rich-text <Editor> component.
 *
 * This entry pulls in React and TipTap (@tiptap/react, @tiptap/starter-kit).
 * For headless, server-safe document handling, import from "@hasna/docs".
 */
export { Editor } from "./editor.js";
export type { EditorProps } from "./editor.js";
export { Toolbar } from "./toolbar.js";
export type { ToolbarProps } from "./toolbar.js";

// Re-export the headless SDK for convenience so consumers of the editor can use
// serialization/analysis without a second import.
export * from "../index.js";
