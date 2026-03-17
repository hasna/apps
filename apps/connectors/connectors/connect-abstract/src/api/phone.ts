import type { ConnectorClient } from './client';
import type { PhoneValidationParams, PhoneValidationResult } from '../types';

const BASE_URL = 'https://phonevalidation.abstractapi.com';

export class PhoneApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Validate a phone number.
   * Returns validity, format, country, carrier, and type info.
   */
  async validate(params: PhoneValidationParams): Promise<PhoneValidationResult> {
    return this.client.get<PhoneValidationResult>('/v1/', { phone: params.phone }, BASE_URL);
  }
}
