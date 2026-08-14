import type { QuoClient } from './client';
import type { PhoneNumber, PhoneNumberListResponse } from '../types';

/**
 * Phone Numbers API module
 * List and get phone number details
 */
export class PhoneNumbersApi {
  constructor(private readonly client: QuoClient) {}

  /**
   * List all phone numbers in the workspace
   */
  async list(): Promise<PhoneNumberListResponse> {
    return this.client.get<PhoneNumberListResponse>('/phone-numbers');
  }

  /**
   * Get a phone number by ID
   */
  async get(phoneNumberId: string): Promise<{ data: PhoneNumber }> {
    return this.client.get<{ data: PhoneNumber }>(`/phone-numbers/${phoneNumberId}`);
  }
}
