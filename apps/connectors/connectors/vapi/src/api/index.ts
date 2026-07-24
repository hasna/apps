import type { RawRequestOptions, VapiConfig } from '../types';
import { AssistantsApi } from './assistants';
import { CallsApi } from './calls';
import { VapiClient } from './client';
import { PhoneNumbersApi } from './phone-numbers';
import { ToolsApi } from './tools';

export class Vapi {
  private readonly client: VapiClient;
  public readonly assistants: AssistantsApi;
  public readonly calls: CallsApi;
  public readonly phoneNumbers: PhoneNumbersApi;
  public readonly tools: ToolsApi;

  constructor(config: VapiConfig) {
    this.client = new VapiClient(config);
    this.assistants = new AssistantsApi(this.client);
    this.calls = new CallsApi(this.client);
    this.phoneNumbers = new PhoneNumbersApi(this.client);
    this.tools = new ToolsApi(this.client);
  }

  static fromEnv(): Vapi {
    const apiKey = process.env.VAPI_API_KEY;
    if (!apiKey) {
      throw new Error('VAPI_API_KEY environment variable is required');
    }
    return new Vapi({
      apiKey,
      baseUrl: process.env.VAPI_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  async rawRequest<T = unknown>(path: string, options: RawRequestOptions = {}): Promise<T> {
    return this.client.request<T>(path, {
      method: options.method,
      body: options.body,
      params: options.params,
    });
  }

  getClient(): VapiClient {
    return this.client;
  }
}

export { VapiClient, DEFAULT_BASE_URL } from './client';
export { AssistantsApi } from './assistants';
export { CallsApi } from './calls';
export { PhoneNumbersApi } from './phone-numbers';
export { ToolsApi } from './tools';
