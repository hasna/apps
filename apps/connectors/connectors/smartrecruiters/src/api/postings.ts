import type { SmartRecruitersClient } from './client';
import type { Posting, SmartRecruitersListResponse } from '../types';

export interface ListPostingsParams {
  limit?: number;
  offset?: number;
  /** Free-text query matched against the posting */
  q?: string;
  /** Filter by department id */
  department?: string;
  /** Filter by location city */
  city?: string;
  /** Filter by location country code */
  country?: string;
  /** Filter to postings updated on or after this ISO-8601 timestamp */
  updatedAfter?: string;
}

/**
 * SmartRecruiters public Posting API
 * (`/v1/companies/{companyIdentifier}/postings`).
 *
 * This is the public job-board feed. It is keyed by a company identifier
 * rather than the authenticated company, so the identifier must be supplied.
 */
export class PostingsApi {
  constructor(
    private readonly client: SmartRecruitersClient,
    private readonly defaultCompanyId?: string
  ) {}

  private resolveCompany(companyId?: string): string {
    const id = companyId || this.defaultCompanyId;
    if (!id) {
      throw new Error(
        'A company identifier is required for the Posting API. ' +
        'Pass one explicitly or set SMARTRECRUITERS_COMPANY_ID.'
      );
    }
    return id;
  }

  /** List active public postings for a company. */
  async list(
    params?: ListPostingsParams,
    companyId?: string
  ): Promise<SmartRecruitersListResponse<Posting>> {
    const company = this.resolveCompany(companyId);
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit !== undefined) queryParams.limit = params.limit;
    if (params?.offset !== undefined) queryParams.offset = params.offset;
    if (params?.q) queryParams.q = params.q;
    if (params?.department) queryParams.department = params.department;
    if (params?.city) queryParams.city = params.city;
    if (params?.country) queryParams.country = params.country;
    if (params?.updatedAfter) queryParams.updatedAfter = params.updatedAfter;

    return this.client.get<SmartRecruitersListResponse<Posting>>(
      `/v1/companies/${encodeURIComponent(company)}/postings`,
      queryParams
    );
  }

  /** Get a single public posting by id. */
  async get(postingId: string, companyId?: string): Promise<Posting> {
    const company = this.resolveCompany(companyId);
    return this.client.get<Posting>(
      `/v1/companies/${encodeURIComponent(company)}/postings/${encodeURIComponent(postingId)}`
    );
  }
}
