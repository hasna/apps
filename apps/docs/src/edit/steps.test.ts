import { describe, expect, test } from "bun:test";
import {
  appendNode,
  appendParagraph,
  applyStep,
  applySteps,
  prependNode,
  StepError,
} from "./steps.js";
import { bold, DocumentValidationError, heading, paragraph, text } from "../model/schema.js";
import type { DocJSON } from "../types/index.js";

const base: DocJSON = {
  type: "doc",
  content: [paragraph([text("a")]), paragraph([text("b")])],
};

describe("applyStep", () => {
  test("insertNode at index", () => {
    const next = applyStep(base, { type: "insertNode", index: 1, node: heading(2, [text("H")]) });
    expect(next.content?.[1]).toMatchObject({ type: "heading" });
    expect(next.content?.length).toBe(3);
  });

  test("does not mutate the input document", () => {
    applyStep(base, { type: "insertNode", index: 0, node: paragraph([text("x")]) });
    expect(base.content?.length).toBe(2);
  });

  test("removeNode", () => {
    const next = applyStep(base, { type: "removeNode", index: 0 });
    expect(next.content?.length).toBe(1);
    expect(next.content?.[0]?.content?.[0]?.text).toBe("b");
  });

  test("replaceNode", () => {
    const next = applyStep(base, { type: "replaceNode", index: 0, node: paragraph([text("z")]) });
    expect(next.content?.[0]?.content?.[0]?.text).toBe("z");
  });

  test("insertText inserts a paragraph", () => {
    const next = applyStep(base, { type: "insertText", index: 2, text: "c" });
    expect(next.content?.[2]).toMatchObject({ type: "paragraph" });
    expect(next.content?.[2]?.content?.[0]?.text).toBe("c");
  });

  test("setDoc replaces the whole body", () => {
    const next = applyStep(base, { type: "setDoc", content: [heading(1, [text("New")])] });
    expect(next.content?.length).toBe(1);
    expect(next.content?.[0]?.type).toBe("heading");
  });

  test("out-of-range index throws", () => {
    expect(() => applyStep(base, { type: "removeNode", index: 9 })).toThrow(StepError);
  });

  test("insertNode at index == length is allowed (append via step)", () => {
    const next = applyStep(base, { type: "insertNode", index: 2, node: paragraph([text("c")]) });
    expect(next.content?.length).toBe(3);
  });

  test("insertNode beyond the end throws", () => {
    expect(() => applyStep(base, { type: "insertNode", index: 3, node: paragraph() })).toThrow(StepError);
  });

  test("removeNode/replaceNode at index == length throws", () => {
    expect(() => applyStep(base, { type: "removeNode", index: 2 })).toThrow(StepError);
    expect(() => applyStep(base, { type: "replaceNode", index: 2, node: paragraph() })).toThrow(StepError);
  });

  test("non-integer and negative indices throw", () => {
    expect(() => applyStep(base, { type: "insertNode", index: 1.5, node: paragraph() })).toThrow(StepError);
    expect(() => applyStep(base, { type: "removeNode", index: -1 })).toThrow(StepError);
  });

  test("steps work on a document with no content array (length 0)", () => {
    const empty: DocJSON = { type: "doc" };
    const next = applyStep(empty, { type: "insertNode", index: 0, node: paragraph([text("x")]) });
    expect(next.content?.[0]?.content?.[0]?.text).toBe("x");
    expect(() => applyStep(empty, { type: "removeNode", index: 0 })).toThrow(StepError);
  });

  test("insertText with marks produces a marked paragraph", () => {
    const next = applyStep(base, { type: "insertText", index: 0, text: "x", marks: [bold()] });
    expect(next.content?.[0]?.content?.[0]?.marks).toEqual([{ type: "bold" }]);
  });

  test("insertNode clones the node (mutating the source node is invisible)", () => {
    const node = paragraph([text("n")]);
    const next = applyStep(base, { type: "insertNode", index: 0, node });
    node.content![0]!.text = "mutated";
    expect(next.content?.[0]?.content?.[0]?.text).toBe("n");
  });

  test("setDoc clones its content (mutating the input is invisible)", () => {
    const content = [paragraph([text("x")])];
    const next = applyStep(base, { type: "setDoc", content });
    content[0]!.content![0]!.text = "mutated";
    expect(next.content?.[0]?.content?.[0]?.text).toBe("x");
  });

  test("an unknown step type throws DocumentValidationError", () => {
    expect(() => applyStep(base, { type: "teleport" } as never)).toThrow(DocumentValidationError);
  });
});

describe("applySteps", () => {
  test("applies steps in order and reports count", () => {
    // base has 2 blocks; after insert at 0 -> [Top, a, b], then remove index 2 -> [Top, a]
    const result = applySteps(base, [
      { type: "insertNode", index: 0, node: heading(1, [text("Top")]) },
      { type: "removeNode", index: 2 },
    ]);
    expect(result.applied).toBe(2);
    expect(result.doc.content?.[0]?.type).toBe("heading");
    expect(result.doc.content?.length).toBe(2);
  });

  test("an empty step list reports zero applied and leaves the doc untouched", () => {
    const result = applySteps(base, []);
    expect(result.applied).toBe(0);
    expect(result.doc).toBe(base);
  });
});

describe("helpers", () => {
  test("appendNode adds to the end", () => {
    const next = appendNode(base, paragraph([text("c")]));
    expect(next.content?.length).toBe(3);
    expect(next.content?.at(-1)?.content?.[0]?.text).toBe("c");
  });

  test("prependNode adds to the start", () => {
    const next = prependNode(base, heading(1, [text("Top")]));
    expect(next.content?.[0]?.type).toBe("heading");
    expect(next.content?.length).toBe(3);
  });

  test("appendParagraph appends a marked text run", () => {
    const next = appendParagraph(base, "c", [bold()]);
    const last = next.content?.at(-1);
    expect(last?.type).toBe("paragraph");
    expect(last?.content?.[0]).toMatchObject({ type: "text", text: "c", marks: [{ type: "bold" }] });
  });
});
