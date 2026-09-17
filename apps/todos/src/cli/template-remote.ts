/**
 * Hosted-only reusable-template operations, shared by the CLI `template*`
 * verbs and the MCP template tools.
 *
 * These were private to `src/cli/commands/template-commands.ts`; the MCP tools
 * had no cloud arm at all and went straight to `db/templates.js` (T1 §4:
 * "Direct CLI<->MCP parity break"). Extracting them keeps ONE remote
 * implementation of the template contract instead of a second copy behind the
 * MCP door — this module never imports commander, chalk or `db/*`, so the MCP
 * bin can use it without pulling the CLI renderer or `bun:sqlite` in.
 */
import type { TemplatePreview } from "../db/templates.js";
import type { Task, TemplateWithTasks } from "../types/index.js";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import {
  evaluateTemplateCondition,
  resolveTemplateVariables,
  substituteTemplateVariables,
} from "../lib/template-semantics.js";
import {
  getTodosCloudClient,
  cloudCreateTask,
  cloudAddDependency,
  cloudGetTemplate as fetchTemplate,
} from "./cloud-router.js";
import { assertTemplateApiEnvironment } from "../lib/template-client-boundary.js";
import { listSharedTemplates } from "./template-api.js";

export function requireTemplateClient(): HasnaStorageClient {
  assertTemplateApiEnvironment(process.env);
  const client = getTodosCloudClient();
  if (!client)
    throw new Error(
      "Templates require HASNA_TODOS_API_URL and HASNA_TODOS_API_KEY, or saved account credentials",
    );
  return client;
}
export async function resolveRemoteTemplate(
  client: HasnaStorageClient,
  ref: string,
): Promise<TemplateWithTasks | null> {
  if (!ref.trim()) throw new Error("Blank template ID prefix");
  const direct = await fetchTemplate(client, ref);
  if (direct?.id === ref) return direct;
  const rows = await listSharedTemplates(client);
  const exact = rows.find((row) => row.id === ref);
  const matches = exact
    ? [exact]
    : rows.filter((row) => row.id.startsWith(ref));
  if (!ref.trim() || matches.length > 1)
    throw new Error("Ambiguous or blank template ID prefix");
  return matches[0] ? fetchTemplate(client, matches[0].id) : null;
}
export interface TemplateApplyProgress {
  tasks: Task[];
  dependencies: Array<{ task_id: string; depends_on: string }>;
  pending: string | null;
}
export class TemplateApplyError extends Error {
  constructor(readonly progress: TemplateApplyProgress) {
    super(
      "Template application did not finish; inspect confirmed tasks before retrying",
    );
  }
}
export async function preflightTemplate(
  client: HasnaStorageClient,
  template: TemplateWithTasks,
  variables: Record<string, string>,
  seen = new Set<string>(),
): Promise<void> {
  if (seen.has(template.id) || seen.size >= 32)
    throw new Error("Circular or excessively deep template include graph");
  seen.add(template.id);
  try {
    const resolved = resolveTemplateVariables(
      template.variables ?? [],
      variables,
    );
    for (const step of template.tasks) {
      if (step.include_template_id) {
        const included = await resolveRemoteTemplate(
          client,
          step.include_template_id,
        );
        if (!included) throw new Error("Included template not found");
        await preflightTemplate(client, included, resolved, seen);
      } else if (step.condition)
        evaluateTemplateCondition(step.condition, resolved);
    }
  } finally {
    seen.delete(template.id);
  }
}
export interface RemoteTemplateApplication {
  tasks: Task[];
}

export interface RemoteTemplateOverrides {
  title?: string;
  description?: string;
  priority?: TemplateWithTasks["priority"];
}

export function normalizeTemplateDescription(
  value: string | null | undefined,
): string | null {
  return value || null;
}

/**
 * Keep cloud preview output byte-for-byte compatible with the canonical local
 * preview contract. Preview intentionally shows only the template's direct
 * checklist steps; execution handles included templates separately.
 */
export function previewRemoteTemplate(
  template: TemplateWithTasks,
  variables?: Record<string, string>,
): TemplatePreview {
  const resolved = resolveTemplateVariables(
    template.variables ?? [],
    variables,
  );
  const renderDescription = (value: string | null) => {
    if (!value) return null;
    return substituteTemplateVariables(value, resolved) || null;
  };

  if (template.tasks.length === 0) {
    return {
      template_id: template.id,
      template_name: template.name,
      description: normalizeTemplateDescription(template.description),
      variables: template.variables,
      resolved_variables: resolved,
      tasks: [
        {
          position: 0,
          title: substituteTemplateVariables(template.title_pattern, resolved),
          description: renderDescription(template.description),
          priority: template.priority,
          tags: template.tags,
          task_type: null,
          depends_on_positions: [],
        },
      ],
    };
  }

  return {
    template_id: template.id,
    template_name: template.name,
    description: normalizeTemplateDescription(template.description),
    variables: template.variables,
    resolved_variables: resolved,
    tasks: template.tasks
      .filter(
        (step) =>
          !step.condition ||
          evaluateTemplateCondition(step.condition, resolved),
      )
      .map((step) => ({
        position: step.position,
        title: substituteTemplateVariables(step.title_pattern, resolved),
        description: renderDescription(step.description),
        priority: step.priority,
        tags: step.tags,
        task_type: step.task_type,
        depends_on_positions: step.depends_on_positions,
      })),
  };
}

