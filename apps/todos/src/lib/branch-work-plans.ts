/**
 * Local branch work plans — git branch analysis, conflict detection,
 * and safe step-by-step work plans for agents. Fully local; no network required.
 */

import { spawnSync } from "node:child_process";
import { getCurrentBranch, resolveGitRoot } from "./git-traceability.js";

export const BRANCH_WORK_PLAN_SCHEMA = "todos.branch_work_plan.v1";

export type WorkPlanRisk = "low" | "medium" | "high";
export type WorkPlanStrategy = "noop" | "fast_forward" | "merge" | "rebase";

export interface BranchWorkPlanInput {
  cwd?: string;
  branch?: string;
  base_branch?: string;
  prefer_strategy?: "merge" | "rebase";
}

export interface BranchRefInfo {
  name: string;
  sha: string;
}

export interface BranchConflictFile {
  path: string;
  conflict_type: "both_modified" | "deleted_by_us" | "deleted_by_them" | "added_both" | "rename_or_mode";
  ours_changed: boolean;
  theirs_changed: boolean;
}

export interface BranchWorkAnalysis {
  schema_version: typeof BRANCH_WORK_PLAN_SCHEMA;
  repo_path: string;
  current_branch: string;
  branch: BranchRefInfo;
  base_branch: string;
  base: BranchRefInfo;
  merge_base: string | null;
  is_dirty: boolean;
  commits_ahead: number;
  commits_behind: number;
  files_changed_on_branch: string[];
  files_changed_on_base: string[];
  overlapping_files: string[];
  conflict_files: BranchConflictFile[];
  has_predicted_conflicts: boolean;
  analyzed_at: string;
}

export interface WorkPlanStep {
  order: number;
  action: string;
  command?: string;
  rationale: string;
  risk: WorkPlanRisk;
  blocking: boolean;
}

export interface SafeWorkPlan {
  schema_version: typeof BRANCH_WORK_PLAN_SCHEMA;
  analysis: BranchWorkAnalysis;
  strategy: WorkPlanStrategy;
  risk_level: WorkPlanRisk;
  safe_to_proceed: boolean;
  steps: WorkPlanStep[];
  warnings: string[];
  generated_at: string;
}

function runGit(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    ok: result.status === 0,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function branchExists(name: string, cwd: string): boolean {
  return runGit(["rev-parse", "--verify", name], cwd).ok;
}

function resolveBranchSha(name: string, cwd: string): string | null {
  const result = runGit(["rev-parse", name], cwd);
  return result.ok ? result.stdout : null;
}

export function resolveDefaultBaseBranch(cwd?: string): string {
  const dir = cwd || process.cwd();
  const root = resolveGitRoot(dir);
  if (!root) throw new Error("Not a git repository");

  for (const candidate of ["main", "master", "develop", "origin/main", "origin/master"]) {
    if (branchExists(candidate, root)) return candidate;
  }

  const current = getCurrentBranch(root);
  if (current) {
    const upstream = runGit(["rev-parse", "--abbrev-ref", `${current}@{upstream}`], root);
    if (upstream.ok && upstream.stdout) {
      const slash = upstream.stdout.lastIndexOf("/");
      const remoteBranch = slash >= 0 ? upstream.stdout.slice(slash + 1) : upstream.stdout;
      if (branchExists(remoteBranch, root)) return remoteBranch;
    }
  }

  throw new Error("Could not resolve base branch — pass base_branch explicitly");
}

function listChangedFiles(fromRef: string, toRef: string, cwd: string): string[] {
  const result = runGit(["diff", "--name-only", `${fromRef}..${toRef}`], cwd);
  if (!result.ok) return [];
  return result.stdout.split("\n").map((f) => f.trim()).filter(Boolean);
}

function countAheadBehind(base: string, branch: string, cwd: string): { ahead: number; behind: number } {
  const result = runGit(["rev-list", "--left-right", "--count", `${base}...${branch}`], cwd);
  if (!result.ok) return { ahead: 0, behind: 0 };
  const parts = result.stdout.split(/\s+/).map((n) => parseInt(n, 10));
  const behind = parts[0] ?? 0;
  const ahead = parts[1] ?? 0;
  return { ahead, behind };
}

function classifyConflictType(path: string, branchFiles: Set<string>, baseFiles: Set<string>): BranchConflictFile["conflict_type"] {
  const onBranch = branchFiles.has(path);
  const onBase = baseFiles.has(path);
  if (onBranch && onBase) return "both_modified";
  if (onBranch && !onBase) return "deleted_by_them";
  if (!onBranch && onBase) return "deleted_by_us";
  return "added_both";
}

function parseMergeTreeConflicts(output: string): BranchConflictFile[] {
  const conflicts: BranchConflictFile[] = [];
  const seen = new Set<string>();

  for (const line of output.split("\n")) {
    const match = line.match(/^CONFLICT \([^)]+\): Merge conflict in (.+)$/);
    if (!match?.[1]) continue;
    const path = match[1].trim();
    if (seen.has(path)) continue;
    seen.add(path);
    conflicts.push({
      path,
      conflict_type: "both_modified",
      ours_changed: true,
      theirs_changed: true,
    });
  }

  return conflicts;
}

