import type { PatentsViewClient } from './client';
import type {
  Location,
  LocationSearchResponse,
  QueryObject,
  QueryOptions,
  SearchRequest,
} from '../types';
import { DEFAULT_LOCATION_FIELDS } from '../types';

/**
 * Locations API - Search and retrieve location data
 */
export class LocationsApi {
  constructor(private readonly client: PatentsViewClient) {}

  /**
   * Search locations with filters
   * @param query - Query object with filters
   * @param fields - Fields to return (defaults to common fields)
   * @param options - Pagination and sorting options
   */
  async search(
    query?: QueryObject,
    fields?: string[],
    options?: QueryOptions
  ): Promise<LocationSearchResponse> {
    const body: SearchRequest = {};

    if (query) {
      body.q = query;
    }

    body.f = fields || DEFAULT_LOCATION_FIELDS;

    if (options) {
      body.o = options;
    }

    return this.client.post<LocationSearchResponse>('/location/', body);
  }

  /**
   * Search locations by country
   * @param country - Country code (e.g., "US", "JP", "DE")
   * @param options - Pagination options
   */
  async searchByCountry(country: string, options?: QueryOptions): Promise<LocationSearchResponse> {
    return this.search(
      { location_country: { _eq: country.toUpperCase() } },
      undefined,
      options
    );
  }

  /**
   * Search locations by state (US only)
   * @param state - State code (e.g., "CA", "NY", "TX")
   * @param options - Pagination options
   */
  async searchByState(state: string, options?: QueryOptions): Promise<LocationSearchResponse> {
    return this.search(
      {
        _and: [
          { location_country: { _eq: 'US' } },
          { location_state: { _eq: state.toUpperCase() } },
        ],
      },
      undefined,
      options
    );
  }

  /**
   * Search locations by city
   * @param city - City name
   * @param country - Country code (optional)
   * @param state - State code (optional, for US)
   * @param options - Pagination options
   */
  async searchByCity(
    city: string,
    country?: string,
    state?: string,
    options?: QueryOptions
  ): Promise<LocationSearchResponse> {
    const conditions: QueryObject[] = [
      { location_city: { _contains: city } },
    ];

    if (country) {
      conditions.push({ location_country: { _eq: country.toUpperCase() } });
    }

    if (state) {
      conditions.push({ location_state: { _eq: state.toUpperCase() } });
    }

    return this.search(
      conditions.length > 1 ? { _and: conditions } : conditions[0],
      undefined,
      options
    );
  }

  /**
   * Get top locations by patent count
   * @param limit - Number of locations to return
   */
  async getTopByPatentCount(limit = 25): Promise<LocationSearchResponse> {
    return this.search(
      undefined,
      [...DEFAULT_LOCATION_FIELDS, 'location_latitude', 'location_longitude'],
      {
        per_page: limit,
        sort: [{ location_num_patents: 'desc' }],
      }
    );
  }

  /**
   * Get top locations by inventor count
   * @param limit - Number of locations to return
   */
  async getTopByInventorCount(limit = 25): Promise<LocationSearchResponse> {
    return this.search(
      undefined,
      [...DEFAULT_LOCATION_FIELDS, 'location_latitude', 'location_longitude'],
      {
        per_page: limit,
        sort: [{ location_num_inventors: 'desc' }],
      }
    );
  }

  /**
   * Get top US cities by patent count
   * @param limit - Number of cities to return
   */
  async getTopUSCities(limit = 25): Promise<LocationSearchResponse> {
    return this.search(
      { location_country: { _eq: 'US' } },
      DEFAULT_LOCATION_FIELDS,
      {
        per_page: limit,
        sort: [{ location_num_patents: 'desc' }],
      }
    );
  }

  /**
   * Get locations in a specific US state, sorted by patent count
   * @param state - State code
   * @param limit - Number of locations to return
   */
  async getTopCitiesInState(state: string, limit = 25): Promise<LocationSearchResponse> {
    return this.search(
      {
        _and: [
          { location_country: { _eq: 'US' } },
          { location_state: { _eq: state.toUpperCase() } },
        ],
      },
      DEFAULT_LOCATION_FIELDS,
      {
        per_page: limit,
        sort: [{ location_num_patents: 'desc' }],
      }
    );
  }

  /**
   * Search locations by coordinates (bounding box)
   * @param minLat - Minimum latitude
   * @param maxLat - Maximum latitude
   * @param minLon - Minimum longitude
   * @param maxLon - Maximum longitude
   * @param options - Pagination options
   */
  async searchByBoundingBox(
    minLat: number,
    maxLat: number,
    minLon: number,
    maxLon: number,
    options?: QueryOptions
  ): Promise<LocationSearchResponse> {
    return this.search(
      {
        _and: [
          { location_latitude: { _gte: minLat } },
          { location_latitude: { _lte: maxLat } },
          { location_longitude: { _gte: minLon } },
          { location_longitude: { _lte: maxLon } },
        ],
      },
      [...DEFAULT_LOCATION_FIELDS, 'location_latitude', 'location_longitude'],
      options
    );
  }
}
