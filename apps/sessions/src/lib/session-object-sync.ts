import {
  listRetryableSessionObjects,
  markSessionObjectFailed,
  markSessionObjectUploaded,
} from "../db/session-objects.js";
import type { S3ObjectInfo } from "../db/cloud/s3-client.js";
import {
  NORMALIZED_SESSION_OBJECT_CONTENT_TYPE,
  serializeStoredSessionContent,
} from "./session-content-object.js";

export interface SessionObjectStore {
  upload(key: string, body: Buffer | Uint8Array, contentType?: string): Promise<void>;
  head(key: string): Promise<S3ObjectInfo>;
}

export interface SyncSessionObjectsOptions {
  objectStore: SessionObjectStore;
  sessionId?: string;
  limit?: number;
}

export interface SyncSessionObjectsResult {
  attempted: number;
  uploaded: number;
  failed: number;
  errors: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function syncRetryableSessionObjects(
  options: SyncSessionObjectsOptions,
): Promise<SyncSessionObjectsResult> {
  const result: SyncSessionObjectsResult = {
    attempted: 0,
    uploaded: 0,
    failed: 0,
    errors: [],
  };

  for (const object of listRetryableSessionObjects({
    sessionId: options.sessionId,
    limit: options.limit,
  })) {
    result.attempted++;
    try {
      const serialized = serializeStoredSessionContent(object.session_id);
      if (
        serialized.sourceDigest !== object.source_digest ||
        serialized.size !== object.size
      ) {
        throw new Error("normalized session payload changed after it was enqueued");
      }

      await options.objectStore.upload(
        object.object_key,
        serialized.body,
        NORMALIZED_SESSION_OBJECT_CONTENT_TYPE,
      );
      const acknowledgement = await options.objectStore.head(object.object_key);
      if (acknowledgement.contentLength !== object.size) {
        throw new Error(
          `object acknowledgement size mismatch: expected ${object.size}, received ${acknowledgement.contentLength ?? "unknown"}`,
        );
      }
      if (
        !markSessionObjectUploaded(
          object.session_id,
          object.object_kind,
          object.source_digest,
        )
      ) {
        throw new Error("session object changed before upload acknowledgement was recorded");
      }
      result.uploaded++;
    } catch (error) {
      const message = errorMessage(error);
      markSessionObjectFailed(
        object.session_id,
        object.object_kind,
        object.source_digest,
        message,
      );
      result.failed++;
      result.errors.push(`${object.session_id}/${object.object_kind}: ${message}`);
    }
  }

  return result;
}
