import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import type { TaskRunArtifact } from "../db/task-runs.js";
import {
  exportStoredArtifactContent,
  importStoredArtifactContent,
  verifyStoredArtifact,
} from "../lib/artifact-store.js";
import type { TodosS3ArtifactStore } from "./s3-artifacts.js";

export interface TodosRunArtifactRemoteRef {
  provider: "s3";
  bucket: string;
  key: string;
  relative_path: string;
  url: string;
  sha256: string;
  size_bytes: number;
  uploaded_at?: string;
  downloaded_at?: string;
}

export interface TodosRunArtifactSyncFilter {
  runId?: string;
  taskId?: string;
  limit?: number;
  includeAlreadySynced?: boolean;
}

export interface TodosRunArtifactSyncResult {
  uploaded: number;
  downloaded: number;
  skipped: number;
  errors: string[];
  artifacts: Array<{
    id: string;
    run_id: string;
    task_id: string;
    key: string;
    sha256: string;
    size_bytes: number;
  }>;
}

export interface TodosRunArtifactSyncPlan {
  direction: "upload" | "download";
  dry_run: true;
  no_network: true;
  total: number;
  uploadable: number;
  downloadable: number;
  skipped: number;
  errors: string[];
  artifacts: Array<{
    id: string;
    run_id: string;
    task_id: string;
    status: "uploadable" | "downloadable" | "already_remote" | "local_ok" | "missing_local" | "metadata_only" | "missing_remote_ref";
    sha256: string | null;
    size_bytes: number | null;
    remote_key?: string;
  }>;
}

export interface UploadRunArtifactsToS3Options {
  store: TodosS3ArtifactStore;
  db?: Database;
  filter?: TodosRunArtifactSyncFilter;
  now?: () => Date;
}

export interface DownloadRunArtifactsFromS3Options {
  store: TodosS3ArtifactStore;
  db?: Database;
  filter?: Omit<TodosRunArtifactSyncFilter, "includeAlreadySynced">;
  force?: boolean;
  now?: () => Date;
}

export interface PlanRunArtifactsS3SyncOptions {
  db?: Database;
  filter?: TodosRunArtifactSyncFilter;
  direction: "upload" | "download";
  force?: boolean;
}

interface TaskRunArtifactRow extends Omit<TaskRunArtifact, "metadata"> {
  metadata: string | null;
}

