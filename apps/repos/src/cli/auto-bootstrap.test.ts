import { afterEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createTestRepo(workspaceRoot: string, name: string): string {
  const repoPath = join(workspaceRoot, name);
  mkdirSync(repoPath, { recursive: true });
  execSync("git init", { cwd: repoPath, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: "pipe" });
  execSync('git config user.name "Test User"', { cwd: repoPath, stdio: "pipe" });
  writeFileSync(join(repoPath, "README.md"), "# auto bootstrap");
  execSync("git add README.md", { cwd: repoPath, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: repoPath, stdio: "pipe" });
  return repoPath;
}

let tempDir = "";

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

describe("cli auto bootstrap", () => {
  it("indexes the workspace on first read command", () => {
    tempDir = mkdtempSync(join(tmpdir(), "open-repos-cli-"));
    const homeDir = join(tempDir, "home");
    const workspaceRoot = join(homeDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const repoPath = createTestRepo(workspaceRoot, "workspace-repo");

    const env = {
      ...process.env,
      HOME: homeDir,
      HASNA_REPOS_DB_PATH: join(tempDir, "repos.db"),
      HASNA_REPOS_CONFIG_PATH: join(tempDir, "config.json"),
      HASNA_REPOS_HOOK_QUEUE_PATH: join(tempDir, "hook-events.tsv"),
    };

    const output = execSync("bun run src/cli/index.tsx repos --json", {
      cwd: join(import.meta.dir, "../.."),
      env,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const repos = JSON.parse(output) as Array<{ name: string }>;
    const hookContent = readFileSync(join(repoPath, ".git", "hooks", "post-commit"), "utf-8");

    expect(repos.some((repo) => repo.name === "workspace-repo")).toBe(true);
    expect(hookContent).toContain("hasna repos auto-index");
  });
});
