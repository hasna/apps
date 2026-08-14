// Real Phone Validation Connector — Phone number validation and carrier lookup
import { RealPhoneValidationClient } from './client';
import type { RealPhoneValidationConfig, RPVResult } from '../types';
export { RealPhoneValidationClient } from './client';

export class RealPhoneValidation {
  private readonly client: RealPhoneValidationClient;
  constructor(config: RealPhoneValidationConfig) { this.client = new RealPhoneValidationClient(config); }
  static fromEnv(): RealPhoneValidation {
    const apiKey = process.env.REALPHONEVALIDATION_API_KEY;
    if (!apiKey) throw new Error('REALPHONEVALIDATION_API_KEY is required');
    return new RealPhoneValidation({ apiKey });
  }

  async validate(phone: string): Promise<RPVResult> {
    return this.client.request<RPVResult>('/v2/validate', { phone });
  }

  async lookup(phone: string): Promise<RPVResult> {
    return this.client.request<RPVResult>('/v2/lookup', { phone });
  }

  async getCarrier(phone: string): Promise<{ carrier: string; phone_type: string }> {
    const result = await this.validate(phone);
    return { carrier: result.carrier, phone_type: result.phone_type };
  }

  getClient(): RealPhoneValidationClient { return this.client; }
}
