import type { WildcardConfig } from '../types';
import { WildcardClient } from './client';
import { FlowsApi } from './flows';
import { QueryApi } from './query';
import { SearchApi } from './search';
import { apiPath, methodFrom, withQuery } from '../utils/args';

export class Wildcard {
  private readonly client: WildcardClient;
  private readonly config: WildcardConfig;

  public readonly search: SearchApi;
  public readonly query: QueryApi;
  public readonly flows: FlowsApi;

  constructor(config: WildcardConfig) {
    this.config = config;
    this.client = new WildcardClient(config);
    this.search = new SearchApi(this.client, config.defaultCollectionId);
    this.query = new QueryApi(this.client);
    this.flows = new FlowsApi(config);
  }

  static fromEnv(): Wildcard {
    const apiKey = process.env.WILDCARD_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('WILDCARD_API_KEY environment variable is required');
    }

    let providerAuthJson: WildcardConfig['providerAuthJson'];
    const rawProviderAuth = process.env.WILDCARD_PROVIDER_AUTH_JSON?.trim();
    if (rawProviderAuth) {
      const parsed = JSON.parse(rawProviderAuth);
      providerAuthJson = parsed;
    }

    return new Wildcard({
      apiKey,
      baseUrl: process.env.WILDCARD_BASE_URL?.trim(),
      defaultCollectionId: process.env.WILDCARD_DEFAULT_COLLECTION_ID?.trim(),
      providerAuthJson,
    });
  }

  async rawRequest(args: Record<string, unknown>): Promise<unknown> {
    const method = methodFrom(args.method);
    const path = withQuery(
      apiPath(requireString(args.path ?? '/', 'path')),
      args.query as Record<string, string | number | boolean> | undefined,
    );
    return this.client.request(path, {
      method,
      body: method === 'GET' ? undefined : ((args.body as Record<string, unknown>) ?? {}),
      headers: args.headers as Record<string, string> | undefined,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): WildcardClient {
    return this.client;
  }

  getConfig(): WildcardConfig {
    return this.config;
  }
}

export { WildcardClient } from './client';
export { SearchApi } from './search';
export { QueryApi } from './query';
export { FlowsApi } from './flows';

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Wildcard: ${label} is required`);
  }
  return value.trim();
}
