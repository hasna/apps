/**
 * The high-level {@link Document} wrapper: a stateful, chainable convenience API
 * over the pure functional core (schema builders, serializers, steps, analysis).
 */
import type {
  ApplyResult,
  CreateDocumentOptions,
  DocJSON,
  DocNode,
  DocumentStats,
  Mark,
  OutlineEntry,
  Step,
} from "../types/index.js";
import { assertValidDoc, cloneNode, emptyDoc } from "./schema.js";
import { fromHTML, toHTML } from "../serialize/html.js";
import { fromMarkdown, toMarkdown } from "../serialize/markdown.js";
import { applyStep, applySteps } from "../edit/steps.js";
import { countWords, getOutline, toText } from "../analyze/outline.js";

/**
 * A rich-text document. Instances are cheap wrappers around a plain
 * ProseMirror/TipTap-compatible JSON tree obtained via {@link Document.toJSON}.
 */
export class Document {
  private doc: DocJSON;

  constructor(doc: DocJSON) {
    this.doc = doc;
  }

  // --- Factories -----------------------------------------------------------

  /** Create a new document, optionally with initial content. */
  static create(options: CreateDocumentOptions = {}): Document {
    if (options.content && options.content.length > 0) {
      return new Document({ type: "doc", content: options.content.map(cloneNode) });
    }
    return new Document(emptyDoc());
  }

  /** Load a document from (validated) ProseMirror/TipTap JSON. */
  static fromJSON(json: unknown): Document {
    return new Document(cloneNode(assertValidDoc(json)));
  }

  /** Build a document from a Markdown string. */
  static fromMarkdown(md: string): Document {
    return new Document(fromMarkdown(md));
  }

  /** Build a document from an HTML string. */
  static fromHTML(html: string): Document {
    return new Document(fromHTML(html));
  }

  // --- Serialization -------------------------------------------------------

  /** Return a deep copy of the underlying document JSON. */
  toJSON(): DocJSON {
    return cloneNode(this.doc);
  }

  /** Serialize to Markdown. */
  toMarkdown(): string {
    return toMarkdown(this.doc);
  }

  /** Serialize to HTML. */
  toHTML(): string {
    return toHTML(this.doc);
  }

  /** Extract plain text. */
  toText(): string {
    return toText(this.doc);
  }

  // --- Analysis ------------------------------------------------------------

  /** Get the heading outline. */
  outline(): OutlineEntry[] {
    return getOutline(this.doc);
  }

  /** Get word/character/reading-time statistics. */
  stats(): DocumentStats {
    return countWords(this.doc);
  }

  /** Convenience: total word count. */
  wordCount(): number {
    return countWords(this.doc).words;
  }

  /** The document's top-level block nodes (deep-copied). */
  get blocks(): DocNode[] {
    return (this.doc.content ?? []).map(cloneNode);
  }

  // --- Editing (mutates this instance and returns it for chaining) ---------

  /** Apply one step in place. */
  apply(step: Step): this {
    this.doc = applyStep(this.doc, step);
    return this;
  }

  /** Apply several steps in place. */
  applyAll(steps: Step[]): ApplyResult {
    const result = applySteps(this.doc, steps);
    this.doc = result.doc;
    return result;
  }

  /** Append a block node. */
  append(node: DocNode): this {
    return this.apply({ type: "insertNode", index: (this.doc.content ?? []).length, node });
  }

  /** Prepend a block node. */
  prepend(node: DocNode): this {
    return this.apply({ type: "insertNode", index: 0, node });
  }

  /** Insert a plain-text paragraph at a block index. */
  insertText(index: number, value: string, marks?: Mark[]): this {
    return this.apply({ type: "insertText", index, text: value, marks });
  }

  /** Replace the entire document body. */
  setContent(content: DocNode[]): this {
    return this.apply({ type: "setDoc", content });
  }

  /** A detached deep copy of this document. */
  clone(): Document {
    return new Document(cloneNode(this.doc));
  }
}

/** Functional alias for {@link Document.create}. */
export function createDocument(options: CreateDocumentOptions = {}): Document {
  return Document.create(options);
}

/** Functional alias for {@link Document.fromJSON}. */
export function loadDocument(json: unknown): Document {
  return Document.fromJSON(json);
}
