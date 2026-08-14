export interface MinimaxConfig {
  apiKey: string;
  groupId?: string;
  baseUrl?: string;
}

// Models
export type VideoModel = 'T2V-01' | 'T2V-01-Director' | 'I2V-01' | 'I2V-01-Director' | 'S2V-01';
export type MusicModel = 'music-01';
export type TTSModel = 'speech-02' | 'speech-02-hd' | 'speech-02-turbo';
export type ImageModel = 'image-01';

// Video Generation
export interface VideoGenerateRequest {
  model: VideoModel;
  prompt?: string;
  first_frame_image?: string;
  subject_reference?: string[];
  prompt_optimizer?: boolean;
}

export interface VideoGenerateResponse {
  task_id: string;
  base_resp?: { status_code: number; status_msg: string };
}

export interface VideoStatusResponse {
  task_id: string;
  status: 'Queueing' | 'Processing' | 'Success' | 'Fail';
  file_id?: string;
  base_resp?: { status_code: number; status_msg: string };
}

export interface VideoFileResponse {
  file: {
    file_id: string;
    bytes: number;
    created_at: number;
    filename: string;
    purpose: string;
    download_url: string;
  };
  base_resp?: { status_code: number; status_msg: string };
}

// Music Generation
export interface MusicGenerateRequest {
  model: MusicModel;
  lyrics?: string;
  refer_voice?: string;
  refer_instrumental?: string;
  prompt?: string;
  genre?: string;
  mood?: string;
  tempo?: number;
  duration?: number;
}

export interface MusicGenerateResponse {
  task_id: string;
  base_resp?: { status_code: number; status_msg: string };
}

export interface MusicStatusResponse {
  task_id: string;
  status: 'Queueing' | 'Processing' | 'Success' | 'Fail';
  audio_file?: string;
  extra_info?: {
    audio_url?: string;
    lyrics?: string;
    instrumental_url?: string;
  };
  base_resp?: { status_code: number; status_msg: string };
}

// TTS (Text to Audio)
export interface TTSRequest {
  model: TTSModel;
  text: string;
  voice_setting?: {
    voice_id?: string;
    speed?: number;
    vol?: number;
    pitch?: number;
    emotion?: string;
  };
  audio_setting?: {
    sample_rate?: number;
    bitrate?: number;
    format?: 'mp3' | 'wav' | 'pcm' | 'flac';
    channel?: number;
  };
  language_boost?: string;
}

export interface TTSResponse {
  data?: {
    audio?: string;
  };
  extra_info?: {
    audio_length?: number;
    audio_sample_rate?: number;
    audio_size?: number;
    bitrate?: number;
    word_count?: number;
    invisible_character_ratio?: number;
  };
  base_resp?: { status_code: number; status_msg: string };
}

// Image Generation
export interface ImageGenerateRequest {
  model: ImageModel;
  prompt: string;
  aspect_ratio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  n?: number;
  prompt_optimizer?: boolean;
}

export interface ImageGenerateResponse {
  task_id: string;
  base_resp?: { status_code: number; status_msg: string };
}

export interface ImageStatusResponse {
  task_id: string;
  status: 'Queueing' | 'Processing' | 'Success' | 'Fail';
  file_id?: string;
  base_resp?: { status_code: number; status_msg: string };
}

// Sound Effects
export interface SoundEffectRequest {
  model: string;
  prompt: string;
  duration?: number;
}

export interface SoundEffectResponse {
  task_id: string;
  base_resp?: { status_code: number; status_msg: string };
}

export interface SoundEffectStatusResponse {
  task_id: string;
  status: 'Queueing' | 'Processing' | 'Success' | 'Fail';
  audio_file?: string;
  extra_info?: {
    audio_url?: string;
  };
  base_resp?: { status_code: number; status_msg: string };
}

// Voice Clone
export interface VoiceCloneRequest {
  file: Buffer;
  voice_id?: string;
}

export interface VoiceListResponse {
  voices: Array<{
    voice_id: string;
    name: string;
    language?: string;
    description?: string;
  }>;
}

// Shared
export type OutputFormat = 'json' | 'pretty';

export class MinimaxApiError extends Error {
  public readonly statusCode: number;
  public readonly error?: { status_code: number; status_msg: string };

  constructor(message: string, statusCode: number, error?: { status_code: number; status_msg: string }) {
    super(message);
    this.name = 'MinimaxApiError';
    this.statusCode = statusCode;
    this.error = error;
  }
}