/**
 * /v1/templates/:id returns the complete template, including ordered checklist
 * steps. Strip storage-only fields so cloud exports round-trip through the
 * canonical template-import contract just like local exports.
 */
export function exportRemoteTemplate(template: TemplateWithTasks) {
  return {
    name: template.name,
    title_pattern: template.title_pattern,
    description: normalizeTemplateDescription(template.description),
    priority: template.priority,
    tags: template.tags,
    variables: template.variables,
    project_id: template.project_id,
    plan_id: template.plan_id,
    metadata: template.metadata,
    tasks: template.tasks.map((step) => ({
      position: step.position,
      title_pattern: step.title_pattern,
      description: normalizeTemplateDescription(step.description),
      priority: step.priority,
      tags: step.tags,
      task_type: step.task_type,
      condition: step.condition,
      include_template_id: step.include_template_id,
      depends_on_positions: step.depends_on_positions,
      metadata: step.metadata,
    })),
  };
}

/**
 * Apply the reusable-template contract through the hosted /v1 API without
 * opening local storage. This deliberately shares the variable and condition
 * language with the SQLite implementation while resolving included templates
 * through authenticated cloud reads.
 */
export async function createRemoteTemplateTasks(
  cloud: HasnaStorageClient,
  template: TemplateWithTasks,
  projectId: string | undefined,
  variables: Record<string, string>,
  agentId: string | undefined,
  overrides?: RemoteTemplateOverrides,
  visited = new Set<string>(),
  progress: TemplateApplyProgress = {
    tasks: [],
    dependencies: [],
    pending: null,
  },
): Promise<RemoteTemplateApplication> {
  if (visited.size === 0) await preflightTemplate(cloud, template, variables);
  if (visited.has(template.id)) {
    throw new Error(`Circular template reference detected: ${template.id}`);
  }
  visited.add(template.id);
  try {
    const resolved = resolveTemplateVariables(
      template.variables ?? [],
      variables,
    );
    const render = (value: string | null | undefined) =>
      value === null || value === undefined
        ? value
        : substituteTemplateVariables(value, resolved);

    if (template.tasks.length === 0) {
      progress.pending = "task-create";
      const task = await cloudCreateTask(cloud, {
        title: render(overrides?.title || template.title_pattern),
        ...(render(overrides?.description ?? template.description)
          ? {
              description: render(
                overrides?.description ?? template.description,
              ),
            }
          : {}),
        priority: overrides?.priority ?? template.priority,
        tags: template.tags,
        ...(projectId ? { project_id: projectId } : {}),
        ...(template.plan_id ? { plan_id: template.plan_id } : {}),
        ...(agentId ? { agent_id: agentId } : {}),
        ...(Object.keys(template.metadata ?? {}).length > 0
          ? { metadata: template.metadata }
          : {}),
      });
      progress.tasks.push(task);
      progress.pending = null;
      return { tasks: [task] };
    }

    const created: Task[] = [];
    const positionToTaskId = new Map<number, string>();
    const skippedPositions = new Set<number>();

    for (const step of template.tasks) {
      // Keep local ordering: an include takes precedence over a step condition.
      if (step.include_template_id) {
        const included = await resolveRemoteTemplate(
          cloud,
          step.include_template_id,
        );
        if (!included)
          throw new Error(
            `Included template not found: ${step.include_template_id}`,
          );
        const result = await createRemoteTemplateTasks(
          cloud,
          included,
          projectId,
          resolved,
          agentId,
          undefined,
          visited,
          progress,
        );
        created.push(...result.tasks);
        if (result.tasks.length > 0)
          positionToTaskId.set(step.position, result.tasks[0]!.id);
        else skippedPositions.add(step.position);
        continue;
      }
      if (
        step.condition &&
        !evaluateTemplateCondition(step.condition, resolved)
      ) {
        skippedPositions.add(step.position);
        continue;
      }
      progress.pending = "task-create";
      const task = await cloudCreateTask(cloud, {
        title: render(step.title_pattern),
        ...(render(step.description)
          ? { description: render(step.description) }
          : {}),
        priority: step.priority,
        tags: step.tags,
        ...(step.task_type ? { task_type: step.task_type } : {}),
        ...(projectId ? { project_id: projectId } : {}),
        ...(template.plan_id ? { plan_id: template.plan_id } : {}),
        ...(agentId ? { agent_id: agentId } : {}),
        ...(Object.keys(step.metadata ?? {}).length > 0
          ? { metadata: step.metadata }
          : {}),
      });
      progress.tasks.push(task);
      progress.pending = null;
      created.push(task);
      positionToTaskId.set(step.position, task.id);
    }

    for (const step of template.tasks) {
      if (skippedPositions.has(step.position) || step.include_template_id)
        continue;
      const taskId = positionToTaskId.get(step.position);
      if (!taskId) continue;
      for (const dependencyPosition of step.depends_on_positions) {
        if (skippedPositions.has(dependencyPosition)) continue;
        const dependencyId = positionToTaskId.get(dependencyPosition);
        if (dependencyId) {
          progress.pending = "dependency-add";
          await cloudAddDependency(cloud, taskId, dependencyId);
          progress.dependencies.push({
            task_id: taskId,
            depends_on: dependencyId,
          });
          progress.pending = null;
        }
      }
    }
    return { tasks: created };
  } catch (error) {
    if (error instanceof TemplateApplyError) throw error;
    throw new TemplateApplyError(progress);
  } finally {
    visited.delete(template.id);
  }
}

