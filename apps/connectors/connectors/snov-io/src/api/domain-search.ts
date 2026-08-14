import type { SnovIoClient } from './client';
import type { DomainSearchResultResponse, DomainSearchStartResponse } from '../types';

export interface DomainSearchStartParams {
  domain: string;
}

export interface DomainSearchProspectsStartParams {
  domain: string;
  positions?: string[];
  page?: number;
}

export class DomainSearchApi {
  constructor(private readonly client: SnovIoClient) {}

  /** Start company info search by domain (POST /v2/domain-search/start) */
  async start(params: DomainSearchStartParams): Promise<DomainSearchStartResponse> {
    return this.client.postV2Form<DomainSearchStartResponse>('/v2/domain-search/start', {
      domain: params.domain,
    });
  }

  /** Get domain search results (GET /v2/domain-search/result/{task_hash}) */
  async getResult(taskHash: string): Promise<DomainSearchResultResponse> {
    return this.client.getV2<DomainSearchResultResponse>(`/v2/domain-search/result/${taskHash}`);
  }

  /** Start prospect search by domain (POST /v2/domain-search/prospects/start) */
  async startProspects(params: DomainSearchProspectsStartParams): Promise<DomainSearchStartResponse> {
    const body: Record<string, string | number> = { domain: params.domain };
    if (params.positions?.length) {
      body.positions = params.positions.join(',');
    }
    if (params.page !== undefined) {
      body.page = params.page;
    }
    return this.client.postV2Form<DomainSearchStartResponse>('/v2/domain-search/prospects/start', body);
  }

  /** Get prospect search results (GET /v2/domain-search/prospects/result/{task_hash}) */
  async getProspectsResult(taskHash: string): Promise<DomainSearchResultResponse> {
    return this.client.getV2<DomainSearchResultResponse>(`/v2/domain-search/prospects/result/${taskHash}`);
  }
}
