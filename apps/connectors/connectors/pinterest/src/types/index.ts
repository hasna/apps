// Pinterest Connector Types

// ============================================
// Configuration
// ============================================

export interface PinterestConfig {
  accessToken: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  items: T[];
  bookmark?: string;
}

// ============================================
// User Types
// ============================================

export interface UserAccount {
  account_type: 'BUSINESS' | 'PINNER';
  profile_image?: string;
  website_url?: string;
  username: string;
  about?: string;
  business_name?: string;
  board_count?: number;
  pin_count?: number;
  follower_count?: number;
  following_count?: number;
  monthly_views?: number;
}

// ============================================
// Board Types
// ============================================

export type BoardPrivacy = 'PUBLIC' | 'PROTECTED' | 'SECRET';

export interface Board {
  id: string;
  name: string;
  description?: string;
  owner: {
    username: string;
  };
  privacy: BoardPrivacy;
  created_at?: string;
  board_pins_modified_at?: string;
  pin_count?: number;
  follower_count?: number;
  collaborator_count?: number;
  media?: {
    image_cover_url?: string;
    pin_thumbnail_urls?: string[];
  };
}

export interface BoardListResponse extends PaginatedResponse<Board> {
  items: Board[];
}

export interface BoardCreateParams {
  name: string;
  description?: string;
  privacy?: BoardPrivacy;
}

export interface BoardUpdateParams {
  name?: string;
  description?: string;
  privacy?: BoardPrivacy;
}

// ============================================
// Pin Types
// ============================================

export interface Pin {
  id: string;
  created_at?: string;
  link?: string;
  title?: string;
  description?: string;
  dominant_color?: string;
  alt_text?: string;
  board_id?: string;
  board_section_id?: string;
  board_owner?: {
    username: string;
  };
  media?: PinMedia;
  media_source?: MediaSource;
  parent_pin_id?: string;
  is_owner?: boolean;
  is_standard?: boolean;
  has_been_promoted?: boolean;
  note?: string;
  pin_metrics?: {
    [key: string]: number;
  };
}

export interface PinMedia {
  media_type?: 'image' | 'video' | 'multiple_images' | 'multiple_mixed';
  images?: {
    [size: string]: {
      width: number;
      height: number;
      url: string;
    };
  };
}

export interface MediaSource {
  source_type: 'image_url' | 'image_base64' | 'video_id' | 'multiple_image_urls' | 'multiple_image_base64';
  url?: string;
  content_type?: string;
  data?: string;
  cover_image_url?: string;
  cover_image_content_type?: string;
  cover_image_data?: string;
  items?: Array<{
    url?: string;
    content_type?: string;
    data?: string;
    title?: string;
    description?: string;
    link?: string;
  }>;
  is_standard?: boolean;
}

export interface PinListResponse extends PaginatedResponse<Pin> {
  items: Pin[];
}

export interface PinCreateParams {
  board_id: string;
  media_source: MediaSource;
  link?: string;
  title?: string;
  description?: string;
  alt_text?: string;
  board_section_id?: string;
  parent_pin_id?: string;
  note?: string;
}

export interface PinUpdateParams {
  board_id?: string;
  board_section_id?: string;
  link?: string;
  title?: string;
  description?: string;
  alt_text?: string;
  note?: string;
}

// ============================================
// Board Section Types
// ============================================

export interface BoardSection {
  id: string;
  name: string;
}

export interface BoardSectionListResponse extends PaginatedResponse<BoardSection> {
  items: BoardSection[];
}

export interface BoardSectionCreateParams {
  name: string;
}

// ============================================
// Media Types
// ============================================

export interface MediaUpload {
  media_id: string;
  media_type: 'video';
  upload_url: string;
  upload_parameters?: {
    [key: string]: string;
  };
}

export interface MediaUploadResponse {
  media_id: string;
}

// ============================================
// Analytics Types
// ============================================

export type MetricType = 'IMPRESSION' | 'SAVE' | 'PIN_CLICK' | 'OUTBOUND_CLICK' | 'VIDEO_MRC_VIEW' | 'VIDEO_AVG_WATCH_TIME' | 'VIDEO_V50_WATCH_TIME' | 'QUARTILE_95_PERCENT_VIEW' | 'VIDEO_10S_VIEW' | 'VIDEO_START';

export interface PinAnalytics {
  all_time?: {
    [metric: string]: number;
  };
  daily_metrics?: Array<{
    date: string;
    data_status: string;
    metrics: {
      [metric: string]: number;
    };
  }>;
}

export interface UserAnalytics {
  all_time?: {
    [metric: string]: number;
  };
  daily_metrics?: Array<{
    date: string;
    data_status: string;
    metrics: {
      [metric: string]: number;
    };
  }>;
}

// ============================================
// Search Types
// ============================================

export interface SearchPinsParams {
  query: string;
  bookmark?: string;
  page_size?: number;
}

// ============================================
// API Error Types
// ============================================

export interface PinterestErrorDetail {
  code: number;
  message: string;
}

export interface PinterestErrorResponse {
  code: number;
  message: string;
  status?: string;
}

export class PinterestApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: number;

  constructor(message: string, statusCode: number, code?: number) {
    super(message);
    this.name = 'PinterestApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
