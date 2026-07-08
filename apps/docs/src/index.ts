/**
 * @hasna/docs — headless rich-text document SDK.
 *
 * The default entry point is framework-agnostic and dependency-free: it runs
 * anywhere (Node, Bun, edge, browser) with no DOM. For the React <Editor>
 * component, import from "@hasna/docs/react".
 */

// Types
export type {
  ApplyResult,
  CreateDocumentOptions,
  DocJSON,
  DocNode,
  DocumentStats,
  HeadingLevel,
  Mark,
  MarkType,
  NodeType,
  OutlineEntry,
  Step,
} from "./types/index.js";

// Document model + factories
export { Document, createDocument, loadDocument } from "./model/document.js";

// Schema builders + validation
export {
  MARK_TYPES,
  NODE_TYPES,
  LEAF_NODES,
  DocumentValidationError,
  assertValidDoc,
  isValidDoc,
  cloneNode,
  emptyDoc,
  text,
  paragraph,
  heading,
  blockquote,
  codeBlock,
  listItem,
  bulletList,
  orderedList,
  horizontalRule,
  hardBreak,
  bold,
  italic,
  strike,
  code,
  link,
} from "./model/schema.js";

// Serialization
export { toMarkdown, fromMarkdown } from "./serialize/markdown.js";
export { toHTML, fromHTML } from "./serialize/html.js";

// Editing (functional)
export {
  StepError,
  applyStep,
  applySteps,
  appendNode,
  prependNode,
  appendParagraph,
} from "./edit/steps.js";

// Analysis
export { toText, getOutline, countWords, slugify, nodeText } from "./analyze/outline.js";

export { VERSION } from "./version.js";
