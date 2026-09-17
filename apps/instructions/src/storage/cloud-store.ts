/**
 * Pure-remote (Amendment A1) Postgres store for the instructions `/v1` API.
 *
 * Every function reads/writes the shared RDS Postgres DIRECTLY through the
 * vendored storage kit's typed query client — there is NO local cache or sync
 * in the service. This is a real wrapper over the configs/profiles domain
 * (slug uniqueness, optimistic version bumps, JSONB (de)serialization); it
 * throws clear errors rather than returning fake no-ops.
 */
import { createHash, randomUUID } from "node:crypto";
import type { TypedQueryClient } from "../generated/storage-kit/index.js";
import {
  ConfigNotFoundError,
  ProfileNotFoundError,
  type Config,
  type ConfigFilter,
  type ConfigOutput,
  type ConfigSummary,
  type ConfigIdentity,
  type ConfigSnapshot,
  type CreateConfigInput,
  type CreateProfileInput,
  type Machine,
  type Profile,
  type ProfileSelector,
  type ProfileVariables,
  type BoundedReadOptions,
  type BoundedReadPage,
  type ProfileResolutionRead,
  type UpdateConfigInput,
  type UpdateProfileInput,
  type ProfileConfigBinding,
  type ProfileConfigBindingSpec,
  type ProfileAssetBinding,
  type ProfileAssetBindingSpec,
} from "../types/index.js";
import { boundedReadPage, normalizeBoundedReadOptions } from "../lib/bounded-read.js";
import { legacyProfileConfigBinding, normalizeProfileConfigBinding } from "../lib/instruction-graph.js";
import { normalizeProfileAssetBinding } from "../lib/asset-plan.js";
import { normalizeOsFamily } from "../lib/machine.js";


class CollectionChangedWhilePagingError extends Error {
  constructor(label: string, detail: string) {
    super(`${label} changed while paging: ${detail}`);
    this.name = "CollectionChangedWhilePagingError";
  }
}

interface StableCollectionRead<T> {
  items: T[];
  total: number;
}

function isBoundedPageConsistencyError(error: unknown): error is Error {
  return error instanceof Error && (
    error.message.startsWith("bounded read returned ")
    || error.message.startsWith("bounded read did not advance ")
  );
}

async function aggregateBoundedCollectionRead<T>(
  label: string,
  readPage: (cursor: number) => Promise<BoundedReadPage<T>>,
  identity: (item: T) => string,
  requireAscendingIdentity = false,
  retryBoundedPageConsistencyErrors = false,
): Promise<StableCollectionRead<T>> {
  let lastError: CollectionChangedWhilePagingError | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const items: T[] = [];
      const seen = new Set<string>();
      let expectedTotal: number | null = null;
      let previousIdentity: string | null = null;
      let cursor = 0;
      while (true) {
        let page: BoundedReadPage<T>;
        try {
          page = await readPage(cursor);
        } catch (error) {
          if (!retryBoundedPageConsistencyErrors || !isBoundedPageConsistencyError(error)) throw error;
          throw new CollectionChangedWhilePagingError(label, error.message);
        }
        if (page.cursor !== cursor) {
          throw new CollectionChangedWhilePagingError(label, `server returned cursor ${page.cursor} for requested cursor ${cursor}`);
        }
        if (expectedTotal === null) expectedTotal = page.total;
        else if (page.total !== expectedTotal) {
          throw new CollectionChangedWhilePagingError(label, `total changed from ${expectedTotal} to ${page.total}`);
        }
        for (const item of page.items) {
          const key = identity(item);
          if (!key) throw new CollectionChangedWhilePagingError(label, "an item had no stable identity");
          if (seen.has(key)) throw new CollectionChangedWhilePagingError(label, `duplicate identity ${key}`);
          if (requireAscendingIdentity && previousIdentity !== null && key <= previousIdentity) {
            throw new CollectionChangedWhilePagingError(label, `identity order was not strictly increasing at ${key}`);
          }
          seen.add(key);
          previousIdentity = key;
          items.push(item);
        }
        if (page.complete) {
          if (items.length !== expectedTotal) {
            throw new CollectionChangedWhilePagingError(label, `received ${items.length} unique rows for total ${expectedTotal}`);
          }
          return { items, total: expectedTotal };
        }
        if (page.next_cursor === null || page.next_cursor <= cursor) {
          throw new CollectionChangedWhilePagingError(label, `cursor did not advance from ${cursor}`);
        }
        cursor = page.next_cursor;
      }
    } catch (error) {
      if (!(error instanceof CollectionChangedWhilePagingError)) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new CollectionChangedWhilePagingError(label, "read did not stabilize");
}

async function aggregateBoundedCollection<T>(
  label: string,
  readPage: (cursor: number) => Promise<BoundedReadPage<T>>,
  identity: (item: T) => string,
  requireAscendingIdentity = false,
): Promise<T[]> {
  return (await aggregateBoundedCollectionRead(label, readPage, identity, requireAscendingIdentity)).items;
}

