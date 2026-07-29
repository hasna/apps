import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  TODOS_OPERATION_MANIFEST_DIGEST,
  TODOS_REQUEST_SCHEMA_IDS,
  TODOS_REQUEST_SCHEMAS,
  TaskToPrProjectionSchema,
  createTaskToPrProjection,
  validateTaskToPrProjectionHistory,
  validateTaskToPrProjectionTransition,
  type TaskToPrProjection,
} from "@hasna/contracts/todos";
import type {
  TaskToPrProjectionListOptions,
  TaskToPrProjectionMutationReceipt,
  TaskToPrProjectionPage,
  TaskToPrProjectionRebuildInput,
  TaskToPrProjectionRebuildResult,
  TaskToPrProjectionScope,
  TaskToPrProjectionWriteResult,
} from "./types.js";

const OWNER = "hasna.todos";
const SHA1 = /^[0-9a-f]{40}$/;

interface ProjectionRow {
  projection_id: string;
  version: number;
  sequence: number;
  owner: string;
  task_id: string;
  repository_id: string;
  worktree_id: string;
  branch_id: string;
  pull_request_id: string | null;
  source_group_id: string | null;
  project_id: string | null;
  task_list_id: string | null;
  plan_id: string | null;
  agent_id: string | null;
  status: string | null;
  derived_at: string;
  digest: string;
  payload: string;
}

interface SourceGroupRow {
  id: string;
  repository: string;
  leaf_task_id: string;
  branch: string;
  pr_number: number | null;
  base_sha: string | null;
  state: string;
  terminal_head_sha: string | null;
  updated_at: string;
  project_id: string | null;
  task_list_id: string | null;
  plan_id: string | null;
  agent_id: string | null;
}

interface SourceAttemptRow {
  id: string;
  worktree: string;
  created_at: string;
}