function predictConflictsWithMergeTree(mergeBase: string, base: string, branch: string, cwd: string): BranchConflictFile[] {
  const result = runGit(["merge-tree", mergeBase, base, branch], cwd);
  if (!result.ok) return [];
  return parseMergeTreeConflicts(result.stdout);
}

function buildOverlapConflicts(
  overlapping: string[],
  branchFiles: string[],
  baseFiles: string[],
): BranchConflictFile[] {
  const branchSet = new Set(branchFiles);
  const baseSet = new Set(baseFiles);
  return overlapping.map((path) => ({
    path,
    conflict_type: classifyConflictType(path, branchSet, baseSet),
    ours_changed: branchSet.has(path),
    theirs_changed: baseSet.has(path),
  }));
}

export function analyzeBranchWork(input: BranchWorkPlanInput = {}): BranchWorkAnalysis {
  const cwd = input.cwd || process.cwd();
  const root = resolveGitRoot(cwd);
  if (!root) throw new Error("Not a git repository");

  const branchName = input.branch || getCurrentBranch(root);
  if (!branchName) throw new Error("Could not resolve current branch");

  const baseName = input.base_branch || resolveDefaultBaseBranch(root);
  if (!branchExists(branchName, root)) throw new Error(`Branch not found: ${branchName}`);
  if (!branchExists(baseName, root)) throw new Error(`Base branch not found: ${baseName}`);

  const branchSha = resolveBranchSha(branchName, root);
  const baseSha = resolveBranchSha(baseName, root);
  if (!branchSha || !baseSha) throw new Error("Could not resolve branch SHAs");

  const mergeBaseResult = runGit(["merge-base", baseName, branchName], root);
  const mergeBase = mergeBaseResult.ok ? mergeBaseResult.stdout : null;

  const dirty = runGit(["status", "--porcelain"], root).stdout.length > 0;
  const { ahead, behind } = countAheadBehind(baseName, branchName, root);

  const filesChangedOnBranch = mergeBase ? listChangedFiles(mergeBase, branchName, root) : [];
  const filesChangedOnBase = mergeBase ? listChangedFiles(mergeBase, baseName, root) : [];
  const overlapping = filesChangedOnBranch.filter((f) => filesChangedOnBase.includes(f));

  let conflictFiles: BranchConflictFile[] = [];
  if (mergeBase && branchName !== baseName) {
    conflictFiles = predictConflictsWithMergeTree(mergeBase, baseName, branchName, root);
    if (conflictFiles.length === 0 && overlapping.length > 0) {
      conflictFiles = buildOverlapConflicts(overlapping, filesChangedOnBranch, filesChangedOnBase);
    }
  }

  const hasPredictedConflicts = conflictFiles.some((c) => c.conflict_type === "both_modified" || c.conflict_type === "added_both");

  return {
    schema_version: BRANCH_WORK_PLAN_SCHEMA,
    repo_path: root,
    current_branch: getCurrentBranch(root) ?? branchName,
    branch: { name: branchName, sha: branchSha },
    base_branch: baseName,
    base: { name: baseName, sha: baseSha },
    merge_base: mergeBase,
    is_dirty: dirty,
    commits_ahead: ahead,
    commits_behind: behind,
    files_changed_on_branch: filesChangedOnBranch,
    files_changed_on_base: filesChangedOnBase,
    overlapping_files: overlapping,
    conflict_files: conflictFiles,
    has_predicted_conflicts: hasPredictedConflicts,
    analyzed_at: new Date().toISOString(),
  };
}

function chooseStrategy(analysis: BranchWorkAnalysis, prefer?: "merge" | "rebase"): WorkPlanStrategy {
  if (analysis.branch.name === analysis.base_branch) return "noop";
  if (analysis.commits_ahead === 0 && analysis.commits_behind === 0) return "noop";
  if (analysis.commits_ahead === 0 && analysis.commits_behind > 0) return "fast_forward";
  return prefer ?? (analysis.has_predicted_conflicts ? "merge" : "rebase");
}

