// Icons8 Connector Types

// ============================================
// Configuration
// ============================================

export interface Icons8Config {
  apiKey: string;
  apiSecret?: string; // Optional - some APIs need only a key
  baseUrl?: string;   // Override default base URL
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  nextToken?: string;
  hasMore: boolean;
}

// ============================================
// Icons8 Icon Types
// ============================================

export interface Icon {
  id: string;
  name: string;
  platform: string;
  created: string;
  url: string;
  commonName?: string;
  category?: string;
  subcategory?: string;
  svg?: string;
  png?: IconPng[];
}

export interface IconPng {
  width: number;
  height: number;
  link: string;
}

export interface IconSearchResponse {
  icons: Icon[];
  totalCount?: number;
}

export interface IconSearchParams {
  term: string;
  amount?: number;
  offset?: number;
  platform?: string;
  language?: string;
}

// ============================================
// Icons8 Category Types
// ============================================

export interface Category {
  name: string;
  api_code: string;
  subcategory?: Subcategory[];
}

export interface Subcategory {
  name: string;
  api_code: string;
}

export interface CategoriesResponse {
  categories: Category[];
}

// ============================================
// Icons8 Platform/Style Types
// ============================================

export interface Platform {
  name: string;
  api_code: string;
  title: string;
}

export interface PlatformsResponse {
  platforms: Platform[];
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class Icons8ApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'Icons8ApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
