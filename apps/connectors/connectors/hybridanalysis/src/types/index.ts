export interface HybridAnalysisConfig { apiKey: string; }

export interface HAReport { job_id: string; sha256: string; md5: string; sha1: string; verdict: string; threat_score: number; threat_level: number; av_detect: number; vx_family: string; type: string; size: number; submit_name: string; analysis_start_time: string; }
export interface HASearchResult { result: HAReport[]; count: number; search_terms: string[]; }
export interface HAOverview { sha256: string; md5: string; last_file_name: string; threat_score: number | null; verdict: string | null; tags: string[]; type: string; }
export interface HAQuota { limit: number; used: number; remaining: number; }

export class HybridAnalysisApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'HybridAnalysisApiError'; this.statusCode = statusCode; }
}
