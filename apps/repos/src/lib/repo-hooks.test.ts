import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HOOK_MARKER_START, drainHookQueue, installPostCommitHook } from "./repo-hooks";

const TEST_DIR = join(import.meta.dir, "../../.test-hooks");

function createTestRepo(name: string): string {
  const repoPath = join(TEST_DIR, name);
  mkdirSync(repoPath, { recursive: true });
  execSync("git init", { cwd: repoPath, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: "pipe" });
  execSync('git config user.name "Test User"', { cwd: repoPath, stdio: "pipe" });
  writeFileSync(join(repoPath, "README.md"), "# test");
  execSync("git add README.md", { cwd: repoPath, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: repoPath, stdio: "pipe" });
  return repoPath;
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  process.env["HASNA_REPOS_HOOK_QUEUE_PATH"] = join(TEST_DIR, "hook-events.tsv");
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env["HASNA_REPOS_HOOK_QUEUE_PATH"];
});

describe("repo-hooks", () => {
  it("installs the automation block without clobbering existing hooks", () => {
    const repoPath = createTestRepo("hooked-repo");
    const hookPath = join(repoPath, ".git", "hooks", "post-commit");
    writeFileSync(hookPath, "#!/bin/sh\necho existing-hook\n");

    const result = installPostCommitHook(repoPath);
    const content = readFileSync(hookPath, "utf-8");

    expect(result.status).toBe("updated");
    expect(content).toContain("echo existing-hook");
    expect(content).toContain(HOOK_MARKER_START);
    expect(content).toContain(process.env["HASNA_REPOS_HOOK_QUEUE_PATH"]!);
  });

  it("drains and deduplicates queued repo paths", () => {
    const queuePath = process.env["HASNA_REPOS_HOOK_QUEUE_PATH"]!;
    writeFileSync(queuePath, [
      "2026-04-08T13:00:00Z\t/tmp/repo-a",
      "2026-04-08T13:00:01Z\t/tmp/repo-a",
      "2026-04-08T13:00:02Z\t/tmp/repo-b",
    ].join("\n"));

    const repos = drainHookQueue(queuePath);

    expect(repos).toEqual([
      resolve("/tmp/repo-a"),
      resolve("/tmp/repo-b"),
    ]);
    expect(readFileSync(queuePath, "utf-8")).toBe("");
  });
});
