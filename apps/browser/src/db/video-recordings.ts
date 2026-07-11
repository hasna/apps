import { randomUUID } from "node:crypto";
import { getDatabase } from "./schema.js";
import type { VideoRecording, VideoRecordingFormat, VideoRecordingStatus } from "../types/index.js";
import { BrowserError } from "../types/index.js";

interface RawVideoRecording {
  id: string;
  session_id: string | null;
  project_id: string | null;
  name: string;
  status: VideoRecordingStatus;
  path: string | null;
  download_id: string | null;
  url: string | null;
  title: string | null;
  format: VideoRecordingFormat;
  width: number;
  height: number;
  size_bytes: number | null;
  duration_ms: number | null;
  started_at: string;
  stopped_at: string | null;
  error: string | null;
}

function deserialize(row: RawVideoRecording): VideoRecording {
  return {
    id: row.id,
    session_id: row.session_id ?? undefined,
    project_id: row.project_id ?? undefined,
    name: row.name,
    status: row.status,
    path: row.path ?? undefined,
    download_id: row.download_id ?? undefined,
    url: row.url ?? undefined,
    title: row.title ?? undefined,
    format: row.format,
    width: row.width,
    height: row.height,
    size_bytes: row.size_bytes ?? undefined,
    duration_ms: row.duration_ms ?? undefined,
    started_at: row.started_at,
    stopped_at: row.stopped_at ?? undefined,
    error: row.error ?? undefined,
  };
}

export function createVideoRecording(
  data: Omit<VideoRecording, "id" | "started_at" | "format"> & { started_at?: string; format?: VideoRecordingFormat }
): VideoRecording {
  const db = getDatabase();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO video_recordings
      (id, session_id, project_id, name, status, path, download_id, url, title,
       format, width, height, size_bytes, duration_ms, started_at, stopped_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.session_id ?? null,
    data.project_id ?? null,
    data.name,
    data.status,
    data.path ?? null,
    data.download_id ?? null,
    data.url ?? null,
    data.title ?? null,
    data.format ?? "webm",
    data.width,
    data.height,
    data.size_bytes ?? null,
    data.duration_ms ?? null,
    data.started_at ?? new Date().toISOString(),
    data.stopped_at ?? null,
    data.error ?? null,
  );
  return getVideoRecording(id);
}

export function getVideoRecording(id: string): VideoRecording {
  const db = getDatabase();
  const row = db.query<RawVideoRecording, string>("SELECT * FROM video_recordings WHERE id = ?").get(id);
  if (!row) throw new BrowserError(`Video recording not found: ${id}`, "VIDEO_RECORDING_NOT_FOUND");
  return deserialize(row);
}

export interface VideoRecordingFilter {
  projectId?: string;
  sessionId?: string;
  status?: VideoRecordingStatus;
  limit?: number;
  offset?: number;
}

export function listVideoRecordings(filter?: VideoRecordingFilter): VideoRecording[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (filter?.projectId) { conditions.push("project_id = ?"); values.push(filter.projectId); }
  if (filter?.sessionId) { conditions.push("session_id = ?"); values.push(filter.sessionId); }
  if (filter?.status) { conditions.push("status = ?"); values.push(filter.status); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter?.limit ?? 100;
  const offset = filter?.offset ?? 0;
  const rows = db.query<RawVideoRecording, (string | number)[]>(
    `SELECT * FROM video_recordings ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`
  ).all(...values, limit, offset);

  return rows.map(deserialize);
}

export function updateVideoRecording(
  id: string,
  data: Partial<Omit<VideoRecording, "id">>
): VideoRecording {
  const db = getDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  const set = (field: string, value: string | number | null | undefined) => {
    if (value !== undefined) {
      fields.push(`${field} = ?`);
      values.push(value);
    }
  };

  set("session_id", data.session_id ?? undefined);
  set("project_id", data.project_id ?? undefined);
  set("name", data.name);
  set("status", data.status);
  set("path", data.path ?? undefined);
  set("download_id", data.download_id ?? undefined);
  set("url", data.url ?? undefined);
  set("title", data.title ?? undefined);
  set("format", data.format);
  set("width", data.width);
  set("height", data.height);
  set("size_bytes", data.size_bytes ?? undefined);
  set("duration_ms", data.duration_ms ?? undefined);
  set("started_at", data.started_at);
  set("stopped_at", data.stopped_at ?? undefined);
  set("error", data.error ?? undefined);

  if (fields.length === 0) return getVideoRecording(id);
  values.push(id);
  db.prepare(`UPDATE video_recordings SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getVideoRecording(id);
}

export function deleteVideoRecording(id: string): void {
  const db = getDatabase();
  db.prepare("DELETE FROM video_recordings WHERE id = ?").run(id);
}
