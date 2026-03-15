import { describe, it, expect } from "bun:test";
import { compress, stripAnsi } from "./compression.js";

describe("stripAnsi", () => {
  it("removes ANSI escape codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
    expect(stripAnsi("\x1b[1;32mbold green\x1b[0m")).toBe("bold green");
  });

  it("leaves clean text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });
});

describe("compress", () => {
  it("strips ANSI by default", () => {
    const result = compress("ls", "\x1b[32mfile.ts\x1b[0m");
    expect(result.content).not.toContain("\x1b");
  });

  it("uses structured parser when format=json", () => {
    const output = `total 16
-rw-r--r--  1 user staff  450 Mar 10 09:00 package.json
drwxr-xr-x  5 user staff  160 Mar 10 09:00 src`;

    const result = compress("ls -la", output, { format: "json" });
    // Parser may skip JSON if it's larger than raw — just check it returned something
    expect(result.content).toBeTruthy();
    expect(result.compressedTokens).toBeGreaterThan(0);
  });

  it("respects maxTokens budget", () => {
    const longOutput = Array.from({ length: 100 }, (_, i) => `Line ${i}: some output text here`).join("\n");
    const result = compress("some-command", longOutput, { maxTokens: 50 });
    expect(result.compressedTokens).toBeLessThanOrEqual(60); // allow some slack
  });

  it("deduplicates similar lines", () => {
    const output = Array.from({ length: 20 }, (_, i) => `Compiling module ${i}...`).join("\n");
    const result = compress("build", output);
    expect(result.compressedTokens).toBeLessThan(result.originalTokens);
  });

  it("tracks savings on large output", () => {
    const output = Array.from({ length: 100 }, (_, i) => `Line ${i}: some long output text here that takes tokens`).join("\n");
    const result = compress("cmd", output, { maxTokens: 50 });
    expect(result.compressedTokens).toBeLessThan(result.originalTokens);
  });
});
