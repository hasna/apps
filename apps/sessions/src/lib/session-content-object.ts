import { createHash } from "node:crypto";
import {
  getMessages,
  getSession,
  getToolCalls,
} from "../db/sessions.js";
import { enqueueSessionObject } from "../db/session-objects.js";
import {
  prefixSessionObjectKey,
  resolveSessionObjectStoreConfig,
} from "../db/cloud/object-store-config.js";
import { buildObjectKey } from "../db/cloud/object-key.js";
import type {
  Message,
  Session,
  SessionContentImport,
  SessionObject,
  ToolCall,
} from "../types/index.js";

export const NORMALIZED_SESSION_OBJECT_KIND = "normalized_content" as const;
export const NORMALIZED_SESSION_OBJECT_CONTENT_TYPE = "application/json";

export function createSessionContentImport(
  session: Session,
  messages: Message[],
  toolCalls: ToolCall[],
): SessionContentImport {
  return {
    session: {
      id: session.id,
      source: session.source,
      source_id: session.source_id,
      source_path: session.source_path,
      title: session.title,
      project_path: session.project_path,
      project_name: session.project_name,
      model: session.model,
      model_provider: session.model_provider,
      git_branch: session.git_branch,
      git_sha: session.git_sha,
      git_origin_url: session.git_origin_url,
      cli_version: session.cli_version,
      is_subagent: session.is_subagent,
      parent_session_id: session.parent_session_id,
      total_input_tokens: session.total_input_tokens,
      total_output_tokens: session.total_output_tokens,
      total_cache_read_tokens: session.total_cache_read_tokens,
      total_cache_write_tokens: session.total_cache_write_tokens,
      total_thinking_tokens: session.total_thinking_tokens,
      message_count: session.message_count,
      tool_call_count: session.tool_call_count,
      started_at: session.started_at,
      ended_at: session.ended_at,
      duration_seconds: session.duration_seconds,
      source_modified_at: session.source_modified_at,
      machine: session.machine,
      metadata: session.metadata,
    },
    messages,
    toolCalls,
  };
}

export interface SerializedSessionContent {
  content: SessionContentImport;
  body: Buffer;
  sourceDigest: string;
  size: number;
}

export function serializeStoredSessionContent(sessionId: string): SerializedSessionContent {
  const content = createSessionContentImport(
    getSession(sessionId),
    getMessages(sessionId),
    getToolCalls(sessionId),
  );
  const body = Buffer.from(JSON.stringify(content), "utf8");
  return {
    content,
    body,
    sourceDigest: createHash("sha256").update(body).digest("hex"),
    size: body.byteLength,
  };
}

/** Enqueue the latest normalized payload only when object storage is configured. */
export function enqueueStoredSessionObjectIfConfigured(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): SessionObject | null {
  let config;
  try {
    config = resolveSessionObjectStoreConfig(env);
  } catch {
    // Object storage is an optional outbound sink. A malformed optional
    // configuration must not make local ingest fail before the API sync path.
    return null;
  }
  if (!config) return null;

  const session = getSession(sessionId);
  const serialized = serializeStoredSessionContent(sessionId);
  const objectKey = prefixSessionObjectKey(
    config.prefix,
    buildObjectKey({
      machineId: session.machine ?? "unresolved",
      source: session.source,
      sessionId: session.id,
      sha256: serialized.sourceDigest,
      ext: "json",
    }),
  );
  return enqueueSessionObject({
    session_id: session.id,
    object_kind: NORMALIZED_SESSION_OBJECT_KIND,
    object_key: objectKey,
    source_digest: serialized.sourceDigest,
    size: serialized.size,
  });
}
