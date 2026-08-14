/**
 * Node/mark builders and validation for the document model.
 *
 * Kept fully headless and dependency-free so it runs in any JS runtime
 * (Node, Bun, edge, browser) without a DOM.
 */
import type {
  DocJSON,
  DocNode,
  HeadingLevel,
  Mark,
  MarkType,
  NodeType,
} from "../types/index.js";

/** All node names the model understands. */
export const NODE_TYPES: readonly NodeType[] = [
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
];

/** All mark names the model understands. */
export const MARK_TYPES: readonly MarkType[] = [
  "bold",
  "italic",
  "strike",
  "code",
  "link",
];

/** Node types that contain no children (leaf/atom nodes). */
export const LEAF_NODES: readonly NodeType[] = [
  "text",
  "horizontalRule",
  "hardBreak",
];

const NODE_SET = new Set<string>(NODE_TYPES);
const MARK_SET = new Set<string>(MARK_TYPES);

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Build a text node with optional marks. */
export function text(value: string, marks?: Mark[]): DocNode {
  const node: DocNode = { type: "text", text: value };
  if (marks && marks.length > 0) node.marks = marks;
  return node;
}

/** Build a paragraph node from inline content. */
export function paragraph(content: DocNode[] = []): DocNode {
  return { type: "paragraph", content };
}

/** Build a heading node. */
export function heading(level: HeadingLevel, content: DocNode[] = []): DocNode {
  return { type: "heading", attrs: { level }, content };
}

/** Build a blockquote node from block content. */
export function blockquote(content: DocNode[] = []): DocNode {
  return { type: "blockquote", content };
}

/** Build a fenced code block. */
export function codeBlock(code: string, language?: string): DocNode {
  return {
    type: "codeBlock",
    attrs: { language: language ?? null },
    content: code ? [text(code)] : [],
  };
}

/** Build a list item wrapping block content. */
export function listItem(content: DocNode[] = []): DocNode {
  return { type: "listItem", content };
}

/** Build a bullet (unordered) list. */
export function bulletList(items: DocNode[] = []): DocNode {
  return { type: "bulletList", content: items };
}

/** Build an ordered list. */
export function orderedList(items: DocNode[] = [], start = 1): DocNode {
  return { type: "orderedList", attrs: { start }, content: items };
}

/** A horizontal rule leaf node. */
export function horizontalRule(): DocNode {
  return { type: "horizontalRule" };
}

/** A hard line break leaf node. */
export function hardBreak(): DocNode {
  return { type: "hardBreak" };
}

/** Build a bold mark. */
export function bold(): Mark {
  return { type: "bold" };
}

/** Build an italic mark. */
export function italic(): Mark {
  return { type: "italic" };
}

/** Build a strike-through mark. */
export function strike(): Mark {
  return { type: "strike" };
}

/** Build an inline code mark. */
export function code(): Mark {
  return { type: "code" };
}

/** Build a link mark. */
export function link(href: string, attrs?: Record<string, unknown>): Mark {
  return { type: "link", attrs: { href, ...attrs } };
}

/** Build an empty document (a single empty paragraph). */
export function emptyDoc(): DocJSON {
  return { type: "doc", content: [paragraph()] };
}

// ---------------------------------------------------------------------------
// Validation / normalization
// ---------------------------------------------------------------------------

/** Thrown when a document fails validation in {@link assertValidDoc}. */
export class DocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentValidationError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateMark(mark: unknown, path: string): void {
  if (!isPlainObject(mark)) {
    throw new DocumentValidationError(`${path}: mark must be an object`);
  }
  if (typeof mark.type !== "string" || !MARK_SET.has(mark.type)) {
    throw new DocumentValidationError(
      `${path}: unknown mark type ${JSON.stringify(mark.type)}`,
    );
  }
  if (mark.type === "link") {
    const attrs = mark.attrs;
    if (!isPlainObject(attrs) || typeof attrs.href !== "string") {
      throw new DocumentValidationError(`${path}: link mark requires a string href`);
    }
  }
}

function validateNode(node: unknown, path: string): void {
  if (!isPlainObject(node)) {
    throw new DocumentValidationError(`${path}: node must be an object`);
  }
  if (typeof node.type !== "string" || !NODE_SET.has(node.type)) {
    throw new DocumentValidationError(
      `${path}: unknown node type ${JSON.stringify(node.type)}`,
    );
  }
  if (node.type === "text") {
    if (typeof node.text !== "string") {
      throw new DocumentValidationError(`${path}: text node requires a string text`);
    }
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks)) {
        throw new DocumentValidationError(`${path}: marks must be an array`);
      }
      node.marks.forEach((m, i) => validateMark(m, `${path}.marks[${i}]`));
    }
    return;
  }
  if (node.type === "heading") {
    const level = isPlainObject(node.attrs) ? node.attrs.level : undefined;
    if (typeof level !== "number" || level < 1 || level > 6) {
      throw new DocumentValidationError(
        `${path}: heading requires an attrs.level between 1 and 6`,
      );
    }
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) {
      throw new DocumentValidationError(`${path}: content must be an array`);
    }
    node.content.forEach((c, i) => validateNode(c, `${path}.content[${i}]`));
  }
}

/**
 * Validate an unknown value as a document, throwing on the first problem.
 * Returns the value typed as {@link DocJSON} on success.
 */
export function assertValidDoc(value: unknown): DocJSON {
  if (!isPlainObject(value) || value.type !== "doc") {
    throw new DocumentValidationError('root node must have type "doc"');
  }
  if (value.content !== undefined) {
    if (!Array.isArray(value.content)) {
      throw new DocumentValidationError("doc.content must be an array");
    }
    value.content.forEach((c, i) => validateNode(c, `doc.content[${i}]`));
  }
  return value as unknown as DocJSON;
}

/** Non-throwing variant of {@link assertValidDoc}. */
export function isValidDoc(value: unknown): value is DocJSON {
  try {
    assertValidDoc(value);
    return true;
  } catch {
    return false;
  }
}

/** Deep clone of a document node (structuredClone with JSON fallback). */
export function cloneNode<T extends DocNode>(node: T): T {
  const sc = (globalThis as { structuredClone?: <V>(v: V) => V }).structuredClone;
  if (typeof sc === "function") return sc(node);
  return JSON.parse(JSON.stringify(node)) as T;
}
