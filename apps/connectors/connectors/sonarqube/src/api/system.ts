import type { SonarQubeClient } from './client';
import type { SystemHealth, SystemStatus } from '../types';

export class SystemApi {
  constructor(private readonly client: SonarQubeClient) {}

  async status(): Promise<SystemStatus> {
    return this.client.get<SystemStatus>('/api/system/status');
  }

  async health(): Promise<SystemHealth> {
    return this.client.get<SystemHealth>('/api/system/health');
  }

  async ping(): Promise<string> {
    const result = await this.client.get<{ status?: string } | string>('/api/system/ping');
    return typeof result === 'string' ? result : result.status ?? 'ok';
  }
}
