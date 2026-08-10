import type { DbAdapter, SqliteAdapter } from "../storage.js";
import { apiJson, isApiMode, toQuery } from "../db/api-mode.js";
import { getDatabase } from "../db/database.js";
import { parseMemoryRow } from "../db/memories.js";
import {
  buildMementosProjectRegistrationCapability,
} from "./identity.js";
import { digestMementosProjectRegistrationValue } from "./authority.js";
import {
  MEMENTOS_PROJECT_RESOURCE_KINDS,
  MEMENTOS_PROJECT_RESOURCE_ROUTE,
  type MementosProjectRegistrationAuthorityOptions,
  type MementosProjectResource,
  type MementosProjectResourceExactResult,
  type MementosProjectResourceKind,
  type MementosProjectResourcePage,
} from "./types.js";

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 1_000;
const CURSOR_SCHEMA = "mementos.project-resources.cursor.v1";

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  description: string | null;
  memory_prefix: string | null;
  created_at: unknown;
  updated_at: unknown;
}

interface CursorPayload {
  schema: typeof CURSOR_SCHEMA;
  project_id: string;
  collection_revision: string;
  resource_kinds: MementosProjectResourceKind[];
  after_key: string;
}

export type MementosProjectResourceErrorCode =
  | "MEMENTOS_PROJECT_RESOURCE_INVALID_INPUT"
  | "MEMENTOS_PROJECT_RESOURCE_PROJECT_NOT_FOUND"
  | "MEMENTOS_PROJECT_RESOURCE_NOT_FOUND"
  | "MEMENTOS_PROJECT_RESOURCE_COLLECTION_CHANGED"
  | "MEMENTOS_PROJECT_RESOURCE_INCOMPLETE";

export class MementosProjectResourceError extends Error {
  constructor(
    readonly code: MementosProjectResourceErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "MementosProjectResourceError";
  }
}

export interface ReadMementosProjectResourcePageOptions {
  limit?: number;
  cursor?: string | null;
  resource_kinds?: MementosProjectResourceKind[];
}

export interface ReadAllMementosProjectResourcesOptions {
  page_size?: number;
  resource_kinds?: MementosProjectResourceKind[];
}

function timestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function normalizeSqlValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeSqlValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, normalizeSqlValue(item)]),
  );
}

function exactProject(db: DbAdapter, projectId: string): ProjectRow {
  const row = db.get(
    "SELECT id, name, path, description, memory_prefix, created_at, updated_at FROM projects WHERE id = ? LIMIT 1",
    projectId,
  ) as ProjectRow | null;
  if (!row) {
    throw new MementosProjectResourceError(
      "MEMENTOS_PROJECT_RESOURCE_PROJECT_NOT_FOUND",
      `Mementos project not found: ${projectId}`,
      { project_id: projectId },
    );
  }
  return row;
}

function resourceKey(resource: Pick<MementosProjectResource, "resource_kind" | "stable_id">): string {
  const rank = MEMENTOS_PROJECT_RESOURCE_KINDS.indexOf(resource.resource_kind);
  return `${String(rank).padStart(2, "0")}:${resource.stable_id}`;
}

function projectResource(project: ProjectRow): MementosProjectResource {
  const normalized = normalizeSqlValue(project);
  return {
    authority: "mementos",
    source_package: "@hasna/mementos",
    project_id: project.id,
    resource_kind: "project",
    stable_id: project.id,
    revision: timestamp(project.updated_at),
    digest: digestMementosProjectRegistrationValue(normalized),
    membership: "project_aggregate",
  };
}

function memoryResources(db: DbAdapter, projectId: string): MementosProjectResource[] {
  const rows = db.all(
    "SELECT * FROM memories WHERE project_id = ? ORDER BY id ASC",
    projectId,
  ) as Record<string, unknown>[];
  return rows.map((row) => {
    const memory = normalizeSqlValue(parseMemoryRow(row)) as Record<string, unknown>;
    return {
      authority: "mementos" as const,
      source_package: "@hasna/mementos" as const,
      project_id: projectId,
      resource_kind: row["category"] === "knowledge" ? "knowledge" as const : "memory" as const,
      stable_id: String(row["id"]),
      revision: timestamp(row["updated_at"]),
      digest: digestMementosProjectRegistrationValue(memory),
      membership: "explicit_project_id_or_focus" as const,
    };
  });
}

