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
    if (options.nodes) {
      const body: Record<string, unknown> = { name: options.name, nodes: options.nodes };
      if (options.description) body.description = options.description;
      return this.client.request('/v0/pipes', { method: 'POST', body });
    }
    return this.client.request('/v0/pipes', {
      method: 'POST',
      params: {
        name: options.name,
        sql: options.sql,
        description: options.description,
      },
    });
  }

  async update(name: string, options: { newName?: string; description?: string }): Promise<unknown> {
    return this.client.request(`/v0/pipes/${encodeURIComponent(name)}`, {
      method: 'PUT',
      params: {
        name: options.newName,
        description: options.description,
      },
    });
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
      params: {
        name: options.nodeName,
        description: options.description,
      },
      body: options.sql,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      skipJsonContentType: true,
    });
  }

  async editNode(
    name: string,
    nodeId: string,
    options: { sql?: string; description?: string },
  ): Promise<unknown> {
    return this.client.request(
      `/v0/pipes/${encodeURIComponent(name)}/nodes/${encodeURIComponent(nodeId)}`,
      {
        method: 'PUT',
        params: { description: options.description },
        body: options.sql,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        skipJsonContentType: true,
      },
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