export class StoreValidationError extends Error {
  constructor(
    message: string,
    readonly code: "NAME_REQUIRED" | "CATEGORY_REQUIRED",
  ) {
    super(message);
    this.name = "StoreValidationError";
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED" as const;
  constructor() {
    super("Idempotency-Key was already used for a different request body");
    this.name = "IdempotencyConflictError";
  }
}

export interface IdempotentRequestInput {
  principal: string;
  operation: string;
  key: string;
  body: unknown;
}

export interface IdempotentResponse<T> {
  status: number;
  body: T;
  replayed: boolean;
}

type TransactionalQueryClient = TypedQueryClient & {
  transaction<T>(fn: (client: TypedQueryClient) => Promise<T>): Promise<T>;
};

interface IdempotencyReceiptRow {
  request_sha256: string;
  response_status: number | null;
  response_body: unknown;
}

const IDEMPOTENCY_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS instruction_idempotency_receipts (
  principal TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  response_status INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (principal, operation, idempotency_key),
  CHECK (length(principal) BETWEEN 1 AND 512),
  CHECK (length(operation) BETWEEN 1 AND 255),
  CHECK (length(idempotency_key) BETWEEN 1 AND 255),
  CHECK (length(request_sha256) = 64),
  CHECK (
    (response_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
    OR
    (response_status BETWEEN 200 AND 599 AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  )
)`;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(null);
}

export function idempotencyBodyDigest(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

function hasTransaction(client: TypedQueryClient): client is TransactionalQueryClient {
  return typeof (client as Partial<TransactionalQueryClient>).transaction === "function";
}

/**
 * Execute a retryable mutation under one durable PostgreSQL receipt.
 *
 * The placeholder receipt, domain mutation, and completed response commit in
 * the same transaction. The primary key serializes concurrent duplicates;
 * `FOR UPDATE` makes a waiter replay the first committed response. A failed
 * domain mutation rolls the placeholder back, so a later retry may safely run.
 */
const idempotencySchemaReady = new WeakSet<object>();

export async function ensureIdempotencySchema(client: TypedQueryClient): Promise<void> {
  if (idempotencySchemaReady.has(client as object)) return;
  await client.execute(IDEMPOTENCY_SCHEMA_SQL);
  await client.execute(
    "CREATE INDEX IF NOT EXISTS instruction_idempotency_receipts_created_at_idx ON instruction_idempotency_receipts (created_at)",
  );
  idempotencySchemaReady.add(client as object);
}

export async function executeIdempotentRequest<T>(
  client: TypedQueryClient,
  input: IdempotentRequestInput,
  perform: (client: TypedQueryClient) => Promise<{ status: number; body: T }>,
): Promise<IdempotentResponse<T>> {
  if (!hasTransaction(client)) {
    throw new Error("durable idempotency requires a transactional PostgreSQL client");
  }
  await ensureIdempotencySchema(client);
  const digest = idempotencyBodyDigest(input.body);
  return client.transaction(async (tx) => {
    const identity = [input.principal, input.operation, input.key] as const;
    const inserted = await tx.query<{ inserted: boolean }>(
      `INSERT INTO instruction_idempotency_receipts
         (principal, operation, idempotency_key, request_sha256)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (principal, operation, idempotency_key) DO NOTHING
       RETURNING true AS inserted`,
      [...identity, digest],
    );
    const receipt = await tx.get<IdempotencyReceiptRow>(
      `SELECT request_sha256, response_status, response_body
         FROM instruction_idempotency_receipts
        WHERE principal = $1 AND operation = $2 AND idempotency_key = $3
        FOR UPDATE`,
      identity,
    );
    if (!receipt) throw new Error("idempotency receipt disappeared during transaction");
    if (receipt.request_sha256 !== digest) throw new IdempotencyConflictError();
    if (inserted.rowCount === 0) {
      if (receipt.response_status === null || receipt.response_body === null) {
        throw new Error("idempotency receipt is incomplete after serialization");
      }
      return { status: Number(receipt.response_status), body: receipt.response_body as T, replayed: true };
    }

    const response = await perform(tx);
    await tx.execute(
      `UPDATE instruction_idempotency_receipts
          SET response_status = $5, response_body = $6::jsonb, completed_at = now()
        WHERE principal = $1 AND operation = $2 AND idempotency_key = $3 AND request_sha256 = $4`,
      [...identity, digest, response.status, JSON.stringify(response.body)],
    );
    return { ...response, replayed: false };
  });
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return value == null ? "" : String(value);
}

/** Parse a value the pg driver may hand back either as JSON string or object. */
function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try {
      const p = JSON.parse(value);
      return Array.isArray(p) ? (p as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asObject<T>(value: unknown): T {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as T;
  if (typeof value === "string") {
    try {
      const p = JSON.parse(value);
      return p && typeof p === "object" ? (p as T) : ({} as T);
    } catch {
      return {} as T;
    }
  }
  return {} as T;
}

interface ConfigDbRow {
  id: string;
  name: string;
  slug: string;
  kind: string;
  category: string;
  agent: string;
  target_path: string | null;
  outputs: unknown;
  format: string;
  content: string;
  description: string | null;
  tags: unknown;
  is_template: boolean;
  version: number;
  created_at: unknown;
  updated_at: unknown;
  synced_at: unknown;
}

function rowToConfig(row: ConfigDbRow): Config {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind as Config["kind"],
    category: row.category as Config["category"],
    agent: row.agent as Config["agent"],
    target_path: row.target_path,
    outputs: asArray<ConfigOutput>(row.outputs),
    format: row.format as Config["format"],
    content: row.content,
    description: row.description,
    tags: asArray<string>(row.tags),
    is_template: Boolean(row.is_template),
    version: Number(row.version),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    synced_at: row.synced_at == null ? null : toIso(row.synced_at),
  };
}

async function uniqueSlug(
  client: TypedQueryClient,
  name: string,
  excludeId?: string,
): Promise<string> {
  const base = slugify(name) || "config";
  let slug = base;
  let i = 1;
  // Bounded loop; a handful of collisions at most in practice.
  for (let attempt = 0; attempt < 1000; attempt++) {
    const existing = await client.get<{ id: string }>(
      "SELECT id FROM configs WHERE slug = $1",
      [slug],
    );
    if (!existing || existing.id === excludeId) return slug;
    slug = `${base}-${i++}`;
  }
  throw new Error(`could not allocate a unique slug for '${name}'`);
}

// ── Configs ────────────────────────────────────────────────────────────────

function configFilterSql(filter: ConfigFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    conditions.push(sql.replace("$?", `$${params.length}`));
  };
  if (filter.category) add("category = $?", filter.category);
  if (filter.agent) add("agent = $?", filter.agent);
  if (filter.kind) add("kind = $?", filter.kind);
  if (filter.is_template !== undefined) add("is_template = $?", filter.is_template);
  if (filter.search) {
    params.push(`%${filter.search}%`);
    const parameter = `$${params.length}`;
    conditions.push(`(name ILIKE ${parameter} OR description ILIKE ${parameter} OR content ILIKE ${parameter})`);
  }
  if (filter.tags?.length) {
    for (const tag of filter.tags) add("tags @> $?::jsonb", JSON.stringify([tag]));
  }
  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export async function listConfigsPage(
  client: TypedQueryClient,
  filter: ConfigFilter = {},
  options: BoundedReadOptions = {},
): Promise<BoundedReadPage<Config>> {
  const normalized = normalizeBoundedReadOptions(options);
  const { where, params } = configFilterSql(filter);
  const count = await client.get<{ total: number | string }>(
    `SELECT COUNT(*) AS total FROM configs ${where}`,
    params,
  );
  const rows = await client.many<ConfigDbRow>(
    `SELECT * FROM configs ${where} ORDER BY id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, normalized.limit, normalized.cursor],
  );
  return boundedReadPage(rows.map(rowToConfig), Number(count?.total ?? 0), normalized);
}

