export type OutputFormat = 'json' | 'pretty' | 'table';

export interface ArxivPaper {
  id: string;           // e.g., "2301.12345"
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  primaryCategory: string;
  published: string;    // ISO date
  updated: string;      // ISO date
  pdfUrl: string;
  absUrl: string;
  doi?: string;
  journalRef?: string;
  comment?: string;
}

export interface SearchOptions {
  query: string;
  category?: string;
  maxResults?: number;
  start?: number;
  sortBy?: 'relevance' | 'lastUpdatedDate' | 'submittedDate';
  sortOrder?: 'ascending' | 'descending';
}

export interface SearchResult {
  papers: ArxivPaper[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
}

export class ArxivApiError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'ArxivApiError';
  }
}
