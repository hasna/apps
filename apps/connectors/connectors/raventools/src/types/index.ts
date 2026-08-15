export interface RavenToolsConfig { apiKey: string; }

export interface RTDomain { domain: string; name: string; }
export interface RTRanking { keyword: string; engine: string; rank: number; url: string; date: string; }
export interface RTCompetitor { domain: string; keywords_in_common: number; }
export interface RTKeyword { keyword: string; search_volume: number; competition: number; cpc: number; }
export interface RTBacklink { url: string; anchor_text: string; domain_authority: number; page_authority: number; follow: boolean; first_seen: string; }

export class RavenToolsApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'RavenToolsApiError'; this.statusCode = statusCode; }
}