export async function listConfigs(
  client: TypedQueryClient,
  filter: ConfigFilter = {},
): Promise<Config[]> {
  return aggregateBoundedCollection(
    "config list",
    (cursor) => listConfigsPage(client, filter, { limit: 100, cursor }),
    (config) => config.id,
    true,
  );
}

export async function listConfigSummariesPage(
  client: TypedQueryClient,
  filter: ConfigFilter = {},
  options: BoundedReadOptions = {},
): Promise<BoundedReadPage<ConfigSummary>> {
  const normalized = normalizeBoundedReadOptions(options);
  const { where, params } = configFilterSql(filter);
  const count = await client.get<{ total: number | string }>(`SELECT COUNT(*) AS total FROM configs ${where}`, params);
  const rows = await client.many<{
    id: string; name: string; slug: string; kind: string; category: string; agent: string;
    target_path: string | null; format: string; output_count: number | string; description: string | null;
    tags: unknown; is_template: boolean; version: number; updated_at: unknown;
  }>(
    `SELECT id, name, slug, kind, category, agent, target_path, format,
            jsonb_array_length(outputs) AS output_count, description, tags,
            is_template, version, updated_at
       FROM configs ${where} ORDER BY id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, normalized.limit, normalized.cursor],
  );
  return boundedReadPage(rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category as Config["category"],
    agent: row.agent as Config["agent"],
    kind: row.kind as Config["kind"],
    format: row.format as Config["format"],
    target_path: row.target_path,
    output_count: Number(row.output_count ?? 0),
    version: row.version,
    is_template: Boolean(row.is_template),
    updated_at: toIso(row.updated_at),
    description: row.description,
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
  })), Number(count?.total ?? 0), normalized);
}


export function listConfigIdentitiesPage(
  client: TypedQueryClient,
  options?: BoundedReadOptions,
): Promise<BoundedReadPage<ConfigIdentity>>;
export function listConfigIdentitiesPage(
  client: TypedQueryClient,
  filter: ConfigFilter,
  options?: BoundedReadOptions,
): Promise<BoundedReadPage<ConfigIdentity>>;
export async function listConfigIdentitiesPage(
  client: TypedQueryClient,
  filterOrOptions: ConfigFilter | BoundedReadOptions = {},
  maybeOptions?: BoundedReadOptions,
): Promise<BoundedReadPage<ConfigIdentity>> {
  const filterKeys = ["category", "agent", "kind", "is_template", "search", "tags"] as const;
  const isFilterOnly = maybeOptions === undefined && filterKeys.some((key) => key in filterOrOptions);
  const filter = maybeOptions === undefined && !isFilterOnly ? {} : filterOrOptions as ConfigFilter;
  const options = maybeOptions === undefined && !isFilterOnly ? filterOrOptions as BoundedReadOptions : (maybeOptions ?? {});
  const normalized = normalizeBoundedReadOptions(options);
  const { where, params } = configFilterSql(filter);
  const count = await client.get<{ total: number | string }>(`SELECT COUNT(*) AS total FROM configs ${where}`, params);
  const rows = await client.many<Omit<ConfigIdentity, "created_at" | "updated_at" | "synced_at"> & {
    created_at: unknown; updated_at: unknown; synced_at: unknown;
  }>(
    `SELECT id, name, slug, kind, category, agent, format, is_template, version, created_at, updated_at, synced_at
       FROM configs ${where} ORDER BY id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, normalized.limit, normalized.cursor],
  );
  return boundedReadPage(rows.map((row) => ({
    ...row,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    synced_at: row.synced_at == null ? null : toIso(row.synced_at),
  })), Number(count?.total ?? 0), normalized);
}

export async function getConfig(client: TypedQueryClient, idOrSlug: string): Promise<Config> {
  const row = await client.get<ConfigDbRow>(
    "SELECT * FROM configs WHERE id = $1 OR slug = $1",
    [idOrSlug],
  );
  if (!row) throw new ConfigNotFoundError(idOrSlug);
  return rowToConfig(row);
}

