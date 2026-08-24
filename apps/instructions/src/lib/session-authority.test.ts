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

  test("fails closed for a dangling legacy authority symlink", () => {
    const targetHome = join(root, "claude-dangling");
    mkdirSync(targetHome, { recursive: true });
    symlinkSync(join(root, "does-not-exist.md"), join(targetHome, "AGENTS.md"));

    const conflicts = detectClaudeAuthorityConflicts(targetHome);

    expect(conflicts.length).toBe(1);
    expect(conflicts[0]?.kind).toBe("invalid-unmanaged-authority");
    expect(conflicts[0]?.provenance.detection).toBe("non-regular-file");
  });

  test("does not report a fresh target with no legacy authority", () => {
    expect(detectClaudeAuthorityConflicts(join(root, "fresh-claude"))).toEqual([]);
  });

  test("passes when AGENTS.md is owned by a registered config whose stored content matches disk", () => {
    const targetHome = join(root, "claude");
    mkdirSync(targetHome, { recursive: true });
    const content = "# Managed Claude AGENTS.md\nOwned by a registered instructions config.\n";
    writeFileSync(join(targetHome, "AGENTS.md"), content);

    const conflicts = detectClaudeAuthorityConflicts(targetHome, [
      { slug: "agents-md-1", targetPath: join(targetHome, "AGENTS.md"), content },
    ]);

    expect(conflicts).toEqual([]);
  });

  test("recognizes an owned config spelled with a tilde home path", () => {
    const previousConfigsHome = process.env["CONFIGS_HOME"];
    process.env["CONFIGS_HOME"] = root;
    try {
      const targetHome = join(root, ".claude");
      mkdirSync(targetHome, { recursive: true });
      const content = "# Managed Claude AGENTS.md\nRendered by the instructions pipeline.\n";
      writeFileSync(join(targetHome, "AGENTS.md"), content);

      const conflicts = detectClaudeAuthorityConflicts(targetHome, [
        { slug: "agents-md-1", targetPath: "~/.claude/AGENTS.md", content },
      ]);

      expect(conflicts).toEqual([]);
    } finally {
      if (previousConfigsHome === undefined) delete process.env["CONFIGS_HOME"];
      else process.env["CONFIGS_HOME"] = previousConfigsHome;
    }
  });

  test("still fails closed for an unmanaged AGENTS.md when an owned config covers a different target", () => {
    const targetHome = join(root, "claude");
    mkdirSync(targetHome, { recursive: true });
    writeFileSync(join(targetHome, "AGENTS.md"), [
      "# Agent Rules (Claude)",
      "",
      "## No Worktrees",
      "Never use git worktrees.",
      "",
    ].join("\n"));

    const [conflict] = detectClaudeAuthorityConflicts(targetHome, [
      { slug: "agents-md-1", targetPath: join(root, "other-home", "AGENTS.md"), content: "# Unrelated owned file\n" },
    ]);

    expect(conflict?.kind).toBe("known-legacy-no-worktree");
    expect(conflict?.provenance.detection).toBe("known-legacy-markers");
  });

  test("fails closed when a registered config's stored content drifts from disk", () => {
    const targetHome = join(root, "claude");
    mkdirSync(targetHome, { recursive: true });
    writeFileSync(join(targetHome, "AGENTS.md"), "# Disk content\nChanged outside the pipeline.\n");

    const [conflict] = detectClaudeAuthorityConflicts(targetHome, [
      { slug: "agents-md-1", targetPath: join(targetHome, "AGENTS.md"), content: "# Stored content\nAs registered.\n" },
    ]);

    expect(conflict?.kind).toBe("unknown-unmanaged-authority");
    expect(conflict?.provenance.detection).toBe("owned-config-drift");
    expect(conflict?.reason).toContain("agents-md-1");
  });
});
