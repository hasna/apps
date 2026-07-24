import type { Database } from "bun:sqlite";
import { relative, resolve } from "node:path";
import { getTaskCommits, getTaskGitRefs, getTaskVerifications } from "../db/task-commits.js";
import { getDatabase } from "../db/database.js";
import { getTask } from "../db/tasks.js";
import { getTaskRunLedger, listTaskRuns, type TaskRun, type TaskRunArtifact, type TaskRunCommand } from "../db/task-runs.js";
import type { Task, TaskStatus } from "../types/index.js";
import { loadConfig, saveConfig, type PolicyPackConfig, type TodosConfig } from "./config.js";

export interface UpsertPolicyPackInput {
  name: string;
  root?: string;
  version?: number;
  required_commands?: string[];
  prohibited_commands?: string[];
  prohibited_paths?: string[];
  required_statuses?: string[];
  require_passed_verification?: boolean;
  require_commit?: boolean;
  require_pull_request?: boolean;
  require_approval?: boolean;
  require_run?: boolean;
  require_artifact?: boolean;
  evidence_min_count?: number;
  branch_pattern?: string;
}

export interface ValidatePolicyPackInput {
  name: string;
  task_id: string;
  root?: string;
  explain?: boolean;
}

export type PolicyFindingStatus = "pass" | "fail";
export type PolicyFindingSeverity = "info" | "error";

export interface PolicyPackFinding {
  id: string;
  status: PolicyFindingStatus;
  severity: PolicyFindingSeverity;
  message: string;
  evidence: string[];
}

export interface PolicyEvidenceSummary {
  task: {
    id: string;
    title: string;
    status: TaskStatus;
    requires_approval: boolean;
    approved_by: string | null;
    approved_at: string | null;
  };
  verifications: Array<{ command: string; status: string; artifact_path: string | null }>;
  commits: Array<{ sha: string; files_changed: string[] }>;
  git_refs: Array<{ ref_type: string; name: string; url: string | null }>;
  runs: Array<{ id: string; status: string; title: string | null }>;
  run_commands: Array<{ command: string; status: string; artifact_path: string | null }>;
  artifacts: string[];
  files: string[];
  evidence_count: number;
}

export interface PolicyPackValidationResult {
  pack: PolicyPackConfig;
  task_id: string;
  mode: "validate" | "explain";
  passed: boolean;
  findings: PolicyPackFinding[];
  audit_evidence: PolicyEvidenceSummary;
}

interface GatheredEvidence {
  task: Task;
  verifications: ReturnType<typeof getTaskVerifications>;
  commits: ReturnType<typeof getTaskCommits>;
  gitRefs: ReturnType<typeof getTaskGitRefs>;
  runs: TaskRun[];
  runCommands: TaskRunCommand[];
  artifacts: TaskRunArtifact[];
  files: string[];
}

function normalizePath(path: string): string {
  return resolve(path);
}

function unique(values: string[] | undefined): string[] {
  return Array.from(new Set((values || []).map((value) => value.trim()).filter(Boolean)));
}

function parseStatuses(values: string[] | undefined): string[] {
  const allowed = new Set(["pending", "in_progress", "completed", "failed", "cancelled"]);
  return unique(values).filter((value) => allowed.has(value));
}