export async function createConfig(
  client: TypedQueryClient,
  input: CreateConfigInput,
): Promise<Config> {
  if (typeof input.name !== "string" || !input.name.trim()) throw new StoreValidationError("name is required", "NAME_REQUIRED");
  if (typeof input.category !== "string" || !input.category.trim()) throw new StoreValidationError("category is required", "CATEGORY_REQUIRED");
  const id = randomUUID();
  const slug = await uniqueSlug(client, input.name);
  const snapshotId = randomUUID();
  await client.execute(
    `WITH inserted_config AS (
       INSERT INTO configs
         (id, name, slug, kind, category, agent, target_path, outputs, format, content, description, tags, is_template, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13,1,now(),now())
       RETURNING id, content, version
     )
     INSERT INTO config_snapshots (id, config_id, content, version, created_at)
     SELECT $14, id, content, version, now() FROM inserted_config`,
    [
      id,
      input.name,
      slug,
      input.kind ?? "file",
      input.category,
      input.agent ?? "global",
      input.target_path ?? null,
      JSON.stringify(input.outputs ?? []),
      input.format ?? "text",
      input.content ?? "",
      input.description ?? null,
      JSON.stringify(input.tags ?? []),
      input.is_template ?? false,
      snapshotId,
    ],
  );
  return getConfig(client, id);
}

export async function updateConfig(
  client: TypedQueryClient,
  idOrSlug: string,
  input: UpdateConfigInput,
): Promise<Config> {
  const existing = await getConfig(client, idOrSlug);
  const sets: string[] = ["updated_at = now()", "version = version + 1"];
  const params: unknown[] = [];
  const set = (col: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if (input.name !== undefined) {
    set("name", input.name);
    set("slug", await uniqueSlug(client, input.name, existing.id));
  }
  if (input.kind !== undefined) set("kind", input.kind);
  if (input.category !== undefined) set("category", input.category);
  if (input.agent !== undefined) set("agent", input.agent);
  if (input.target_path !== undefined) set("target_path", input.target_path);
  if (input.outputs !== undefined) set("outputs", JSON.stringify(input.outputs), "::jsonb");
  if (input.format !== undefined) set("format", input.format);
  if (input.content !== undefined) set("content", input.content);
  if (input.description !== undefined) set("description", input.description);
  if (input.tags !== undefined) set("tags", JSON.stringify(input.tags), "::jsonb");
  if (input.is_template !== undefined) set("is_template", input.is_template);
  if (input.synced_at !== undefined) set("synced_at", input.synced_at, "::timestamptz");

  params.push(existing.id);
  const configIdParam = params.length;
  params.push(randomUUID());
  const snapshotIdParam = params.length;
  await client.execute(
    `WITH updated_config AS (
       UPDATE configs SET ${sets.join(", ")} WHERE id = $${configIdParam}
       RETURNING id, content, version
     )
     INSERT INTO config_snapshots (id, config_id, content, version, created_at)
     SELECT $${snapshotIdParam}, id, content, version, now() FROM updated_config`,
    params,
  );
  return getConfig(client, existing.id);
}

export async function deleteConfig(client: TypedQueryClient, idOrSlug: string): Promise<void> {
  const existing = await getConfig(client, idOrSlug);
  await client.execute("DELETE FROM configs WHERE id = $1", [existing.id]);
}

export async function getConfigStats(client: TypedQueryClient): Promise<Record<string, number>> {
  const rows = await client.many<{ category: string; count: string | number }>(
    "SELECT category, COUNT(*)::int AS count FROM configs GROUP BY category",
  );
  const stats: Record<string, number> = { total: 0 };
  for (const row of rows) {
    const n = Number(row.count);
    stats[row.category] = n;
    stats.total += n;
  }
  return stats;
}

// ── Snapshots ────────────────────────────────────────────────────────────────

export async function createSnapshot(
  client: TypedQueryClient,
  idOrSlug: string,
): Promise<ConfigSnapshot> {
  const config = await getConfig(client, idOrSlug);
  const id = randomUUID();
  await client.execute(
    `INSERT INTO config_snapshots (id, config_id, content, version, created_at)
     VALUES ($1,$2,$3,$4,now())`,
    [id, config.id, config.content, config.version],
  );
  const row = await client.get<{ id: string; config_id: string; content: string; version: number; created_at: unknown }>(
    "SELECT id, config_id, content, version, created_at FROM config_snapshots WHERE id = $1",
    [id],
  );
  if (!row) throw new Error("snapshot insert failed");
  return { id: row.id, config_id: row.config_id, content: row.content, version: Number(row.version), created_at: toIso(row.created_at) };
}

export async function createSnapshotContent(
  client: TypedQueryClient,
  idOrSlug: string,
  content: string,
  version: number,
): Promise<ConfigSnapshot> {
  const config = await getConfig(client, idOrSlug);
  const id = randomUUID();
  await client.execute(
    `INSERT INTO config_snapshots (id, config_id, content, version, created_at)
     VALUES ($1,$2,$3,$4,now())`,
    [id, config.id, content, version],
  );
  const row = await client.get<{ id: string; config_id: string; content: string; version: number; created_at: unknown }>(
    "SELECT id, config_id, content, version, created_at FROM config_snapshots WHERE id = $1",
    [id],
  );
  if (!row) throw new Error("snapshot insert failed");
  return { id: row.id, config_id: row.config_id, content: row.content, version: Number(row.version), created_at: toIso(row.created_at) };
}

export async function listSnapshotsPage(
  client: TypedQueryClient,
  idOrSlug: string,
  options: BoundedReadOptions = {},
): Promise<BoundedReadPage<ConfigSnapshot>> {
  const config = await getConfig(client, idOrSlug);
  const normalized = normalizeBoundedReadOptions(options);
  const count = await client.get<{ total: number | string }>(
    "SELECT COUNT(*) AS total FROM config_snapshots WHERE config_id = $1",
    [config.id],
  );
  const rows = await client.many<{ id: string; config_id: string; content: string; version: number; created_at: unknown }>(
    `SELECT id, config_id, content, version, created_at
       FROM config_snapshots WHERE config_id = $1
       ORDER BY version DESC, id LIMIT $2 OFFSET $3`,
    [config.id, normalized.limit, normalized.cursor],
  );
  return boundedReadPage(rows.map((row) => ({
    id: row.id,
    config_id: row.config_id,
    content: row.content,
    version: Number(row.version),
    created_at: toIso(row.created_at),
  })), Number(count?.total ?? 0), normalized);
}

export async function listSnapshots(
  client: TypedQueryClient,
  idOrSlug: string,
): Promise<ConfigSnapshot[]> {
  const snapshots: ConfigSnapshot[] = [];
  let cursor = 0;
  while (true) {
    const page = await listSnapshotsPage(client, idOrSlug, { limit: 100, cursor });
    snapshots.push(...page.items);
    if (page.complete) return snapshots;
    cursor = page.next_cursor!;
  }
}

export async function getSnapshotById(
  client: TypedQueryClient,
  snapshotId: string,
): Promise<ConfigSnapshot | null> {
  const row = await client.get<{ id: string; config_id: string; content: string; version: number; created_at: unknown }>(
    "SELECT id, config_id, content, version, created_at FROM config_snapshots WHERE id = $1",
    [snapshotId],
  );
  return row ? { id: row.id, config_id: row.config_id, content: row.content, version: Number(row.version), created_at: toIso(row.created_at) } : null;
}

export async function getSnapshotByVersion(
  client: TypedQueryClient,
  idOrSlug: string,
  version: number,
): Promise<ConfigSnapshot | null> {
  const config = await getConfig(client, idOrSlug);
  const row = await client.get<{ id: string; config_id: string; content: string; version: number; created_at: unknown }>(
    "SELECT id, config_id, content, version, created_at FROM config_snapshots WHERE config_id = $1 AND version = $2",
    [config.id, version],
  );
  return row ? { id: row.id, config_id: row.config_id, content: row.content, version: Number(row.version), created_at: toIso(row.created_at) } : null;
}

export async function pruneSnapshots(
  client: TypedQueryClient,
  idOrSlug: string,
  keep = 10,
): Promise<number> {
  const config = await getConfig(client, idOrSlug);
  const result = await client.query(
    `DELETE FROM config_snapshots WHERE config_id = $1 AND id NOT IN (
       SELECT id FROM config_snapshots WHERE config_id = $1 ORDER BY version DESC LIMIT $2
     )`,
    [config.id, keep],
  );
  return result.rowCount ?? 0;
}

// ── Profiles ─────────────────────────────────────────────────────────────────

interface ProfileDbRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  selectors: unknown;
  variables: unknown;
  created_at: unknown;
  updated_at: unknown;
}

