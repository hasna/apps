import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectClaudeAuthorityConflicts } from "./session-authority";
import { makeTempRoot } from "./test-temp-root";

let root = "";

beforeEach(() => {
  root = makeTempRoot("open-configs-session-authority-");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("Claude unmanaged authority detection", () => {
  test("classifies the known no-worktree legacy authority without exposing content", () => {
    const targetHome = join(root, "claude");
    mkdirSync(targetHome, { recursive: true });
    writeFileSync(join(targetHome, "AGENTS.md"), [
      "# Agent Rules (Claude)",
      "",
      "## No Worktrees",
      "Never use git worktrees.",
      "",
    ].join("\n"));

    const [conflict] = detectClaudeAuthorityConflicts(targetHome);

    expect(conflict).toMatchObject({
      tool: "claude",
      relativePath: "AGENTS.md",
      kind: "known-legacy-no-worktree",
      provenance: {
        source: "filesystem",
        authority: "unmanaged",
        detection: "known-legacy-markers",
      },
    });
    expect(conflict?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(conflict?.reason).toContain("no-worktree");
    expect(conflict?.reason).not.toContain("Never use git worktrees");
  });

  test("fails closed for unknown unmanaged authority", () => {
    const targetHome = join(root, "claude");
    mkdirSync(targetHome, { recursive: true });
    writeFileSync(join(targetHome, "AGENTS.md"), "# Local authority\nUse local rules.\n");

    const [conflict] = detectClaudeAuthorityConflicts(targetHome);

    expect(conflict?.kind).toBe("unknown-unmanaged-authority");
    expect(conflict?.provenance.detection).toBe("unknown-content");
  });

  test("fails closed for symlinked legacy targets", () => {
    const targetHome = join(root, "claude");
    const outside = join(root, "outside.md");
    mkdirSync(targetHome, { recursive: true });
    writeFileSync(outside, "# Agent Rules (Claude)\n## No Worktrees\n");
    symlinkSync(outside, join(targetHome, "AGENTS.md"));

    const [conflict] = detectClaudeAuthorityConflicts(targetHome);

    expect(conflict?.kind).toBe("invalid-unmanaged-authority");
    expect(conflict?.sha256).toBeNull();
    expect(conflict?.provenance.detection).toBe("non-regular-file");
  });

  test("does not report a fresh target with no legacy authority", () => {
    expect(detectClaudeAuthorityConflicts(join(root, "fresh-claude"))).toEqual([]);
  });
});
