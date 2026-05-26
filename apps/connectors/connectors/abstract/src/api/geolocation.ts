import type { ConnectorClient } from './client';
import type { GeolocationParams, GeolocationResult } from '../types';

const BASE_URL = 'https://ipgeolocation.abstractapi.com';

export class GeolocationApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Look up geolocation data for an IP address.
   * If no IP is provided, returns data for the requester's IP.
   */
  async lookup(params?: GeolocationParams): Promise<GeolocationResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};

    if (params?.ip_address) {
      queryParams.ip_address = params.ip_address;
    }
    if (params?.fields) {
      queryParams.fields = params.fields;
    }

    return this.client.get<GeolocationResult>('/v1/', queryParams, BASE_URL);
  }
}
