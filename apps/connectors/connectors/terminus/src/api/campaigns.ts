import type { ConnectorClient } from './client';
import type { PaginatedResponse, PaginationParams, UtmValue } from '../types';

export type UtmResource = 'campaigns' | 'contents' | 'mediums' | 'sources' | 'terms';

function projectPath(projectId: string, resource: UtmResource): string {
  return `/v1/projects/${projectId}/${resource}`;
}

export class UtmValuesApi {
  constructor(
    private readonly client: ConnectorClient,
    private readonly resource: UtmResource
  ) {}

  async list(projectId: string, params?: PaginationParams): Promise<PaginatedResponse<UtmValue>> {
    return this.client.get<PaginatedResponse<UtmValue>>(projectPath(projectId, this.resource), params);
  }
}

export class CampaignsApi extends UtmValuesApi {
  constructor(client: ConnectorClient) {
    super(client, 'campaigns');
  }
}

export class ContentsApi extends UtmValuesApi {
  constructor(client: ConnectorClient) {
    super(client, 'contents');
  }
}

export class MediumsApi extends UtmValuesApi {
  constructor(client: ConnectorClient) {
    super(client, 'mediums');
  }
}

export class SourcesApi extends UtmValuesApi {
  constructor(client: ConnectorClient) {
    super(client, 'sources');
  }
}

export class TermsApi extends UtmValuesApi {
  constructor(client: ConnectorClient) {
    super(client, 'terms');
  }
}