export async function uploadRunArtifactsToS3(
  options: UploadRunArtifactsToS3Options,
): Promise<TodosRunArtifactSyncResult> {
  const db = options.db ?? getDatabase();
  const now = options.now ?? (() => new Date());
  const result = emptyResult();

  for (const artifact of listRunArtifacts(db, options.filter)) {
    try {
      const metadata = artifact.metadata;
      if (!options.filter?.includeAlreadySynced && remoteRef(metadata)) {
        result.skipped += 1;
        continue;
      }
      const content = exportStoredArtifactContent({
        id: artifact.id,
        path: artifact.path,
        size_bytes: artifact.size_bytes,
        sha256: artifact.sha256,
        metadata,
      });
      if (!content) {
        result.skipped += 1;
        continue;
      }

      const ref = await options.store.putObject({
        key: content.relative_path,
        body: Buffer.from(content.base64, "base64"),
        contentType: mediaType(metadata) ?? "application/octet-stream",
        metadata: {
          artifact_id: artifact.id,
          run_id: artifact.run_id,
          task_id: artifact.task_id,
          sha256: content.sha256,
        },
      });
      const remote: TodosRunArtifactRemoteRef = {
        provider: "s3",
        bucket: ref.bucket,
        key: ref.key,
        relative_path: content.relative_path,
        url: ref.url,
        sha256: content.sha256,
        size_bytes: content.size_bytes,
        uploaded_at: now().toISOString(),
      };
      updateArtifactMetadata(db, artifact.id, {
        ...metadata,
        remote_artifact_store: remote,
      });
      result.uploaded += 1;
      result.artifacts.push({
        id: artifact.id,
        run_id: artifact.run_id,
        task_id: artifact.task_id,
        key: ref.key,
        sha256: content.sha256,
        size_bytes: content.size_bytes,
      });
    } catch (error) {
      result.errors.push(`${artifact.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}

export function planRunArtifactsS3Sync(
  options: PlanRunArtifactsS3SyncOptions,
): TodosRunArtifactSyncPlan {
  const db = options.db ?? getDatabase();
  const plan: TodosRunArtifactSyncPlan = {
    direction: options.direction,
    dry_run: true,
    no_network: true,
    total: 0,
    uploadable: 0,
    downloadable: 0,
    skipped: 0,
    errors: [],
    artifacts: [],
  };

  for (const artifact of listRunArtifacts(db, options.filter)) {
    plan.total += 1;
    try {
      const metadata = artifact.metadata;
      const remote = remoteRef(metadata);
      const integrity = verifyStoredArtifact({
        id: artifact.id,
        path: artifact.path,
        size_bytes: artifact.size_bytes,
        sha256: artifact.sha256,
        metadata,
      });
      if (options.direction === "upload") {
        if (remote && !options.filter?.includeAlreadySynced) {
          plan.skipped += 1;
          plan.artifacts.push(planArtifact(artifact, "already_remote", remote));
        } else if (integrity.status === "ok") {
          plan.uploadable += 1;
          plan.artifacts.push(planArtifact(artifact, "uploadable", remote));
        } else {
          plan.skipped += 1;
          plan.artifacts.push(planArtifact(artifact, integrity.status === "metadata_only" ? "metadata_only" : "missing_local", remote));
        }
      } else if (!remote) {
        plan.skipped += 1;
        plan.artifacts.push(planArtifact(artifact, "missing_remote_ref", remote));
      } else if (!options.force && integrity.status === "ok") {
        plan.skipped += 1;
        plan.artifacts.push(planArtifact(artifact, "local_ok", remote));
      } else {
        plan.downloadable += 1;
        plan.artifacts.push(planArtifact(artifact, "downloadable", remote));
      }
    } catch (error) {
      plan.errors.push(`${artifact.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return plan;
}

export async function downloadRunArtifactsFromS3(
  options: DownloadRunArtifactsFromS3Options,
): Promise<TodosRunArtifactSyncResult> {
  const db = options.db ?? getDatabase();
  const now = options.now ?? (() => new Date());
  const result = emptyResult();

  for (const artifact of listRunArtifacts(db, options.filter)) {
    try {
      const metadata = artifact.metadata;
      const remote = remoteRef(metadata);
      if (!remote) {
        result.skipped += 1;
        continue;
      }
      const integrity = verifyStoredArtifact({
        id: artifact.id,
        path: artifact.path,
        size_bytes: artifact.size_bytes,
        sha256: artifact.sha256,
        metadata,
      });
      if (!options.force && integrity.status === "ok") {
        result.skipped += 1;
        continue;
      }

      const response = await options.store.getObject(remote.relative_path);
      const bytes = Buffer.from(await response.arrayBuffer());
      const report = importStoredArtifactContent({
        artifact_id: artifact.id,
        relative_path: remote.relative_path,
        sha256: remote.sha256,
        size_bytes: remote.size_bytes,
        base64: bytes.toString("base64"),
      });
      if (report.status !== "ok") throw new Error(report.message);
      updateArtifactMetadata(db, artifact.id, {
        ...metadata,
        remote_artifact_store: {
          ...remote,
          downloaded_at: now().toISOString(),
        },
      });
      result.downloaded += 1;
      result.artifacts.push({
        id: artifact.id,
        run_id: artifact.run_id,
        task_id: artifact.task_id,
        key: remote.key,
        sha256: remote.sha256,
        size_bytes: remote.size_bytes,
      });
    } catch (error) {
      result.errors.push(`${artifact.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}

function emptyResult(): TodosRunArtifactSyncResult {
  return { uploaded: 0, downloaded: 0, skipped: 0, errors: [], artifacts: [] };
}

function planArtifact(
  artifact: TaskRunArtifact,
  status: TodosRunArtifactSyncPlan["artifacts"][number]["status"],
  remote: TodosRunArtifactRemoteRef | null,
): TodosRunArtifactSyncPlan["artifacts"][number] {
  return {
    id: artifact.id,
    run_id: artifact.run_id,
    task_id: artifact.task_id,
    status,
    sha256: artifact.sha256,
    size_bytes: artifact.size_bytes,
    ...(remote ? { remote_key: remote.key } : {}),
  };
}

function listRunArtifacts(db: Database, filter: TodosRunArtifactSyncFilter = {}): TaskRunArtifact[] {
  const conditions: string[] = [];
  const values: string[] = [];
  if (filter.runId) {
    conditions.push("run_id = ?");
    values.push(filter.runId);
  }
  if (filter.taskId) {
    conditions.push("task_id = ?");
    values.push(filter.taskId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter.limit && filter.limit > 0 ? " LIMIT ?" : "";
  const rows = db
    .query(`SELECT * FROM task_run_artifacts ${where} ORDER BY created_at, id${limit}`)
    .all(...(limit ? [...values, String(filter.limit)] : values)) as TaskRunArtifactRow[];
  return rows.map((row) => ({ ...row, metadata: parseMetadata(row.metadata) }));
}

function updateArtifactMetadata(db: Database, id: string, metadata: Record<string, unknown>): void {
  db.run("UPDATE task_run_artifacts SET metadata = ? WHERE id = ?", [JSON.stringify(metadata), id]);
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function remoteRef(metadata: Record<string, unknown>): TodosRunArtifactRemoteRef | null {
  const value = metadata["remote_artifact_store"];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<TodosRunArtifactRemoteRef>;
  if (record.provider !== "s3") return null;
  if (
    typeof record.bucket !== "string" ||
    typeof record.key !== "string" ||
    typeof record.relative_path !== "string" ||
    typeof record.url !== "string" ||
    typeof record.sha256 !== "string" ||
    typeof record.size_bytes !== "number"
  ) {
    return null;
  }
  return record as TodosRunArtifactRemoteRef;
}

function mediaType(metadata: Record<string, unknown>): string | null {
  const store = metadata["artifact_store"];
  if (!store || typeof store !== "object" || Array.isArray(store)) return null;
  const value = (store as Record<string, unknown>)["media_type"];
  return typeof value === "string" ? value : null;
}
