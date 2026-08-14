import type { WandbClient } from './client';

export class GraphqlApi {
  constructor(private readonly client: WandbClient) {}

  async execute<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return this.client.query<T>(query, variables);
  }
}
