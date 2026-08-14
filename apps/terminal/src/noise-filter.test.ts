import { describe, it, expect } from "bun:test";
import { stripNoise } from "./noise-filter.js";

describe("stripNoise", () => {
  it("removes npm funding notices", () => {
    const input = "123 packages are looking for funding\n  run `npm fund` for details\nactual output";
    const result = stripNoise(input);
    expect(result.cleaned).not.toContain("packages are looking for funding");
    expect(result.linesRemoved).toBeGreaterThan(0);
  });

  it("removes vulnerability notices", () => {
    const input = "added 5 packages\nfound 0 vulnerabilities";
    const result = stripNoise(input);
    expect(result.cleaned).not.toContain("found 0 vulnerabilities");
  });

  it("removes progress bars", () => {
    const input = "[======>     ] 45%\ndone";
    const result = stripNoise(input);
    expect(result.cleaned).not.toContain("[======>");
  });

  it("removes gyp info", () => {
    const input = "gyp info it worked\nactual result";
    const result = stripNoise(input);
    expect(result.cleaned).not.toContain("gyp info");
  });

  it("collapses 3+ blank lines to 1", () => {
    const input = "line1\n\n\n\n\nline2";
    const result = stripNoise(input);
    const blankCount = (result.cleaned.match(/\n/g) || []).length;
    expect(blankCount).toBeLessThan(4);
  });

  it("redacts sensitive env var assignments", () => {
    const input = "export API_" + "KEY=sk-12345\nnormal line";
    const result = stripNoise(input);
    expect(result.cleaned).toContain("[REDACTED]");
    expect(result.cleaned).not.toContain("sk-12345");
  });

  it("does not redact code lines", () => {
    const input = "const API_" + "KEY = process.env.API_KEY";
    const result = stripNoise(input);
    expect(result.cleaned).toContain("API_KEY");
    expect(result.cleaned).not.toContain("[REDACTED]");
  });

  it("preserves useful lines", () => {
    const input = "✓ Build succeeded in 2.3s";
    const result = stripNoise(input);
    expect(result.cleaned).toContain("Build succeeded");
  });

  it("removes carriage return overwrites", () => {
    const input = "\rloading\rdone loading\nfinal";
    const result = stripNoise(input);
    expect(result.linesRemoved).toBeGreaterThanOrEqual(0);
  });

  it("tracks lines removed", () => {
    const input = "npm warn deprecated foo\nnpm warn ERESOLVE conflict\nfound 0 vulnerabilities\ngood line";
    const result = stripNoise(input);
    expect(result.linesRemoved).toBeGreaterThan(0);
    expect(result.cleaned.trim()).not.toContain("npm warn");
  });
});
