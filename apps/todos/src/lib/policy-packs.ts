/**
 * Local policy packs for task done gates — project-local, versioned, auditable.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Database } from "bun:sqlite";
import { getTask } from "../db/tasks.js";
import { getProject } from "../db/projects.js";
import { listVerificationRecords } from "./verification-providers.js";
import { listArtifacts } from "../db/artifacts.js";
import { checkCompletionGuard } from "./completion-guard.js";
import { getDatabase } from "../db/database.js";
import type { Task } from "../types/index.js";

export const POLICY_PACK_VERSION = "todos.policy-pack.v1";

export type PolicyRuleType =
  | "require_in_progress"
  | "require_approval"
  | "require_verification"
  | "require_evidence"
  | "require_commit_hash"
  | "secret_scan_metadata"
  | "completion_guard";

export interface PolicyRule {
  type: PolicyRuleType;
  /** verification provider name for require_verification */
  provider?: string;
  message?: string;
}

export interface PolicyPack {
  name: string;
  version: number;
  description?: string;
  rules: PolicyRule[];
}

export interface PolicyValidationResult {
  schema_version: typeof POLICY_PACK_VERSION;
  pack_name: string;
  task_id: string;
  passed: boolean;
  dry_run: boolean;
  violations: Array<{ rule: PolicyRuleType; message: string }>;
  explanations: string[];
}

function getPolicyPacksPath(): string {
  const local = join(process.cwd(), ".todos", "policy-packs.json");
  if (existsSync(local)) return local;
  const home = process.env["HOME"] || "~";
  return join(home, ".hasna", "todos", "policy-packs.json");
}

let cachedPacks: PolicyPack[] | null = null;

export function resetPolicyPackCache(): void {
  cachedPacks = null;
}

export function getDefaultPolicyPacks(): PolicyPack[] {
  return [
    {
      name: "default",
      version: 1,
      description: "Standard local done gates",
      rules: [
        { type: "require_in_progress" },
        { type: "require_approval" },
        { type: "secret_scan_metadata" },
        { type: "completion_guard" },
      ],
    },
    {
      name: "strict",
      version: 1,
      description: "Requires verification and evidence",
      rules: [
        { type: "require_in_progress" },
        { type: "require_approval" },
        { type: "require_verification", provider: "test" },
        { type: "require_evidence" },
        { type: "require_commit_hash" },
        { type: "secret_scan_metadata" },
        { type: "completion_guard" },
      ],
    },
  ];
}

export function loadPolicyPacks(): PolicyPack[] {
  if (cachedPacks) return cachedPacks;
  const path = getPolicyPacksPath();
  if (!existsSync(path)) {
    cachedPacks = getDefaultPolicyPacks();
    return cachedPacks;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { packs: PolicyPack[] };
  cachedPacks = parsed.packs?.length ? parsed.packs : getDefaultPolicyPacks();
  return cachedPacks;
}

export function savePolicyPacks(packs: PolicyPack[]): void {
  const path = getPolicyPacksPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ schema_version: POLICY_PACK_VERSION, packs }, null, 2));
  cachedPacks = packs;
}

export function getPolicyPack(name: string): PolicyPack | null {
  return loadPolicyPacks().find((p) => p.name === name) ?? null;
}

const SECRET_PATTERN = /\b(sk-[a-zA-Z0-9]{10,}|ghp_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16})\b/;

function evaluateRule(rule: PolicyRule, task: Task, db: Database): string | null {
  switch (rule.type) {
    case "require_in_progress":
      if (task.status !== "in_progress") {
        return rule.message || `Task must be in_progress (current: ${task.status})`;
      }
      return null;

    case "require_approval":
      if (task.requires_approval && !task.approved_at) {
        return rule.message || "Task requires approval before completion";
      }
      return null;

    case "require_verification": {
      const records = listVerificationRecords({ task_id: task.id, provider: rule.provider }, db);
      const passed = records.some((r) => r.status === "passed");
      if (!passed) {
        return rule.message || `Missing passed verification${rule.provider ? ` from ${rule.provider}` : ""}`;
      }
      return null;
    }

    case "require_evidence": {
      const artifacts = listArtifacts({ entity_type: "task", entity_id: task.id }, db);
      const evidence = (task.metadata as Record<string, unknown>)?._evidence;
      if (artifacts.length === 0 && !evidence) {
        return rule.message || "Task completion requires evidence artifact or _evidence metadata";
      }
      return null;
    }

    case "require_commit_hash": {
      const evidence = (task.metadata as Record<string, unknown>)?._evidence as Record<string, unknown> | undefined;
      if (!evidence?.commit_hash) {
        return rule.message || "Task completion requires commit_hash in evidence metadata";
      }
      return null;
    }

    case "secret_scan_metadata": {
      const raw = JSON.stringify(task.metadata);
      if (SECRET_PATTERN.test(raw)) {
        return rule.message || "Metadata appears to contain raw secrets — redact before completing";
      }
      return null;
    }

    case "completion_guard":
      try {
        checkCompletionGuard(task, task.assigned_to || task.agent_id || null, db);
      } catch (e) {
        return rule.message || (e instanceof Error ? e.message : "Completion guard failed");
      }
      return null;

    default:
      return `Unknown rule type: ${rule.type}`;
  }
}

export function validateTaskAgainstPolicyPack(
  taskId: string,
  packName = "default",
  options?: { dry_run?: boolean; db?: Database },
): PolicyValidationResult {
  const db = options?.db || getDatabase();
  const pack = getPolicyPack(packName);
  if (!pack) throw new Error(`Policy pack not found: ${packName}`);

  const task = getTask(taskId, db);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const violations: PolicyValidationResult["violations"] = [];
  const explanations: string[] = [];

  for (const rule of pack.rules) {
    const message = evaluateRule(rule, task, db);
    if (message) {
      violations.push({ rule: rule.type, message });
      explanations.push(`[${rule.type}] ${message}`);
    } else {
      explanations.push(`[${rule.type}] OK`);
    }
  }

  return {
    schema_version: POLICY_PACK_VERSION,
    pack_name: pack.name,
    task_id: taskId,
    passed: violations.length === 0,
    dry_run: options?.dry_run ?? false,
    violations,
    explanations,
  };
}

export function assertPolicyPackPassed(taskId: string, packName = "default", db?: Database): void {
  const result = validateTaskAgainstPolicyPack(taskId, packName, { db });
  if (!result.passed) {
    throw new Error(`Policy pack '${packName}' failed: ${result.violations.map((v) => v.message).join("; ")}`);
  }
}

export function resolveProjectPolicyPack(projectId?: string | null, db?: Database): string {
  if (!projectId) return "default";
  const project = getProject(projectId, db);
  const meta = (project as { metadata?: Record<string, unknown> } | null)?.metadata;
  if (meta && typeof meta.policy_pack === "string") return meta.policy_pack;
  return "default";
}
