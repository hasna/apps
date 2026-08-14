import { WeaviateClient } from './client';
import type {
  WeaviateConfig,
  WeaviateClass,
  WeaviateClassProperty,
  WeaviateGraphQLResponse,
  WeaviateNodeInfo,
  WeaviateObject,
  WeaviateSchema,
} from '../types';

export { WeaviateClient } from './client';

export class Weaviate {
  private readonly client: WeaviateClient;

  constructor(config: WeaviateConfig) {
    this.client = new WeaviateClient(config);
  }

  static fromEnv(): Weaviate {
    const host = process.env.WEAVIATE_HOST;
    if (!host) throw new Error('WEAVIATE_HOST is required');
    return new Weaviate({ host, apiKey: process.env.WEAVIATE_API_KEY });
  }

  async getSchema(): Promise<WeaviateSchema> {
    return this.client.request<WeaviateSchema>('/schema');
  }

  async createClass(options: {
    className: string;
    description?: string;
    properties?: WeaviateClassProperty[];
  }): Promise<WeaviateClass> {
    const body: Record<string, unknown> = { class: options.className };
    if (options.description) body.description = options.description;
    if (options.properties) body.properties = options.properties;
    return this.client.request<WeaviateClass>('/schema', { method: 'POST', body });
  }

  async deleteClass(className: string): Promise<{ deleted: boolean; className: string }> {
    await this.client.request(`/schema/${className}`, { method: 'DELETE' });
    return { deleted: true, className };
  }

  async addObject(options: {
    className: string;
    properties: Record<string, unknown>;
    id?: string;
  }): Promise<WeaviateObject> {
    const body: Record<string, unknown> = {
      class: options.className,
      properties: options.properties,
    };
    if (options.id) body.id = options.id;
    return this.client.request<WeaviateObject>('/objects', { method: 'POST', body });
  }

  async getObject(className: string, id: string): Promise<WeaviateObject> {
    return this.client.request<WeaviateObject>(`/objects/${className}/${id}`);
  }

  async updateObject(options: {
    className: string;
    id: string;
    properties: Record<string, unknown>;
  }): Promise<WeaviateObject> {
    return this.client.request<WeaviateObject>(`/objects/${options.className}/${options.id}`, {
      method: 'PATCH',
      body: { class: options.className, properties: options.properties },
    });
  }

  async deleteObject(className: string, id: string): Promise<{ deleted: boolean; id: string }> {
    await this.client.request(`/objects/${className}/${id}`, { method: 'DELETE' });
    return { deleted: true, id };
  }

  async graphqlQuery(query: string, variables?: Record<string, unknown>): Promise<WeaviateGraphQLResponse> {
    const body: Record<string, unknown> = { query };
    if (variables) body.variables = variables;
    return this.client.request<WeaviateGraphQLResponse>('/graphql', { method: 'POST', body });
  }

  async nearTextSearch(options: {
    className: string;
    concepts: string[];
    limit?: number;
    properties?: string[];
  }): Promise<WeaviateGraphQLResponse> {
    const props = (options.properties ?? ['_additional { id certainty }']).join(' ');
    const query = `{ Get { ${options.className}(nearText: { concepts: ${JSON.stringify(options.concepts)} }, limit: ${options.limit ?? 5}) { ${props} } } }`;
    return this.graphqlQuery(query);
  }

  async getNode(): Promise<WeaviateNodeInfo> {
    return this.client.request<WeaviateNodeInfo>('/nodes');
  }

  getClient(): WeaviateClient {
    return this.client;
  }
}