function assessRiskLevel(analysis: BranchWorkAnalysis, strategy: WorkPlanStrategy): WorkPlanRisk {
  if (analysis.is_dirty) return "high";
  if (analysis.has_predicted_conflicts) return "high";
  if (analysis.overlapping_files.length > 0) return "medium";
  if (analysis.commits_behind > 0 && strategy === "rebase") return "medium";
  if (analysis.commits_ahead === 0 && analysis.commits_behind > 0) return "low";
  return "low";
}

function buildWorkPlanSteps(
  analysis: BranchWorkAnalysis,
  strategy: WorkPlanStrategy,
): WorkPlanStep[] {
  const steps: WorkPlanStep[] = [];
  let order = 1;
  const branch = analysis.branch.name;
  const base = analysis.base_branch;

  const push = (step: Omit<WorkPlanStep, "order">) => {
    steps.push({ ...step, order: order++ });
  };

  if (analysis.branch.name === analysis.base_branch) {
    push({
      action: "noop",
      rationale: "Already on base branch — no integration work required",
      risk: "low",
      blocking: false,
    });
    return steps;
  }

  if (analysis.is_dirty) {
    push({
      action: "stash_or_commit",
      command: "git status && git stash push -u -m 'todos: branch-plan checkpoint'",
      rationale: "Working tree has uncommitted changes — stash or commit before integrating",
      risk: "high",
      blocking: true,
    });
  }

  if (analysis.commits_behind > 0) {
    push({
      action: "update_base_ref",
      command: `git fetch origin ${base} 2>/dev/null || git checkout ${base} && git pull --ff-only 2>/dev/null || true`,
      rationale: `${analysis.commits_behind} commit(s) behind ${base} — refresh base reference when network is available`,
      risk: "low",
      blocking: false,
    });
  }

  if (strategy === "fast_forward") {
    push({
      action: "fast_forward",
      command: `git checkout ${branch} && git merge --ff-only ${base}`,
      rationale: "Branch is behind base with no unique commits — fast-forward to catch up",
      risk: "low",
      blocking: true,
    });
    return steps;
  }

  if (strategy === "rebase") {
    push({
      action: "rebase_onto_base",
      command: `git checkout ${branch} && git rebase ${base}`,
      rationale: "Replay branch commits on top of latest base for a linear history",
      risk: analysis.overlapping_files.length > 0 ? "medium" : "low",
      blocking: true,
    });
  } else if (strategy === "merge") {
    push({
      action: "merge_base_into_branch",
      command: `git checkout ${branch} && git merge ${base}`,
      rationale: "Merge base into feature branch to integrate upstream changes",
      risk: analysis.has_predicted_conflicts ? "high" : "medium",
      blocking: true,
    });
  }

  for (const conflict of analysis.conflict_files.filter((c) => c.conflict_type === "both_modified" || c.conflict_type === "added_both")) {
    push({
      action: "resolve_conflict",
      command: `git checkout --ours -- ${conflict.path}; git checkout --theirs -- ${conflict.path}; # edit ${conflict.path} manually`,
      rationale: `Resolve merge conflict in ${conflict.path}`,
      risk: "high",
      blocking: true,
    });
  }

  if (analysis.conflict_files.length > 0) {
    push({
      action: "continue_integration",
      command: strategy === "rebase" ? "git rebase --continue" : "git merge --continue",
      rationale: "Complete rebase or merge after conflicts are resolved",
      risk: "medium",
      blocking: true,
    });
  }

  push({
    action: "verify",
    command: "bun test",
    rationale: "Run project test suite after integration",
    risk: "low",
    blocking: false,
  });

  push({
    action: "review_diff",
    command: `git diff ${base}...${branch}`,
    rationale: "Review final diff against base before opening or updating PR",
    risk: "low",
    blocking: false,
  });

  return steps;
}

function buildWarnings(analysis: BranchWorkAnalysis, strategy: WorkPlanStrategy): string[] {
  const warnings: string[] = [];
  if (analysis.is_dirty) warnings.push("Working tree is dirty — commit or stash before integrating");
  if (analysis.commits_behind > 0) warnings.push(`Branch is ${analysis.commits_behind} commit(s) behind ${analysis.base_branch}`);
  if (analysis.has_predicted_conflicts) {
    warnings.push(`${analysis.conflict_files.length} file(s) may conflict during integration`);
  } else if (analysis.overlapping_files.length > 0) {
    warnings.push(`${analysis.overlapping_files.length} overlapping file(s) touched on both branches — review carefully`);
  }
  if (strategy === "rebase" && analysis.commits_ahead > 0 && analysis.commits_behind > 0) {
    warnings.push("Rebase rewrites history — avoid if branch is already pushed and shared");
  }
  if (analysis.branch.name === analysis.base_branch) {
    warnings.push("Branch equals base — switch to a feature branch to plan integration work");
  }
  return warnings;
}

