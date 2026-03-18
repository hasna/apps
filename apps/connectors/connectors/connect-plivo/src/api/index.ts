// Plivo Connector — Cloud communications platform for voice and SMS
import { PlivoClient } from './client';
import type { PlivoConfig, PlivoMessage, PlivoMessageList, PlivoCall, PlivoCallList, PlivoNumber, PlivoAccount } from '../types';
export { PlivoClient } from './client';

export class Plivo {
  private readonly client: PlivoClient;
  constructor(config: PlivoConfig) { this.client = new PlivoClient(config); }
  static fromEnv(): Plivo {
    const authId = process.env.PLIVO_AUTH_ID;
    const authToken = process.env.PLIVO_AUTH_TOKEN;
    if (!authId || !authToken) throw new Error('PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN are required');
    return new Plivo({ authId, authToken });
  }

  async sendMessage(from: string, to: string, text: string): Promise<{ message_uuid: string[] }> {
    return this.client.request('/Message', { method: 'POST', body: { src: from, dst: to, text } });
  }
  async getMessage(messageUuid: string): Promise<PlivoMessage> { return this.client.request<PlivoMessage>(`/Message/${messageUuid}`); }
  async listMessages(options?: { limit?: number; offset?: number }): Promise<PlivoMessageList> {
    return this.client.request<PlivoMessageList>('/Message', { params: { limit: options?.limit, offset: options?.offset } });
  }

  async makeCall(from: string, to: string, answerUrl: string): Promise<{ request_uuid: string }> {
    return this.client.request('/Call', { method: 'POST', body: { from, to, answer_url: answerUrl } });
  }
  async getCall(callUuid: string): Promise<PlivoCall> { return this.client.request<PlivoCall>(`/Call/${callUuid}`); }
  async listCalls(options?: { limit?: number; offset?: number }): Promise<PlivoCallList> {
    return this.client.request<PlivoCallList>('/Call', { params: { limit: options?.limit, offset: options?.offset } });
  }
  async hangupCall(callUuid: string): Promise<void> { await this.client.request(`/Call/${callUuid}`, { method: 'DELETE' }); }

  async listNumbers(): Promise<{ meta: Record<string, unknown>; objects: PlivoNumber[] }> { return this.client.request('/Number'); }
  async getNumber(number: string): Promise<PlivoNumber> { return this.client.request<PlivoNumber>(`/Number/${number}`); }

  async getAccount(): Promise<PlivoAccount> { return this.client.request<PlivoAccount>(''); }

  getClient(): PlivoClient { return this.client; }
}
