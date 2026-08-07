import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliEntry = join(import.meta.dir, "..", "index.tsx");
const syntheticGitHubToken = ["ghp", "A".repeat(36)].join("_");

describe("review staged-diff boundary", () => {
  let fixtureRoot = "";

  afterEach(() => {
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = "";
  });

  function createRepo(name: string): string {
    if (!fixtureRoot) fixtureRoot = mkdtempSync(join(tmpdir(), "shield-review-"));
    const repo = join(fixtureRoot, name);
    mkdirSync(repo);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: repo });
    return repo;
  }

  function commitAll(repo: string, message: string): void {
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-qm", message], { cwd: repo });
  }

  function runReview(repo: string) {
    return spawnSync("bun", ["run", cliEntry, "review"], {
      cwd: repo,
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: join(fixtureRoot, "home"),
        USERPROFILE: join(fixtureRoot, "home"),
        SECURITY_DB: join(fixtureRoot, "shield.db"),
        CEREBRAS_API_KEY: "",
        NO_COLOR: "1",
      },
    });
  }

  test("reports added vulnerable lines and excludes unchanged vulnerable lines", () => {
    const unchangedRepo = createRepo("unchanged");
    writeFileSync(join(unchangedRepo, "sample.ts"), "target.innerHTML = input;\n");
    commitAll(unchangedRepo, "baseline vulnerable line");
    writeFileSync(
      join(unchangedRepo, "sample.ts"),
      "target.innerHTML = input;\nconst safe = true;\n",
    );
    execFileSync("git", ["add", "sample.ts"], { cwd: unchangedRepo });

    const unchanged = runReview(unchangedRepo);
    expect(unchanged.status).toBe(0);
    expect(unchanged.stderr).toBe("");
    expect(unchanged.stdout).toContain("No security issues found in staged changes.");
    expect(unchanged.stdout).not.toContain("sample.ts:1");

    const addedRepo = createRepo("added");
    writeFileSync(join(addedRepo, "sample.ts"), "const safe = true;\n");
    commitAll(addedRepo, "safe baseline");
    writeFileSync(
      join(addedRepo, "sample.ts"),
      "const safe = true;\ntarget.innerHTML = input;\n",
    );
    execFileSync("git", ["add", "sample.ts"], { cwd: addedRepo });

    const added = runReview(addedRepo);
    expect(added.status).toBe(0);
    expect(added.stderr).toBe("");
    expect(added.stdout).toContain("HIGH  sample.ts:2");
    expect(added.stdout).not.toContain("No security issues found in staged changes.");
  });

  test("scans staged test files with the same coverage as non-test files", () => {
    const testRepo = createRepo("test-file");
    writeFileSync(
      join(testRepo, "fixture.test.ts"),
      `const token = "${syntheticGitHubToken}";\n`,
    );
    execFileSync("git", ["add", "fixture.test.ts"], { cwd: testRepo });

    const testFile = runReview(testRepo);
    expect(testFile.status).toBe(0);
    expect(testFile.stderr).toBe("");
    expect(testFile.stdout).toContain("CRITICAL  fixture.test.ts:1");

    const sourceRepo = createRepo("source-file");
    writeFileSync(join(sourceRepo, "fixture.ts"), `const token = "${syntheticGitHubToken}";\n`);
    execFileSync("git", ["add", "fixture.ts"], { cwd: sourceRepo });

    const sourceFile = runReview(sourceRepo);
    expect(sourceFile.status).toBe(0);
    expect(sourceFile.stderr).toBe("");
    expect(sourceFile.stdout).toContain("CRITICAL  fixture.ts:1");
  });

  test("treats staged filenames as literal git pathspecs", () => {
    const repo = createRepo("literal-pathspec");
    const fileName = ":(literal)fixture.ts";
    writeFileSync(join(repo, fileName), `const token = "${syntheticGitHubToken}";\n`);
    execFileSync("git", ["--literal-pathspecs", "add", "--", fileName], { cwd: repo });

    const result = runReview(repo);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`CRITICAL  ${fileName}:1`);
    expect(result.stdout).not.toContain("No security issues found in staged changes.");

    const normalRepo = createRepo("normal-pathspec-control");
    writeFileSync(
      join(normalRepo, "fixture.ts"),
      `const token = "${syntheticGitHubToken}";\n`,
    );
    execFileSync("git", ["add", "--", "fixture.ts"], { cwd: normalRepo });

    const normal = runReview(normalRepo);
    expect(normal.status).toBe(0);
    expect(normal.stderr).toBe("");
    expect(normal.stdout).toContain("CRITICAL  fixture.ts:1");

    const safeRepo = createRepo("safe-pathspec-control");
    writeFileSync(join(safeRepo, "fixture.ts"), "const safe = true;\n");
    execFileSync("git", ["add", "--", "fixture.ts"], { cwd: safeRepo });

    const safe = runReview(safeRepo);
    expect(safe.status).toBe(0);
    expect(safe.stderr).toBe("");
    expect(safe.stdout).toContain("No security issues found in staged changes.");
  });

  test("scans the staged index content rather than later unstaged edits", () => {
    const repo = createRepo("index-content");
    writeFileSync(join(repo, "fixture.ts"), "const safe = true;\n");
    execFileSync("git", ["add", "fixture.ts"], { cwd: repo });
    writeFileSync(join(repo, "fixture.ts"), `const token = "${syntheticGitHubToken}";\n`);

    const result = runReview(repo);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("No security issues found in staged changes.");
    expect(result.stdout).not.toContain("CRITICAL  fixture.ts:1");
  });
});