function sessionResources(db: DbAdapter, projectId: string): MementosProjectResource[] {
  const rows = db.all(
    "SELECT * FROM session_memory_jobs WHERE project_id = ? ORDER BY id ASC",
    projectId,
  ) as Record<string, unknown>[];
  return rows.map((row) => {
    const normalized = {
      id: String(row["id"]),
      session_id: String(row["session_id"]),
      agent_id: row["agent_id"] === null ? null : String(row["agent_id"] ?? "") || null,
      project_id: row["project_id"] === null ? null : String(row["project_id"] ?? "") || null,
      source: String(row["source"]),
      status: String(row["status"]),
      transcript: String(row["transcript"]),
      chunk_count: Number(row["chunk_count"]),
      memories_extracted: Number(row["memories_extracted"]),
      error: row["error"] === null ? null : String(row["error"] ?? "") || null,
      metadata: typeof row["metadata"] === "string"
        ? JSON.parse(row["metadata"] || "{}")
        : normalizeSqlValue(row["metadata"] ?? {}),
      created_at: timestamp(row["created_at"]),
      started_at: row["started_at"] === null ? null : timestamp(row["started_at"]),
      completed_at: row["completed_at"] === null ? null : timestamp(row["completed_at"]),
    };
    return {
      authority: "mementos" as const,
      source_package: "@hasna/mementos" as const,
      project_id: projectId,
      resource_kind: "session" as const,
      stable_id: String(row["id"]),
      revision: timestamp(row["completed_at"] ?? row["started_at"] ?? row["created_at"]),
      digest: digestMementosProjectRegistrationValue(normalized),
      membership: "explicit_project_id_or_focus" as const,
    };
  });
}

function normalizeResourceKinds(
  value: MementosProjectResourceKind[] | undefined,
): MementosProjectResourceKind[] {
  if (!value) return [...MEMENTOS_PROJECT_RESOURCE_KINDS];
  if (value.length === 0) {
    throw new MementosProjectResourceError(
      "MEMENTOS_PROJECT_RESOURCE_INVALID_INPUT",
      "resource_kinds must contain at least one supported resource kind",
    );
  }
  const requested = new Set(value);
  for (const kind of requested) {
    if (!MEMENTOS_PROJECT_RESOURCE_KINDS.includes(kind)) {
      throw new MementosProjectResourceError(
        "MEMENTOS_PROJECT_RESOURCE_INVALID_INPUT",
        `Unsupported Mementos project resource kind: ${kind}`,
      );
    }
  }
  return MEMENTOS_PROJECT_RESOURCE_KINDS.filter((kind) => requested.has(kind));
}

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_PAGE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new MementosProjectResourceError(
      "MEMENTOS_PROJECT_RESOURCE_INVALID_INPUT",
      `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`,
    );
  }
  return limit;
}

function encodeCursor(cursor: CursorPayload): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as CursorPayload;
    if (
      parsed.schema !== CURSOR_SCHEMA
      || typeof parsed.project_id !== "string"
      || typeof parsed.collection_revision !== "string"
      || !Array.isArray(parsed.resource_kinds)
      || typeof parsed.after_key !== "string"
    ) {
      throw new Error("invalid cursor shape");
    }
    return parsed;
  } catch {
    throw new MementosProjectResourceError(
      "MEMENTOS_PROJECT_RESOURCE_INVALID_INPUT",
      "cursor is not a valid Mementos project-resource cursor",
    );
  }
}

