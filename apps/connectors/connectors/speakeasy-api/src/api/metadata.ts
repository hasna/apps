import type { ConnectorClient } from './client';
import type { VersionMetadata } from '../types';

export class MetadataApi {
  constructor(private readonly client: ConnectorClient) {}

  list(apiID: string, versionID: string): Promise<VersionMetadata[]> {
    return this.client.get<VersionMetadata[]>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/metadata`
    );
  }

  insert(apiID: string, versionID: string, metadata: VersionMetadata): Promise<VersionMetadata> {
    return this.client.post<VersionMetadata>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/metadata`,
      metadata as unknown as Record<string, unknown>
    );
  }

  delete(apiID: string, versionID: string, metaKey: string, metaValue: string): Promise<void> {
    return this.client.delete<void>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/metadata/${encodeURIComponent(metaKey)}/${encodeURIComponent(metaValue)}`
    );
  }
}