interface SourceEventRow {
  id: string;
  sequence: number;
  head_sha: string | null;
  ci_proof: string | null;
  payload_hash: string;
  created_at: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function opaqueRef(prefix: string, value: unknown): { id: string; digest: string } {
  const digest = sha256(stableJson(value));
  return { id: `${prefix}-${digest.slice(0, 32)}`, digest };
}

function parseProjection(payload: string): TaskToPrProjection {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch (error) {
    throw new Error("TASK_TO_PR_PROJECTION_INVALID: persisted projection is not valid JSON", { cause: error });
  }
  const parsed = TaskToPrProjectionSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("TASK_TO_PR_PROJECTION_INVALID: persisted projection violates @hasna/contracts", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function projectionFromRow(row: ProjectionRow): TaskToPrProjection {
  const projection = parseProjection(row.payload);
  if (projection.id !== row.projection_id || projection.version !== Number(row.version) ||
      projection.sequence !== Number(row.sequence) || projection.digest !== row.digest) {
    throw new Error("TASK_TO_PR_PROJECTION_INVALID: persisted projection index does not match its contract payload");
  }
  return projection;
}

function validateListOptions(options: TaskToPrProjectionListOptions): Required<TaskToPrProjectionListOptions> {
  const request = {
    cursor: options.cursor ?? null,
    limit: options.limit ?? 100,
    projectId: options.projectId ?? null,
    taskListId: options.taskListId ?? null,
    planId: options.planId ?? null,
    agentId: options.agentId ?? null,
    status: options.status ?? null,
    changedAfter: options.changedAfter ?? null,
  };
  return TODOS_REQUEST_SCHEMAS[TODOS_REQUEST_SCHEMA_IDS.list].parse(request);
}

function encodeCursor(row: Pick<ProjectionRow, "derived_at" | "projection_id">): string {
  return Buffer.from(JSON.stringify([row.derived_at, row.projection_id]), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 2 || value.some((entry) => typeof entry !== "string")) {
      throw new Error("shape");
    }
    if (!Number.isFinite(Date.parse(value[0]))) throw new Error("timestamp");
    return [value[0], value[1]];
  } catch (error) {
    throw new Error("TASK_TO_PR_PROJECTION_INVALID_CURSOR: cursor is malformed", { cause: error });
  }
}

function inferredScope(db: Database, projection: TaskToPrProjection): TaskToPrProjectionScope {
  const row = db.query(`
    SELECT project_id, task_list_id, plan_id, agent_id, status
    FROM tasks WHERE id = ? LIMIT 1
  `).get(projection.identity.taskRef.id) as {
    project_id: string | null;
    task_list_id: string | null;
    plan_id: string | null;
    agent_id: string | null;
    status: string | null;
  } | null;
  return row ? {
    projectId: row.project_id,
    taskListId: row.task_list_id,
    planId: row.plan_id,
    agentId: row.agent_id,
    status: row.status,
  } : {};
}

function exactProjectionRow(db: Database, id: string, version: number): ProjectionRow | null {
  return db.query(`
    SELECT * FROM task_to_pr_projection_snapshots
    WHERE projection_id = ? AND version = ? LIMIT 1
  `).get(id, version) as ProjectionRow | null;
}

function projectionHistory(db: Database, id: string): TaskToPrProjection[] {
  return (db.query(`
    SELECT * FROM task_to_pr_projection_snapshots
    WHERE projection_id = ? ORDER BY version ASC
  `).all(id) as ProjectionRow[]).map(projectionFromRow);
}

function insertProjection(
  db: Database,
  projection: TaskToPrProjection,
  scope: TaskToPrProjectionScope,
): void {
  db.query(`
    INSERT INTO task_to_pr_projection_snapshots (
      projection_id, version, sequence, owner, task_id, repository_id,
      worktree_id, branch_id, pull_request_id, source_group_id,
      project_id, task_list_id, plan_id, agent_id, status,
      derived_at, digest, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    projection.id,
    projection.version,
    projection.sequence,
    projection.owner,
    projection.identity.taskRef.id,
    projection.identity.repositoryRef.id,
    projection.identity.worktreeRef.id,
    projection.identity.branchRef.id,
    projection.pullRequestRef?.id ?? null,
    scope.sourceGroupId ?? null,
    scope.projectId ?? null,
    scope.taskListId ?? null,
    scope.planId ?? null,
    scope.agentId ?? null,
    scope.status ?? null,
    projection.derivedAt,
    projection.digest,
    JSON.stringify(projection),
  );
}

function sourceGroups(db: Database, taskRefs: readonly string[]): SourceGroupRow[] {
  const rows = db.query(`
    SELECT groups.id, groups.repository, groups.leaf_task_id, groups.branch,
           groups.pr_number, groups.base_sha, groups.state,
           groups.terminal_head_sha, groups.updated_at,
           tasks.project_id, tasks.task_list_id, tasks.plan_id, tasks.agent_id
    FROM pr_groups AS groups
    LEFT JOIN tasks ON tasks.id = groups.leaf_task_id
    ORDER BY groups.id ASC
  `).all() as SourceGroupRow[];
  if (taskRefs.length === 0) return rows;
  const requested = new Set(taskRefs);
  const matchingTaskIds = new Set(
    (db.query(`SELECT id, short_id FROM tasks`).all() as Array<{ id: string; short_id: string | null }>)
      .filter((task) => requested.has(task.id) || (task.short_id !== null && requested.has(task.short_id)))
      .map((task) => task.id),
  );
  return rows.filter((row) => requested.has(row.leaf_task_id) || matchingTaskIds.has(row.leaf_task_id));
}

function sourceAttempt(db: Database, groupId: string): SourceAttemptRow | null {
  return db.query(`
    SELECT id, worktree, created_at FROM pr_group_attempts
    WHERE group_id = ? ORDER BY created_at ASC, id ASC LIMIT 1
  `).get(groupId) as SourceAttemptRow | null;
}

function sourceEvents(db: Database, groupId: string): SourceEventRow[] {
  return db.query(`
    SELECT id, sequence, head_sha, ci_proof, payload_hash, created_at
    FROM pr_group_events WHERE group_id = ? ORDER BY sequence ASC
  `).all(groupId) as SourceEventRow[];
}

function latestHeadEvent(events: readonly SourceEventRow[], terminalHead: string | null): SourceEventRow | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.head_sha && SHA1.test(event.head_sha)) return event;
  }
  if (!terminalHead || !SHA1.test(terminalHead) || events.length === 0) return null;
  return { ...events[events.length - 1]!, head_sha: terminalHead };
}

function matchingCiEvent(events: readonly SourceEventRow[], head: string): SourceEventRow | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.head_sha !== head || !event.ci_proof) continue;
    try {
      const proof = JSON.parse(event.ci_proof) as Record<string, unknown>;
      if (proof["status"] === "success" && proof["head_sha"] === head) return event;
    } catch {}
  }
  return null;
}

export function deriveTaskToPrProjection(
  db: Database,
  group: SourceGroupRow,
): { projection: TaskToPrProjection; scope: TaskToPrProjectionScope } | null {
  const base = group.base_sha?.toLowerCase() ?? null;
  const attempt = sourceAttempt(db, group.id);
  const events = sourceEvents(db, group.id);
  const headEvent = latestHeadEvent(events, group.terminal_head_sha?.toLowerCase() ?? null);
  if (!base || !SHA1.test(base) || !attempt || !headEvent?.head_sha) return null;

  const headValue = headEvent.head_sha.toLowerCase();
  const head = { algorithm: "sha1" as const, value: headValue };
  const taskRef = opaqueRef("task", { owner: OWNER, kind: "task", id: group.leaf_task_id });
  const repositoryRef = opaqueRef("repository", { owner: OWNER, repository: group.repository });
  const worktreeRef = opaqueRef("worktree", { owner: OWNER, worktree: attempt.worktree });
  const branchRef = opaqueRef("branch", { owner: OWNER, repository: group.repository, branch: group.branch });
  const ciEvent = matchingCiEvent(events, headValue);
  const hasExactPullRequest = group.pr_number !== null && ciEvent !== null;

  let pullRequestRef: TaskToPrProjection["pullRequestRef"] = null;
  let publishedHead: TaskToPrProjection["head"]["publishedHead"] = null;
  let providerObservedHead: TaskToPrProjection["head"]["providerObservedHead"] = null;
  let equalityProof: TaskToPrProjection["head"]["equalityProof"] = null;
  const proofs: TaskToPrProjection["proofs"] = [];
  if (hasExactPullRequest) {
    const pr = opaqueRef("pull-request", {
      owner: OWNER,
      repository: group.repository,
      number: group.pr_number,
    });
    const equality = opaqueRef("proof", {
      owner: OWNER,
      kind: "head_equality",
      event: ciEvent.id,
      head: headValue,
    });
    const ci = opaqueRef("proof", {
      owner: OWNER,
      kind: "ci",
      payload: ciEvent.payload_hash,
      head: headValue,
    });
    pullRequestRef = { owner: OWNER, kind: "pull_request", ...pr };
    publishedHead = head;
    providerObservedHead = head;
    equalityProof = {
      ref: { owner: OWNER, kind: "proof_bundle", ...equality },
      kind: "head_equality",
      head,
      observedAt: ciEvent.created_at,
    };
    proofs.push({
      ref: { owner: OWNER, kind: "proof_bundle", ...ci },
      kind: "ci",
      head,
      observedAt: ciEvent.created_at,
    });
  }

  const projectionIdentity = opaqueRef("projection", { owner: OWNER, group: group.id });
  const projection = createTaskToPrProjection({
    schema: "hasna.todos.task_to_pr_projection.v1",
    id: projectionIdentity.id,
    owner: OWNER,
    version: 1,
    sequence: Number(headEvent.sequence),
    predecessor: null,
    identity: {
      taskRef: { owner: OWNER, kind: "task", id: group.leaf_task_id, digest: taskRef.digest },
      repositoryRef: { owner: OWNER, kind: "repository", ...repositoryRef },
      worktreeRef: { owner: OWNER, kind: "worktree", ...worktreeRef },
      branchRef: { owner: OWNER, kind: "branch", ...branchRef },
      baseHead: { algorithm: "sha1", value: base },
    },
    pullRequestRef,
    head: { branchHead: head, publishedHead, providerObservedHead, equalityProof },
    proofs,
    derivedAt: headEvent.created_at || group.updated_at,
  });
  return {
    projection,
    scope: {
      sourceGroupId: group.id,
      projectId: group.project_id,
      taskListId: group.task_list_id,
      planId: group.plan_id,
      agentId: group.agent_id,
      status: group.state,
    },
  };
}

export class SqliteTaskToPrProjectionStore {
  constructor(private readonly db: Database) {}

  save(input: unknown, scope: TaskToPrProjectionScope = {}): TaskToPrProjectionWriteResult {
    const projection = TaskToPrProjectionSchema.parse(input);
    const existing = exactProjectionRow(this.db, projection.id, projection.version);
    if (existing) {
      const replay = projectionFromRow(existing);
      if (replay.digest !== projection.digest) {
        throw new Error("TASK_TO_PR_PROJECTION_CONFLICT: version already exists with a different digest");
      }
      return { projection: replay, changed: false, replayed: true };
    }

    const history = projectionHistory(this.db, projection.id);
    const previous = history.at(-1);
    if (previous) {
      const transition = validateTaskToPrProjectionTransition(previous, projection);
      if (!transition.success) {
        throw new Error("TASK_TO_PR_PROJECTION_CONFLICT: update violates the contract transition", {
          cause: transition.error,
        });
      }
    } else if (projection.version !== 1 || projection.predecessor !== null) {
      throw new Error("TASK_TO_PR_PROJECTION_CONFLICT: the first snapshot must be version 1 without a predecessor");
    }

    const nextHistory = [...history, projection];
    const validHistory = validateTaskToPrProjectionHistory(nextHistory, { expectedOwner: projection.owner });
    if (!validHistory.success) {
      throw new Error("TASK_TO_PR_PROJECTION_CONFLICT: snapshot history violates @hasna/contracts", {
        cause: validHistory.error,
      });
    }
    const inferred = inferredScope(this.db, projection);
    insertProjection(this.db, projection, { ...inferred, ...scope });
    return { projection, changed: true, replayed: false };
  }

  get(ref: string): TaskToPrProjection | null {
    const exact = this.db.query(`
      SELECT snapshots.* FROM task_to_pr_projection_snapshots AS snapshots
      WHERE snapshots.projection_id = ?
      ORDER BY snapshots.version DESC LIMIT 1
    `).get(ref) as ProjectionRow | null;
    if (exact) return projectionFromRow(exact);

    const byTask = this.db.query(`
      SELECT snapshots.* FROM task_to_pr_projection_snapshots AS snapshots
      JOIN (
        SELECT projection_id, MAX(version) AS version
        FROM task_to_pr_projection_snapshots GROUP BY projection_id
      ) AS latest
        ON latest.projection_id = snapshots.projection_id AND latest.version = snapshots.version
      WHERE snapshots.task_id = ?
      ORDER BY snapshots.derived_at DESC, snapshots.projection_id ASC
      LIMIT 2
    `).all(ref) as ProjectionRow[];
    if (byTask.length > 1) {
      throw new Error("TASK_TO_PR_PROJECTION_AMBIGUOUS: task reference resolves to multiple projections");
    }
    return byTask[0] ? projectionFromRow(byTask[0]) : null;
  }

  list(options: TaskToPrProjectionListOptions = {}): TaskToPrProjectionPage {
    const request = validateListOptions(options);
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    for (const [column, value] of [
      ["project_id", request.projectId],
      ["task_list_id", request.taskListId],
      ["plan_id", request.planId],
      ["agent_id", request.agentId],
      ["status", request.status],
    ] as const) {
      if (value !== null) {
        clauses.push(`snapshots.${column} = ?`);
        values.push(value);
      }
    }
    if (request.changedAfter !== null) {
      clauses.push("snapshots.derived_at > ?");
      values.push(request.changedAfter);
    }
    if (request.cursor !== null) {
      const [derivedAt, id] = decodeCursor(request.cursor);
      clauses.push("(snapshots.derived_at < ? OR (snapshots.derived_at = ? AND snapshots.projection_id > ?))");
      values.push(derivedAt, derivedAt, id);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.query(`
      SELECT snapshots.* FROM task_to_pr_projection_snapshots AS snapshots
      JOIN (
        SELECT projection_id, MAX(version) AS version
        FROM task_to_pr_projection_snapshots GROUP BY projection_id
      ) AS latest
        ON latest.projection_id = snapshots.projection_id AND latest.version = snapshots.version
      ${where}
      ORDER BY snapshots.derived_at DESC, snapshots.projection_id ASC
      LIMIT ?
    `).all(...values, request.limit + 1) as ProjectionRow[];
    const hasMore = rows.length > request.limit;
    const pageRows = rows.slice(0, request.limit);
    return {
      items: pageRows.map(projectionFromRow),
      count: pageRows.length,
      nextCursor: hasMore && pageRows.length > 0 ? encodeCursor(pageRows[pageRows.length - 1]!) : null,
    };
  }

  rebuild(input: TaskToPrProjectionRebuildInput): TaskToPrProjectionRebuildResult {
    const request = TODOS_REQUEST_SCHEMAS[TODOS_REQUEST_SCHEMA_IDS.projectionRebuild].parse(input);
    if (request.expectedManifestDigest !== TODOS_OPERATION_MANIFEST_DIGEST) {
      throw new Error("TASK_TO_PR_PROJECTION_PRECONDITION_FAILED: manifest digest does not match @hasna/contracts");
    }
    const groups = sourceGroups(this.db, request.taskRefs);
    const derived = groups
      .map((group) => deriveTaskToPrProjection(this.db, group))
      .filter((value): value is NonNullable<typeof value> => value !== null);
    const oldById = new Map<string, string>();
    for (const value of derived) {
      const current = this.get(value.projection.id);
      if (current) oldById.set(value.projection.id, current.digest);
    }

    const transaction = this.db.transaction(() => {
      if (request.taskRefs.length === 0) {
        this.db.run("DELETE FROM task_to_pr_projection_snapshots");
      } else {
        for (const group of groups) {
          this.db.query("DELETE FROM task_to_pr_projection_snapshots WHERE source_group_id = ?").run(group.id);
        }
      }
      for (const value of derived) insertProjection(this.db, value.projection, value.scope);
    });
    transaction();

    const receipts: TaskToPrProjectionMutationReceipt[] = derived.map(({ projection }) => ({
      operationId: "todos.task_to_pr_projection.rebuild",
      resourceId: projection.id,
      changed: oldById.get(projection.id) !== projection.digest,
      replayed: oldById.get(projection.id) === projection.digest,
      version: projection.version,
    }));
    if (receipts.length === 0) {
      receipts.push({
        operationId: "todos.task_to_pr_projection.rebuild",
        resourceId: "task-to-pr-projections",
        changed: false,
        replayed: true,
        version: null,
      });
    }
    return { receipts };
  }
}

export { TODOS_OPERATION_MANIFEST_DIGEST };

