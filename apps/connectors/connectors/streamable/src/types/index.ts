export interface StreamableVideo {
  shortcode: string;
  title?: string;
  status?: number;
  percent?: number;
  url?: string;
  embed_code?: string;
  thumbnail_url?: string;
  files?: Record<string, unknown>;
  source?: unknown;
  [key: string]: unknown;
}

export interface StreamableOEmbed {
  html?: string;
  provider_name?: string;
  provider_url?: string;
  thumbnail_url?: string;
  title?: string;
  type?: string;
  version?: string;
  height?: number;
  width?: number;
  [key: string]: unknown;
}

export class StreamableApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'StreamableApiError';
    this.statusCode = statusCode;
  }
}
