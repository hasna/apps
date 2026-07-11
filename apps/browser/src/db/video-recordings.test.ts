import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDatabase } from "./schema.js";
import {
  createVideoRecording,
  deleteVideoRecording,
  getVideoRecording,
  listVideoRecordings,
  updateVideoRecording,
} from "./video-recordings.js";
import { createSession } from "./sessions.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "browser-video-db-test-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "test.db");
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
});

describe("video recordings CRUD", () => {
  it("creates and fetches a recording", () => {
    const session = createSession({ engine: "playwright" });
    const recording = createVideoRecording({
      session_id: session.id,
      name: "demo",
      status: "recording",
      width: 1280,
      height: 720,
      url: "https://example.com",
    });

    expect(recording.id).toBeTruthy();
    expect(recording.format).toBe("webm");
    expect(recording.status).toBe("recording");
    expect(getVideoRecording(recording.id).name).toBe("demo");
  });

  it("updates completion metadata", () => {
    const recording = createVideoRecording({
      name: "demo",
      status: "recording",
      width: 1280,
      height: 720,
    });

    const updated = updateVideoRecording(recording.id, {
      status: "completed",
      path: "/tmp/demo.webm",
      download_id: "download-1",
      size_bytes: 1024,
      duration_ms: 1500,
      stopped_at: new Date().toISOString(),
    });

    expect(updated.status).toBe("completed");
    expect(updated.path).toBe("/tmp/demo.webm");
    expect(updated.size_bytes).toBe(1024);
    expect(updated.duration_ms).toBe(1500);
  });

  it("lists and filters recordings", () => {
    const s1 = createSession({ engine: "playwright" });
    const s2 = createSession({ engine: "playwright" });
    createVideoRecording({ name: "a", status: "recording", session_id: s1.id, width: 1280, height: 720 });
    createVideoRecording({ name: "b", status: "completed", session_id: s2.id, width: 1280, height: 720 });

    expect(listVideoRecordings().length).toBeGreaterThanOrEqual(2);
    expect(listVideoRecordings({ status: "completed" }).every((r) => r.status === "completed")).toBe(true);
    expect(listVideoRecordings({ sessionId: s1.id })).toHaveLength(1);
  });

  it("limits and offsets recording lists", () => {
    createVideoRecording({ name: "oldest", status: "completed", width: 1280, height: 720, started_at: "2026-01-01T00:00:00.000Z" });
    createVideoRecording({ name: "middle", status: "completed", width: 1280, height: 720, started_at: "2026-01-02T00:00:00.000Z" });
    createVideoRecording({ name: "newest", status: "completed", width: 1280, height: 720, started_at: "2026-01-03T00:00:00.000Z" });

    const page = listVideoRecordings({ limit: 1, offset: 1 });

    expect(page).toHaveLength(1);
    expect(page[0]?.name).toBe("middle");
  });

  it("deletes a recording", () => {
    const recording = createVideoRecording({ name: "delete-me", status: "recording", width: 1280, height: 720 });
    deleteVideoRecording(recording.id);
    expect(() => getVideoRecording(recording.id)).toThrow("Video recording not found");
  });
});
