/**
 * Programmatic editing via a small, typed, serializable step model.
 *
 * Steps operate on the document's top-level block list. They are pure: each
 * function returns a new document and never mutates the input.
 */
import type { ApplyResult, DocJSON, DocNode, Mark, Step } from "../types/index.js";
import { cloneNode, DocumentValidationError, paragraph, text } from "../model/schema.js";

/** Thrown when a step cannot be applied (e.g. out-of-range index). */
export class StepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepError";
  }
}

function blocksOf(doc: DocJSON): DocNode[] {
  return doc.content ? doc.content.map(cloneNode) : [];
}

function checkIndex(index: number, length: number, allowEnd: boolean): void {
  const max = allowEnd ? length : length - 1;
  if (!Number.isInteger(index) || index < 0 || index > max) {
    throw new StepError(
      `index ${index} out of range (0..${max})`,
    );
  }
}

/** Apply a single step, returning a new document. */
export function applyStep(doc: DocJSON, step: Step): DocJSON {
  const blocks = blocksOf(doc);
  switch (step.type) {
    case "insertNode": {
      checkIndex(step.index, blocks.length, true);
      blocks.splice(step.index, 0, cloneNode(step.node));
      break;
    }
    case "removeNode": {
      checkIndex(step.index, blocks.length, false);
      blocks.splice(step.index, 1);
      break;
    }
    case "replaceNode": {
      checkIndex(step.index, blocks.length, false);
      blocks[step.index] = cloneNode(step.node);
      break;
    }
    case "insertText": {
      checkIndex(step.index, blocks.length, true);
      blocks.splice(step.index, 0, paragraph([text(step.text, step.marks)]));
      break;
    }
    case "setDoc": {
      return { type: "doc", content: step.content.map(cloneNode) };
    }
    default: {
      const exhaustive: never = step;
      throw new DocumentValidationError(
        `unknown step ${JSON.stringify(exhaustive)}`,
      );
    }
  }
  return { type: "doc", content: blocks };
}

/** Apply a sequence of steps in order. */
export function applySteps(doc: DocJSON, steps: Step[]): ApplyResult {
  let current = doc;
  let applied = 0;
  for (const step of steps) {
    current = applyStep(current, step);
    applied += 1;
  }
  return { doc: current, applied };
}

// ---------------------------------------------------------------------------
// Higher-level convenience edits (thin wrappers over applyStep)
// ---------------------------------------------------------------------------

/** Append a block to the end of the document. */
export function appendNode(doc: DocJSON, node: DocNode): DocJSON {
  return applyStep(doc, {
    type: "insertNode",
    index: (doc.content ?? []).length,
    node,
  });
}

/** Prepend a block to the start of the document. */
export function prependNode(doc: DocJSON, node: DocNode): DocJSON {
  return applyStep(doc, { type: "insertNode", index: 0, node });
}

/** Append a paragraph made of a single (optionally marked) text run. */
export function appendParagraph(doc: DocJSON, value: string, marks?: Mark[]): DocJSON {
  return appendNode(doc, paragraph([text(value, marks)]));
}
