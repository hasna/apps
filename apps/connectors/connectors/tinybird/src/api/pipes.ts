import type { PipeNode, ResponseFormat } from '../types';
import type { TinybirdClient } from './client';

export class PipesApi {
  constructor(private readonly client: TinybirdClient) {}

  async list(options: { attrs?: string; dependencies?: boolean } = {}): Promise<unknown> {
    return this.client.request('/v0/pipes', { params: options });
  }

  async get(name: string): Promise<unknown> {
    return this.client.request(`/v0/pipes/${encodeURIComponent(name)}`);
  }

  async create(options: {
    name: string;
    description?: string;
    sql?: string;
    nodes?: PipeNode[];
  }): Promise<unknown> {
    const body: Record<string, unknown> = { name: options.name };
    if (options.description) body.description = options.description;
    if (options.sql) body.sql = options.sql;
    if (options.nodes) body.nodes = options.nodes;
    return this.client.request('/v0/pipes', { method: 'POST', body });
  }

  async update(name: string, options: { newName?: string; description?: string }): Promise<unknown> {
    const body: Record<string, unknown> = {};
    if (options.newName) body.name = options.newName;
    if (options.description !== undefined) body.description = options.description;
    return this.client.request(`/v0/pipes/${encodeURIComponent(name)}`, { method: 'PUT', body });
  }

  async delete(name: string): Promise<unknown> {
    return this.client.request(`/v0/pipes/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  async query(
    name: string,
    options: { format?: ResponseFormat; parameters?: Record<string, unknown> } = {},
  ): Promise<unknown> {
    const format = options.format ?? 'json';
    const path = `/v0/pipes/${encodeURIComponent(name)}.${format}`;
    if (options.parameters) {
      return this.client.request(path, { method: 'POST', body: options.parameters });
    }
    return this.client.request(path);
  }

  async appendNode(
    name: string,
    options: { nodeName: string; sql: string; description?: string },
  ): Promise<unknown> {
    return this.client.request(`/v0/pipes/${encodeURIComponent(name)}/nodes`, {
      method: 'POST',
      body: {
        name: options.nodeName,
        sql: options.sql,
        description: options.description,
      },
    });
  }

  async editNode(
    name: string,
    nodeId: string,
    options: { sql?: string; description?: string },
  ): Promise<unknown> {
    return this.client.request(
      `/v0/pipes/${encodeURIComponent(name)}/nodes/${encodeURIComponent(nodeId)}`,
      { method: 'PUT', body: options },
    );
  }

  async deleteNode(name: string, nodeId: string): Promise<unknown> {
    return this.client.request(
      `/v0/pipes/${encodeURIComponent(name)}/nodes/${encodeURIComponent(nodeId)}`,
      { method: 'DELETE' },
    );
  }

  async explain(name: string): Promise<unknown> {
    return this.client.request(`/v0/pipes/${encodeURIComponent(name)}/explain`);
  }
}
