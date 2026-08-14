import { describe, it, expect, beforeEach } from "bun:test";
import { detectLoop, resetLoopDetector } from "./loop-detector.js";

beforeEach(() => {
  resetLoopDetector();
});

describe("detectLoop", () => {
  it("does not detect a loop for a single test command", () => {
    const result = detectLoop("bun test");
    expect(result.detected).toBe(false);
    expect(result.iteration).toBe(1);
  });

  it("does not detect a loop for two test commands", () => {
    detectLoop("bun test");
    const result = detectLoop("bun test");
    expect(result.detected).toBe(false);
    expect(result.iteration).toBe(2);
  });

  it("detects a loop after 3+ full test suite commands", () => {
    detectLoop("bun test");
    detectLoop("bun test");
    const result = detectLoop("bun test");
    expect(result.detected).toBe(true);
    expect(result.iteration).toBe(3);
  });

  it("does not detect a loop for narrowed test commands", () => {
    detectLoop("bun test src/auth.test.ts");
    detectLoop("bun test src/auth.test.ts");
    const result = detectLoop("bun test src/auth.test.ts");
    expect(result.detected).toBe(false);
  });

  it("does not detect a loop for non-test commands", () => {
    detectLoop("ls -la");
    const result = detectLoop("ls -la");
    expect(result.detected).toBe(false);
  });

  it("detects loops with various test runners", () => {
    detectLoop("npm test");
    detectLoop("npm test");
    const result = detectLoop("npm test");
    expect(result.detected).toBe(true);
  });

  it("recognizes pytest as test command", () => {
    const result = detectLoop("pytest");
    expect(result.detected).toBe(false); // only 1 run
  });

  it("recognizes cargo test as test command", () => {
    const result = detectLoop("cargo test");
    expect(result.detected).toBe(false); // only 1 run
  });

  it("does not detect loop when --grep narrows the run", () => {
    detectLoop("bun test --grep auth");
    detectLoop("bun test --grep auth");
    const result = detectLoop("bun test --grep auth");
    expect(result.detected).toBe(false);
  });

  it("resets after resetLoopDetector", () => {
    detectLoop("bun test");
    detectLoop("bun test");
    detectLoop("bun test");
    resetLoopDetector();
    const result = detectLoop("bun test");
    expect(result.detected).toBe(false);
    expect(result.iteration).toBe(1);
  });

  it("includes a reason when loop is detected", () => {
    detectLoop("bun test");
    detectLoop("bun test");
    const result = detectLoop("bun test");
    expect(result.reason).toContain("Full test suite");
  });
});
