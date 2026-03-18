// ConvertAPI Connector — File conversion and document processing
import { ConvertAPIClient } from './client';
import type { ConvertAPIConfig, CAConversion, CAFormat, CAUser } from '../types';
export { ConvertAPIClient } from './client';

export class ConvertAPI {
  private readonly client: ConvertAPIClient;
  constructor(config: ConvertAPIConfig) { this.client = new ConvertAPIClient(config); }
  static fromEnv(): ConvertAPI {
    const apiKey = process.env.CONVERTAPI_API_KEY;
    if (!apiKey) throw new Error('CONVERTAPI_API_KEY is required');
    return new ConvertAPI({ apiKey });
  }

  async convert(fromFormat: string, toFormat: string, options: { File?: string; Url?: string; FileName?: string; StoreFile?: boolean; [key: string]: unknown }): Promise<CAConversion> {
    return this.client.request<CAConversion>(`/convert/${fromFormat}/to/${toFormat}`, { method: 'POST', body: { Parameters: Object.entries(options).map(([Name, Value]) => ({ Name, Value })) } });
  }

  async convertUrl(url: string, toFormat: string, options?: Record<string, unknown>): Promise<CAConversion> {
    return this.convert('web', toFormat, { Url: url, ...options });
  }

  async listFormats(): Promise<CAFormat[]> { return this.client.request<CAFormat[]>('/info/formats'); }
  async getUser(): Promise<CAUser> { return this.client.request<CAUser>('/user'); }

  getClient(): ConvertAPIClient { return this.client; }
}
