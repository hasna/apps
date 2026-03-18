// On2Air Connector — Airtable backup, forms, and automation
import { On2AirClient } from './client';
import type { On2AirConfig, O2ABackup, O2ABackupList, O2ABase, O2ASchedule } from '../types';
export { On2AirClient } from './client';

export class On2Air {
  private readonly client: On2AirClient;
  constructor(config: On2AirConfig) { this.client = new On2AirClient(config); }
  static fromEnv(): On2Air {
    const apiKey = process.env.ON2AIR_API_KEY;
    if (!apiKey) throw new Error('ON2AIR_API_KEY is required');
    return new On2Air({ apiKey });
  }

  async listBackups(options?: { page?: number; base_id?: string }): Promise<O2ABackupList> {
    return this.client.request<O2ABackupList>('/backups', { params: { page: options?.page, base_id: options?.base_id } });
  }
  async getBackup(backupId: string): Promise<O2ABackup> { return this.client.request<O2ABackup>(`/backups/${backupId}`); }
  async createBackup(baseId: string): Promise<O2ABackup> {
    return this.client.request<O2ABackup>('/backups', { method: 'POST', body: { base_id: baseId } });
  }

  async listBases(): Promise<O2ABase[]> { return this.client.request<O2ABase[]>('/bases'); }
  async getBase(baseId: string): Promise<O2ABase> { return this.client.request<O2ABase>(`/bases/${baseId}`); }

  async listSchedules(): Promise<O2ASchedule[]> { return this.client.request<O2ASchedule[]>('/schedules'); }
  async createSchedule(baseId: string, frequency: string): Promise<O2ASchedule> {
    return this.client.request<O2ASchedule>('/schedules', { method: 'POST', body: { base_id: baseId, frequency } });
  }
  async deleteSchedule(scheduleId: string): Promise<void> { await this.client.request(`/schedules/${scheduleId}`, { method: 'DELETE' }); }

  getClient(): On2AirClient { return this.client; }
}
