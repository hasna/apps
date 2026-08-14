// AssemblyAI Connector Types

// ============================================
// Configuration
// ============================================

export interface AssemblyAIConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Transcript Types
// ============================================

export type TranscriptStatus = 'queued' | 'processing' | 'completed' | 'error';

export interface TranscriptRequest {
  audio_url: string;
  language_code?: string;
  punctuate?: boolean;
  format_text?: boolean;
  dual_channel?: boolean;
  webhook_url?: string;
  webhook_auth_header_name?: string;
  webhook_auth_header_value?: string;
  auto_highlights?: boolean;
  audio_start_from?: number;
  audio_end_at?: number;
  word_boost?: string[];
  boost_param?: 'low' | 'default' | 'high';
  filter_profanity?: boolean;
  redact_pii?: boolean;
  redact_pii_audio?: boolean;
  redact_pii_policies?: string[];
  redact_pii_sub?: 'entity_name' | 'hash';
  speaker_labels?: boolean;
  speakers_expected?: number;
  content_safety?: boolean;
  iab_categories?: boolean;
  custom_spelling?: Array<{ from: string[]; to: string }>;
  disfluencies?: boolean;
  sentiment_analysis?: boolean;
  auto_chapters?: boolean;
  entity_detection?: boolean;
  speech_threshold?: number;
  summarization?: boolean;
  summary_model?: 'informative' | 'conversational' | 'catchy';
  summary_type?: 'bullets' | 'bullets_verbose' | 'gist' | 'headline' | 'paragraph';
  language_detection?: boolean;
}

export interface Word {
  text: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: string;
}

export interface Utterance {
  confidence: number;
  end: number;
  speaker: string;
  start: number;
  text: string;
  words: Word[];
}

export interface Chapter {
  gist: string;
  headline: string;
  start: number;
  end: number;
  summary: string;
}

export interface Entity {
  entity_type: string;
  text: string;
  start: number;
  end: number;
}

export interface SentimentResult {
  text: string;
  start: number;
  end: number;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  confidence: number;
  speaker?: string;
}

export interface Transcript {
  id: string;
  status: TranscriptStatus;
  audio_url: string;
  text?: string;
  words?: Word[];
  utterances?: Utterance[];
  confidence?: number;
  audio_duration?: number;
  punctuate?: boolean;
  format_text?: boolean;
  dual_channel?: boolean;
  webhook_url?: string;
  webhook_status_code?: number;
  webhook_auth?: boolean;
  auto_highlights?: boolean;
  auto_highlights_result?: {
    status: string;
    results: Array<{
      count: number;
      rank: number;
      text: string;
      timestamps: Array<{ start: number; end: number }>;
    }>;
  };
  audio_start_from?: number;
  audio_end_at?: number;
  word_boost?: string[];
  boost_param?: string;
  filter_profanity?: boolean;
  redact_pii?: boolean;
  redact_pii_audio?: boolean;
  redact_pii_audio_quality?: string;
  redact_pii_policies?: string[];
  redact_pii_sub?: string;
  speaker_labels?: boolean;
  speakers_expected?: number;
  content_safety?: boolean;
  content_safety_labels?: {
    status: string;
    results: Array<{
      text: string;
      labels: Array<{
        label: string;
        confidence: number;
        severity: number;
      }>;
      timestamp: { start: number; end: number };
    }>;
    summary: Record<string, number>;
    severity_score_summary: Record<string, { low: number; medium: number; high: number }>;
  };
  iab_categories?: boolean;
  iab_categories_result?: {
    status: string;
    results: Array<{
      text: string;
      labels: Array<{ relevance: number; label: string }>;
      timestamp: { start: number; end: number };
    }>;
    summary: Record<string, number>;
  };
  language_code?: string;
  custom_spelling?: Array<{ from: string[]; to: string }>;
  disfluencies?: boolean;
  sentiment_analysis?: boolean;
  sentiment_analysis_results?: SentimentResult[];
  auto_chapters?: boolean;
  chapters?: Chapter[];
  entity_detection?: boolean;
  entities?: Entity[];
  speech_threshold?: number;
  summarization?: boolean;
  summary?: string;
  summary_type?: string;
  summary_model?: string;
  language_detection?: boolean;
  language_confidence_threshold?: number;
  language_confidence?: number;
  error?: string;
}

export interface TranscriptListResponse {
  page_details: {
    limit: number;
    result_count: number;
    current_url: string;
    prev_url?: string;
    next_url?: string;
  };
  transcripts: Array<{
    id: string;
    resource_url: string;
    status: TranscriptStatus;
    created: string;
    completed?: string;
    audio_url: string;
    error?: string;
  }>;
}

// ============================================
// Upload Types
// ============================================

export interface UploadResponse {
  upload_url: string;
}

// ============================================
// LeMUR Types
// ============================================

export interface LemurTaskRequest {
  transcript_ids: string[];
  prompt: string;
  context?: string;
  final_model?: 'default' | 'basic' | 'assemblyai/mistral-7b';
  max_output_size?: number;
  temperature?: number;
}

export interface LemurResponse {
  request_id: string;
  response: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface LemurSummaryRequest {
  transcript_ids: string[];
  context?: string;
  final_model?: string;
  max_output_size?: number;
  answer_format?: string;
}

export interface LemurQuestionAnswerRequest {
  transcript_ids: string[];
  questions: Array<{
    question: string;
    context?: string;
    answer_format?: string;
    answer_options?: string[];
  }>;
  context?: string;
  final_model?: string;
}

export interface LemurQuestionAnswerResponse {
  request_id: string;
  response: Array<{
    question: string;
    answer: string;
  }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class AssemblyAIApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'AssemblyAIApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
