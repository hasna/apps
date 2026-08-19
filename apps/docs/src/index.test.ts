/**
 * Public entry-point surface: import from the package root (as consumers do)
 * and exercise the exported factories, serializers, editors, and analysis
 * together. Guards against the entry point silently dropping a re-export or
 * breaking the headless contract (no DOM required).
 */
import { describe, expect, test } from "bun:test";
import {
  StepError,
  assertValidDoc,
  createDocument,
  fromHTML,
  fromMarkdown,
  getOutline,
  isValidDoc,
  loadDocument,
  paragraph,
  text,
  toHTML,
  toMarkdown,
  toText,
} from "./index.js";

describe("public entry point", () => {
  test("full pipeline: markdown in, edit, analyze, serialize out", () => {
    const doc = fromMarkdown("# Title\n\nbody text");
    expect(getOutline(doc)[0]).toMatchObject({ level: 1, text: "Title" });
    expect(toText(doc)).toContain("body text");
    expect(toHTML(doc)).toContain("<h1>Title</h1>");
    expect(toMarkdown(doc)).toContain("# Title");
  });

  test("Document wrapper composes with functional helpers", () => {
    const doc = createDocument({ content: [paragraph([text("a")])] }).append(paragraph([text("b")]));
    expect(doc.blocks).toHaveLength(2);
    expect(doc.wordCount()).toBe(2);
  });

  test("html -> markdown cross-serialization through the entry point", () => {
    const doc = fromHTML("<h2>Sub</h2><p>Body</p>");
    expect(toMarkdown(doc).trim()).toContain("## Sub");
  });

  test("validation helpers are exported and agree", () => {
    const good = { type: "doc", content: [paragraph([text("x")])] };
    const bad = { type: "doc", content: [{ type: "nope" }] };
    expect(isValidDoc(good)).toBe(true);
    expect(isValidDoc(bad)).toBe(false);
    expect(() => assertValidDoc(bad)).toThrow();
  });

  test("edit errors are exported as StepError", () => {
    const doc = createDocument();
    expect(() => doc.apply({ type: "removeNode", index: 5 })).toThrow(StepError);
  });

  test("loadDocument round-trips through toJSON", () => {
    const original = { type: "doc" as const, content: [paragraph([text("x")])] };
    const doc = loadDocument(original);
    expect(doc.toJSON()).toEqual(original);
  });
});
