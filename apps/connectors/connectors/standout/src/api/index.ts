import type {
  StandoutAssessment,
  StandoutCandidate,
  StandoutConfig,
  StandoutQueryParams,
  StandoutRawRequestOptions,
  StandoutRole,
} from '../types';
import { StandoutClient } from './client';

export { StandoutClient, DEFAULT_BASE_URL } from './client';

export class Standout {
  private readonly client: StandoutClient;

  constructor(config: StandoutConfig) {
    this.client = new StandoutClient(config);
  }

  static fromEnv(): Standout {
    const apiKey = process.env.STANDOUT_API_KEY;
    if (!apiKey) {
      throw new Error('STANDOUT_API_KEY environment variable is required');
    }
    return new Standout({
      apiKey,
      baseUrl: process.env.STANDOUT_BASE_URL,
    });
  }

  async listCandidates(query?: StandoutQueryParams): Promise<unknown> {
    return this.client.request('/candidates', { query });
  }

  async getCandidate(candidateId: string): Promise<StandoutCandidate> {
    return this.client.request<StandoutCandidate>(`/candidates/${encodeURIComponent(candidateId)}`);
  }

  async listRoles(query?: StandoutQueryParams): Promise<unknown> {
    return this.client.request('/roles', { query });
  }

  async createAssessment(body: Record<string, unknown>): Promise<StandoutAssessment> {
    return this.client.request<StandoutAssessment>('/assessments', { method: 'POST', body });
  }

  async listAssessments(query?: StandoutQueryParams): Promise<unknown> {
    return this.client.request('/assessments', { query });
  }

  async rawRequest(options: StandoutRawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, query, body } = options;
    return this.client.request(path, { method, query, body });
  }

  getClient(): StandoutClient {
    return this.client;
  }
}
