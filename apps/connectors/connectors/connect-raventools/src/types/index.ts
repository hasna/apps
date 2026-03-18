export interface RavenToolsConfig {
  token: string;
  baseUrl?: string;
}

export interface Site {
  siteHash: string;
  siteName: string;
  siteUrl: string;
  totalKeywords: number;
  activeEngines: number;
}

export interface Keyword {
  keyword: string;
  tags: string[];
  rankingData: Record<string, {
    rank: number | null;
    url: string | null;
    change: number | null;
    date: string;
  }>;
}

export interface RankingEntry {
  keyword: string;
  engine: string;
  rank: number | null;
  previousRank: number | null;
  change: number | null;
  url: string | null;
  date: string;
}

export interface Competitor {
  domain: string;
  label: string;
}

export interface Profile {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

export class RavenToolsApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'RavenToolsApiError';
    this.statusCode = statusCode;
  }
}
