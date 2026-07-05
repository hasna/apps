import type {
  QueryParams,
  RawRequestOptions,
  VerdexClaim,
  VerdexConfig,
  VerdexListResponse,
  VerdexMonitoringJob,
  VerdexPortfolio,
  VerdexSiteConditions,
  VerdexVerification,
} from '../types';
import { VerdexClient } from './client';

export { VerdexClient, DEFAULT_BASE_URL } from './client';

export class Verdex {
  private readonly client: VerdexClient;

  constructor(config: VerdexConfig) {
    this.client = new VerdexClient(config);
  }

  static fromEnv(): Verdex {
    const apiKey = process.env.VERDEX_API_KEY;
    if (!apiKey) {
      throw new Error('VERDEX_API_KEY environment variable is required');
    }

    return new Verdex({
      apiKey,
      baseUrl: process.env.VERDEX_BASE_URL,
    });
  }

  async listClaims(params?: QueryParams): Promise<VerdexListResponse<VerdexClaim>> {
    return this.client.get('/claims', params);
  }

  async getClaim(claimId: string): Promise<VerdexClaim> {
    return this.client.get(`/claims/${encodeURIComponent(claimId)}`);
  }

  async createVerification(
    claimId: string,
    body: Record<string, unknown> = {},
  ): Promise<VerdexVerification> {
    return this.client.post(`/claims/${encodeURIComponent(claimId)}/verifications`, body);
  }

  async getVerification(verificationId: string): Promise<VerdexVerification> {
    return this.client.get(`/verifications/${encodeURIComponent(verificationId)}`);
  }

  async listPortfolios(params?: QueryParams): Promise<VerdexListResponse<VerdexPortfolio>> {
    return this.client.get('/portfolios', params);
  }

  async getPortfolio(portfolioId: string): Promise<VerdexPortfolio> {
    return this.client.get(`/portfolios/${encodeURIComponent(portfolioId)}`);
  }

  async getSiteConditions(siteId: string, params?: QueryParams): Promise<VerdexSiteConditions> {
    return this.client.get(`/sites/${encodeURIComponent(siteId)}/conditions`, params);
  }

  async listMonitoringJobs(params?: QueryParams): Promise<VerdexListResponse<VerdexMonitoringJob>> {
    return this.client.get('/monitoring-jobs', params);
  }

  async runMonitoringCheck(
    jobId: string,
    body: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.client.post(`/monitoring-jobs/${encodeURIComponent(jobId)}/run`, body);
  }

  async rawRequest<T = Record<string, unknown>>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }

  getClient(): VerdexClient {
    return this.client;
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}
