import type { TelnyxClient } from './client';
import type { NumberLookupParams, NumberLookupResult, TelnyxResponse } from '../types';

/**
 * Telnyx Number Lookup API — carrier and caller-name data for a phone number.
 * `GET /number_lookup/{phone_number}`.
 */
export class NumberLookupApi {
  constructor(private readonly client: TelnyxClient) {}

  /**
   * Look up carrier / caller information for a phone number (E.164 format).
   * Pass `type` to request enrichments, e.g. "carrier" or "caller-name".
   */
  async lookup(phoneNumber: string, params: NumberLookupParams = {}): Promise<NumberLookupResult> {
    if (!phoneNumber) {
      throw new Error('A phone number is required for lookup');
    }
    const response = await this.client.get<TelnyxResponse<NumberLookupResult>>(
      `/number_lookup/${encodeURIComponent(phoneNumber)}`,
      { type: params.type }
    );
    return response.data;
  }
}
