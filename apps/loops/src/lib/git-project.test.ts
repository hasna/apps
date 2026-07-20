import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
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

  test("accepts ordinary repo subdirectories whose names begin with two dots", () => {
    const repo = createRepo("loops-git-project-dotdot-prefix-");
    const subdir = join(repo, "..sdk");
    mkdirSync(subdir);

    expect(gitProjectRootForPath(subdir)).toBe(repo);
    expect(isExistingGitProjectPath(subdir)).toBe(true);
  });

  test("rejects generated directories nested inside a repo checkout", () => {
    const repo = createRepo("loops-git-project-generated-");
    for (const generatedDir of [".tmp", ".bun-cache", "node_modules", "dist"]) {
      const generatedPath = join(repo, "packages", "sdk", generatedDir, "route-candidate");
      mkdirSync(generatedPath, { recursive: true });
      chmodSync(generatedPath, 0o700);

      expect(gitProjectRootForPath(generatedPath)).toBeUndefined();
      expect(isExistingGitProjectPath(generatedPath)).toBe(false);
    }
  });

  test("rejects generated lexical paths even when a symlink resolves to an ordinary repo directory", () => {
    const repo = createRepo("loops-git-project-generated-symlink-");
    const ordinary = join(repo, "ordinary");
    mkdirSync(ordinary);
    for (const generatedDir of [".tmp", ".bun-cache", "node_modules", "dist"]) {
      const generatedRoot = join(repo, generatedDir);
      const generatedAlias = join(generatedRoot, "route-candidate");
      mkdirSync(generatedRoot);
      symlinkSync("../ordinary", generatedAlias, "dir");

      expect(realpathSync(generatedAlias)).toBe(realpathSync(ordinary));
      expect(gitProjectRootForPath(generatedAlias)).toBeUndefined();
      expect(isExistingGitProjectPath(generatedAlias)).toBe(false);
    }
  });

  test("rejects ordinary lexical aliases when their canonical target is generated", () => {
    const repo = createRepo("loops-git-project-canonical-generated-");
    const generatedTarget = join(repo, ".tmp", "route-candidate");
    const ordinaryAlias = join(repo, "ordinary-alias");
    mkdirSync(generatedTarget, { recursive: true });
    symlinkSync(".tmp/route-candidate", ordinaryAlias, "dir");

    expect(realpathSync(ordinaryAlias)).toBe(realpathSync(generatedTarget));
    expect(gitProjectRootForPath(ordinaryAlias)).toBeUndefined();
    expect(isExistingGitProjectPath(ordinaryAlias)).toBe(false);
  });

  test("rejects generated lexical paths that point into a different repository", () => {
    const sourceRepo = createRepo("loops-git-project-cross-source-");
    const targetRepo = createRepo("loops-git-project-cross-target-");
    const targetOrdinary = join(targetRepo, "ordinary");
    const generatedRoot = join(sourceRepo, ".tmp");
    const generatedAlias = join(generatedRoot, "cross-repo-link");
    mkdirSync(targetOrdinary);
    mkdirSync(generatedRoot);
    symlinkSync(targetOrdinary, generatedAlias, "dir");

    expect(realpathSync(generatedAlias)).toBe(realpathSync(targetOrdinary));
    expect(gitProjectRootForPath(generatedAlias)).toBeUndefined();
    expect(isExistingGitProjectPath(generatedAlias)).toBe(false);
  });

  test("rejects subdirectories of nested repositories located under generated paths", () => {
    const outerRepo = createRepo("loops-git-project-nested-generated-");
    for (const generatedDir of [".tmp", ".bun-cache", "node_modules", "dist"]) {
      const innerRepo = join(outerRepo, generatedDir, "candidate");
      const innerSubdir = join(innerRepo, "subdir");
      mkdirSync(innerSubdir, { recursive: true });
      git(innerRepo, ["init"]);

      expect(gitProjectRootForPath(innerRepo)).toBeUndefined();
      expect(gitProjectRootForPath(innerSubdir)).toBeUndefined();
      expect(isExistingGitProjectPath(innerSubdir)).toBe(false);
    }
  });
});
