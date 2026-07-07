import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { gitProjectRootForPath, isExistingGitProjectPath } from "./git-project.js";

function git(repo: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  expect(result.status).toBe(0);
}

function createRepo(prefix: string): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "loops-test@example.com"]);
  git(repo, ["config", "user.name", "Loops Test"]);
  mkdirSync(join(repo, "packages", "sdk"), { recursive: true });
  writeFileSync(join(repo, "packages", "sdk", "README.md"), "# sdk\n");
  git(repo, ["add", "packages/sdk/README.md"]);
  git(repo, ["commit", "-m", "init"]);
  return realpathSync(repo);
}

describe("git project path helpers", () => {
  test("accepts ordinary repo subdirectories", () => {
    const repo = createRepo("loops-git-project-subdir-");
    const subdir = join(repo, "packages", "sdk");

    expect(gitProjectRootForPath(subdir)).toBe(repo);
    expect(isExistingGitProjectPath(subdir)).toBe(true);
  });

  test("rejects generated directories nested inside a repo checkout", () => {
    const repo = createRepo("loops-git-project-generated-");
    const tmpPath = join(repo, "packages", "sdk", ".tmp", "route-candidate");
    const cachePath = join(repo, "packages", "sdk", ".bun-cache", "route-candidate");
    mkdirSync(tmpPath, { recursive: true });
    mkdirSync(cachePath, { recursive: true });
    chmodSync(tmpPath, 0o700);
    chmodSync(cachePath, 0o700);

    expect(gitProjectRootForPath(tmpPath)).toBeUndefined();
    expect(gitProjectRootForPath(cachePath)).toBeUndefined();
    expect(isExistingGitProjectPath(tmpPath)).toBe(false);
    expect(isExistingGitProjectPath(cachePath)).toBe(false);
  });
});
