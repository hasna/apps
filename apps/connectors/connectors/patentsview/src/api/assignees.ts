import type { PatentsViewClient } from './client';
import type {
  Assignee,
  AssigneeSearchResponse,
  AssigneeGetResponse,
  QueryObject,
  QueryOptions,
  SearchRequest,
} from '../types';
import { DEFAULT_ASSIGNEE_FIELDS } from '../types';

/**
 * Assignees API - Search and retrieve assignee data
 */
export class AssigneesApi {
  constructor(private readonly client: PatentsViewClient) {}

  /**
   * Search assignees with filters
   * @param query - Query object with filters
   * @param fields - Fields to return (defaults to common fields)
   * @param options - Pagination and sorting options
   */
  async search(
    query?: QueryObject,
    fields?: string[],
    options?: QueryOptions
  ): Promise<AssigneeSearchResponse> {
    const body: SearchRequest = {};

    if (query) {
      body.q = query;
    }

    body.f = fields || DEFAULT_ASSIGNEE_FIELDS;

    if (options) {
      body.o = options;
    }

    return this.client.post<AssigneeSearchResponse>('/assignee/', body);
  }

  /**
   * Get a single assignee by ID
   * @param assigneeId - The assignee ID
   * @param fields - Fields to return
   */
  async get(assigneeId: string, fields?: string[]): Promise<Assignee | null> {
    const response = await this.client.get<AssigneeGetResponse>(
      `/assignee/${assigneeId}/`,
      fields ? { f: fields.join(',') } : undefined
    );
    return response.assignees?.[0] || null;
  }

  /**
   * Search assignees by organization name
   * @param organization - Organization name
   * @param options - Pagination options
   */
  async searchByOrganization(organization: string, options?: QueryOptions): Promise<AssigneeSearchResponse> {
    return this.search(
      { assignee_organization: { _contains: organization } },
      undefined,
      options
    );
  }

  /**
   * Search assignees by individual name
   * @param lastName - Last name
   * @param firstName - First name (optional)
   * @param options - Pagination options
   */
  async searchByName(
    lastName: string,
    firstName?: string,
    options?: QueryOptions
  ): Promise<AssigneeSearchResponse> {
    const query: QueryObject = {
      assignee_individual_name_last: { _eq: lastName },
    };

    if (firstName) {
      query.assignee_individual_name_first = { _eq: firstName };
    }

    return this.search(query, undefined, options);
  }

  /**
   * Search assignees by location
   * @param country - Country code
   * @param state - State (optional)
   * @param city - City (optional)
   * @param options - Pagination options
   */
  async searchByLocation(
    country: string,
    state?: string,
    city?: string,
    options?: QueryOptions
  ): Promise<AssigneeSearchResponse> {
    const conditions: QueryObject[] = [
      { assignee_country: { _eq: country } },
    ];

    if (state) {
      conditions.push({ assignee_state: { _eq: state } });
    }

    if (city) {
      conditions.push({ assignee_city: { _eq: city } });
    }

    return this.search(
      conditions.length > 1 ? { _and: conditions } : conditions[0],
      undefined,
      options
    );
  }

  /**
   * Search assignees by type
   * @param type - Assignee type (e.g., "2" for US Company)
   * @param options - Pagination options
   */
  async searchByType(type: string, options?: QueryOptions): Promise<AssigneeSearchResponse> {
    return this.search(
      { assignee_type: { _eq: type } },
      [...DEFAULT_ASSIGNEE_FIELDS, 'assignee_type'],
      options
    );
  }

  /**
   * Get top assignees by patent count
   * @param limit - Number of assignees to return
   */
  async getTopByPatentCount(limit = 25): Promise<AssigneeSearchResponse> {
    return this.search(
      undefined,
      [...DEFAULT_ASSIGNEE_FIELDS, 'assignee_num_patents'],
      {
        per_page: limit,
        sort: [{ assignee_num_patents: 'desc' }],
      }
    );
  }

  /**
   * Get top assignees by inventor count
   * @param limit - Number of assignees to return
   */
  async getTopByInventorCount(limit = 25): Promise<AssigneeSearchResponse> {
    return this.search(
      undefined,
      [...DEFAULT_ASSIGNEE_FIELDS, 'assignee_num_inventors'],
      {
        per_page: limit,
        sort: [{ assignee_num_inventors: 'desc' }],
      }
    );
  }

  /**
   * Search for US companies (assignee_type = 2)
   * @param options - Pagination options
   */
  async searchUSCompanies(options?: QueryOptions): Promise<AssigneeSearchResponse> {
    return this.searchByType('2', options);
  }

  /**
   * Search for foreign companies (assignee_type = 3)
   * @param options - Pagination options
   */
  async searchForeignCompanies(options?: QueryOptions): Promise<AssigneeSearchResponse> {
    return this.searchByType('3', options);
  }
}
