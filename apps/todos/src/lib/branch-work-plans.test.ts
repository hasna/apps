import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  analyzeBranchWork,
  generateSafeWorkPlan,
  resolveDefaultBaseBranch,
  formatSafeWorkPlanMarkdown,
  formatSafeWorkPlanText,
  getBranchWorkPlanDocs,
  BRANCH_WORK_PLAN_SCHEMA,
} from "./branch-work-plans.js";

let tempDir: string;

function git(args: string[], cwd: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

function initRepo(dir: string): void {
  git(["init"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test User"], dir);
}

function seedMainBranch(dir: string, content = "main line\n"): void {
  writeFileSync(join(dir, "file.txt"), content);
  git(["add", "."], dir);
  git(["commit", "-m", "initial main"], dir);
  git(["branch", "-M", "main"], dir);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "branch-plan-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("resolveDefaultBaseBranch", () => {
  it("prefers main when present", () => {
    initRepo(tempDir);
    seedMainBranch(tempDir);
    expect(resolveDefaultBaseBranch(tempDir)).toBe("main");
  });

  it("falls back to master", () => {
    initRepo(tempDir);
    writeFileSync(join(tempDir, "file.txt"), "x\n");
    git(["add", "."], tempDir);
    git(["commit", "-m", "init"], tempDir);
    git(["branch", "-M", "master"], tempDir);
    expect(resolveDefaultBaseBranch(tempDir)).toBe("master");
  });
});

describe("analyzeBranchWork", () => {
  it("reports ahead/behind and changed files on a feature branch", () => {
    initRepo(tempDir);
    seedMainBranch(tempDir);
    git(["checkout", "-b", "feature/a"], tempDir);
    writeFileSync(join(tempDir, "feature.txt"), "feature\n");
    git(["add", "feature.txt"], tempDir);
    git(["commit", "-m", "add feature file"], tempDir);

    const analysis = analyzeBranchWork({ cwd: tempDir, branch: "feature/a", base_branch: "main" });

    expect(analysis.schema_version).toBe(BRANCH_WORK_PLAN_SCHEMA);
    expect(analysis.branch.name).toBe("feature/a");
    expect(analysis.base_branch).toBe("main");
    expect(analysis.commits_ahead).toBe(1);
    expect(analysis.commits_behind).toBe(0);
    expect(analysis.files_changed_on_branch).toContain("feature.txt");
    expect(analysis.has_predicted_conflicts).toBe(false);
  });

  it("detects overlapping files when base moved forward", () => {
    initRepo(tempDir);
    seedMainBranch(tempDir);
    git(["checkout", "-b", "feature/conflict"], tempDir);
    writeFileSync(join(tempDir, "file.txt"), "feature change\n");
    git(["add", "file.txt"], tempDir);
    git(["commit", "-m", "feature edit"], tempDir);

    git(["checkout", "main"], tempDir);
    writeFileSync(join(tempDir, "file.txt"), "main change\n");
    git(["add", "file.txt"], tempDir);
    git(["commit", "-m", "main edit"], tempDir);

    git(["checkout", "feature/conflict"], tempDir);
    const analysis = analyzeBranchWork({ cwd: tempDir, branch: "feature/conflict", base_branch: "main" });

    expect(analysis.commits_behind).toBe(1);
    expect(analysis.overlapping_files).toContain("file.txt");
    expect(analysis.conflict_files.some((c) => c.path === "file.txt")).toBe(true);
  });

  it("flags dirty working tree", () => {
    initRepo(tempDir);
    seedMainBranch(tempDir);
    git(["checkout", "-b", "feature/dirty"], tempDir);
    writeFileSync(join(tempDir, "dirty.txt"), "uncommitted\n");

    const analysis = analyzeBranchWork({ cwd: tempDir, branch: "feature/dirty", base_branch: "main" });
    expect(analysis.is_dirty).toBe(true);
  });

  it("throws outside a git repository", () => {
    const empty = mkdtempSync(join(tmpdir(), "branch-plan-empty-"));
    try {
      expect(() => analyzeBranchWork({ cwd: empty })).toThrow(/git repository/i);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("generateSafeWorkPlan", () => {
  it("produces low-risk fast-forward plan when only behind base", () => {
    initRepo(tempDir);
    seedMainBranch(tempDir);
    git(["checkout", "-b", "feature/behind"], tempDir);

    git(["checkout", "main"], tempDir);
    writeFileSync(join(tempDir, "main-only.txt"), "main\n");
    git(["add", "main-only.txt"], tempDir);
    git(["commit", "-m", "main only"], tempDir);

    git(["checkout", "feature/behind"], tempDir);
    const plan = generateSafeWorkPlan({ cwd: tempDir, branch: "feature/behind", base_branch: "main" });

    expect(plan.strategy).toBe("fast_forward");
    expect(plan.risk_level).toBe("low");
    expect(plan.steps.some((s) => s.action === "fast_forward")).toBe(true);
  });

  it("uses merge strategy and high risk when conflicts predicted", () => {
    initRepo(tempDir);
    seedMainBranch(tempDir);
    git(["checkout", "-b", "feature/conflict"], tempDir);
    writeFileSync(join(tempDir, "file.txt"), "feature change\n");
    git(["add", "file.txt"], tempDir);
    git(["commit", "-m", "feature edit"], tempDir);

    git(["checkout", "main"], tempDir);
    writeFileSync(join(tempDir, "file.txt"), "main change\n");
    git(["add", "file.txt"], tempDir);
    git(["commit", "-m", "main edit"], tempDir);

    git(["checkout", "feature/conflict"], tempDir);
    const plan = generateSafeWorkPlan({
      cwd: tempDir,
      branch: "feature/conflict",
      base_branch: "main",
      prefer_strategy: "merge",
    });

    expect(plan.strategy).toBe("merge");
    expect(plan.risk_level).toBe("high");
    expect(plan.safe_to_proceed).toBe(false);
    expect(plan.steps.some((s) => s.action === "resolve_conflict")).toBe(true);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it("formats markdown and text summaries", () => {
    initRepo(tempDir);
    seedMainBranch(tempDir);
    const plan = generateSafeWorkPlan({ cwd: tempDir, branch: "main", base_branch: "main" });
    const md = formatSafeWorkPlanMarkdown(plan);
    const text = formatSafeWorkPlanText(plan);
    expect(md).toContain("Branch work plan");
    expect(text).toContain("Strategy:");
    expect(getBranchWorkPlanDocs()).toContain("analyze_branch_work");
  });

  it("defaults to rebase for clean diverged branches", () => {
    initRepo(tempDir);
    seedMainBranch(tempDir);
    git(["checkout", "-b", "feature/clean"], tempDir);
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(join(tempDir, "src/new.ts"), "export const x = 1;\n");
    git(["add", "src/new.ts"], tempDir);
    git(["commit", "-m", "add src"], tempDir);

    git(["checkout", "main"], tempDir);
    writeFileSync(join(tempDir, "readme.md"), "# readme\n");
    git(["add", "readme.md"], tempDir);
    git(["commit", "-m", "add readme"], tempDir);

    git(["checkout", "feature/clean"], tempDir);
    const plan = generateSafeWorkPlan({ cwd: tempDir, branch: "feature/clean", base_branch: "main" });

    expect(plan.strategy).toBe("rebase");
    expect(plan.analysis.overlapping_files).toHaveLength(0);
  });
});
