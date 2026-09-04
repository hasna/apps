/**
 * Upload a run artifact to the configured S3 bucket at creation time.
 *
 * The artifact-remote kit pattern (hasna/apps#1639): every run artifact that
 * gets stored locally is mirrored to the configured object store as soon as
 * the row is created, so the bytes never live only on the station that
 * produced them. The object is content-addressed under
 * `artifacts/<task_id>/<sha256>` (inside the configured bucket prefix), and
 * the remote reference is recorded on the artifact row's metadata, which makes
 * `todos storage artifacts download` able to restore the bytes on any machine.
 *
 * Fail-soft by contract: when no bucket is configured the artifacts stay
 * local-only (the pre-existing behaviour); when credentials are missing or the
 * upload fails, the artifact row is still created and the failure is reported
 * in the return value instead of being thrown. Callers that live in
 * short-lived processes (the CLI `runs artifact` command, MCP tools) await
 * this before they return.
 */
import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import type { TaskRunArtifact } from "../db/task-runs.js";
import { exportStoredArtifactContent } from "../lib/artifact-store.js";
import { loadTodosStorageConfig, TODOS_STORAGE_ENV, TODOS_STORAGE_FALLBACK_ENV, type TodosStorageEnv } from "./config.js";
import {
  parseMetadata,
  remoteRef,
  remoteArtifactKey,
  updateArtifactMetadata,
  type TodosRunArtifactRemoteRef,
} from "./s3-artifact-sync.js";
import { createTodosS3ArtifactStore, type TodosS3ArtifactStore, type TodosAwsCredentials } from "./s3-artifacts.js";

export interface UploadRunArtifactAtCreationInput {
  /** The `task_run_artifacts` row id created by `addTaskRunArtifact`. */
  artifactId: string;
  db?: Database;
  /** Env to read the bucket/prefix/credentials from. Defaults to `process.env`. */
  env?: TodosStorageEnv;
  /** Injectable store (tests). When omitted, one is built from the env config. */
  store?: TodosS3ArtifactStore;
  now?: () => Date;
}

export type RunArtifactCreationUploadReason =
  | "uploaded"
  | "already_remote"
  | "s3_not_configured"
  | "s3_credentials_missing"
  | "artifact_not_found"
  | "no_local_content"
  | "upload_error";

export interface RunArtifactCreationUploadReport {
  /** True when the artifact content lives in S3 (uploaded now or before). */
  uploaded: boolean;
  reason: RunArtifactCreationUploadReason;
  ref?: TodosRunArtifactRemoteRef;
  error?: string;
}

/**
 * Upload the stored content of a freshly created run artifact to the
 * configured S3 bucket, then record the remote reference on the artifact row.
 * Never throws; every failure mode is reported in the result instead.
 */
export async function uploadRunArtifactAtCreation(
  input: UploadRunArtifactAtCreationInput,
): Promise<RunArtifactCreationUploadReport> {
  const db = input.db ?? getDatabase();
  const now = input.now ?? (() => new Date());
  try {
    const artifact = getRunArtifactById(db, input.artifactId);
    if (!artifact) return { uploaded: false, reason: "artifact_not_found" };

    const metadata = artifact.metadata;
    const existing = remoteRef(metadata);
    if (existing) return { uploaded: true, reason: "already_remote", ref: existing };

    if (!input.store) {
      const config = loadTodosStorageConfig(input.env ?? process.env);
      if (!config.objectStorage) return { uploaded: false, reason: "s3_not_configured" };
      const credentials = creationCredentialsFromEnv(input.env ?? process.env);
      if (!credentials) return { uploaded: false, reason: "s3_credentials_missing" };
      input.store = createTodosS3ArtifactStore({ config: config.objectStorage, credentials });
    }
    const store = input.store;

    const content = exportStoredArtifactContent({
      id: artifact.id,
      path: artifact.path,
      size_bytes: artifact.size_bytes,
      sha256: artifact.sha256,
      metadata,
    });
    if (!content) return { uploaded: false, reason: "no_local_content" };

    const relativePath = remoteArtifactKey(artifact.task_id, content.sha256);
    const ref = await store.putObject({
      key: relativePath,
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
      relative_path: relativePath,
      local_path: content.relative_path,
      url: ref.url,
      sha256: content.sha256,
      size_bytes: content.size_bytes,
      uploaded_at: now().toISOString(),
    };
    updateArtifactMetadata(db, artifact.id, {
      ...metadata,
      remote_artifact_store: remote,
    });
    return { uploaded: true, reason: "uploaded", ref: remote };
  } catch (error) {
    return {
      uploaded: false,
      reason: "upload_error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Read creation-time S3 credentials from the canonical or fallback env names. */

/** Read creation-time S3 credentials from the canonical or fallback env names. */
export function creationCredentialsFromEnv(env: TodosStorageEnv): TodosAwsCredentials | null {
  const accessKeyId = readCredentialEnv(env, "s3AccessKeyId");
  const secretAccessKey = readCredentialEnv(env, "s3SecretAccessKey");
  if (!accessKeyId || !secretAccessKey) return null;
  const sessionToken = readCredentialEnv(env, "s3SessionToken");
  return sessionToken ? { accessKeyId, secretAccessKey, sessionToken } : { accessKeyId, secretAccessKey };
}

function readCredentialEnv(env: TodosStorageEnv, key: "s3AccessKeyId" | "s3SecretAccessKey" | "s3SessionToken"): string | undefined {
  const value = env[TODOS_STORAGE_ENV[key]] ?? env[TODOS_STORAGE_FALLBACK_ENV[key]];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getRunArtifactById(db: Database, id: string): TaskRunArtifact | null {
  const row = db
    .query("SELECT * FROM task_run_artifacts WHERE id = ?")
    .get(id) as (Omit<TaskRunArtifact, "metadata"> & { metadata: string | null }) | null;
  return row ? { ...row, metadata: parseMetadata(row.metadata) } : null;
}

function mediaType(metadata: Record<string, unknown>): string | null {
  const store = metadata["artifact_store"];
  if (!store || typeof store !== "object" || Array.isArray(store)) return null;
  const value = (store as Record<string, unknown>)["media_type"];
  return typeof value === "string" ? value : null;
}