function configuredPacks(config: TodosConfig = loadConfig()): PolicyPackConfig[] {
  return Object.values(config.policy_packs || {})
    .map((pack) => ({ ...pack, root: normalizePath(pack.root) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function defaultPolicyPack(name: string, root: string): PolicyPackConfig {
  return {
    name,
    version: 1,
    root: normalizePath(root),
    required_commands: [],
    prohibited_commands: ["npm install -g", "git reset --hard", "git checkout --", "rm -rf"],
    prohibited_paths: [],
    required_statuses: [],
    require_passed_verification: false,
    require_commit: false,
    require_pull_request: false,
    require_approval: false,
    require_run: false,
    require_artifact: false,
    evidence_min_count: 0,
  };
}

function isPathInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/") && !/^[A-Za-z]:/.test(rel));
}

function matchesPattern(value: string, pattern: string): boolean {
  const normalizedValue = value.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();
  if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
    try {
      return new RegExp(pattern.slice(1, -1), "i").test(value);
    } catch {
      return false;
    }
  }
  if (pattern.includes("*")) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i").test(value);
  }
  return normalizedValue === normalizedPattern || normalizedValue.includes(normalizedPattern);
}

function commandMatches(commands: string[], pattern: string): string[] {
  return commands.filter((command) => matchesPattern(command, pattern));
}

function pathMatches(paths: string[], pattern: string, root: string): string[] {
  return paths.filter((path) => {
    const candidate = path.startsWith("/") ? path : resolve(root, path);
    if (!isPathInside(root, candidate)) return matchesPattern(path, pattern);
    return matchesPattern(path, pattern) || matchesPattern(relative(root, candidate), pattern);
  });
}

function finding(id: string, passed: boolean, message: string, evidence: string[] = []): PolicyPackFinding {
  return {
    id,
    status: passed ? "pass" : "fail",
    severity: passed ? "info" : "error",
    message,
    evidence,
  };
}

function gatherEvidence(taskId: string, db: Database): GatheredEvidence {
  const task = getTask(taskId, db);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const runs = listTaskRuns(task.id, db);
  const ledgers = runs.map((run) => getTaskRunLedger(run.id, db));
  const files = unique(ledgers.flatMap((ledger) => ledger.files.map((file) => file.path)));
  return {
    task,
    verifications: getTaskVerifications(task.id, db),
    commits: getTaskCommits(task.id, db),
    gitRefs: getTaskGitRefs(task.id, db),
    runs,
    runCommands: ledgers.flatMap((ledger) => ledger.commands),
    artifacts: ledgers.flatMap((ledger) => ledger.artifacts),
    files,
  };
}

function summarizeEvidence(evidence: GatheredEvidence): PolicyEvidenceSummary {
  const commitFiles = evidence.commits.flatMap((commit) => commit.files_changed || []);
  const verificationArtifacts = evidence.verifications
    .map((verification) => verification.artifact_path)
    .filter((path): path is string => Boolean(path));
  const commandArtifacts = evidence.runCommands
    .map((command) => command.artifact_path)
    .filter((path): path is string => Boolean(path));
  const artifactPaths = evidence.artifacts.map((artifact) => artifact.path);
  const evidenceCount = (
    evidence.verifications.length
    + evidence.commits.length
    + evidence.gitRefs.length
    + evidence.runs.length
    + evidence.runCommands.length
    + evidence.artifacts.length
    + evidence.files.length
  );

  return {
    task: {
      id: evidence.task.id,
      title: evidence.task.title,
      status: evidence.task.status,
      requires_approval: evidence.task.requires_approval,
      approved_by: evidence.task.approved_by,
      approved_at: evidence.task.approved_at,
    },
    verifications: evidence.verifications.map((verification) => ({
      command: verification.command,
      status: verification.status,
      artifact_path: verification.artifact_path,
    })),
    commits: evidence.commits.map((commit) => ({
      sha: commit.sha,
      files_changed: commit.files_changed || [],
    })),
    git_refs: evidence.gitRefs.map((ref) => ({
      ref_type: ref.ref_type,
      name: ref.name,
      url: ref.url,
    })),
    runs: evidence.runs.map((run) => ({ id: run.id, status: run.status, title: run.title })),
    run_commands: evidence.runCommands.map((command) => ({
      command: command.command,
      status: command.status,
      artifact_path: command.artifact_path,
    })),
    artifacts: unique([...verificationArtifacts, ...commandArtifacts, ...artifactPaths]),
    files: unique([...commitFiles, ...evidence.files]),
    evidence_count: evidenceCount,
  };
}

export function listPolicyPacks(): PolicyPackConfig[] {
  return configuredPacks();
}

export function getPolicyPack(name: string): PolicyPackConfig | null {
  return configuredPacks().find((pack) => pack.name === name) || null;
}

export function upsertPolicyPack(input: UpsertPolicyPackInput): PolicyPackConfig {
  const config = loadConfig();
  const existing = config.policy_packs?.[input.name];
  const root = normalizePath(input.root || existing?.root || process.cwd());
  const base = existing || defaultPolicyPack(input.name, root);
  const timestamp = new Date().toISOString();
  const pack: PolicyPackConfig = {
    ...base,
    name: input.name,
    root,
    version: input.version ?? base.version,
    required_commands: unique(input.required_commands ?? base.required_commands),
    prohibited_commands: unique(input.prohibited_commands ?? base.prohibited_commands),
    prohibited_paths: unique(input.prohibited_paths ?? base.prohibited_paths),
    required_statuses: parseStatuses(input.required_statuses ?? base.required_statuses),
    require_passed_verification: input.require_passed_verification ?? base.require_passed_verification,
    require_commit: input.require_commit ?? base.require_commit,
    require_pull_request: input.require_pull_request ?? base.require_pull_request,
    require_approval: input.require_approval ?? base.require_approval,
    require_run: input.require_run ?? base.require_run,
    require_artifact: input.require_artifact ?? base.require_artifact,
    evidence_min_count: input.evidence_min_count ?? base.evidence_min_count,
    branch_pattern: input.branch_pattern ?? base.branch_pattern,
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
  };
  saveConfig({
    ...config,
    policy_packs: {
      ...(config.policy_packs || {}),
      [pack.name]: pack,
    },
  });
  return pack;
}

export function removePolicyPack(name: string): boolean {
  const config = loadConfig();
  if (!config.policy_packs?.[name]) return false;
  const next = { ...config.policy_packs };
  delete next[name];
  saveConfig({ ...config, policy_packs: next });
  return true;
}

export function validatePolicyPack(input: ValidatePolicyPackInput, db?: Database): PolicyPackValidationResult {
  const pack = getPolicyPack(input.name);
  if (!pack) throw new Error(`Policy pack not found: ${input.name}`);
  const d = getDatabase(db);
  const evidence = gatherEvidence(input.task_id, d);
  const summary = summarizeEvidence(evidence);
  const allCommands = [
    ...evidence.verifications.map((verification) => verification.command),
    ...evidence.runCommands.map((command) => command.command),
  ];
  const passedCommands = [
    ...evidence.verifications.filter((verification) => verification.status === "passed").map((verification) => verification.command),
    ...evidence.runCommands.filter((command) => command.status === "passed").map((command) => command.command),
  ];
  const findings: PolicyPackFinding[] = [];

  if (pack.required_statuses.length > 0) {
    findings.push(finding(
      "required-status",
      pack.required_statuses.includes(evidence.task.status),
      `task status must be one of: ${pack.required_statuses.join(", ")}`,
      [evidence.task.status],
    ));
  }

  if (pack.require_passed_verification) {
    const passed = evidence.verifications.filter((verification) => verification.status === "passed");
    findings.push(finding("passed-verification", passed.length > 0, "at least one passed verification is required", passed.map((item) => item.command)));
  }

  for (const pattern of pack.required_commands) {
    const matches = commandMatches(passedCommands, pattern);
    findings.push(finding(`required-command:${pattern}`, matches.length > 0, `required passed command must match: ${pattern}`, matches));
  }

  for (const pattern of pack.prohibited_commands) {
    const matches = commandMatches(allCommands, pattern);
    findings.push(finding(`prohibited-command:${pattern}`, matches.length === 0, `no command may match prohibited pattern: ${pattern}`, matches));
  }

  if (pack.require_commit) {
    findings.push(finding("linked-commit", evidence.commits.length > 0, "at least one linked commit is required", evidence.commits.map((commit) => commit.sha)));
  }

  if (pack.require_pull_request) {
    const refs = evidence.gitRefs.filter((ref) => ref.ref_type === "pull_request");
    findings.push(finding("linked-pull-request", refs.length > 0, "at least one linked pull request is required", refs.map((ref) => ref.name)));
  }

  if (pack.branch_pattern) {
    const branches = evidence.gitRefs.filter((ref) => ref.ref_type === "branch" && matchesPattern(ref.name, pack.branch_pattern!));
    findings.push(finding("branch-pattern", branches.length > 0, `at least one linked branch must match: ${pack.branch_pattern}`, branches.map((ref) => ref.name)));
  }

  if (pack.require_approval) {
    findings.push(finding(
      "approval",
      Boolean(evidence.task.approved_by && evidence.task.approved_at),
      "task approval is required",
      evidence.task.approved_by ? [evidence.task.approved_by] : [],
    ));
  }

  if (pack.require_run) {
    findings.push(finding("run-ledger", evidence.runs.length > 0, "at least one local run ledger is required", evidence.runs.map((run) => run.id)));
  }

  if (pack.require_artifact) {
    findings.push(finding("artifact", summary.artifacts.length > 0, "at least one verification or run artifact is required", summary.artifacts));
  }

  const changedPaths = summary.files;
  const artifactPaths = summary.artifacts;
  for (const pattern of pack.prohibited_paths) {
    const matches = pathMatches([...changedPaths, ...artifactPaths], pattern, input.root || pack.root);
    findings.push(finding(`prohibited-path:${pattern}`, matches.length === 0, `no evidence path may match prohibited pattern: ${pattern}`, matches));
  }

  if (pack.evidence_min_count > 0) {
    findings.push(finding(
      "evidence-min-count",
      summary.evidence_count >= pack.evidence_min_count,
      `at least ${pack.evidence_min_count} local evidence records are required`,
      [String(summary.evidence_count)],
    ));
  }

  const passed = findings.every((item) => item.status === "pass");
  return {
    pack,
    task_id: evidence.task.id,
    mode: input.explain ? "explain" : "validate",
    passed,
    findings,
    audit_evidence: summary,
  };
}

export function explainPolicyPack(input: Omit<ValidatePolicyPackInput, "explain">, db?: Database): PolicyPackValidationResult {
  return validatePolicyPack({ ...input, explain: true }, db);
}
