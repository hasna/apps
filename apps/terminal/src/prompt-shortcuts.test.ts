import { describe, expect, it } from "bun:test";
import { getPromptShortcut } from "./prompt-shortcuts.js";

describe("getPromptShortcut", () => {
  it("maps common git-change prompts without an AI provider", () => {
    expect(getPromptShortcut("summarize the current changes")?.command).toBe("git status --short --branch");
    expect(getPromptShortcut("what changed in git")?.command).toBe("git status --short --branch");
  });

  it("maps test and typecheck workflows to local commands", () => {
    expect(getPromptShortcut("what tests exist")?.command).toContain("-name '*.test.ts'");
    expect(getPromptShortcut("run typecheck")?.command).toBe("bun run typecheck");
    expect(getPromptShortcut("run tests")?.command).toBe("bun test");
  });

  it("maps debug search prompts to a deterministic ripgrep query", () => {
    const shortcut = getPromptShortcut("find TODOs and tests");
    expect(shortcut?.command).toContain("TODO|FIXME");
    expect(shortcut?.command).toContain("describe");
  });

  it("does not rewrite unrelated prompts", () => {
    expect(getPromptShortcut("explain the release architecture")).toBeNull();
  });
});
