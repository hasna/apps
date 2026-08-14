import type { MetadataParams } from '../types';
import type { ConnectorClient } from './client';

export class MetadataApi {
  constructor(private readonly client: ConnectorClient) {}

  async getMetadata(options: MetadataParams = {}): Promise<unknown> {
    return this.client.get('/metadata', {
      module_filter: options.modules?.join(','),
      type_filter: options.type_filter,
    });
  }

  async getModuleMetadata(module: string): Promise<unknown> {
    return this.client.get(`/metadata/modules/${encodeURIComponent(module)}`);
  }

  async getEnumOptions(module: string, field: string): Promise<unknown> {
    return this.client.get(
      `/${encodeURIComponent(module)}/enum/${encodeURIComponent(field)}`
    );
  }
}
