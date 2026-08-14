import type { TelnyxClient } from './client';
import type {
  AvailablePhoneNumber,
  SearchAvailableNumbersParams,
  TelnyxListResponse,
} from '../types';

/**
 * Telnyx Number Search API — find phone numbers available to purchase.
 * `GET /available_phone_numbers`. A `country_code` filter is required upstream.
 */
export class AvailableNumbersApi {
  constructor(private readonly client: TelnyxClient) {}

  /**
   * Search for available phone numbers matching the given filters.
   */
  async search(
    params: SearchAvailableNumbersParams = {}
  ): Promise<TelnyxListResponse<AvailablePhoneNumber>> {
    const query: Record<string, unknown> = {
      'filter[country_code]': params.country_code,
      'filter[phone_number][starts_with]': params.starts_with,
      'filter[phone_number][ends_with]': params.ends_with,
      'filter[phone_number][contains]': params.contains,
      'filter[locality]': params.locality,
      'filter[administrative_area]': params.administrative_area,
      'filter[national_destination_code]': params.national_destination_code,
      'filter[phone_number_type]': params.phone_number_type,
      'filter[features]': params.features,
      'filter[limit]': params.limit,
      'filter[best_effort]': params.best_effort,
      'filter[quickship]': params.quickship,
      'filter[reservable]': params.reservable,
      'filter[exclude_held_numbers]': params.exclude_held_numbers,
    };
    return this.client.get<TelnyxListResponse<AvailablePhoneNumber>>(
      '/available_phone_numbers',
      query
    );
  }
}
