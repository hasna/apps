// Plivo Connector
// SMS, MMS, and voice call communications API

import { PlivoClient } from './client';
import type {
  PlivoConfig,
  PlivoMessage,
  PlivoMessageRecord,
  PlivoCall,
  PlivoCallRecord,
  PlivoNumber,
  PlivoAccount,
} from '../types';

export { PlivoClient } from './client';

export class Plivo {
  private readonly client: PlivoClient;

  constructor(config: PlivoConfig) {
    this.client = new PlivoClient(config);
  }

  static fromEnv(): Plivo {
    const authId = process.env.PLIVO_AUTH_ID;
    const authToken = process.env.PLIVO_AUTH_TOKEN;
    if (!authId || !authToken) throw new Error('PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN are required');
    return new Plivo({ authId, authToken });
  }

  // ============================================
  // Account
  // ============================================

  async getAccount(): Promise<PlivoAccount> {
    return this.client.request<PlivoAccount>('/');
  }

  // ============================================
  // Messages (SMS/MMS)
  // ============================================

  async sendMessage(options: {
    src: string;
    dst: string;
    text: string;
    type?: 'sms' | 'mms';
    url?: string;
    method?: 'GET' | 'POST';
    mediaUrls?: string[];
  }): Promise<PlivoMessage> {
    return this.client.request<PlivoMessage>('/Message/', {
      method: 'POST',
      body: {
        src: options.src,
        dst: options.dst,
        text: options.text,
        type: options.type,
        url: options.url,
        method: options.method,
        media_urls: options.mediaUrls,
      },
    });
  }

  async getMessage(messageUuid: string): Promise<PlivoMessageRecord> {
    return this.client.request<PlivoMessageRecord>(`/Message/${messageUuid}/`);
  }

  async listMessages(options?: {
    limit?: number;
    offset?: number;
    subAccount?: string;
    callDirection?: string;
    fromNumber?: string;
    toNumber?: string;
  }): Promise<{ api_id: string; meta: { limit: number; offset: number; total_count: number }; objects: PlivoMessageRecord[] }> {
    return this.client.request('/Message/', { params: options as Record<string, string | number | undefined> });
  }

  // ============================================
  // Calls (Voice)
  // ============================================

  async makeCall(options: {
    from: string;
    to: string;
    answerUrl: string;
    answerMethod?: 'GET' | 'POST';
    hangupUrl?: string;
    callerName?: string;
    timeLimit?: number;
  }): Promise<PlivoCall> {
    return this.client.request<PlivoCall>('/Call/', {
      method: 'POST',
      body: {
        from: options.from,
        to: options.to,
        answer_url: options.answerUrl,
        answer_method: options.answerMethod || 'POST',
        hangup_url: options.hangupUrl,
        caller_name: options.callerName,
        time_limit: options.timeLimit,
      },
    });
  }

  async getCall(callUuid: string): Promise<PlivoCallRecord> {
    return this.client.request<PlivoCallRecord>(`/Call/${callUuid}/`);
  }

  async listCalls(options?: {
    limit?: number;
    offset?: number;
    billDuration?: number;
    fromNumber?: string;
    toNumber?: string;
    callDirection?: string;
  }): Promise<{ api_id: string; meta: { total_count: number }; objects: PlivoCallRecord[] }> {
    return this.client.request('/Call/', { params: options as Record<string, string | number | undefined> });
  }

  async hangupCall(callUuid: string): Promise<void> {
    await this.client.request(`/Call/${callUuid}/`, { method: 'DELETE' });
  }

  // ============================================
  // Phone Numbers
  // ============================================

  async listNumbers(options?: { limit?: number; offset?: number }): Promise<{ api_id: string; objects: PlivoNumber[] }> {
    return this.client.request('/Number/', { params: options });
  }

  async getNumber(number: string): Promise<PlivoNumber> {
    return this.client.request<PlivoNumber>(`/Number/${number}/`);
  }

  getClient(): PlivoClient {
    return this.client;
  }
}
