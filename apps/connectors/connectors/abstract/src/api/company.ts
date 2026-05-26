import type { ConnectorClient } from './client';
import type { CompanyEnrichmentParams, CompanyEnrichmentResult } from '../types';

const BASE_URL = 'https://companyenrichment.abstractapi.com';

export class CompanyApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Enrich company data by domain.
   * Returns company name, industry, employees count, social links, and more.
   */
  async enrich(params: CompanyEnrichmentParams): Promise<CompanyEnrichmentResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      domain: params.domain,
    };

    if (params.fields) {
      queryParams.fields = params.fields;
    }

    return this.client.get<CompanyEnrichmentResult>('/v1/', queryParams, BASE_URL);
  }
}
