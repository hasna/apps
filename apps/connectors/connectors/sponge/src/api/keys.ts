import { SpongeClient, compact } from './client';
import type { AgentKeyParams } from '../types';

/**
 * Agent Service Keys API (Secrets) — store and retrieve third-party service
 * credentials scoped to an agent.
 */
export class KeysApi {
  constructor(private readonly client: SpongeClient) {}

  /** Store a service key for an agent. */
  store(params: AgentKeyParams): Promise<unknown> {
    return this.client.post('/api/agent-keys', compact({ ...params }));
  }

  /** List stored service keys (metadata only). */
  list(options: { agentId?: string; service?: string } = {}): Promise<unknown> {
    return this.client.get('/api/agent-keys', {
      agentId: options.agentId,
      service: options.service,
    });
  }

  /** Delete a stored service key. */
  delete(service: string, options: { agentId?: string } = {}): Promise<unknown> {
    return this.client.delete('/api/agent-keys', {
      service,
      agentId: options.agentId,
    });
  }

  /** Retrieve the raw value of a stored service key. */
  value(service: string, options: { agentId?: string } = {}): Promise<unknown> {
    return this.client.get('/api/agent-keys/value', {
      service,
      agentId: options.agentId,
    });
  }
}
