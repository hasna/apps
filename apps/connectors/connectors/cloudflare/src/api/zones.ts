import type { CloudflareClient } from './client';
import type { Zone, CreateZoneParams, ZoneSettings, CloudflareResponse } from '../types';

export class ZonesApi {
  constructor(private client: CloudflareClient) {}

  /**
   * List all zones
   */
  async list(params?: {
    name?: string;
    status?: string;
    page?: number;
    per_page?: number;
    order?: 'name' | 'status' | 'account.id' | 'account.name';
    direction?: 'asc' | 'desc';
    match?: 'any' | 'all';
  }): Promise<CloudflareResponse<Zone[]>> {
    return this.client.get<Zone[]>('/zones', params);
  }

  /**
   * Get zone details
   */
  async get(zoneId: string): Promise<Zone> {
    const response = await this.client.get<Zone>(`/zones/${zoneId}`);
    return response.result;
  }

  /**
   * Create a new zone
   */
  async create(params: CreateZoneParams): Promise<Zone> {
    const response = await this.client.post<Zone>('/zones', params as unknown as Record<string, unknown>);
    return response.result;
  }

  /**
   * Delete a zone
   */
  async delete(zoneId: string): Promise<{ id: string }> {
    const response = await this.client.delete<{ id: string }>(`/zones/${zoneId}`);
    return response.result;
  }

  /**
   * Get all zone settings
   */
  async getSettings(zoneId: string): Promise<ZoneSettings[]> {
    const response = await this.client.get<ZoneSettings[]>(`/zones/${zoneId}/settings`);
    return response.result;
  }

  /**
   * Get a specific zone setting
   */
  async getSetting(zoneId: string, settingId: string): Promise<ZoneSettings> {
    const response = await this.client.get<ZoneSettings>(`/zones/${zoneId}/settings/${settingId}`);
    return response.result;
  }

  /**
   * Update a zone setting
   */
  async updateSetting(zoneId: string, settingId: string, value: unknown): Promise<ZoneSettings> {
    const response = await this.client.patch<ZoneSettings>(
      `/zones/${zoneId}/settings/${settingId}`,
      { value }
    );
    return response.result;
  }

  /**
   * Edit multiple zone settings
   */
  async updateSettings(zoneId: string, items: Array<{ id: string; value: unknown }>): Promise<ZoneSettings[]> {
    const response = await this.client.patch<ZoneSettings[]>(
      `/zones/${zoneId}/settings`,
      { items }
    );
    return response.result;
  }

  /**
   * Activate zone check (initiate another zone activation check)
   */
  async activationCheck(zoneId: string): Promise<{ id: string }> {
    const response = await this.client.put<{ id: string }>(`/zones/${zoneId}/activation_check`);
    return response.result;
  }

  /**
   * Pause zone (pause Cloudflare for this zone)
   */
  async pause(zoneId: string): Promise<Zone> {
    const response = await this.client.patch<Zone>(`/zones/${zoneId}`, { paused: true });
    return response.result;
  }

  /**
   * Unpause zone (resume Cloudflare for this zone)
   */
  async unpause(zoneId: string): Promise<Zone> {
    const response = await this.client.patch<Zone>(`/zones/${zoneId}`, { paused: false });
    return response.result;
  }

  /**
   * Enable development mode
   */
  async enableDevMode(zoneId: string): Promise<ZoneSettings> {
    return this.updateSetting(zoneId, 'development_mode', 'on');
  }

  /**
   * Disable development mode
   */
  async disableDevMode(zoneId: string): Promise<ZoneSettings> {
    return this.updateSetting(zoneId, 'development_mode', 'off');
  }
}
