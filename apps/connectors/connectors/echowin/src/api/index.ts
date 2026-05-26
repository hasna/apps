// Echowin Connector — AI-powered phone answering and call management
import { EchowinClient } from './client';
import type { EchowinConfig, EWScenario, EWCall, EWCallList, EWPhoneNumber, EWAnalytics } from '../types';
export { EchowinClient } from './client';

export class Echowin {
  private readonly client: EchowinClient;
  constructor(config: EchowinConfig) { this.client = new EchowinClient(config); }
  static fromEnv(): Echowin {
    const apiKey = process.env.ECHOWIN_API_KEY;
    if (!apiKey) throw new Error('ECHOWIN_API_KEY is required');
    return new Echowin({ apiKey });
  }

  async listScenarios(): Promise<EWScenario[]> { return this.client.request<EWScenario[]>('/scenarios'); }
  async getScenario(scenarioId: string): Promise<EWScenario> { return this.client.request<EWScenario>(`/scenarios/${scenarioId}`); }
  async createScenario(data: { name: string; description?: string; greeting?: string; phone_number?: string }): Promise<EWScenario> {
    return this.client.request<EWScenario>('/scenarios', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateScenario(scenarioId: string, data: { name?: string; greeting?: string; status?: string }): Promise<EWScenario> {
    return this.client.request<EWScenario>(`/scenarios/${scenarioId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }

  async listCalls(options?: { page?: number; per_page?: number; scenario_id?: string }): Promise<EWCallList> {
    return this.client.request<EWCallList>('/calls', { params: { page: options?.page, per_page: options?.per_page, scenario_id: options?.scenario_id } });
  }
  async getCall(callId: string): Promise<EWCall> { return this.client.request<EWCall>(`/calls/${callId}`); }
  async getCallTranscript(callId: string): Promise<{ transcript: string }> { return this.client.request(`/calls/${callId}/transcript`); }

  async listPhoneNumbers(): Promise<EWPhoneNumber[]> { return this.client.request<EWPhoneNumber[]>('/phone-numbers'); }

  async getAnalytics(options?: { from?: string; to?: string; scenario_id?: string }): Promise<EWAnalytics> {
    return this.client.request<EWAnalytics>('/analytics', { params: { from: options?.from, to: options?.to, scenario_id: options?.scenario_id } });
  }

  getClient(): EchowinClient { return this.client; }
}
