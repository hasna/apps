import type { HarryPotterConfig } from '../types';
import { HarryPotterApiError } from '../types';

export class HarryPotterClient {
  private readonly baseUrl: string;

  constructor(config: HarryPotterConfig = {}) {
    this.baseUrl = (config.baseUrl || 'https://hp-api.onrender.com/api').replace(/\/$/, '');
  }

  async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) throw new HarryPotterApiError(response.statusText, response.status);
    return (await response.json()) as T;
  }
}
