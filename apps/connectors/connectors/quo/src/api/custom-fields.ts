import type { QuoClient } from './client';
import type { CustomFieldListResponse } from '../types';

/**
 * Custom Fields API module
 * Get contact custom field definitions
 */
export class CustomFieldsApi {
  constructor(private readonly client: QuoClient) {}

  /**
   * List all contact custom field definitions
   */
  async list(): Promise<CustomFieldListResponse> {
    return this.client.get<CustomFieldListResponse>('/contact-custom-fields');
  }
}
