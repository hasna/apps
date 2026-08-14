// Supadata Connector Types

export interface SupadataConfig {
  apiKey: string;
  baseUrl?: string;
}

export type JobStatus = 'queued' | 'active' | 'scraping' | 'completed' | 'failed' | 'cancelled';

export type QueryParams = Record<string, string | number | boolean | undefined>;

// ── Account ──────────────────────────────────────────────

export interface AccountInfo {
  organizationId?: string;
  plan?: string;
  credits?: {
    used?: number;
    limit?: number;
    remaining?: number;
  };
  [key: string]: unknown;
}

// ── Web ────────────────────────────────────────────────

export interface ScrapeOptions {
  url: string;
  noLinks?: boolean;
  lang?: string;
}

export interface ScrapeResult {
  url: string;
  content: string;
  name?: string;
  description?: string;
  ogUrl?: string;
  countCharacters?: number;
  urls?: string[];
}

export interface MapOptions {
  url: string;
}

export interface MapResult {
  urls: string[];
}

export interface CrawlStartOptions {
  url: string;
  limit?: number;
}

export interface JobIdResponse {
  jobId: string;
}

export interface CrawlPage {
  url: string;
  content: string;
  name?: string;
  description?: string;
}

export interface CrawlJobResult {
  status: JobStatus;
  pages?: CrawlPage[];
  next?: string;
  error?: string;
}

// ── Transcript ─────────────────────────────────────────

export type TranscriptMode = 'native' | 'auto' | 'generate';

export interface TranscriptOptions {
  url: string;
  lang?: string;
  text?: boolean;
  chunkSize?: number;
  mode?: TranscriptMode;
}

export interface TranscriptChunk {
  text: string;
  offset: number;
  duration: number;
  lang?: string;
}

export interface TranscriptResult {
  content: string | TranscriptChunk[];
  lang?: string;
  availableLangs?: string[];
}

export interface TranscriptJobResult {
  status: JobStatus;
  content?: string | TranscriptChunk[];
  lang?: string;
  availableLangs?: string[];
  error?: string;
}

// ── Metadata ───────────────────────────────────────────

export interface MetadataOptions {
  url: string;
}

export interface MediaMetadata {
  platform: string;
  type: string;
  id: string;
  url: string;
  title?: string | null;
  description?: string | null;
  author?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  media?: Record<string, unknown>;
  tags?: string[];
  createdAt?: string;
  additionalData?: Record<string, unknown>;
}

// ── Extract ────────────────────────────────────────────

export interface ExtractOptions {
  url: string;
  prompt?: string;
  schema?: Record<string, unknown>;
}

export interface ExtractJobResult {
  status: JobStatus;
  data?: Record<string, unknown>;
  schema?: Record<string, unknown>;
  error?: string;
}

// ── YouTube ────────────────────────────────────────────

export interface YoutubeChannelOptions {
  id: string;
}

export interface YoutubeChannel {
  id: string;
  name?: string;
  description?: string;
  subscriberCount?: number;
  videoCount?: number;
  viewCount?: number;
  thumbnail?: string;
  banner?: string;
}

export type YoutubeVideoType = 'all' | 'video' | 'short' | 'live';

export interface YoutubeChannelVideosOptions {
  id: string;
  limit?: number;
  type?: YoutubeVideoType;
}

export interface YoutubeChannelVideos {
  videoIds: string[];
  shortIds?: string[];
  liveIds?: string[];
}

export interface YoutubePlaylistOptions {
  id: string;
}

export interface YoutubePlaylist {
  id: string;
  title?: string;
  description?: string;
  videoCount?: number;
  channelId?: string;
  thumbnail?: string;
}

export interface YoutubePlaylistVideosOptions {
  id: string;
  limit?: number;
}

export interface YoutubePlaylistVideos {
  videoIds: string[];
}

export interface YoutubeVideoOptions {
  id?: string;
  url?: string;
}

export interface YoutubeVideo {
  id: string;
  title?: string;
  description?: string;
  duration?: number;
  channel?: Record<string, unknown>;
  viewCount?: number;
  likeCount?: number;
  tags?: string[];
  thumbnail?: string;
  uploadDate?: string;
}

export interface YoutubeSearchOptions {
  query: string;
  limit?: number;
  type?: 'video' | 'channel' | 'playlist';
}

export interface YoutubeSearchResult {
  results?: Record<string, unknown>[];
}

export interface YoutubeTranscriptOptions {
  url?: string;
  videoId?: string;
  lang?: string;
  text?: boolean;
  chunkSize?: number;
}

export interface YoutubeTranslateOptions {
  url?: string;
  videoId?: string;
  lang: string;
  text?: boolean;
  chunkSize?: number;
}

export interface YoutubeTranscriptBatchOptions {
  videoIds?: string[];
  playlistId?: string;
  channelId?: string;
  limit?: number;
  lang?: string;
  text?: boolean;
}

export interface YoutubeVideoBatchOptions {
  videoIds?: string[];
  playlistId?: string;
  channelId?: string;
  limit?: number;
}

export interface YoutubeBatchJobResult {
  status: JobStatus;
  results?: Record<string, unknown>[];
  stats?: {
    total?: number;
    succeeded?: number;
    failed?: number;
  };
  completedAt?: string;
  error?: string;
}

export interface PollOptions {
  intervalMs?: number;
  maxAttempts?: number;
}

// ── Errors ─────────────────────────────────────────────

export class SupadataApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'SupadataApiError';
    this.statusCode = statusCode;
  }
}
