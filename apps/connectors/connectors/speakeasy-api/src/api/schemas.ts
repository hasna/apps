import type { ConnectorClient } from './client';
import type { Schema, SchemaDiff } from '../types';

export class SchemasApi {
  constructor(private readonly client: ConnectorClient) {}

  get(apiID: string, versionID: string): Promise<Schema> {
    return this.client.get<Schema>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/schema`
    );
  }

  register(apiID: string, versionID: string, file: Blob | File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    return this.client.post<void>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/schema`,
      form
    );
  }

  download(apiID: string, versionID: string): Promise<string> {
    return this.client.request<string>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/schema/download`,
      { raw: true }
    );
  }

  diff(
    apiID: string,
    versionID: string,
    baseRevisionID: string,
    targetRevisionID: string
  ): Promise<SchemaDiff> {
    return this.client.get<SchemaDiff>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/schema/${encodeURIComponent(baseRevisionID)}/diff/${encodeURIComponent(targetRevisionID)}`
    );
  }

  getRevision(apiID: string, versionID: string, revisionID: string): Promise<Schema> {
    return this.client.get<Schema>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/schema/${encodeURIComponent(revisionID)}`
    );
  }

  downloadRevision(apiID: string, versionID: string, revisionID: string): Promise<string> {
    return this.client.request<string>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/schema/${encodeURIComponent(revisionID)}/download`,
      { raw: true }
    );
  }

  list(apiID: string, versionID: string): Promise<Schema[]> {
    return this.client.get<Schema[]>(
      `/v1/apis/${encodeURIComponent(apiID)}/version/${encodeURIComponent(versionID)}/schemas`
    );
  }
}
