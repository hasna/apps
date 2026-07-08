/**
 * Document model types for @hasna/docs.
 *
 * The document JSON is intentionally shape-compatible with the ProseMirror /
 * TipTap document model, so a document produced by this headless SDK can be
 * handed straight to the TipTap-based <Editor> (from "@hasna/docs/react") and
 * back, with no conversion.
 */

/** Inline mark names supported by the document model. */
export type MarkType = "bold" | "italic" | "strike" | "code" | "link";

/** A ProseMirror/TipTap-compatible inline mark. */
export interface Mark {
  type: MarkType;
  attrs?: Record<string, unknown>;
}

/** Block and inline node names supported by the document model. */
export type NodeType =
  | "doc"
  | "paragraph"
  | "text"
  | "heading"
  | "bulletList"
  | "orderedList"
  | "listItem"
  | "blockquote"
  | "codeBlock"
  | "horizontalRule"
  | "hardBreak"
  | "table"
  | "tableRow"
  | "tableHeader"
  | "tableCell";

/**
 * A ProseMirror/TipTap-compatible document node.
 *
 * - Text nodes carry `text` (and optional `marks`).
 * - Block nodes carry `content` (child nodes) and optional `attrs`.
 */
export interface DocNode {
  type: NodeType;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: Mark[];
  text?: string;
}

/** The root document node. Its `type` is always `"doc"`. */
export interface DocJSON extends DocNode {
  type: "doc";
  content?: DocNode[];
}

/** Heading levels supported by the model. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** A single entry in a document outline (a heading). */
export interface OutlineEntry {
  level: HeadingLevel;
  text: string;
  /** Zero-based index of the heading among the document's top-level blocks. */
  index: number;
  /** A slugified, URL-safe id derived from the heading text. */
  id: string;
}

/** Counts returned by {@link countWords}. */
export interface DocumentStats {
  words: number;
  characters: number;
  /** Characters excluding whitespace. */
  charactersNoSpaces: number;
  paragraphs: number;
  headings: number;
  sentences: number;
  /** Estimated reading time in minutes (rounded up, 200 wpm). */
  readingTimeMinutes: number;
}

/** Options accepted by {@link createDocument}. */
export interface CreateDocumentOptions {
  /** Optional initial content nodes for the document body. */
  content?: DocNode[];
}

/**
 * A programmatic edit step applied to a {@link Document}.
 *
 * These are a small, typed, self-describing step model (not ProseMirror binary
 * steps) so they are trivial to serialize, log, and replay server-side.
 */
export type Step =
  | { type: "insertNode"; index: number; node: DocNode }
  | { type: "removeNode"; index: number }
  | { type: "replaceNode"; index: number; node: DocNode }
  | { type: "insertText"; index: number; text: string; marks?: Mark[] }
  | { type: "setDoc"; content: DocNode[] };

/** Result of applying one or more {@link Step}s. */
export interface ApplyResult {
  doc: DocJSON;
  applied: number;
}
