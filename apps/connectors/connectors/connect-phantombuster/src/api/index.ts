// PhantomBuster Connector — Cloud-based web automation and data extraction
import { PhantomBusterClient } from './client';
import type { PhantomBusterConfig, PBAgent, PBContainer, PBOutput } from '../types';
export { PhantomBusterClient } from './client';

export class PhantomBuster {
  private readonly client: PhantomBusterClient;
  constructor(config: PhantomBusterConfig) { this.client = new PhantomBusterClient(config); }
  static fromEnv(): PhantomBuster {
    const apiKey = process.env.PHANTOMBUSTER_API_KEY;
    if (!apiKey) throw new Error('PHANTOMBUSTER_API_KEY is required');
    return new PhantomBuster({ apiKey });
  }

  async getAgent(agentId: string): Promise<PBAgent> { return this.client.request<PBAgent>('/agents/fetch', { params: { id: agentId } }); }
  async listAgents(): Promise<PBAgent[]> { return this.client.request<PBAgent[]>('/agents/fetch-all'); }

  async launchAgent(agentId: string, options?: { argument?: Record<string, unknown> }): Promise<{ containerId: string }> {
    return this.client.request('/agents/launch', { method: 'POST', body: { id: agentId, argument: options?.argument ? JSON.stringify(options.argument) : undefined } as Record<string, unknown> });
  }
  async abortAgent(agentId: string): Promise<void> {
    await this.client.request('/agents/abort', { method: 'POST', body: { id: agentId } });
  }

  async getContainer(containerId: string): Promise<PBContainer> {
    return this.client.request<PBContainer>('/containers/fetch', { params: { id: containerId } });
  }
  async getContainerOutput(containerId: string): Promise<PBOutput> {
    return this.client.request<PBOutput>('/containers/fetch-output', { params: { id: containerId } });
  }
  async getContainerResultObject(containerId: string): Promise<PBOutput> {
    return this.client.request<PBOutput>('/containers/fetch-result-object', { params: { id: containerId } });
  }

  getClient(): PhantomBusterClient { return this.client; }
}
