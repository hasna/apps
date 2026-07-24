import type { Database, SQLQueryBindings } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";
import {
  buildArtifactExportManifest,
  deleteStoredArtifactFile,
  isArtifactExpired,
  storeArtifactFile,
  type ArtifactExportEntry,
  type ArtifactExportManifest,
  type CleanupPolicy,
} from "../lib/artifact-store.js";

export const ARTIFACT_ENTITY_TYPES = ["task", "project", "plan", "run", "verification", "handoff"] as const;
export type ArtifactEntityType = (typeof ARTIFACT_ENTITY_TYPES)[number];

export const ARTIFACT_STORAGE_MODES = ["reference", "copy"] as const;
export type ArtifactStorageMode = (typeof ARTIFACT_STORAGE_MODES)[number];

export const ARTIFACT_REDACTION_STATUSES = ["none", "partial", "full"] as const;
export type ArtifactRedactionStatus = (typeof ARTIFACT_REDACTION_STATUSES)[number];

export interface Artifact {
  id: string;
  entity_type: ArtifactEntityType;
  entity_id: string;
  name: string;
  storage_mode: ArtifactStorageMode;
  source_path: string | null;
  local_path: string;
  content_hash: string;
  mime_type: string | null;
  size_bytes: number;
  redaction_status: ArtifactRedactionStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AddArtifactInput {
  entity_type: ArtifactEntityType;
  entity_id: string;
  source_path: string;
  name?: string;
  storage_mode?: ArtifactStorageMode;
  redaction_status?: ArtifactRedactionStatus;
  metadata?: Record<string, unknown>;
}

export interface ListArtifactsFilter {
  entity_type?: ArtifactEntityType;
  entity_id?: string;
  include_deleted?: boolean;
  limit?: number;
}

function rowToArtifact(row: Record<string, unknown>): Artifact {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : {},
  } as Artifact;
}

export function addArtifact(input: AddArtifactInput, db?: Database, dbPath?: string): Artifact {
  const d = getDatabase(db);
  const id = uuid();
  const timestamp = now();
  const storageMode = input.storage_mode ?? "copy";
  const stored = storeArtifactFile({
    artifactId: id,
    sourcePath: input.source_path,
    storageMode,
    name: input.name,
    dbPath,
  });

  d.run(
    `INSERT INTO artifacts (
      id, entity_type, entity_id, name, storage_mode, source_path, local_path,
      content_hash, mime_type, size_bytes, redaction_status, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.entity_type,
      input.entity_id,
      input.name || stored.sourcePath?.split("/").pop() || "artifact",
      storageMode,
      stored.sourcePath,
      stored.localPath,
      stored.contentHash,
      stored.mimeType,
      stored.sizeBytes,
      input.redaction_status ?? "none",
      JSON.stringify(input.metadata ?? {}),
      timestamp,
      timestamp,
    ],
  );

  return getArtifact(id, d)!;
}

export function getArtifact(id: string, db?: Database): Artifact | null {
  const d = getDatabase(db);
  const row = d.query("SELECT * FROM artifacts WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToArtifact(row) : null;
}

export function listArtifacts(filter: ListArtifactsFilter = {}, db?: Database): Artifact[] {
  const d = getDatabase(db);
  let query = "SELECT * FROM artifacts WHERE 1=1";
  const params: SQLQueryBindings[] = [];

  if (!filter.include_deleted) {
    query += " AND deleted_at IS NULL";
  }
  if (filter.entity_type) {
    query += " AND entity_type = ?";
    params.push(filter.entity_type);
  }
  if (filter.entity_id) {
    query += " AND entity_id = ?";
    params.push(filter.entity_id);
  }
  query += " ORDER BY created_at DESC";
  if (filter.limit) {
    query += " LIMIT ?";
    params.push(filter.limit);
  }

  return (d.query(query).all(...params) as Record<string, unknown>[]).map(rowToArtifact);
}

export function updateArtifactRedaction(
  id: string,
  redactionStatus: ArtifactRedactionStatus,
  db?: Database,
): Artifact | null {
  const d = getDatabase(db);
  const timestamp = now();
  d.run(
    "UPDATE artifacts SET redaction_status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    [redactionStatus, timestamp, id],
  );
  return getArtifact(id, d);
}

export function softDeleteArtifact(id: string, db?: Database): boolean {
  const d = getDatabase(db);
  const timestamp = now();
  const result = d.run(
    "UPDATE artifacts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    [timestamp, timestamp, id],
  );
  return result.changes > 0;
}

export function purgeArtifact(id: string, db?: Database, dbPath?: string): boolean {
  const d = getDatabase(db);
  const artifact = getArtifact(id, d);
  if (!artifact) return false;
  deleteStoredArtifactFile(artifact.local_path, artifact.storage_mode, dbPath);
  d.run("DELETE FROM artifacts WHERE id = ?", [id]);
  return true;
}

export function cleanupArtifacts(policy: CleanupPolicy = {}, db?: Database, dbPath?: string): number {
  const d = getDatabase(db);
  const expired = listArtifacts({ include_deleted: true }, d).filter((a) => isArtifactExpired(a.deleted_at, policy));
  let purged = 0;
  for (const artifact of expired) {
    if (purgeArtifact(artifact.id, d, dbPath)) purged++;
  }
  return purged;
}

export function exportArtifacts(filter: ListArtifactsFilter = {}, db?: Database, dbPath?: string): ArtifactExportManifest {
  const artifacts = listArtifacts(filter, db).map((a): ArtifactExportEntry => ({
    id: a.id,
    entity_type: a.entity_type,
    entity_id: a.entity_id,
    name: a.name,
    storage_mode: a.storage_mode,
    source_path: a.source_path,
    local_path: a.local_path,
    content_hash: a.content_hash,
    mime_type: a.mime_type,
    size_bytes: a.size_bytes,
    redaction_status: a.redaction_status,
    metadata: a.metadata,
    created_at: a.created_at,
  }));
  return buildArtifactExportManifest(artifacts, dbPath);
}

export interface ImportArtifactInput {
  entity_type: ArtifactEntityType;
  entity_id: string;
  source_path: string;
  name?: string;
  storage_mode?: ArtifactStorageMode;
  redaction_status?: ArtifactRedactionStatus;
  metadata?: Record<string, unknown>;
  content_hash?: string;
}

export function importArtifactFromManifestEntry(entry: ImportArtifactInput, db?: Database, dbPath?: string): Artifact {
  const artifact = addArtifact(entry, db, dbPath);
  if (entry.content_hash && artifact.content_hash !== entry.content_hash) {
    purgeArtifact(artifact.id, db, dbPath);
    throw new Error(`Content hash mismatch for ${entry.name}: expected ${entry.content_hash}, got ${artifact.content_hash}`);
  }
  return artifact;
}
