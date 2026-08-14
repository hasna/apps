// Deepgram Connector Types

// ============================================
// Configuration
// ============================================

export interface DeepgramConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Transcription Types
// ============================================

export interface TranscriptionOptions {
  model?: 'nova-2' | 'nova' | 'enhanced' | 'base' | 'whisper';
  language?: string;
  punctuate?: boolean;
  profanity_filter?: boolean;
  redact?: string[];
  diarize?: boolean;
  diarize_version?: string;
  smart_format?: boolean;
  filler_words?: boolean;
  multichannel?: boolean;
  alternatives?: number;
  numerals?: boolean;
  search?: string[];
  replace?: string[];
  keywords?: string[];
  utterances?: boolean;
  utt_split?: number;
  paragraphs?: boolean;
  summarize?: boolean | 'v2';
  topics?: boolean | 'v2';
  intents?: boolean;
  sentiment?: boolean;
  detect_language?: boolean;
  detect_entities?: boolean;
  detect_topics?: boolean;
  tag?: string[];
  callback?: string;
  callback_method?: 'put' | 'post';
}

export interface Word {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word?: string;
  speaker?: number;
  speaker_confidence?: number;
}

export interface Alternative {
  transcript: string;
  confidence: number;
  words: Word[];
  paragraphs?: {
    transcript: string;
    paragraphs: Array<{
      sentences: Array<{
        text: string;
        start: number;
        end: number;
      }>;
      start: number;
      end: number;
      num_words: number;
      speaker?: number;
    }>;
  };
}

export interface Channel {
  alternatives: Alternative[];
  detected_language?: string;
  language_confidence?: number;
}

export interface Utterance {
  start: number;
  end: number;
  confidence: number;
  channel: number;
  transcript: string;
  words: Word[];
  speaker?: number;
  id: string;
}

export interface TranscriptionResult {
  metadata: {
    transaction_key: string;
    request_id: string;
    sha256: string;
    created: string;
    duration: number;
    channels: number;
    models: string[];
    model_info: Record<string, { name: string; version: string; arch: string }>;
  };
  results: {
    channels: Channel[];
    utterances?: Utterance[];
    summary?: {
      short?: string;
      result?: string;
    };
    topics?: {
      segments: Array<{
        text: string;
        start_word: number;
        end_word: number;
        topics: Array<{
          topic: string;
          confidence: number;
        }>;
      }>;
    };
    intents?: {
      segments: Array<{
        text: string;
        start_word: number;
        end_word: number;
        intents: Array<{
          intent: string;
          confidence: number;
        }>;
      }>;
    };
    sentiments?: {
      segments: Array<{
        text: string;
        start_word: number;
        end_word: number;
        sentiment: 'positive' | 'negative' | 'neutral';
        sentiment_score: number;
      }>;
      average: {
        sentiment: 'positive' | 'negative' | 'neutral';
        sentiment_score: number;
      };
    };
  };
}

// ============================================
// Text-to-Speech Types
// ============================================

export interface SpeakOptions {
  model?: string;
  encoding?: 'linear16' | 'mulaw' | 'alaw' | 'mp3' | 'opus' | 'flac' | 'aac';
  container?: 'wav' | 'mp3' | 'ogg' | 'none';
  sample_rate?: number;
  bit_rate?: number;
}

export interface SpeakResponse {
  audio: Buffer;
  contentType: string;
  requestId: string;
  modelName: string;
  modelUuid: string;
  characters: number;
}

// ============================================
// Project Types
// ============================================

export interface Project {
  project_id: string;
  name: string;
  company?: string;
}

export interface ProjectsResponse {
  projects: Project[];
}

export interface ProjectBalance {
  balance_id: string;
  amount: number;
  units: string;
  purchase?: string;
}

export interface BalanceResponse {
  balances: ProjectBalance[];
}

export interface UsageSummary {
  start: string;
  end: string;
  resolution: {
    units: string;
    amount: number;
  };
  results: Array<{
    start: string;
    end: string;
    hours: number;
    total_hours: number;
    requests: number;
  }>;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class DeepgramApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'DeepgramApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
