export {
  startVideoRecording,
  stopVideoRecording,
  stopAllVideoRecordingsForSession,
  listVideos,
  getVideo,
  deleteVideo,
  resolveVideoTranscodeSettings,
  buildVideoTranscodeArgs,
  buildFrameTranscodeArgs,
  validateVideoOutput,
} from "./lib/video-recording.js";
export {
  VIDEO_PRESET_NAMES,
  resolveVideoRecordingPreset,
} from "./lib/video-presets.js";
export {
  recordX11BrowserVideo,
  buildX11FfmpegArgs,
} from "./lib/x11-video.js";
export {
  createVideoRecording,
  getVideoRecording,
  listVideoRecordings,
  updateVideoRecording,
  deleteVideoRecording,
} from "./db/video-recordings.js";
export type {
  VideoRecording,
  VideoRecordingCaptureMode,
  VideoRecordingCodec,
  VideoRecordingEncoding,
  VideoRecordingFormat,
  VideoRecordingOptions,
  VideoRecordingPreset,
  VideoRecordingQuality,
  VideoRecordingStatus,
  VideoTuiFrameOptions,
} from "./types/index.js";
export type { VideoRecordingFilter } from "./db/video-recordings.js";
