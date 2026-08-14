import { SpongeClient, compact } from './client';
import type { CreateAgentParams, UpdateAgentParams } from '../types';

/**
 * Agents API — manage agent wallets, their spending limits, and API keys.
 */
export class AgentsApi {
  constructor(private readonly client: SpongeClient) {}

  /** Get the agent associated with the current API key. */
  me(): Promise<unknown> {
    return this.client.get('/api/agents/me');
  }

  /** List agents. */
  list(options: { includeBalances?: boolean } = {}): Promise<unknown> {
    return this.client.get('/api/agents/', {
      includeBalances: options.includeBalances,
    });
  }

  /** Create a new agent. */
  create(params: CreateAgentParams): Promise<unknown> {
    return this.client.post('/api/agents/', compact({ ...params }));
  }

  /** Get an agent by id. */
  get(id: string, options: { includeBalances?: boolean } = {}): Promise<unknown> {
    return this.client.get(`/api/agents/${encodeURIComponent(id)}`, {
      includeBalances: options.includeBalances,
    });
  }

  /** Update an agent. */
  update(id: string, params: UpdateAgentParams): Promise<unknown> {
    return this.client.put(`/api/agents/${encodeURIComponent(id)}`, compact({ ...params }));
  }

  /** Delete an agent. */
  delete(id: string): Promise<unknown> {
    return this.client.delete(`/api/agents/${encodeURIComponent(id)}`);
  }

  /** Get an agent's API key. */
  getApiKey(id: string): Promise<unknown> {
    return this.client.get(`/api/agents/${encodeURIComponent(id)}/api-key`);
  }

  /** Regenerate an agent's API key. */
  regenerateKey(id: string): Promise<unknown> {
    return this.client.post(`/api/agents/${encodeURIComponent(id)}/regenerate-key`, {});
  }
}
