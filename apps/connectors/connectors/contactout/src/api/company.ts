import type { ContactOutClient } from './client';
import type {
  CompanySearchParams,
  CompanySearchResponse,
  DomainEnrichParams,
  DomainEnrichResponse,
} from '../types';

/**
 * Company API - Search and enrich company profiles
 */
export class CompanyApi {
  constructor(private readonly client: ContactOutClient) {}

  /**
   * Search for companies matching criteria
   * @param params - Search filters including name, domain, size, location, industry, revenue, etc.
   * @returns Paginated list of matching companies
   * @cost 1 search credit per company
   */
  async search(params: CompanySearchParams): Promise<CompanySearchResponse> {
    return this.client.post<CompanySearchResponse>('/v1/company/search', {
      name: params.name,
      domain: params.domain,
      size: params.size,
      location: params.location,
      industry: params.industry,
      min_revenue: params.min_revenue,
      max_revenue: params.max_revenue,
      year_founded_from: params.year_founded_from,
      year_founded_to: params.year_founded_to,
      page: params.page,
      hq_only: params.hq_only,
    });
  }

  /**
   * Enrich company information from domains
   * @param params.domains - Array of domain names (max 30)
   * @returns Company details for each domain
   * @cost No credits consumed
   */
  async enrichFromDomains(params: DomainEnrichParams): Promise<DomainEnrichResponse> {
    if (params.domains.length > 30) {
      throw new Error('Maximum 30 domains allowed per request');
    }
    return this.client.post<DomainEnrichResponse>('/v1/domain/enrich', {
      domains: params.domains,
    });
  }

  /**
   * Get company by domain (convenience method for single domain)
   * @param domain - Company domain
   * @returns Company profile
   */
  async getByDomain(domain: string): Promise<DomainEnrichResponse> {
    return this.enrichFromDomains({ domains: [domain] });
  }
}
