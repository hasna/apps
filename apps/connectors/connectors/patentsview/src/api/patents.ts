import type { PatentsViewClient } from './client';
import type {
  Patent,
  PatentSearchResponse,
  PatentGetResponse,
  QueryObject,
  QueryOptions,
  SearchRequest,
} from '../types';
import { DEFAULT_PATENT_FIELDS } from '../types';

/**
 * Patents API - Search and retrieve patent data
 */
export class PatentsApi {
  constructor(private readonly client: PatentsViewClient) {}

  /**
   * Search patents with filters
   * @param query - Query object with filters
   * @param fields - Fields to return (defaults to common fields)
   * @param options - Pagination and sorting options
   */
  async search(
    query?: QueryObject,
    fields?: string[],
    options?: QueryOptions
  ): Promise<PatentSearchResponse> {
    const body: SearchRequest = {};

    if (query) {
      body.q = query;
    }

    body.f = fields || DEFAULT_PATENT_FIELDS;

    if (options) {
      body.o = options;
    }

    return this.client.post<PatentSearchResponse>('/patent/', body);
  }

  /**
   * Get a single patent by ID
   * @param patentId - The patent ID (e.g., "10000000")
   * @param fields - Fields to return
   */
  async get(patentId: string, fields?: string[]): Promise<Patent | null> {
    const response = await this.client.get<PatentGetResponse>(
      `/patent/${patentId}/`,
      fields ? { f: fields.join(',') } : undefined
    );
    return response.patents?.[0] || null;
  }

  /**
   * Search patents by title text
   * @param title - Text to search in patent titles
   * @param options - Pagination options
   */
  async searchByTitle(title: string, options?: QueryOptions): Promise<PatentSearchResponse> {
    return this.search(
      { patent_title: { _text_phrase: title } },
      undefined,
      options
    );
  }

  /**
   * Search patents by abstract text
   * @param text - Text to search in patent abstracts
   * @param options - Pagination options
   */
  async searchByAbstract(text: string, options?: QueryOptions): Promise<PatentSearchResponse> {
    return this.search(
      { patent_abstract: { _text_any: text } },
      undefined,
      options
    );
  }

  /**
   * Search patents by assignee organization
   * @param organization - Organization name
   * @param options - Pagination options
   */
  async searchByAssignee(organization: string, options?: QueryOptions): Promise<PatentSearchResponse> {
    return this.search(
      { assignees: { assignee_organization: { _contains: organization } } },
      [...DEFAULT_PATENT_FIELDS, 'assignees.assignee_organization'],
      options
    );
  }

  /**
   * Search patents by inventor name
   * @param firstName - First name (optional)
   * @param lastName - Last name
   * @param options - Pagination options
   */
  async searchByInventor(
    lastName: string,
    firstName?: string,
    options?: QueryOptions
  ): Promise<PatentSearchResponse> {
    const inventorQuery: QueryObject = {
      inventors: {
        inventor_name_last: { _eq: lastName },
      } as QueryObject,
    };

    if (firstName) {
      (inventorQuery.inventors as QueryObject).inventor_name_first = { _eq: firstName };
    }

    return this.search(
      inventorQuery,
      [...DEFAULT_PATENT_FIELDS, 'inventors.inventor_name_first', 'inventors.inventor_name_last'],
      options
    );
  }

  /**
   * Search patents by CPC classification
   * @param cpcSubgroup - CPC subgroup ID (e.g., "G06F3/01")
   * @param options - Pagination options
   */
  async searchByCPC(cpcSubgroup: string, options?: QueryOptions): Promise<PatentSearchResponse> {
    return this.search(
      { cpc_current: { cpc_subgroup_id: { _eq: cpcSubgroup } } },
      [...DEFAULT_PATENT_FIELDS, 'cpc_current.cpc_subgroup_id', 'cpc_current.cpc_subgroup_title'],
      options
    );
  }

  /**
   * Search patents by date range
   * @param startDate - Start date (YYYY-MM-DD)
   * @param endDate - End date (YYYY-MM-DD)
   * @param options - Pagination options
   */
  async searchByDateRange(
    startDate: string,
    endDate: string,
    options?: QueryOptions
  ): Promise<PatentSearchResponse> {
    return this.search(
      {
        _and: [
          { patent_date: { _gte: startDate } },
          { patent_date: { _lte: endDate } },
        ],
      },
      undefined,
      options
    );
  }

  /**
   * Search patents by year
   * @param year - Patent year
   * @param options - Pagination options
   */
  async searchByYear(year: number, options?: QueryOptions): Promise<PatentSearchResponse> {
    return this.search(
      { patent_year: { _eq: year } },
      undefined,
      options
    );
  }

  /**
   * Get recently granted patents
   * @param limit - Number of patents to return
   */
  async getRecent(limit = 25): Promise<PatentSearchResponse> {
    return this.search(
      undefined,
      undefined,
      {
        per_page: limit,
        sort: [{ patent_date: 'desc' }],
      }
    );
  }

  /**
   * Get most cited patents
   * @param limit - Number of patents to return
   */
  async getMostCited(limit = 25): Promise<PatentSearchResponse> {
    return this.search(
      undefined,
      [...DEFAULT_PATENT_FIELDS, 'patent_num_cited_by_us_patents'],
      {
        per_page: limit,
        sort: [{ patent_num_cited_by_us_patents: 'desc' }],
      }
    );
  }
}
