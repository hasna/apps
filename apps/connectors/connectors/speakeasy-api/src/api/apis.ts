import type { ConnectorClient } from './client';
import type { Api, ApiListParams } from '../types';

function buildListParams(params?: ApiListParams): Record<string, string | boolean | undefined> {
  if (!params) return {};
  const query: Record<string, string | boolean | undefined> = {};
  if (params.and !== undefined) {
    query['op[and]'] = params.and;
  }
  if (params.metadata) {
    for (const [key, values] of Object.entries(params.metadata)) {
      for (const value of values) {
        query[`metadata[${key}]`] = value;
      }
    }
  }
  return query;
}

export class ApisApi {
  constructor(private readonly client: ConnectorClient) {}

  list(params?: ApiListParams): Promise<Api[]> {
    return this.client.get<Api[]>('/v1/apis', buildListParams(params));
  }

  listVersions(apiID: string, params?: ApiListParams): Promise<Api[]> {
    return this.client.get<Api[]>(`/v1/apis/${encodeURIComponent(apiID)}`, buildListParams(params));
  }

  upsert(apiID: string, api: Api): Promise<Api> {
    return this.client.put<Api>(`/v1/apis/${encodeURIComponent(apiID)}`, api as unknown as Record<string, unknown>);
  }

  delete(apiID: string, versionID: string): Promise<void> {
    return this.client.delete<void>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}`
    );
  }

  listEndpoints(apiID: string): Promise<import('../types').ApiEndpoint[]> {
    return this.client.get(`/v1/apis/${encodeURIComponent(apiID)}/api_endpoints`);
  }

  generateOpenApi(apiID: string, versionID: string): Promise<import('../types').GenerateOpenApiSpecDiff> {
    return this.client.get(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/generate/openapi`
    );
  }

  generatePostman(apiID: string, versionID: string): Promise<string> {
    return this.client.request<string>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/generate/postman`,
      { raw: true }
    );
  }
}
