import type { PatentsViewClient } from './client';
import type {
  Inventor,
  InventorSearchResponse,
  InventorGetResponse,
  QueryObject,
  QueryOptions,
  SearchRequest,
} from '../types';
import { DEFAULT_INVENTOR_FIELDS } from '../types';

/**
 * Inventors API - Search and retrieve inventor data
 */
export class InventorsApi {
  constructor(private readonly client: PatentsViewClient) {}

  /**
   * Search inventors with filters
   * @param query - Query object with filters
   * @param fields - Fields to return (defaults to common fields)
   * @param options - Pagination and sorting options
   */
  async search(
    query?: QueryObject,
    fields?: string[],
    options?: QueryOptions
  ): Promise<InventorSearchResponse> {
    const body: SearchRequest = {};

    if (query) {
      body.q = query;
    }

    body.f = fields || DEFAULT_INVENTOR_FIELDS;

    if (options) {
      body.o = options;
    }

    return this.client.post<InventorSearchResponse>('/inventor/', body);
  }

  /**
   * Get a single inventor by ID
   * @param inventorId - The inventor ID
   * @param fields - Fields to return
   */
  async get(inventorId: string, fields?: string[]): Promise<Inventor | null> {
    const response = await this.client.get<InventorGetResponse>(
      `/inventor/${inventorId}/`,
      fields ? { f: fields.join(',') } : undefined
    );
    return response.inventors?.[0] || null;
  }

  /**
   * Search inventors by name
   * @param lastName - Last name
   * @param firstName - First name (optional)
   * @param options - Pagination options
   */
  async searchByName(
    lastName: string,
    firstName?: string,
    options?: QueryOptions
  ): Promise<InventorSearchResponse> {
    const query: QueryObject = {
      inventor_name_last: { _eq: lastName },
    };

    if (firstName) {
      query.inventor_name_first = { _eq: firstName };
    }

    return this.search(query, undefined, options);
  }

  /**
   * Search inventors by location
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
  ): Promise<InventorSearchResponse> {
    const conditions: QueryObject[] = [
      { inventor_country: { _eq: country } },
    ];

    if (state) {
      conditions.push({ inventor_state: { _eq: state } });
    }

    if (city) {
      conditions.push({ inventor_city: { _eq: city } });
    }

    return this.search(
      conditions.length > 1 ? { _and: conditions } : conditions[0],
      undefined,
      options
    );
  }

  /**
   * Get top inventors by patent count
   * @param limit - Number of inventors to return
   */
  async getTopByPatentCount(limit = 25): Promise<InventorSearchResponse> {
    return this.search(
      undefined,
      [...DEFAULT_INVENTOR_FIELDS, 'inventor_num_patents'],
      {
        per_page: limit,
        sort: [{ inventor_num_patents: 'desc' }],
      }
    );
  }

  /**
   * Get prolific inventors (more than N patents)
   * @param minPatents - Minimum number of patents
   * @param options - Pagination options
   */
  async getProlific(minPatents = 100, options?: QueryOptions): Promise<InventorSearchResponse> {
    return this.search(
      { inventor_num_patents: { _gte: minPatents } },
      [...DEFAULT_INVENTOR_FIELDS, 'inventor_num_patents'],
      {
        ...options,
        sort: [{ inventor_num_patents: 'desc' }],
      }
    );
  }

  /**
   * Search inventors by years active
   * @param minYears - Minimum years active
   * @param options - Pagination options
   */
  async searchByYearsActive(minYears: number, options?: QueryOptions): Promise<InventorSearchResponse> {
    return this.search(
      { inventor_years_active: { _gte: minYears } },
      [...DEFAULT_INVENTOR_FIELDS, 'inventor_years_active', 'inventor_first_seen_date', 'inventor_last_seen_date'],
      options
    );
  }

  /**
   * Search inventors by last name prefix
   * @param prefix - Name prefix
   * @param options - Pagination options
   */
  async searchByNamePrefix(prefix: string, options?: QueryOptions): Promise<InventorSearchResponse> {
    return this.search(
      { inventor_name_last: { _begins: prefix } },
      undefined,
      options
    );
  }

  /**
   * Get inventors from US
   * @param state - State filter (optional)
   * @param options - Pagination options
   */
  async getUSInventors(state?: string, options?: QueryOptions): Promise<InventorSearchResponse> {
    return this.searchByLocation('US', state, undefined, options);
  }
}
