import type { ConnectorClient } from './client';
import type {
  GuessFormatParams,
  GuessFormatResult,
  DomainSearchParams,
  DomainSearchResult,
  ActivityParams,
  ActivityResult,
} from '../types';

export class EnrichmentApi {
  constructor(private readonly client: ConnectorClient) {}

  async guessFormat(params: GuessFormatParams): Promise<GuessFormatResult> {
    if (!params.email) {
      throw new Error('email is required');
    }

    return this.client.get<GuessFormatResult>('/v2/guessformat', {
      email: params.email,
    });
  }

  async domainSearch(params: DomainSearchParams): Promise<DomainSearchResult> {
    if (!params.domain) {
      throw new Error('domain is required');
    }

    return this.client.get<DomainSearchResult>('/v2/domain-search', {
      domain: params.domain,
      format: params.format,
      page: params.page,
      limit: params.limit,
    });
  }

  async getActivity(params: ActivityParams): Promise<ActivityResult> {
    if (!params.email) {
      throw new Error('email is required');
    }

    return this.client.get<ActivityResult>('/v2/activity', {
      email: params.email,
    });
  }
}
