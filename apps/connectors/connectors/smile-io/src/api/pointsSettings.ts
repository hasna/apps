import type { SmileClient } from './client';
import type { PointsSettings, PointsSettingsResponse } from '../types';

/**
 * Points Settings API — the account's points currency branding.
 * Endpoint: GET /points_settings
 */
export class PointsSettingsApi {
  constructor(private readonly client: SmileClient) {}

  /** Get the account's points settings (points label singular/plural). */
  async get(): Promise<PointsSettings> {
    const response = await this.client.request<PointsSettingsResponse>('/points_settings');
    return response.points_settings;
  }
}