function rowToProfile(row: ProfileDbRow): Profile {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    selectors: asObject<ProfileSelector>(row.selectors),
    variables: asObject<ProfileVariables>(row.variables),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

export async function listProfiles(client: TypedQueryClient): Promise<Profile[]> {
  return aggregateBoundedCollection(
    "profile list",
    (cursor) => listProfilesPage(client, { limit: 100, cursor }),
    (profile) => profile.id,
    true,
  );
}

export async function listProfilesPage(
  client: TypedQueryClient,
  options: BoundedReadOptions = {},
): Promise<BoundedReadPage<Profile>> {
  const normalized = normalizeBoundedReadOptions(options);
  const count = await client.get<{ total: number | string }>("SELECT COUNT(*) AS total FROM profiles");
  const rows = await client.many<ProfileDbRow>(
    "SELECT * FROM profiles ORDER BY id LIMIT $1 OFFSET $2",
    [normalized.limit, normalized.cursor],
  );
  return boundedReadPage(rows.map(rowToProfile), Number(count?.total ?? 0), normalized);
}

export interface ProfileIdentity {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export async function listProfileIdentitiesPage(
  client: TypedQueryClient,
  options: BoundedReadOptions = {},
): Promise<BoundedReadPage<ProfileIdentity>> {
  const normalized = normalizeBoundedReadOptions(options);
  const count = await client.get<{ total: number | string }>("SELECT COUNT(*) AS total FROM profiles");
  const rows = await client.many<{ id: string; name: string; slug: string; created_at: unknown; updated_at: unknown }>(
    `SELECT id, name, slug, created_at, updated_at
       FROM profiles ORDER BY id LIMIT $1 OFFSET $2`,
    [normalized.limit, normalized.cursor],
  );
  return boundedReadPage(rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  })), Number(count?.total ?? 0), normalized);
}

export async function getProfile(client: TypedQueryClient, idOrSlug: string): Promise<Profile> {
  const row = await client.get<ProfileDbRow>(
    "SELECT * FROM profiles WHERE id = $1 OR slug = $1",
    [idOrSlug],
  );
  if (!row) throw new ProfileNotFoundError(idOrSlug);
  return rowToProfile(row);
}

export async function getProfileConfigs(
  client: TypedQueryClient,
  idOrSlug: string,
): Promise<Config[]> {
  return aggregateBoundedCollection(
    "profile membership",
    (cursor) => getProfileConfigsPage(client, idOrSlug, { limit: 100, cursor }),
    (config) => config.id,
  );
}

export async function getProfileConfigsPage(
  client: TypedQueryClient,
  idOrSlug: string,
  options: BoundedReadOptions = {},
): Promise<BoundedReadPage<Config>> {
  const profile = await getProfile(client, idOrSlug);
  const normalized = normalizeBoundedReadOptions(options);
  const count = await client.get<{ total: number | string }>(
    "SELECT COUNT(*) AS total FROM profile_configs WHERE profile_id = $1",
    [profile.id],
  );
  const rows = await client.many<ConfigDbRow>(
    `SELECT c.* FROM configs c
       JOIN profile_configs pc ON pc.config_id = c.id
      WHERE pc.profile_id = $1
      ORDER BY pc.sort_order, c.id
      LIMIT $2 OFFSET $3`,
    [profile.id, normalized.limit, normalized.cursor],
  );
  return boundedReadPage(rows.map(rowToConfig), Number(count?.total ?? 0), normalized);
}

