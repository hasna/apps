import { describe, expect, test } from "bun:test";
import { appendNode, applyStep, applySteps, StepError } from "./steps.js";
import { heading, paragraph, text } from "../model/schema.js";
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
});

describe("helpers", () => {
  test("appendNode adds to the end", () => {
    const next = appendNode(base, paragraph([text("c")]));
    expect(next.content?.length).toBe(3);
    expect(next.content?.at(-1)?.content?.[0]?.text).toBe("c");
  });
});
