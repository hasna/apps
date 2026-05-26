import type { ContactOutClient } from './client';
import type {
  PeopleSearchParams,
  PeopleSearchResponse,
  PeopleCountParams,
  PeopleCountResponse,
  PeopleEnrichParams,
  PeopleEnrichResponse,
  DecisionMakersParams,
  DecisionMakersResponse,
} from '../types';

/**
 * People API - Search, count, and enrich people profiles
 */
export class PeopleApi {
  constructor(private readonly client: ContactOutClient) {}

  /**
   * Search for people matching criteria
   * @param params - Search filters including job title, company, location, etc.
   * @returns Paginated list of matching profiles
   * @cost 1 search credit per profile; email/phone credits if reveal_info=true
   * @rateLimit 60 requests/minute
   */
  async search(params: PeopleSearchParams): Promise<PeopleSearchResponse> {
    return this.client.post<PeopleSearchResponse>('/v1/people/search', {
      name: params.name,
      job_title: params.job_title,
      job_function: params.job_function,
      seniority: params.seniority,
      skills: params.skills,
      languages: params.languages,
      education: params.education,
      company: params.company,
      company_domain: params.company_domain,
      location: params.location,
      industry: params.industry,
      page: params.page,
      data_types: params.data_types,
      reveal_info: params.reveal_info,
      detailed_experience: params.detailed_experience,
      detailed_education: params.detailed_education,
    });
  }

  /**
   * Count people matching criteria without returning profiles
   * @param params - Search filters
   * @returns Total count of matching profiles
   * @cost No credits consumed
   * @access Paid users only
   */
  async count(params: PeopleCountParams): Promise<PeopleCountResponse> {
    return this.client.post<PeopleCountResponse>('/v1/people/count', {
      name: params.name,
      job_title: params.job_title,
      job_function: params.job_function,
      seniority: params.seniority,
      skills: params.skills,
      company: params.company,
      location: params.location,
      industry: params.industry,
    });
  }

  /**
   * Enrich a person's profile using multiple identifying parameters
   * @param params - Identifying info: LinkedIn URL, email, phone, name, company, etc.
   * @param params.include - What to include: work_email, personal_email, phone
   * @returns Enriched profile with contact info
   * @cost 1 search credit + 1 email/phone credit if contact found
   */
  async enrich(params: PeopleEnrichParams): Promise<PeopleEnrichResponse> {
    return this.client.post<PeopleEnrichResponse>('/v1/people/enrich', {
      linkedin_url: params.linkedin_url,
      email: params.email,
      phone: params.phone,
      first_name: params.first_name,
      last_name: params.last_name,
      full_name: params.full_name,
      company: params.company,
      company_domain: params.company_domain,
      location: params.location,
      include: params.include,
    });
  }

  /**
   * Get decision makers at a company
   * @param params - At least one of: linkedin_url, domain, or company name
   * @returns Key decision makers at the company
   * @cost 1 search credit per profile; email/phone credits if reveal_info=true
   */
  async getDecisionMakers(params: DecisionMakersParams): Promise<DecisionMakersResponse> {
    if (!params.linkedin_url && !params.domain && !params.name) {
      throw new Error('At least one of linkedin_url, domain, or name is required');
    }
    return this.client.get<DecisionMakersResponse>('/v1/people/decision-makers', {
      linkedin_url: params.linkedin_url,
      domain: params.domain,
      name: params.name,
      page: params.page,
      reveal_info: params.reveal_info,
    });
  }
}
