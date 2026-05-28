import { describe, it, expect } from "bun:test";
import { shouldProcess } from "./output-processor.js";

describe("shouldProcess", () => {
  it("returns false for short output", () => {
    expect(shouldProcess("hello world")).toBe(false);
  });

  it("returns true for long output", () => {
    const long = Array(20).fill("line").join("\n");
    expect(shouldProcess(long)).toBe(true);
  });

  it("returns false at exact threshold", () => {
    const lines = Array(15).fill("line").join("\n");
    expect(shouldProcess(lines)).toBe(false);
  });
});
