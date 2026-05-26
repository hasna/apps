// Wikipedia uses no authentication — public read-only API
export interface WikipediaConfig { language?: string; userAgent?: string; baseUrl?: string; }

export interface WikiArticleSummary {
  title: string;
  displaytitle: string;
  description: string | null;
  extract: string;
  thumbnail?: { source: string; width: number; height: number };
  content_urls: { desktop: { page: string }; mobile: { page: string } };
  timestamp: string;
  pageid: number;
}

export interface WikiSearchResult {
  pageid: number;
  title: string;
  snippet: string;
  size: number;
  wordcount: number;
  timestamp: string;
}

export interface WikiArticleSection { title: string; content: string; level: number; }

export interface WikiRandomArticle { id: number; key: string; title: string; excerpt: string; description: string | null; }

export class WikipediaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'WikipediaApiError'; this.statusCode = statusCode; }
}
