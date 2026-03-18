// Evervault Connector — Encryption and data security infrastructure
import { EvervaultClient } from './client';
import type { EvervaultConfig, EVEncryptResult, EVDecryptResult, EVFunction, EVFunctionRunResult, EVCage, EVApp } from '../types';
export { EvervaultClient } from './client';

export class Evervault {
  private readonly client: EvervaultClient;
  constructor(config: EvervaultConfig) { this.client = new EvervaultClient(config); }
  static fromEnv(): Evervault {
    const appId = process.env.EVERVAULT_APP_ID;
    const apiKey = process.env.EVERVAULT_API_KEY;
    if (!appId || !apiKey) throw new Error('EVERVAULT_APP_ID and EVERVAULT_API_KEY are required');
    return new Evervault({ appId, apiKey });
  }

  async encrypt(data: unknown): Promise<EVEncryptResult> {
    return this.client.request<EVEncryptResult>('/encrypt', { method: 'POST', body: { data } as Record<string, unknown> });
  }
  async decrypt(data: unknown): Promise<EVDecryptResult> {
    return this.client.request<EVDecryptResult>('/decrypt', { method: 'POST', body: { data } as Record<string, unknown> });
  }

  async listFunctions(): Promise<EVFunction[]> { return this.client.request<EVFunction[]>('/functions'); }
  async runFunction(functionName: string, data: Record<string, unknown>): Promise<EVFunctionRunResult> {
    return this.client.request<EVFunctionRunResult>(`/functions/${functionName}/runs`, { method: 'POST', body: data });
  }

  async listCages(): Promise<EVCage[]> { return this.client.request<EVCage[]>('/cages'); }

  async getApp(): Promise<EVApp> { return this.client.request<EVApp>('/apps/current'); }

  async createToken(data: unknown, expiry?: number): Promise<{ token: string; expiry: number }> {
    return this.client.request('/client-side-tokens', { method: 'POST', body: { payload: data, expiry } as Record<string, unknown> });
  }

  getClient(): EvervaultClient { return this.client; }
}
