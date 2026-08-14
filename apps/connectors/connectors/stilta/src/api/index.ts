import type {
  StiltaConfig,
  Patent,
  PatentSearchParams,
  PatentSearchResult,
  ResearchJob,
  ResearchJobListResult,
  CreateResearchJobParams,
  RawRequestParams,
} from '../types';
import { StiltaClient } from './client';

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

/**
 * High-level wrapper around the Stilta patents / prior-art research API.
 */
export class Stilta {
  private readonly client: StiltaClient;

  constructor(config: StiltaConfig) {
    this.client = new StiltaClient(config);
  }

  static fromEnv(): Stilta {
    const apiKey = process.env.STILTA_API_KEY;
    if (!apiKey) {
      throw new Error('STILTA_API_KEY environment variable is required');
    }
    const baseUrl = process.env.STILTA_BASE_URL;
    return new Stilta({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): StiltaClient {
    return this.client;
  }

  // ============================================
  // Patents
  // ============================================

  /** Search patents. POST /patents/search */
  async searchPatents(params: PatentSearchParams = {}): Promise<PatentSearchResult> {
    return this.client.post<PatentSearchResult>('/patents/search', params as Record<string, unknown>);
  }

  /** Get a single patent by id. GET /patents/{patentId} */
  async getPatent(patentId: string): Promise<Patent> {
    return this.client.get<Patent>(`/patents/${encodePathSegment(patentId)}`);
  }

  // ============================================
  // Research Jobs
  // ============================================

  /** List research jobs. GET /research-jobs */
  async listResearchJobs(params?: {
    limit?: number;
    offset?: number;
    status?: string;
  }): Promise<ResearchJobListResult> {
    return this.client.get<ResearchJobListResult>('/research-jobs', params);
  }

  /** Create a research job. POST /research-jobs */
  async createResearchJob(params: CreateResearchJobParams): Promise<ResearchJob> {
    return this.client.post<ResearchJob>('/research-jobs', params as Record<string, unknown>);
  }

  /** Get a research job by id. GET /research-jobs/{jobId} */
  async getResearchJob(jobId: string): Promise<ResearchJob> {
    return this.client.get<ResearchJob>(`/research-jobs/${encodePathSegment(jobId)}`);
  }

  // ============================================
  // Raw requests
  // ============================================

  /** Perform an arbitrary request against the Stilta API. */
  async rawRequest<T = unknown>(params: RawRequestParams): Promise<T> {
    const { path, method = 'GET', query, body, headers } = params;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }
}

export { StiltaClient } from './client';
