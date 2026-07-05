import { getDb } from "./database.js";
import { nanoid } from "nanoid";
import { appendKnowledgeSourceOutboxEvent } from "./knowledge-outbox.js";
import type { KnowledgeSourceOutboxEventType } from "../types/index.js";
import type { Source, SourceType, SourceConfig, S3Config } from "../types/index.js";

interface SourceRow {
  id: string;
  name: string;
  type: string;
  path: string | null;
  bucket: string | null;
  prefix: string | null;
  region: string | null;
  config: string;
  machine_id: string;
  enabled: number;
  last_indexed_at: string | null;
  file_count: number;
  created_at: string;
  updated_at: string;
}

function toSource(row: SourceRow): Source {
  return {
    ...row,
    type: row.type as SourceType,
    path: row.path ?? undefined,
    bucket: row.bucket ?? undefined,
    prefix: row.prefix ?? undefined,
    region: row.region ?? undefined,
    config: sanitizeSourceConfigJson(row.config),
    enabled: row.enabled === 1,
    last_indexed_at: row.last_indexed_at ?? undefined,
  };
}

export function createSource(input: {
  name: string;
  type: SourceType;
  path?: string;
  bucket?: string;
  prefix?: string;
  region?: string;
  config?: SourceConfig;
  machine_id: string;
}): Source {
  const db = getDb();
  const id = `src_${nanoid(10)}`;
  const config = prepareSourceConfigForStorage(input.type, input.config);
  db.run(
    `INSERT INTO sources (id, name, type, path, bucket, prefix, region, config, machine_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.type,
      input.path ?? null,
      input.bucket ?? null,
      input.prefix ?? null,
      input.region ?? null,
      JSON.stringify(config),
      input.machine_id,
    ]
  );
  const source = getSource(id)!;
  appendKnowledgeSourceOutboxEvent({
    event_type: "source_created",
    source_id: source.id,
    status: source.enabled ? "active" : "disabled",
    path: source.path,
    idempotency_key: `source_created:${source.id}`,
    metadata: {
      source_type: source.type,
      bucket: source.bucket,
      prefix: source.prefix,
      region: source.region,
    },
  });
  return source;
}

export function getSource(id: string): Source | null {
  const row = getDb().query<SourceRow, [string]>("SELECT * FROM sources WHERE id = ?").get(id);
  return row ? toSource(row) : null;
}

export function listSources(machine_id?: string): Source[] {
  const db = getDb();
  if (machine_id) {
    return db.query<SourceRow, [string]>("SELECT * FROM sources WHERE machine_id = ? ORDER BY created_at DESC").all(machine_id).map(toSource);
  }
  return db.query<SourceRow, []>("SELECT * FROM sources ORDER BY created_at DESC").all().map(toSource);
}

export function updateSource(
  id: string,
  updates: Partial<Pick<Source, "name" | "enabled" | "config" | "path" | "bucket" | "prefix" | "region">>,
): Source | null {
  const db = getDb();
  const before = getSource(id);
  const config = updates.config !== undefined
    ? prepareSourceConfigForStorage(before?.type ?? "s3", updates.config)
    : undefined;
  const fields: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];
  if (updates.name !== undefined) { fields.push("name = ?"); values.push(updates.name); }
  if (updates.enabled !== undefined) { fields.push("enabled = ?"); values.push(updates.enabled ? 1 : 0); }
  if (updates.config !== undefined) { fields.push("config = ?"); values.push(JSON.stringify(config)); }
  if (updates.path !== undefined) { fields.push("path = ?"); values.push(updates.path); }
  if (updates.bucket !== undefined) { fields.push("bucket = ?"); values.push(updates.bucket); }
  if (updates.prefix !== undefined) { fields.push("prefix = ?"); values.push(updates.prefix); }
  if (updates.region !== undefined) { fields.push("region = ?"); values.push(updates.region); }
  if (fields.length === 1) return getSource(id);
  db.run(`UPDATE sources SET ${fields.join(", ")} WHERE id = ?`, [...values as import("bun:sqlite").SQLQueryBindings[], id]);
  const after = getSource(id);
  if (after) emitSourceOutboxEvent(classifySourceChange(before, after, updates), before, after, updates);
  return after;
}

export function sanitizeSourceConfig(config: SourceConfig | undefined): SourceConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const copy = { ...config } as Record<string, unknown>;
  delete copy.accessKeyId;
  delete copy.secretAccessKey;
  delete copy.sessionToken;
  return copy as SourceConfig;
}

export function sanitizeSourceConfigJson(raw: unknown): SourceConfig {
  if (typeof raw === "string") {
    try {
      return sanitizeSourceConfig(JSON.parse(raw) as SourceConfig);
    } catch {
      return {};
    }
  }
  return sanitizeSourceConfig(raw as SourceConfig | undefined);
}

export function sanitizeSourceConfigJsonString(raw: unknown): string {
  return JSON.stringify(sanitizeSourceConfigJson(raw));
}

function prepareSourceConfigForStorage(type: SourceType, config: SourceConfig | undefined): SourceConfig {
  if (type === "s3") assertNoStaticS3Credentials(config);
  return sanitizeSourceConfig(config);
}

function assertNoStaticS3Credentials(config: SourceConfig | undefined): void {
  const s3Config = config as S3Config | undefined;
  if (!s3Config) return;
  if (hasConfiguredSecretValue(s3Config.accessKeyId)
    || hasConfiguredSecretValue(s3Config.secretAccessKey)
    || hasConfiguredSecretValue(s3Config.sessionToken)) {
    throw new Error("S3 source config must not contain static credentials. Use an AWS profile or the default AWS provider chain.");
  }
}

function hasConfiguredSecretValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null;
}

export function deleteSource(id: string): boolean {
  const before = getSource(id);
  const result = getDb().run("DELETE FROM sources WHERE id = ?", [id]);
  if (result.changes > 0 && before) {
    appendKnowledgeSourceOutboxEvent({
      event_type: "source_disabled",
      source_id: before.id,
      status: "deleted",
      path: before.path,
      idempotency_key: `source_disabled:${before.id}:deleted`,
      metadata: {
        source_type: before.type,
        deleted: true,
      },
    });
  }
  return result.changes > 0;
}

export function markSourceIndexed(id: string, file_count: number): void {
  getDb().run(
    "UPDATE sources SET last_indexed_at = datetime('now'), file_count = ?, updated_at = datetime('now') WHERE id = ?",
    [file_count, id]
  );
}

function classifySourceChange(
  before: Source | null,
  after: Source,
  updates: Partial<Pick<Source, "name" | "enabled" | "config" | "path" | "bucket" | "prefix" | "region">>,
): KnowledgeSourceOutboxEventType {
  if (before?.enabled !== after.enabled && after.enabled === false) return "source_disabled";
  if (before?.enabled !== after.enabled && after.enabled === true) return "source_enabled";
  if (updates.enabled === false) return "source_disabled";
  if (updates.enabled === true) return "source_enabled";
  return "source_updated";
}

function emitSourceOutboxEvent(
  eventType: KnowledgeSourceOutboxEventType,
  before: Source | null,
  after: Source,
  updates: Partial<Pick<Source, "name" | "enabled" | "config" | "path" | "bucket" | "prefix" | "region">>,
): void {
  const changedFields = Object.keys(updates).filter((key) => key !== "config").sort();
  if (updates.config !== undefined) changedFields.push("config");
  appendKnowledgeSourceOutboxEvent({
    event_type: eventType,
    source_id: after.id,
    status: after.enabled ? "active" : "disabled",
    path: after.path,
    idempotency_key: [
      eventType,
      after.id,
      after.enabled ? "enabled" : "disabled",
      after.updated_at,
      changedFields.join(","),
    ].join(":"),
    metadata: {
      source_type: after.type,
      changed_fields: changedFields,
      previous_enabled: before?.enabled,
      enabled: after.enabled,
      config_changed: updates.config !== undefined,
    },
  });
}
