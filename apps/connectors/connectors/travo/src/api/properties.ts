import type {
  CompsParams,
  EnrichPropertyBody,
  PropertySearchParams,
  RawRequestOptions,
} from '../types';
import { ConnectorClient, encodePathSegment } from './client';

export class PropertiesApi {
  constructor(private readonly client: ConnectorClient) {}

  searchProperties(params: PropertySearchParams = {}): Promise<unknown> {
    return this.client.get('/properties/search', params);
  }

  getProperty(propertyId: string): Promise<unknown> {
    return this.client.get(`/properties/${encodePathSegment(propertyId)}`);
  }

  getComps(propertyId: string, params: CompsParams = {}): Promise<unknown> {
    return this.client.get(`/properties/${encodePathSegment(propertyId)}/comps`, params);
  }

  getOwnership(propertyId: string): Promise<unknown> {
    return this.client.get(`/properties/${encodePathSegment(propertyId)}/ownership`);
  }

  getZoning(propertyId: string): Promise<unknown> {
    return this.client.get(`/properties/${encodePathSegment(propertyId)}/zoning`);
  }

  getFinancials(propertyId: string): Promise<unknown> {
    return this.client.get(`/properties/${encodePathSegment(propertyId)}/financials`);
  }

  enrichProperty(propertyId: string, body: EnrichPropertyBody = {}): Promise<unknown> {
    return this.client.post(`/properties/${encodePathSegment(propertyId)}/enrich`, body);
  }

  rawRequest(options: RawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request(path.startsWith('/') ? path : `/${path}`, {
      method,
      params: query,
      body,
      headers,
    });
  }
}
