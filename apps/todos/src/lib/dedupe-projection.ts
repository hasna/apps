import type { Task, TaskPriority, TaskStatus } from "../types/index.js";
import { redactEvidenceText, redactValue } from "./redaction.js";

/**
 * The ONLY metadata keys the dedup projection carries. This is exactly the
 * source-key set the fingerprint in `task-dedupe.ts` consumes
 * (`sourceKeysFor`). Any other metadata — free-form `token`, `api_key`,
 * `secret`, arbitrary composites — is never projected, so a credential value
 * sitting in free-form metadata can never reach a dedup workflow's capture.
 *
 * Regression O15-00170 (incidents 713001/713022/713043-46/713119): workflows
 * doing deduplication captured credential-bearing whole-task composites from
 * `todos list --json` / `--format compact` / `--format csv` because no
 * package-owned bounded projection existed. This allowlist is the bounded
 * surface that abstraction provides.
 */
export const DEDUPE_SOURCE_KEY_ALLOWLIST = [
  "github_url",
  "github_issue_url",
  "github_pr_url",
  "source_url",
  "url",
  "external_url",
  "issue_url",
  "github_owner",
  "github_repo",
  "github_number",
] as const;

/**
 * A task reduced to exactly the fields the dedup fingerprint consumes, plus a
 * bounded source-key metadata object. It deliberately excludes free-form
 * `metadata`, `tags`, comments, run/plan fields, and every other composite
 * field of `Task` — the surfaces where credential values leaked. The carried
 * free-form text (`title`, `description`) is redacted through the same
 * pattern redactor every other output surface uses, so a credential embedded
 * in prose never survives into the projection.
 */
export interface DedupeTaskProjection {
  id: string;
  short_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  project_id: string | null;
  task_list_id: string | null;
  assigned_to: string | null;
  priority: TaskPriority;
  metadata: Record<string, unknown>;
}

/**
 * Project whole tasks into the bounded dedup shape.
 *
 * This is the package-owned "canonical-machine" abstraction: the only way a
 * dedup workflow may capture task state for deduplication. It never emits a
 * whole-task composite, so a credential that lives in free-form metadata,
 * tags, or a nested composite cannot be captured with it.
 */
export function projectTasksForDedupe(tasks: Task[]): DedupeTaskProjection[] {
  return tasks.map((task) => {
    const metadata: Record<string, unknown> = {};
    for (const key of DEDUPE_SOURCE_KEY_ALLOWLIST) {
      if (key in task.metadata) {
        metadata[key] = redactValue(task.metadata[key]);
      }
    }
    return {
      id: task.id,
      short_id: task.short_id,
      title: redactEvidenceText(task.title),
      description: task.description === null || task.description === undefined
        ? null
        : redactEvidenceText(task.description),
      status: task.status,
      created_at: task.created_at,
      updated_at: task.updated_at,
      project_id: task.project_id,
      task_list_id: task.task_list_id,
      assigned_to: task.assigned_to,
      priority: task.priority,
      metadata,
    };
  });
}
