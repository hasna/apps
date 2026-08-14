export interface ApiFlashConfig { accessKey: string; }

export interface ApiFlashScreenshot { url: string; }
export interface ApiFlashQuota { limit: number; remaining: number; reset: number; }

export interface ApiFlashOptions {
  url: string;
  format?: 'jpeg' | 'png' | 'webp';
  width?: number;
  height?: number;
  full_page?: boolean;
  fresh?: boolean;
  quality?: number;
  delay?: number;
  scroll_page?: boolean;
  css?: string;
  js?: string;
  wait_until?: 'page_loaded' | 'network_idle';
  response_type?: 'image' | 'json';
  thumbnail_width?: number;
  no_cookie_banners?: boolean;
  no_ads?: boolean;
  no_tracking?: boolean;
  element?: string;
  transparent?: boolean;
}

export class ApiFlashApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ApiFlashApiError'; this.statusCode = statusCode; }
}
