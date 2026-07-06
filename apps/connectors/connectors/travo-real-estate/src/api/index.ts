import type {
  ConnectorConfig,
  Event,
  Listing,
  QueryParams,
  RawRequestOptions,
  SearchRequest,
} from '../types';
import { ConnectorClient, encodeListingId } from './client';

/**
 * Travo Data real estate API connector.
 */
export class TravoRealEstate {
  private readonly client: ConnectorClient;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
  }

  static fromEnv(): TravoRealEstate {
    const apiKey = process.env.TRAVO_REAL_ESTATE_API_KEY;
    const baseUrl = process.env.TRAVO_REAL_ESTATE_BASE_URL;

    if (!apiKey) {
      throw new Error('TRAVO_REAL_ESTATE_API_KEY environment variable is required');
    }

    return new TravoRealEstate({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }

  listListings(params?: QueryParams): Promise<unknown> {
    return this.client.get('/listings', params);
  }

  createListing(body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/listings', body);
  }

  getListing(listingId: string): Promise<Listing> {
    return this.client.get<Listing>(`/listings/${encodeListingId(listingId)}`);
  }

  listEvents(params?: QueryParams): Promise<unknown> {
    return this.client.get('/events', params);
  }

  search(body: SearchRequest): Promise<unknown> {
    return this.client.post('/search', body);
  }

  rawRequest(options: RawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request(path, { method, params: query, body, headers });
  }
}

export { ConnectorClient } from './client';
