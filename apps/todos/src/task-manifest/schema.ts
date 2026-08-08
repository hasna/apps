import { z } from "zod";
import { TASK_PRIORITIES, TASK_STATUSES } from "../types/index.js";
import {
  TodosTaskManifestError,
  type TodosTaskManifest,
  type TodosTaskManifestBindingLookupRequest,
  type TodosTaskManifestCompensateRequest,
} from "./types.js";

export const TODOS_TASK_MANIFEST_BOUNDS = {
  tasks: 128,
  dependencies: 512,
  comments: 512,
  verifications: 512,
  effects: 64,
  metadata_fields: 128,
  effect_payload_fields: 128,
  request_bytes: 16_777_216,
  response_bytes: 1_048_576,
} as const;

const key = z.string().min(1).max(96).regex(/^[a-z][a-z0-9_-]*$/);
const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const uuid = z.string().uuid();
const scalar = z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()]);
const boundedScalarRecord = (limit: number, field: string) => z.record(z.string().max(200), scalar)
  .superRefine((value, context) => {
    if (Object.keys(value).length > limit) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `${field} exceeds ${limit} fields` });
    }
  });

const comment = z.object({
  content: z.string().min(1).max(16_384),
  type: z.enum(["comment", "progress", "status_change", "system"]).optional(),
  progress_pct: z.number().int().min(0).max(100).optional(),
  agent_id: identifier.optional(),
  session_id: identifier.optional(),
}).strict();

const verification = z.object({
  command: z.string().min(1).max(8192),
  status: z.enum(["passed", "failed", "unknown"]).optional(),
  output_summary: z.string().max(16_384).optional(),
  artifact_path: z.string().max(4096).optional(),
  agent_id: identifier.optional(),
}).strict();

const task = z.object({
  key,
  title: z.string().min(1).max(500),
  description: z.string().max(64_000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigned_to: identifier.optional(),
  created_by: identifier.optional(),
  tags: z.array(z.string().min(1).max(100)).max(64).optional(),
  metadata: boundedScalarRecord(TODOS_TASK_MANIFEST_BOUNDS.metadata_fields, "metadata").optional(),
  comments: z.array(comment).max(64).optional(),
  verifications: z.array(verification).max(64).optional(),
}).strict();

const dependency = z.object({ task: key, depends_on: key }).strict();
const effect = z.object({
  topic: z.string().min(1).max(200),
  payload: boundedScalarRecord(TODOS_TASK_MANIFEST_BOUNDS.effect_payload_fields, "effect payload"),
}).strict();

const schema = z.object({
  version: z.literal(1),
  operation_id: identifier,
  idempotency_key: identifier,
  project_id: uuid,
  task_list_id: uuid.optional(),
  if_binding_version: z.number().int().min(0).optional(),
  plan: z.object({
    key,
    name: z.string().min(1).max(500),
    description: z.string().max(64_000).optional(),
    status: z.enum(["active", "completed", "archived"]).optional(),
  }).strict(),
  tasks: z.array(task).min(1).max(TODOS_TASK_MANIFEST_BOUNDS.tasks),
  dependencies: z.array(dependency).max(TODOS_TASK_MANIFEST_BOUNDS.dependencies).optional(),
  effects: z.array(effect).max(TODOS_TASK_MANIFEST_BOUNDS.effects).optional(),
}).strict();

const compensationSchema = z.object({
  receipt_id: uuid,
  idempotency_key: identifier,
  if_binding_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
}).strict();

const bindingLookupSchema = z.object({
  authority: z.string().min(1).max(64),
  route: z.string().min(1).max(128),
  schema_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  tenant_id: identifier,
  plan_id: uuid,
  max_items: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
}).strict();

export function parseTodosTaskManifest(input: unknown): TodosTaskManifest {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new TodosTaskManifestError(
      "TODOS_TASK_MANIFEST_INVALID_INPUT",
      `Invalid task manifest: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      { issues: parsed.error.issues },
    );
  }
  const taskKeys = new Set<string>();
  let comments = 0;
  let verifications = 0;
  for (const entry of parsed.data.tasks) {
    if (taskKeys.has(entry.key)) {
      throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_INVALID_INPUT", `Duplicate task key: ${entry.key}`);
    }
    taskKeys.add(entry.key);
    comments += entry.comments?.length ?? 0;
    verifications += entry.verifications?.length ?? 0;
  }
  if (comments > TODOS_TASK_MANIFEST_BOUNDS.comments || verifications > TODOS_TASK_MANIFEST_BOUNDS.verifications) {
    throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_BOUNDS_EXCEEDED", "Task manifest nested resource bounds exceeded", {
      comments,
      verifications,
    });
  }
  const seenDependencies = new Set<string>();
  const dependencyGraph = new Map<string, string[]>();
  for (const edge of parsed.data.dependencies ?? []) {
    if (!taskKeys.has(edge.task) || !taskKeys.has(edge.depends_on)) {
      throw new TodosTaskManifestError(
        "TODOS_TASK_MANIFEST_FOREIGN_REFERENCE",
        `Dependency contains foreign task key: ${edge.task} -> ${edge.depends_on}`,
      );
    }
    if (edge.task === edge.depends_on) {
      throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_INVALID_INPUT", `Task ${edge.task} cannot depend on itself`);
    }
    const identity = `${edge.task}\u001f${edge.depends_on}`;
    if (seenDependencies.has(identity)) {
      throw new TodosTaskManifestError("TODOS_TASK_MANIFEST_INVALID_INPUT", `Duplicate dependency: ${edge.task} -> ${edge.depends_on}`);
    }
    seenDependencies.add(identity);
    const prerequisites = dependencyGraph.get(edge.task) ?? [];
    prerequisites.push(edge.depends_on);
    dependencyGraph.set(edge.task, prerequisites);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskKey: string): void => {
    if (visiting.has(taskKey)) {
      throw new TodosTaskManifestError(
        "TODOS_TASK_MANIFEST_INVALID_INPUT",
        `Dependency cycle contains task ${taskKey}`,
      );
    }
    if (visited.has(taskKey)) return;
    visiting.add(taskKey);
    for (const prerequisite of dependencyGraph.get(taskKey) ?? []) visit(prerequisite);
    visiting.delete(taskKey);
    visited.add(taskKey);
  };
  for (const taskKey of taskKeys) visit(taskKey);
  return parsed.data as TodosTaskManifest;
}

export function parseTodosTaskManifestCompensation(input: unknown): TodosTaskManifestCompensateRequest {
  const parsed = compensationSchema.safeParse(input);
  if (!parsed.success) {
    throw new TodosTaskManifestError(
      "TODOS_TASK_MANIFEST_INVALID_INPUT",
      `Invalid task-manifest compensation: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

export function parseTodosTaskManifestBindingLookup(input: unknown): TodosTaskManifestBindingLookupRequest {
  const parsed = bindingLookupSchema.safeParse(input);
  if (!parsed.success) {
    throw new TodosTaskManifestError(
      "TODOS_TASK_MANIFEST_INVALID_INPUT",
      `Invalid task-manifest binding lookup: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      { issues: parsed.error.issues },
    );
  }
  return parsed.data as TodosTaskManifestBindingLookupRequest;
}