export function generateSafeWorkPlan(input: BranchWorkPlanInput = {}): SafeWorkPlan {
  const analysis = analyzeBranchWork(input);
  const strategy = chooseStrategy(analysis, input.prefer_strategy);
  const riskLevel = assessRiskLevel(analysis, strategy);
  const steps = buildWorkPlanSteps(analysis, strategy);
  const warnings = buildWarnings(analysis, strategy);

  const safeToProceed = !analysis.is_dirty
    && !analysis.has_predicted_conflicts
    && analysis.branch.name !== analysis.base_branch;

  return {
    schema_version: BRANCH_WORK_PLAN_SCHEMA,
    analysis,
    strategy,
    risk_level: riskLevel,
    safe_to_proceed: safeToProceed,
    steps,
    warnings,
    generated_at: new Date().toISOString(),
  };
}

export function formatSafeWorkPlanMarkdown(plan: SafeWorkPlan): string {
  const { analysis: a } = plan;
  const lines: string[] = [
    `# Branch work plan: ${a.branch.name} → ${a.base_branch}`,
    "",
    `- **Risk:** ${plan.risk_level}`,
    `- **Strategy:** ${plan.strategy}`,
    `- **Safe to proceed:** ${plan.safe_to_proceed ? "yes" : "no"}`,
    `- **Ahead / behind:** +${a.commits_ahead} / -${a.commits_behind}`,
    `- **Dirty working tree:** ${a.is_dirty ? "yes" : "no"}`,
    "",
  ];

  if (plan.warnings.length) {
    lines.push("## Warnings", "");
    for (const w of plan.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  if (a.overlapping_files.length) {
    lines.push("## Overlapping files", "");
    for (const f of a.overlapping_files.slice(0, 20)) lines.push(`- ${f}`);
    if (a.overlapping_files.length > 20) lines.push(`- … and ${a.overlapping_files.length - 20} more`);
    lines.push("");
  }

  if (a.conflict_files.length) {
    lines.push("## Predicted conflicts", "");
    for (const c of a.conflict_files.slice(0, 20)) {
      lines.push(`- \`${c.path}\` (${c.conflict_type})`);
    }
    lines.push("");
  }

  lines.push("## Steps", "");
  for (const step of plan.steps) {
    lines.push(`### ${step.order}. ${step.action}`);
    lines.push(`- ${step.rationale}`);
    lines.push(`- Risk: ${step.risk}${step.blocking ? " (blocking)" : ""}`);
    if (step.command) lines.push(`- \`${step.command}\``);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function formatSafeWorkPlanText(plan: SafeWorkPlan): string {
  const { analysis: a } = plan;
  const lines: string[] = [
    `Branch: ${a.branch.name} (${a.branch.sha.slice(0, 7)})`,
    `Base: ${a.base_branch} (${a.base.sha.slice(0, 7)})`,
    `Strategy: ${plan.strategy} | Risk: ${plan.risk_level} | Safe: ${plan.safe_to_proceed}`,
    `Ahead: ${a.commits_ahead} | Behind: ${a.commits_behind} | Dirty: ${a.is_dirty}`,
  ];

  if (plan.warnings.length) {
    lines.push("", "Warnings:");
    for (const w of plan.warnings) lines.push(`  - ${w}`);
  }

  lines.push("", "Steps:");
  for (const step of plan.steps) {
    const cmd = step.command ? ` → ${step.command}` : "";
    lines.push(`  ${step.order}. [${step.risk}] ${step.action}${cmd}`);
  }

  return lines.join("\n");
}

export function getBranchWorkPlanDocs(): string {
  return `# Branch work plans

Local git branch analysis and safe integration plans for agents. No network required for core analysis.

## CLI

\`\`\`bash
todos branch-plan plan [--branch <name>] [--base <name>] [--strategy merge|rebase]
todos branch-plan analyze [--branch <name>] [--base <name>]
todos git plan   # alias for branch-plan plan
todos branch-plan docs
\`\`\`

## MCP

- \`analyze_branch_work\` — branch diff stats, overlapping files, predicted conflicts
- \`generate_branch_work_plan\` — full safe work plan with ordered steps
- \`get_branch_work_plan_docs\` — this documentation

## Schema

\`${BRANCH_WORK_PLAN_SCHEMA}\`

Conflict prediction uses \`git merge-tree\` when available, with overlapping-file heuristics as fallback.
`;
}
