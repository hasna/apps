export type OutputFormat = 'json' | 'pretty' | 'table';

export type OaStatus = 'gold' | 'hybrid' | 'bronze' | 'green' | 'closed';

export interface OaLocation {
  url?: string;
  url_for_pdf?: string;
  url_for_landing_page?: string;
  host_type?: string;
  license?: string;
  version?: string;
  updated?: string;
  evidence?: string;
  is_best?: boolean;
}

export interface DoiObject {
  doi: string;
  doi_url?: string;
  title?: string;
  genre?: string;
  is_paratext?: boolean;
  published_date?: string;
  year?: number;
  journal_name?: string;
  journal_issns?: string;
  journal_is_oa?: boolean;
  journal_is_in_doaj?: boolean;
  publisher?: string;
  is_oa: boolean;
  oa_status: OaStatus;
  has_repository_copy?: boolean;
  best_oa_location?: OaLocation | null;
  first_oa_location?: OaLocation | null;
  oa_locations?: OaLocation[];
  updated?: string;
  data_standard?: number;
  z_authors?: Array<{ given?: string; family?: string; sequence?: string }>;
}

export interface SearchMatch {
  snippet: string;
  score: number;
  response: DoiObject;
}

export interface SearchOptions {
  query: string;
  isOa?: boolean;
  page?: number;
}

export interface SearchResult {
  results: SearchMatch[];
}

export class UnpaywallApiError extends Error {
  constructor(message: string, public statusCode?: number, public responseBody?: string) {
    super(message);
    this.name = 'UnpaywallApiError';
  }
}
