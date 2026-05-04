import { describe, it, expect } from "bun:test";
import { rewriteCommand } from "./command-rewriter.js";

describe("rewriteCommand", () => {
  it("does not change unrelated commands", () => {
    const result = rewriteCommand("ls -la");
    expect(result.changed).toBe(false);
    expect(result.rewritten).toBe("ls -la");
  });

  it("rewrites useless cat to grep", () => {
    const result = rewriteCommand("cat package.json | grep version");
    expect(result.changed).toBe(true);
    expect(result.rewritten).toBe("grep version package.json");
  });

  it("rewrites bare git log with limit", () => {
    const result = rewriteCommand("git log");
    expect(result.changed).toBe(true);
    expect(result.rewritten).toBe("git log --oneline -20");
  });

  it("rewrites bare git diff with --stat", () => {
    const result = rewriteCommand("git diff");
    expect(result.changed).toBe(true);
    expect(result.rewritten).toBe("git diff --stat");
  });

  it("rewrites bare npm ls with depth", () => {
    const result = rewriteCommand("npm ls");
    expect(result.changed).toBe(true);
    expect(result.rewritten).toBe("npm ls --depth=0");
  });

  it("rewrites bare ps aux", () => {
    const result = rewriteCommand("ps aux");
    expect(result.changed).toBe(true);
    expect(result.rewritten).toBe("ps aux | sort -k4 -rn | head -20");
  });

  it("adds node_modules exclusion to find", () => {
    const result = rewriteCommand("find . -name '*.ts'");
    expect(result.changed).toBe(true);
    expect(result.rewritten).toContain("-not -path '*/node_modules/*'");
  });

  it("does not add node_modules exclusion when already present", () => {
    const result = rewriteCommand("find . -not -path '*/node_modules/*' -name '*.ts'");
    expect(result.changed).toBe(false);
  });

  it("includes reason when rewriting", () => {
    const result = rewriteCommand("git log");
    expect(result.reason).toBeDefined();
    expect(result.reason!.length).toBeGreaterThan(0);
  });
});
