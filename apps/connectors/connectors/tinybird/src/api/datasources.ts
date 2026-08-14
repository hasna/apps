import type { DataSourceFormat, DataSourceMode } from '../types';
import type { TinybirdClient } from './client';

export class DataSourcesApi {
  constructor(private readonly client: TinybirdClient) {}

  async list(options: { attrs?: string } = {}): Promise<unknown> {
    return this.client.request('/v0/datasources', { params: options });
  }

  async get(name: string): Promise<unknown> {
    return this.client.request(`/v0/datasources/${encodeURIComponent(name)}`);
  }

  async createOrAppend(options: {
    name: string;
    mode: DataSourceMode;
    schema?: string;
    url?: string;
    format?: DataSourceFormat;
    engine?: string;
  }): Promise<unknown> {
    const params = new URLSearchParams();
    params.set('name', options.name);
    params.set('mode', options.mode);
    if (options.schema) params.set('schema', options.schema);
    if (options.url) params.set('url', options.url);
    if (options.format) params.set('format', options.format);
    if (options.engine) params.set('engine', options.engine);
    return this.client.postDataSourceForm(params);
  }

  async alter(
    name: string,
    options: {
      schema?: string;
      description?: string;
      ttl?: string;
      kafkaTopic?: string;
      kafkaStoreRawValue?: boolean;
      dryRun?: boolean;
    },
  ): Promise<unknown> {
    return this.client.request(`/v0/datasources/${encodeURIComponent(name)}/alter`, {
      method: 'POST',
      body: this.client.createForm({
        schema: options.schema,
        description: options.description,
        ttl: options.ttl,
        kafka_topic: options.kafkaTopic,
        kafka_store_raw_value: options.kafkaStoreRawValue,
        dry_run: options.dryRun,
      }),
    });
  }

  async truncate(name: string, options: { quarantine?: boolean } = {}): Promise<unknown> {
    return this.client.request(`/v0/datasources/${encodeURIComponent(name)}/truncate`, {
      method: 'POST',
      params: { quarantine: options.quarantine },
    });
  }

  async deleteRows(name: string, deleteCondition: string): Promise<unknown> {
    return this.client.request(`/v0/datasources/${encodeURIComponent(name)}/delete`, {
      method: 'POST',
      body: this.client.createForm({ delete_condition: deleteCondition }),
    });
  }

  async drop(name: string, options: { force?: boolean } = {}): Promise<unknown> {
    return this.client.request(`/v0/datasources/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      params: { force: options.force },
    });
  }

  async rename(name: string, newName: string): Promise<unknown> {
    return this.client.request(`/v0/datasources/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: this.client.createForm({ name: newName }),
    });
  }
}
