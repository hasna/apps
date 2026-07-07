import type { VeriphoneConfig, VerifyPhoneOptions, VerifyPhoneSuccessResponse } from '../types';
import { VeriphoneClient } from './client';

export class Veriphone {
  private readonly client: VeriphoneClient;

  constructor(config: VeriphoneConfig) {
    this.client = new VeriphoneClient(config);
  }

  static fromEnv(): Veriphone {
    const apiKey = process.env.VERIPHONE_API_KEY;
    const baseUrl = process.env.VERIPHONE_BASE_URL;
    if (!apiKey) {
      throw new Error('VERIPHONE_API_KEY environment variable is required');
    }
    return new Veriphone({ apiKey, baseUrl });
  }

  /** Verify a phone number via GET /verify */
  async verifyPhone(options: VerifyPhoneOptions): Promise<VerifyPhoneSuccessResponse> {
    const params: Record<string, string> = { phone: options.phone };
    if (options.defaultCountry) {
      params.default_country = options.defaultCountry;
    }
    return this.client.get<VerifyPhoneSuccessResponse>('/verify', params);
  }

  /** Verify a phone number via POST /verify */
  async verifyPhonePost(options: VerifyPhoneOptions): Promise<VerifyPhoneSuccessResponse> {
    const body: Record<string, string> = { phone: options.phone };
    if (options.defaultCountry) {
      body.default_country = options.defaultCountry;
    }
    return this.client.post<VerifyPhoneSuccessResponse>('/verify', body);
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): VeriphoneClient {
    return this.client;
  }
}

export { VeriphoneClient } from './client';
