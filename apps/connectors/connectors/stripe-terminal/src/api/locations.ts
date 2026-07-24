import type { ConnectorClient } from './client';
import type {
  TerminalLocation,
  TerminalLocationCreateParams,
  TerminalLocationUpdateParams,
  TerminalLocationListOptions,
  StripeList,
  DeletedObject,
} from '../types';

/**
 * Stripe Terminal Locations API
 * https://stripe.com/docs/api/terminal/locations
 */
export class LocationsApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(params: TerminalLocationCreateParams): Promise<TerminalLocation> {
    return this.client.post<TerminalLocation>('/terminal/locations', params);
  }

  async get(id: string): Promise<TerminalLocation> {
    return this.client.get<TerminalLocation>(`/terminal/locations/${id}`);
  }

  async update(id: string, params: TerminalLocationUpdateParams): Promise<TerminalLocation> {
    return this.client.post<TerminalLocation>(`/terminal/locations/${id}`, params);
  }

  async list(options?: TerminalLocationListOptions): Promise<StripeList<TerminalLocation>> {
    return this.client.get<StripeList<TerminalLocation>>('/terminal/locations', options as Record<string, string | number | boolean | undefined>);
  }

  async del(id: string): Promise<DeletedObject> {
    return this.client.delete<DeletedObject>(`/terminal/locations/${id}`);
  }
}
