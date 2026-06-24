// ─── Video recording tools ───────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { clampLimit, clampOffset, compactList, truncateText } from "./compact.js";
import {
  registerTool,
  z,
  json,
  err,
  resolveSessionId,
  startVideoRecording,
  stopVideoRecording,
  listVideos,
  getVideo,
  deleteVideo,
} from "./helpers.js";

export function register(server: McpServer) {

registerTool(server,
  "browser_video_start",
  "Start high-quality video recording for the active browser session. Returns file metadata; call browser_video_stop to finalize the video.",
  {
    session_id: z.string().optional(),
    name: z.string().optional(),
    project_id: z.string().optional(),
    quality: z.enum(["source", "low", "medium", "high", "ultra"]).optional().default("source"),
    format: z.enum(["webm", "mp4", "mov"]).optional().default("webm"),
    capture_mode: z.enum(["native", "cdp"]).optional(),
    codec: z.enum(["h264", "prores"]).optional(),
    encoding: z.enum(["balanced", "crisp", "lossless", "prores"]).optional(),
    crf: z.number().optional(),
    fps: z.number().optional(),
    video_bitrate: z.string().optional(),
    ffmpeg_preset: z.string().optional(),
    keep_raw_video: z.boolean().optional(),
    preset: z.enum(["source", "square", "vertical", "landscape", "x-square", "x-vertical", "x-landscape", "reels", "tiktok"]).optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    tui_theme: z.enum(["dark", "light", "system"]).optional(),
    tui_font_size: z.number().optional(),
    tui_zoom: z.number().optional(),
    tui_frame: z.object({
      enabled: z.boolean().optional(),
      fit: z.enum(["preset", "canvas"]).optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      padding: z.number().optional(),
      borderRadius: z.number().optional(),
      title: z.string().optional(),
      background: z.string().optional(),
      shadow: z.boolean().optional(),
    }).optional(),
  },
  async ({ session_id, name, project_id, quality, format, capture_mode, codec, encoding, crf, fps, video_bitrate, ffmpeg_preset, keep_raw_video, preset, width, height, tui_theme, tui_font_size, tui_zoom, tui_frame }) => {
    try {
      const sid = resolveSessionId(session_id);
      const recording = await startVideoRecording(sid, {
        name,
        projectId: project_id,
        quality,
        format,
        captureMode: capture_mode,
        codec,
        encoding,
        crf,
        fps,
        videoBitrate: video_bitrate,
        ffmpegPreset: ffmpeg_preset,
        keepRawVideo: keep_raw_video,
        preset,
        width,
        height,
        tuiTheme: tui_theme,
        tuiFontSize: tui_font_size,
        tuiZoom: tui_zoom,
        tuiFrame: tui_frame,
      });
      return json({ recording });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_video_stop",
  "Stop and finalize an active video recording. The resulting video is saved as a local download.",
  { recording_id: z.string() },
  async ({ recording_id }) => {
    try {
      const recording = await stopVideoRecording(recording_id);
      return json({ recording });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_videos_list",
  "List saved browser video recordings. Compact by default; set verbose=true for full records.",
  {
    session_id: z.string().optional(),
    project_id: z.string().optional(),
    status: z.enum(["recording", "completed", "failed"]).optional(),
    limit: z.number().optional().default(25),
    offset: z.number().optional().default(0),
    verbose: z.boolean().optional().default(false),
  },
  async ({ session_id, project_id, status, limit, offset, verbose }) => {
    try {
      const safeLimit = clampLimit(limit, 25);
      const safeOffset = clampOffset(offset);
      const recordings = listVideos({
          sessionId: session_id,
          projectId: project_id,
          status,
          limit: safeLimit + 1,
          offset: safeOffset,
        });
      const pageRecordings = recordings.slice(0, safeLimit);
      const hasMore = recordings.length > safeLimit;
      if (verbose) return json({
        recordings: pageRecordings,
        count: pageRecordings.length,
        limit: safeLimit,
        truncated: hasMore,
        next_offset: hasMore ? safeOffset + safeLimit : undefined,
      });
      const compact = compactList(pageRecordings, safeLimit, (recording) => ({
        id: recording.id,
        name: truncateText(recording.name, 100),
        status: recording.status,
        format: recording.format,
        dimensions: recording.width && recording.height ? `${recording.width}x${recording.height}` : undefined,
        size_bytes: recording.size_bytes,
        path: recording.path ? truncateText(recording.path, 140) : undefined,
        started_at: recording.started_at,
      }), {
        hint: "Set verbose=true for full video recording metadata.",
      });
      return json({ recordings: compact.items, count: compact.count, limit: safeLimit, truncated: hasMore, next_offset: hasMore ? safeOffset + safeLimit : undefined, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_video_delete",
  "Delete a browser video recording and its saved file",
  { recording_id: z.string() },
  async ({ recording_id }) => {
    try {
      const recording = getVideo(recording_id);
      deleteVideo(recording_id);
      return json({ deleted: recording_id, path: recording.path });
    } catch (e) { return err(e); }
  }
);

} // end register
