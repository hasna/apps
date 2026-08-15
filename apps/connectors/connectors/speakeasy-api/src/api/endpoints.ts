import type { ConnectorClient } from './client';
import type { ApiEndpoint, GenerateOpenApiSpecDiff } from '../types';

export class EndpointsApi {
  constructor(private readonly client: ConnectorClient) {}

  list(apiID: string, versionID: string): Promise<ApiEndpoint[]> {
    return this.client.get<ApiEndpoint[]>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/api_endpoints`
    );
  }

  find(apiID: string, versionID: string, displayName: string): Promise<ApiEndpoint> {
    return this.client.get<ApiEndpoint>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/api_endpoints/find/${encodeURIComponent(displayName)}`
    );
  }

  get(apiID: string, versionID: string, apiEndpointID: string): Promise<ApiEndpoint> {
    return this.client.get<ApiEndpoint>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/api_endpoints/${encodeURIComponent(apiEndpointID)}`
    );
  }

  upsert(apiID: string, versionID: string, apiEndpointID: string, endpoint: ApiEndpoint): Promise<ApiEndpoint> {
    return this.client.put<ApiEndpoint>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/api_endpoints/${encodeURIComponent(apiEndpointID)}`,
      endpoint as unknown as Record<string, unknown>
    );
  }

  delete(apiID: string, versionID: string, apiEndpointID: string): Promise<void> {
    return this.client.delete<void>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/api_endpoints/${encodeURIComponent(apiEndpointID)}`
    );
  }

  generateOpenApi(
    apiID: string,
    versionID: string,
    apiEndpointID: string
  ): Promise<GenerateOpenApiSpecDiff> {
    return this.client.get<GenerateOpenApiSpecDiff>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/api_endpoints/${encodeURIComponent(apiEndpointID)}/generate/openapi`
    );
  }

  generatePostman(apiID: string, versionID: string, apiEndpointID: string): Promise<string> {
    return this.client.request<string>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/api_endpoints/${encodeURIComponent(apiEndpointID)}/generate/postman`,
      { raw: true }
    );
  }
}