function localPopulation(
  projectId: string,
  db: DbAdapter,
  resourceKinds: MementosProjectResourceKind[],
): {
  project: ProjectRow;
  resources: MementosProjectResource[];
  collectionRevision: string;
} {
  const project = exactProject(db, projectId);
  const selected = new Set(resourceKinds);
  const resources = [
    ...(selected.has("project") ? [projectResource(project)] : []),
    ...memoryResources(db, projectId).filter((resource) => selected.has(resource.resource_kind)),
    ...(selected.has("session") ? sessionResources(db, projectId) : []),
  ].sort((left, right) => resourceKey(left).localeCompare(resourceKey(right)));
  const collectionRevision = digestMementosProjectRegistrationValue({
    schema: MEMENTOS_PROJECT_RESOURCE_ROUTE,
    project_id: projectId,
    project_revision: timestamp(project.updated_at),
    resource_kinds: resourceKinds,
    resources: resources.map((resource) => ({
      resource_kind: resource.resource_kind,
      stable_id: resource.stable_id,
      revision: resource.revision,
      digest: resource.digest,
    })),
  });
  return { project, resources, collectionRevision };
}

export function readMementosProjectResourcePage(
  projectId: string,
  options: ReadMementosProjectResourcePageOptions = {},
  db?: DbAdapter,
  authorityOptions: MementosProjectRegistrationAuthorityOptions = {},
): MementosProjectResourcePage {
  const resourceKinds = normalizeResourceKinds(options.resource_kinds);
  const limit = normalizeLimit(options.limit);
  if (!db && isApiMode()) {
    const { data } = apiJson<MementosProjectResourcePage>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/resources${toQuery({
        limit,
        cursor: options.cursor ?? undefined,
        resource_kinds: resourceKinds.join(","),
      })}`,
    );
    return data;
  }

  const d = db ?? getDatabase();
  const { project, resources, collectionRevision } = localPopulation(projectId, d, resourceKinds);
  let start = 0;
  if (options.cursor) {
    const cursor = decodeCursor(options.cursor);
    if (
      cursor.project_id !== projectId
      || JSON.stringify(cursor.resource_kinds) !== JSON.stringify(resourceKinds)
    ) {
      throw new MementosProjectResourceError(
        "MEMENTOS_PROJECT_RESOURCE_INVALID_INPUT",
        "cursor does not belong to this project and resource-kind selection",
      );
    }
    if (cursor.collection_revision !== collectionRevision) {
      throw new MementosProjectResourceError(
        "MEMENTOS_PROJECT_RESOURCE_COLLECTION_CHANGED",
        "Mementos project resource collection changed; restart from the first page",
        {
          cursor_collection_revision: cursor.collection_revision,
          current_collection_revision: collectionRevision,
        },
      );
    }
    const afterIndex = resources.findIndex((resource) => resourceKey(resource) === cursor.after_key);
    if (afterIndex < 0) {
      throw new MementosProjectResourceError(
        "MEMENTOS_PROJECT_RESOURCE_COLLECTION_CHANGED",
        "Mementos project resource cursor no longer names a member; restart from the first page",
      );
    }
    start = afterIndex + 1;
  }

  const pageResources = resources.slice(start, start + limit);
  const hasMore = start + pageResources.length < resources.length;
  const nextCursor = hasMore && pageResources.length > 0
    ? encodeCursor({
      schema: CURSOR_SCHEMA,
      project_id: projectId,
      collection_revision: collectionRevision,
      resource_kinds: resourceKinds,
      after_key: resourceKey(pageResources[pageResources.length - 1]!),
    })
    : null;
  const capability = buildMementosProjectRegistrationCapability(authorityOptions);
  return {
    schema: "mementos.project-resources.v1",
    authority: {
      authority: capability.authority,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
      package_version: capability.package_version,
    },
    project_id: projectId,
    project_revision: timestamp(project.updated_at),
    collection_revision: collectionRevision,
    resource_kinds: resourceKinds,
    resources: pageResources,
    count: pageResources.length,
    total: resources.length,
    limit,
    cursor: options.cursor ?? null,
    next_cursor: nextCursor,
    has_more: hasMore,
    complete: true,
    truncated: false,
  };
}

export function readAllMementosProjectResources(
  projectId: string,
  options: ReadAllMementosProjectResourcesOptions = {},
  db?: DbAdapter,
  authorityOptions: MementosProjectRegistrationAuthorityOptions = {},
): MementosProjectResourcePage {
  const pageSize = normalizeLimit(options.page_size);
  let cursor: string | null = null;
  let first: MementosProjectResourcePage | null = null;
  const resources: MementosProjectResource[] = [];
  const seen = new Set<string>();

  do {
    const page = readMementosProjectResourcePage(
      projectId,
      {
        limit: pageSize,
        cursor,
        resource_kinds: options.resource_kinds,
      },
      db,
      authorityOptions,
    );
    if (!first) first = page;
    if (
      page.collection_revision !== first.collection_revision
      || page.total !== first.total
      || JSON.stringify(page.resource_kinds) !== JSON.stringify(first.resource_kinds)
    ) {
      throw new MementosProjectResourceError(
        "MEMENTOS_PROJECT_RESOURCE_COLLECTION_CHANGED",
        "Mementos project resource collection changed during complete traversal",
      );
    }
    for (const resource of page.resources) {
      const key = resourceKey(resource);
      if (seen.has(key)) {
        throw new MementosProjectResourceError(
          "MEMENTOS_PROJECT_RESOURCE_INCOMPLETE",
          `Mementos project resource traversal returned duplicate stable ID: ${key}`,
        );
      }
      seen.add(key);
      resources.push(resource);
    }
    if (page.has_more && !page.next_cursor) {
      throw new MementosProjectResourceError(
        "MEMENTOS_PROJECT_RESOURCE_INCOMPLETE",
        "Mementos project resource page claimed more results without a continuation cursor",
      );
    }
    cursor = page.next_cursor;
  } while (cursor);

  if (!first) {
    throw new MementosProjectResourceError(
      "MEMENTOS_PROJECT_RESOURCE_INCOMPLETE",
      "Mementos project resource traversal returned no first page",
    );
  }
  if (resources.length !== first.total) {
    throw new MementosProjectResourceError(
      "MEMENTOS_PROJECT_RESOURCE_INCOMPLETE",
      `Mementos project resource traversal returned ${resources.length} of ${first.total} resources`,
    );
  }
  return {
    ...first,
    resources,
    count: resources.length,
    total: resources.length,
    limit: pageSize,
    cursor: null,
    next_cursor: null,
    has_more: false,
    complete: true,
    truncated: false,
  };
}

export function getMementosProjectResourceExact(
  projectId: string,
  resourceKind: MementosProjectResourceKind,
  stableId: string,
  db?: DbAdapter,
  authorityOptions: MementosProjectRegistrationAuthorityOptions = {},
): MementosProjectResourceExactResult {
  if (!MEMENTOS_PROJECT_RESOURCE_KINDS.includes(resourceKind)) {
    throw new MementosProjectResourceError(
      "MEMENTOS_PROJECT_RESOURCE_INVALID_INPUT",
      `Unsupported Mementos project resource kind: ${resourceKind}`,
    );
  }
  if (!db && isApiMode()) {
    const { data } = apiJson<MementosProjectResourceExactResult>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resourceKind)}/${encodeURIComponent(stableId)}`,
    );
    return data;
  }
  const d = db ?? getDatabase();
  const { project, resources, collectionRevision } = localPopulation(projectId, d, [
    resourceKind,
  ]);
  const resource = resources.find((candidate) => candidate.stable_id === stableId);
  if (!resource) {
    throw new MementosProjectResourceError(
      "MEMENTOS_PROJECT_RESOURCE_NOT_FOUND",
      `Mementos ${resourceKind} resource not found in project ${projectId}: ${stableId}`,
      { project_id: projectId, resource_kind: resourceKind, stable_id: stableId },
    );
  }
  const capability = buildMementosProjectRegistrationCapability(authorityOptions);
  return {
    schema: "mementos.project-resource.v1",
    authority: {
      authority: capability.authority,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
      package_version: capability.package_version,
    },
    project_id: projectId,
    project_revision: timestamp(project.updated_at),
    collection_revision: collectionRevision,
    resource,
    complete: true,
    truncated: false,
  };
}

export type { SqliteAdapter };
