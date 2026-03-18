// Oura Connector — Oura Ring health and sleep tracking data
import { OuraClient } from './client';
import type { OuraConfig, OuraSleep, OuraActivity, OuraReadiness, OuraHeartRate, OuraPersonalInfo, OuraDataList } from '../types';
export { OuraClient } from './client';

export class Oura {
  private readonly client: OuraClient;
  constructor(config: OuraConfig) { this.client = new OuraClient(config); }
  static fromEnv(): Oura {
    const token = process.env.OURA_TOKEN;
    if (!token) throw new Error('OURA_TOKEN is required');
    return new Oura({ token });
  }

  async getSleepPeriods(options?: { start_date?: string; end_date?: string; next_token?: string }): Promise<OuraDataList<OuraSleep>> {
    return this.client.request<OuraDataList<OuraSleep>>('/usercollection/sleep', { start_date: options?.start_date, end_date: options?.end_date, next_token: options?.next_token });
  }

  async getDailyActivity(options?: { start_date?: string; end_date?: string; next_token?: string }): Promise<OuraDataList<OuraActivity>> {
    return this.client.request<OuraDataList<OuraActivity>>('/usercollection/daily_activity', { start_date: options?.start_date, end_date: options?.end_date, next_token: options?.next_token });
  }

  async getDailyReadiness(options?: { start_date?: string; end_date?: string; next_token?: string }): Promise<OuraDataList<OuraReadiness>> {
    return this.client.request<OuraDataList<OuraReadiness>>('/usercollection/daily_readiness', { start_date: options?.start_date, end_date: options?.end_date, next_token: options?.next_token });
  }

  async getHeartRate(options?: { start_datetime?: string; end_datetime?: string; next_token?: string }): Promise<OuraDataList<OuraHeartRate>> {
    return this.client.request<OuraDataList<OuraHeartRate>>('/usercollection/heartrate', { start_datetime: options?.start_datetime, end_datetime: options?.end_datetime, next_token: options?.next_token });
  }

  async getPersonalInfo(): Promise<OuraPersonalInfo> { return this.client.request<OuraPersonalInfo>('/usercollection/personal_info'); }

  getClient(): OuraClient { return this.client; }
}