export async function createProfile(
  client: TypedQueryClient,
  input: CreateProfileInput,
): Promise<Profile> {
  if (typeof input.name !== "string" || !input.name.trim()) throw new StoreValidationError("name is required", "NAME_REQUIRED");
  const id = randomUUID();
  const slug = await uniqueProfileSlug(client, input.name);
  await client.execute(
    `INSERT INTO profiles (id, name, slug, description, selectors, variables, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,now(),now())`,
    [id, input.name, slug, input.description ?? null, JSON.stringify(input.selectors ?? {}), JSON.stringify(input.variables ?? {})],
  );
  return getProfile(client, id);
}

async function uniqueProfileSlug(
  client: TypedQueryClient,
  name: string,
  excludeId?: string,
): Promise<string> {
  const base = slugify(name) || "profile";
  let slug = base;
  let i = 1;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const existing = await client.get<{ id: string }>("SELECT id FROM profiles WHERE slug = $1", [slug]);
    if (!existing || existing.id === excludeId) return slug;
    slug = `${base}-${i++}`;
  }
  throw new Error(`could not allocate a unique slug for profile '${name}'`);
}

export async function updateProfile(
  client: TypedQueryClient,
  idOrSlug: string,
  input: UpdateProfileInput,
): Promise<Profile> {
  const existing = await getProfile(client, idOrSlug);
  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [];
  const set = (col: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if (input.name !== undefined) {
    set("name", input.name);
    set("slug", await uniqueProfileSlug(client, input.name, existing.id));
  }
  if (input.description !== undefined) set("description", input.description);
  if (input.selectors !== undefined) set("selectors", JSON.stringify(input.selectors), "::jsonb");
  if (input.variables !== undefined) set("variables", JSON.stringify(input.variables), "::jsonb");
  params.push(existing.id);
  await client.execute(`UPDATE profiles SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  return getProfile(client, existing.id);
}

export async function deleteProfile(client: TypedQueryClient, idOrSlug: string): Promise<void> {
  const existing = await getProfile(client, idOrSlug);
  await client.execute("DELETE FROM profiles WHERE id = $1", [existing.id]);
}

// ── Profile membership ───────────────────────────────────────────────────────

export async function addConfigToProfile(
  client: TypedQueryClient,
  profileIdOrSlug: string,
  configId: string,
): Promise<void> {
  const profile = await getProfile(client, profileIdOrSlug);
  const maxRow = await client.get<{ max_order: number | null }>(
    "SELECT MAX(sort_order) AS max_order FROM profile_configs WHERE profile_id = $1",
    [profile.id],
  );
  const order = (maxRow?.max_order ?? -1) + 1;
  await client.execute(
    `INSERT INTO profile_configs (profile_id, config_id, sort_order)
     VALUES ($1,$2,$3) ON CONFLICT (profile_id, config_id) DO NOTHING`,
    [profile.id, configId, order],
  );
}

function rowToProfileConfigBinding(row: {
  profile_id: string;
  config_id: string;
  sort_order: number;
  binding: unknown;
}): ProfileConfigBinding {
  return {
    profile_id: row.profile_id,
    config_id: row.config_id,
    sort_order: Number(row.sort_order),
    binding: row.binding == null ? legacyProfileConfigBinding() : normalizeProfileConfigBinding(row.binding),
  };
}

export async function getProfileConfigBindingsPage(
  client: TypedQueryClient,
  profileIdOrSlug: string,
  options: BoundedReadOptions = {},
): Promise<BoundedReadPage<ProfileConfigBinding>> {
  const profile = await getProfile(client, profileIdOrSlug);
  const normalized = normalizeBoundedReadOptions(options);
  const count = await client.get<{ total: number | string }>(
    "SELECT COUNT(*) AS total FROM profile_configs WHERE profile_id = $1",
    [profile.id],
  );
  const rows = await client.many<{ profile_id: string; config_id: string; sort_order: number; binding: unknown }>(
    `SELECT profile_id, config_id, sort_order, binding
       FROM profile_configs
      WHERE profile_id = $1
      ORDER BY sort_order, config_id
      LIMIT $2 OFFSET $3`,
    [profile.id, normalized.limit, normalized.cursor],
  );
  return boundedReadPage(rows.map(rowToProfileConfigBinding), Number(count?.total ?? 0), normalized);
}

export async function getProfileConfigBindings(
  client: TypedQueryClient,
  profileIdOrSlug: string,
): Promise<ProfileConfigBinding[]> {
  return aggregateBoundedCollection(
    "profile config bindings",
    (cursor) => getProfileConfigBindingsPage(client, profileIdOrSlug, { limit: 100, cursor }),
    (binding) => `${binding.profile_id}\0${binding.config_id}`,
  );
}

async function getProfileConfigBinding(
  client: TypedQueryClient,
  profileId: string,
  configId: string,
): Promise<ProfileConfigBinding> {
  const row = await client.get<{ profile_id: string; config_id: string; sort_order: number; binding: unknown }>(
    `SELECT profile_id, config_id, sort_order, binding
       FROM profile_configs
      WHERE profile_id = $1 AND config_id = $2`,
    [profileId, configId],
  );
  if (!row) throw new Error(`Config ${configId} is not a member of profile ${profileId}.`);
  return rowToProfileConfigBinding(row);
}

export async function setProfileConfigBinding(
  client: TypedQueryClient,
  profileIdOrSlug: string,
  configId: string,
  binding: ProfileConfigBindingSpec,
): Promise<ProfileConfigBinding> {
  const profile = await getProfile(client, profileIdOrSlug);
  const normalized = normalizeProfileConfigBinding(binding);
  const result = await client.query(
    "UPDATE profile_configs SET binding = $1 WHERE profile_id = $2 AND config_id = $3",
    [JSON.stringify(normalized), profile.id, configId],
  );
  if ((result.rowCount ?? 0) !== 1) throw new Error(`Config ${configId} is not a member of profile ${profile.slug}.`);
  return getProfileConfigBinding(client, profile.id, configId);
}

export async function removeConfigFromProfile(
  client: TypedQueryClient,
  profileIdOrSlug: string,
  configId: string,
): Promise<void> {
  const profile = await getProfile(client, profileIdOrSlug);
  await client.execute(
    "DELETE FROM profile_configs WHERE profile_id = $1 AND config_id = $2",
    [profile.id, configId],
  );
}

function rowToProfileAssetBinding(row: {
  profile_id: string;
  source_config_id: string;
  sort_order: number;
  binding: unknown;
}): ProfileAssetBinding {
  return {
    profile_id: row.profile_id,
    source_config_id: row.source_config_id,
    sort_order: Number(row.sort_order),
    binding: normalizeProfileAssetBinding(row.binding),
  };
}

export async function getProfileAssetBindingsPage(
  client: TypedQueryClient,
  profileIdOrSlug: string,
  options: BoundedReadOptions = {},
): Promise<BoundedReadPage<ProfileAssetBinding>> {
  const profile = await getProfile(client, profileIdOrSlug);
  const normalized = normalizeBoundedReadOptions(options);
  const count = await client.get<{ total: number | string }>(
    "SELECT COUNT(*) AS total FROM profile_assets WHERE profile_id = $1",
    [profile.id],
  );
  const rows = await client.many<{ profile_id: string; source_config_id: string; sort_order: number; binding: unknown }>(
    `SELECT profile_id, source_config_id, sort_order, binding
       FROM profile_assets
      WHERE profile_id = $1
      ORDER BY sort_order, asset_key
      LIMIT $2 OFFSET $3`,
    [profile.id, normalized.limit, normalized.cursor],
  );
  return boundedReadPage(rows.map(rowToProfileAssetBinding), Number(count?.total ?? 0), normalized);
}

export async function getProfileAssetBindings(
  client: TypedQueryClient,
  profileIdOrSlug: string,
): Promise<ProfileAssetBinding[]> {
  return aggregateBoundedCollection(
    "profile asset bindings",
    (cursor) => getProfileAssetBindingsPage(client, profileIdOrSlug, { limit: 100, cursor }),
    (asset) => `${asset.profile_id}\0${asset.binding.assetKey}`,
  );
}

async function getProfileAssetBinding(
  client: TypedQueryClient,
  profileId: string,
  assetKey: string,
): Promise<ProfileAssetBinding> {
  const row = await client.get<{ profile_id: string; source_config_id: string; sort_order: number; binding: unknown }>(
    `SELECT profile_id, source_config_id, sort_order, binding
       FROM profile_assets
      WHERE profile_id = $1 AND asset_key = $2`,
    [profileId, assetKey],
  );
  if (!row) throw new Error(`Asset ${assetKey} is not a member of profile ${profileId}.`);
  return rowToProfileAssetBinding(row);
}

export async function addAssetToProfile(
  client: TypedQueryClient,
  profileIdOrSlug: string,
  sourceConfigId: string,
  binding: ProfileAssetBindingSpec,
): Promise<ProfileAssetBinding> {
  const profile = await getProfile(client, profileIdOrSlug);
  await getConfig(client, sourceConfigId);
  const normalized = normalizeProfileAssetBinding(binding);
  const maxRow = await client.get<{ max_order: number | null }>(
    "SELECT MAX(sort_order) AS max_order FROM profile_assets WHERE profile_id = $1",
    [profile.id],
  );
  const order = (maxRow?.max_order ?? -1) + 1;
  await client.execute(
    "INSERT INTO profile_assets (profile_id, source_config_id, asset_key, sort_order, binding) VALUES ($1,$2,$3,$4,$5::jsonb)",
    [profile.id, sourceConfigId, normalized.assetKey, order, JSON.stringify(normalized)],
  );
  return getProfileAssetBinding(client, profile.id, normalized.assetKey);
}

export async function setProfileAssetBinding(
  client: TypedQueryClient,
  profileIdOrSlug: string,
  assetKey: string,
  binding: ProfileAssetBindingSpec,
): Promise<ProfileAssetBinding> {
  const profile = await getProfile(client, profileIdOrSlug);
  const normalized = normalizeProfileAssetBinding(binding);
  if (normalized.assetKey !== assetKey) throw new Error(`Asset binding key ${normalized.assetKey} does not match route key ${assetKey}.`);
  const result = await client.query(
    "UPDATE profile_assets SET binding = $1::jsonb WHERE profile_id = $2 AND asset_key = $3",
    [JSON.stringify(normalized), profile.id, assetKey],
  );
  if ((result.rowCount ?? 0) !== 1) throw new Error(`Asset ${assetKey} is not a member of profile ${profile.slug}.`);
  return getProfileAssetBinding(client, profile.id, assetKey);
}

export async function removeAssetFromProfile(
  client: TypedQueryClient,
  profileIdOrSlug: string,
  assetKey: string,
): Promise<void> {
  const profile = await getProfile(client, profileIdOrSlug);
  await client.execute("DELETE FROM profile_assets WHERE profile_id = $1 AND asset_key = $2", [profile.id, assetKey]);
}

// ── Profile resolution (machine-aware) ───────────────────────────────────────

function profileHasSelectors(selectors: ProfileSelector): boolean {
  return (selectors.os?.length ?? 0) > 0
    || (selectors.arch?.length ?? 0) > 0
    || (selectors.hostnames?.length ?? 0) > 0;
}

export async function resolveProfileForMachine(
  client: TypedQueryClient,
  machine: { hostname?: string; os?: string; arch?: string },
): Promise<Profile | null> {
  return (await resolveProfileForMachineRead(client, machine)).profile;
}

export async function resolveProfileForMachineRead(
  client: TypedQueryClient,
  machine: { hostname?: string; os?: string; arch?: string },
  options: BoundedReadOptions = {},
): Promise<ProfileResolutionRead> {
  const { limit } = normalizeBoundedReadOptions(options);
  const host = (machine.hostname ?? "").trim().toLowerCase();
  const os = (machine.os ?? "").trim().toLowerCase();
  const osFamily = normalizeOsFamily(machine.os);
  const arch = (machine.arch ?? "").trim().toLowerCase();
  const readStableProfiles = (queryClient: TypedQueryClient) => aggregateBoundedCollectionRead(
    "profile resolution",
    (cursor) => listProfilesPage(queryClient, { limit, cursor }),
    (profile) => profile.id,
    true,
    true,
  );
  const stableRead = hasTransaction(client)
    ? await client.transaction(async (transaction) => {
        await transaction.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        return readStableProfiles(transaction);
      })
    : await readStableProfiles(client);
  let selected: { profile: Profile; score: number } | null = null;

  for (const p of stableRead.items) {
    if (!profileHasSelectors(p.selectors)) continue;
    const s = p.selectors;
    const osOk = !s.os?.length || s.os.some((c) => {
      const value = c.trim().toLowerCase();
      return value === os || normalizeOsFamily(c) === osFamily;
    });
    const archOk = !s.arch?.length || s.arch.some((c) => c.trim().toLowerCase() === arch);
    const hostOk = !s.hostnames?.length || s.hostnames.some((c) => c.trim().toLowerCase() === host);
    if (!osOk || !archOk || !hostOk) continue;
    const score =
      (p.selectors.hostnames?.length ? 100 : 0) +
      (p.selectors.os?.length ? 10 : 0) +
      (p.selectors.arch?.length ? 10 : 0);
    if (
      !selected ||
      score > selected.score ||
      (score === selected.score && p.name.localeCompare(selected.profile.name) < 0)
    ) {
      selected = { profile: p, score };
    }
  }

  return {
    profile: selected?.profile ?? null,
    scanned: stableRead.items.length,
    total: stableRead.total,
    batch_limit: limit,
    source_bounded: true,
    complete: true,
    truncated: false,
  };
}

// ── Machines ─────────────────────────────────────────────────────────────────

interface MachineDbRow {
  id: string;
  hostname: string;
  os: string | null;
  arch: string | null;
  last_applied_at: unknown;
  created_at: unknown;
}

function rowToMachine(row: MachineDbRow): Machine {
  return {
    id: row.id,
    hostname: row.hostname,
    os: row.os,
    arch: row.arch,
    last_applied_at: row.last_applied_at == null ? null : toIso(row.last_applied_at),
    created_at: toIso(row.created_at),
  };
}

export async function listMachinesPage(
  client: TypedQueryClient,
  options: BoundedReadOptions = {},
): Promise<BoundedReadPage<Machine>> {
  const normalized = normalizeBoundedReadOptions(options);
  const count = await client.get<{ total: number | string }>("SELECT COUNT(*) AS total FROM machines");
  const rows = await client.many<MachineDbRow>(
    `SELECT * FROM machines
      ORDER BY id LIMIT $1 OFFSET $2`,
    [normalized.limit, normalized.cursor],
  );
  return boundedReadPage(rows.map(rowToMachine), Number(count?.total ?? 0), normalized);
}

export async function listMachines(client: TypedQueryClient): Promise<Machine[]> {
  return aggregateBoundedCollection(
    "machine list",
    (cursor) => listMachinesPage(client, { limit: 100, cursor }),
    (machine) => machine.id,
    true,
  );
}

export type MachineIdentity = Machine;

export async function listMachineIdentitiesPage(
  client: TypedQueryClient,
  options: BoundedReadOptions = {},
): Promise<BoundedReadPage<MachineIdentity>> {
  const normalized = normalizeBoundedReadOptions(options);
  const count = await client.get<{ total: number | string }>("SELECT COUNT(*) AS total FROM machines");
  const rows = await client.many<MachineDbRow>(
    `SELECT id, hostname, os, arch, last_applied_at, created_at
       FROM machines ORDER BY id LIMIT $1 OFFSET $2`,
    [normalized.limit, normalized.cursor],
  );
  return boundedReadPage(rows.map(rowToMachine), Number(count?.total ?? 0), normalized);
}

export async function registerMachine(
  client: TypedQueryClient,
  hostname: string,
  os: string | null,
  arch: string | null,
): Promise<Machine> {
  const existing = await client.get<MachineDbRow>("SELECT * FROM machines WHERE hostname = $1", [hostname]);
  if (existing) {
    if (existing.os !== os || existing.arch !== arch) {
      await client.execute("UPDATE machines SET os = $1, arch = $2 WHERE hostname = $3", [os, arch, hostname]);
    }
    const row = await client.get<MachineDbRow>("SELECT * FROM machines WHERE hostname = $1", [hostname]);
    return rowToMachine(row!);
  }
  const id = randomUUID();
  await client.execute(
    "INSERT INTO machines (id, hostname, os, arch, last_applied_at, created_at) VALUES ($1,$2,$3,$4,NULL,now())",
    [id, hostname, os, arch],
  );
  const row = await client.get<MachineDbRow>("SELECT * FROM machines WHERE id = $1", [id]);
  return rowToMachine(row!);
}

export async function updateMachineApplied(client: TypedQueryClient, hostname: string): Promise<void> {
  await client.execute("UPDATE machines SET last_applied_at = now() WHERE hostname = $1", [hostname]);
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export async function insertFeedback(
  client: TypedQueryClient,
  input: { message: string; email?: string | null; category?: string | null; version?: string | null },
): Promise<void> {
  await client.execute(
    "INSERT INTO feedback (id, message, email, category, version, created_at) VALUES ($1,$2,$3,$4,$5,now())",
    [randomUUID(), input.message, input.email ?? null, input.category ?? "general", input.version ?? null],
  );
}
