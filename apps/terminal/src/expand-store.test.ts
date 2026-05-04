import { describe, expect, it } from "bun:test";
import { expandOutput, storeOutput } from "./expand-store.js";

describe("expand-store", () => {
  it("returns full output by default", () => {
    const key = storeOutput("test", "one\ntwo\nthree");
    const result = expandOutput(key);

    expect(result.found).toBe(true);
    expect(result.output).toBe("one\ntwo\nthree");
    expect(result.lines).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("filters safely with grep strings", () => {
    const key = storeOutput("test", "alpha\n[error]\nbeta");
    const result = expandOutput(key, "[error]");

    expect(result.output).toBe("[error]");
    expect(result.lines).toBe(1);
  });

  it("returns line windows without loading the whole output", () => {
    const key = storeOutput("test", "a\nb\nc\nd\ne");
    const result = expandOutput(key, { offset: 1, limit: 2 });

    expect(result.output).toBe("b\nc");
    expect(result.lines).toBe(2);
    expect(result.totalLines).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it("adds context around grep matches before windowing", () => {
    const key = storeOutput("test", "one\ntwo\nTHREE\nfour\nfive");
    const result = expandOutput(key, { grep: "three", context: 1 });

    expect(result.output).toBe("two\nTHREE\nfour");
    expect(result.lines).toBe(3);
  });
});
